// Static check for the React hook-order hazard: no early `return` may sit
// between a component's hooks. React identifies hooks by call order, so a render
// that stops early calls fewer of them than the next one 鈥?React throws #310
// ("Rendered more hooks than during the previous render"), the slot entry is
// retired, and the control disappears.
//
// The bug this exists for:
//   if (!supported) return null;      <-- placed before the last useLayoutEffect
//
//   node tools/hook-order.js [file]
//
// Two things make a naive scan useless, and both bit an earlier version:
//   1. this file holds a whole stylesheet inside string literals, so braces must
//      be counted on a copy with strings/comments blanked out;
//   2. components contain nested arrows (effect callbacks, handlers), so a
//      `return` inside one of those is NOT a component-body early exit. Only a
//      return at the component body's own brace depth counts.
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2] ?? path.join(__dirname, '..', 'client.js');
const raw = fs.readFileSync(file, 'utf8');

/** Blank string/comment bodies, preserving line structure. */
function blank(text) {
  let out = '';
  let i = 0;
  const keep = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { out += keep(text[i]); i += 1; }
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ' ';
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { out += keep(text[i]); out += keep(text[i + 1] ?? ''); i += 2; continue; }
        if (text[i] === quote) break;
        out += keep(text[i]);
        i += 1;
      }
      out += ' ';
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const clean = blank(raw).split('\n');
const source = raw.split('\n');

const HOOK = /^\s*(?:const\s+.*=\s*)?(use[A-Z][A-Za-z0-9]*)\s*\(/;
/* A bare `return <expr>;` / `return null;` 鈥?not the `return () => {}` cleanup form. */
const RETURN = /^\s*(?:if\s*[({][^)]*[)}]\s*)?return\s+(?!\()/;
const FN = /^\s*(?:return\s+)?function\s+([A-Za-z0-9_]+)\s*\(/;
const FN_ARROW = /^\s*const\s+([A-Za-z0-9_]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>\s*\{/;

const problems = [];
const scanned = [];
let depth = 0;
const stack = [];

for (let i = 0; i < clean.length; i++) {
  const code = clean[i];
  const text = source[i];
  const atLineStart = depth;

  const fn = FN.exec(code) ?? FN_ARROW.exec(code);
  if (fn !== null) {
    /* Body statements of this function live one brace deeper than its header. */
    stack.push({ name: fn[1], openDepth: depth, bodyDepth: depth + 1, hooks: [], returns: [] });
  }

  if (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (atLineStart === frame.bodyDepth) {
      const hook = HOOK.exec(code);
      if (hook !== null) frame.hooks.push({ line: i + 1, name: hook[1] });
      if (RETURN.test(code)) frame.returns.push({ line: i + 1, text: text.trim() });
    }
  }

  for (const ch of code) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      while (stack.length > 0 && depth === stack[stack.length - 1].openDepth) {
        const frame = stack.pop();
        if (frame.hooks.length > 0) {
          scanned.push(frame.name + ' (' + String(frame.hooks.length) + ' hooks)');
          const first = frame.hooks[0].line;
          const last = frame.hooks[frame.hooks.length - 1].line;
          for (const r of frame.returns) {
            if (r.line > first && r.line < last) {
              problems.push(frame.name + ': early return at line ' + r.line +
                ' sits between hooks ' + first + '..' + last + '  ->  "' + r.text + '"');
            }
          }
        }
      }
    }
  }
}

console.log('scanned ' + file);
for (const c of scanned) console.log('  路 ' + c);
if (problems.length === 0) {
  console.log('\nOK: every hook runs before any early return');
  process.exit(0);
}
console.log('\nPROBLEMS:');
for (const p of problems) console.log('  - ' + p);
process.exit(1);

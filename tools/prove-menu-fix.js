// Prove the React-node guard catches the removal that blanked the model list:
// put `row.remove()` back and confirm the suite fails.
//
//   node tools/prove-menu-fix.js
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'client.js');
const good = fs.readFileSync(BUNDLE, 'utf8');

const START = 'const collapse = (row) => {';
const startAt = good.indexOf(START);
if (startAt < 0) {
  console.error('anchor not found; bundle shape changed');
  process.exit(2);
}
const endAt = good.indexOf('};', startAt) + 2;

/* The shape that shipped: delete the React-owned node outright. */
const REGRESSED = 'const collapse = (row) => {\n\t\t\t\t\t\trow.remove();\n\t\t\t\t\t};';

fs.writeFileSync(BUNDLE, good.slice(0, startAt) + REGRESSED + good.slice(endAt), 'utf8');
console.log('patched the collapse back to row.remove()');

let failed = true;
try {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'smoke.js')], { encoding: 'utf8' });
  const out = (run.stdout || '') + (run.stderr || '');
  const caught = /FAILED:.*React-owned/.test(out);
  const tail = (run.stdout || '').trim().split('\n').slice(-2).join('\n');
  if (tail) console.log(tail);
  console.log(caught
    ? '\nGOOD: the suite fails when the row is removed, so the guard is real'
    : '\nBAD: the suite passed with row.remove() in place');
  failed = !caught;
} finally {
  fs.writeFileSync(BUNDLE, good, 'utf8');
  console.log('bundle restored');
}

process.exit(failed ? 1 : 0);

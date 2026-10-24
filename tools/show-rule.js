// Print rules from the bundle's stylesheet.
//   node tools/show-rule.js ".te-rail" ".te-thumb"
//
// The sheet interpolates layout and palette constants. Rather than listing
// them here (they get renamed, and a stale list silently breaks this tool),
// every `const NAME = <string|number>;` at module scope is discovered and
// supplied.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8');

const start = source.indexOf('const CSS = [');
const end = source.indexOf('].join("");', start);
if (start < 0 || end < 0) throw new Error('CSS array not found');
const arraySource = source.slice(start + 'const CSS = '.length, end + 1);

/* Every module-scope constant the sheet interpolates is discovered from the
   bundle. Nothing is hardcoded here: an earlier version pinned the layout to
   the values it expected, and silently printed a stale sheet after they were
   retuned. */
const names = [];
const values = [];
for (const match of source.matchAll(/const ([A-Z_][A-Z0-9_]*) = ([^;]+);/g)) {
  const name = match[1];
  const raw = match[2].trim();
  if (names.includes(name)) continue;
  const str = /^"([^"]*)"$/.exec(raw);
  if (str !== null) {
    names.push(name);
    values.push(str[1]);
    continue;
  }
  const num = Number(raw);
  if (Number.isFinite(num)) {
    names.push(name);
    values.push(num);
  }
}

const css = new Function(...names, 'return ' + arraySource + '.join("");')(...values);

for (const selector of process.argv.slice(2)) {
  let at = -1;
  for (let i = css.indexOf(selector + '{'); i >= 0; i = css.indexOf(selector + '{', i + 1)) {
    const before = css[i - 1];
    if (i === 0 || before === '}' || before === '/' || before === '\n') {
      at = i;
      break;
    }
    if (at < 0) at = i;
  }
  if (at < 0) {
    console.log(selector + '  (not found)');
    continue;
  }
  console.log('\n' + css.slice(at, css.indexOf('}', at) + 1));
}

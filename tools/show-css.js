// Print the whole compiled stylesheet (or one region), from the bundle source.
//   node tools/show-css.js            -> full sheet
//   node tools/show-css.js <regex>    -> only rules matching the regex
//
// Every module-scope constant is discovered and supplied, so a retuned or
// renamed value can never leave this tool showing a stale sheet.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8');
const start = source.indexOf('const CSS = [');
const end = source.indexOf('].join("");', start);
if (start < 0 || end < 0) throw new Error('CSS array not found');
const arraySource = source.slice(start + 'const CSS = '.length, end + 1);

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

const filter = process.argv[2];
if (filter === undefined) {
  console.log(css);
} else {
  const re = new RegExp(filter);
  /* Split into rules so a match prints a whole rule rather than one fragment. */
  const rules = css.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  const hits = rules.filter((rule) => re.test(rule));
  console.log(hits.length === 0 ? '(no rule matches ' + filter + ')' : hits.join('\n'));
}

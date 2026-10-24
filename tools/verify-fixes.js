// Report whether the two fixes are present in the shipped bundle.
//   node tools/verify-fixes.js
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8');
const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const rows = [
  ['useDirectory retries instead of memoizing the failure', /attemptsRef/.test(body) && !/useMemo\(\(\) => \{\s*if \(absent\(models\)\) return null/.test(body)],
  ['the retry is bounded and stops', /attemptsRef\.current >= 40/.test(body)],
  ['the retry schedules a re-render', /setTimeout\(\(\) => setAttempt/.test(body)],
  ['the retry timer is cleaned up', /clearTimeout\(timer\)/.test(body)],
  ['the shipped effort row is collapsed, never removed', /const collapse = \(row\) =>/.test(body) && !/[a-zA-Z]\.remove\(\)/.test(body)],
  ['collapsing keeps the node (height, not display)', /style\.height = "0"/.test(body) && !/style\.display/.test(body)],
  ['the collapse is idempotent', /data-te-collapsed/.test(body)],
  ['the observer ignores attributes it writes', /childList: true, subtree: true/.test(body) && !/attributes: true/.test(body)]
];

let bad = 0;
for (const [label, ok] of rows) {
  console.log('  ' + (ok ? 'ok  ' : 'BAD ') + label);
  if (!ok) bad += 1;
}
console.log(bad === 0 ? '\nOK: both fixes are in place' : '\nFAIL: ' + String(bad) + ' check(s) failed');
process.exit(bad === 0 ? 0 : 1);

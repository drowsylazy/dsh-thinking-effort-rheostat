// Prove the hook-order gate catches the React #310 bug that shipped: move the
// `if (!supported) return null;` back above the last useLayoutEffect and assert
// that tools/hook-order.js refuses the file.
//
//   node tools/prove-hook-order.js
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUNDLE = path.join(__dirname, '..', 'client.js');
const good = fs.readFileSync(BUNDLE, 'utf8');
const lines = good.split('\n');

const at = lines.findIndex((line) => line.trim() === 'if (!supported) return null;');
if (at < 0) {
  console.error('anchor not found: the early return is missing (that is the fix)');
  process.exit(2);
}
const returnLine = lines[at];

/* Put it back where it was: immediately before the park-the-thumb effect. */
const target = lines.findIndex((line) => line.includes('/* ---- park the thumb on the settled value ----'));
if (target < 0) {
  console.error('anchor not found: park-the-thumb block');
  process.exit(2);
}
lines.splice(at, 1);
lines.splice(target, 0, returnLine, '');

fs.writeFileSync(BUNDLE, lines.join('\n'), 'utf8');
console.log('moved the early return back above the last useLayoutEffect');

let ok = true;
try {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'hook-order.js')], { encoding: 'utf8' });
  const out = (run.stdout || '') + (run.stderr || '');
  const caught = run.status !== 0 && /sits between hooks/.test(out);
  const line = out.split('\n').find((l) => l.includes('sits between hooks'));
  if (line) console.log('  caught: ' + line.trim());
  console.log(caught
    ? '\nGOOD: the gate rejects the hook-order bug'
    : '\nBAD: the gate accepted a bundle with the bug 鈥?it is not covering it');
  ok = caught;
} finally {
  fs.writeFileSync(BUNDLE, good, 'utf8');
  console.log('bundle restored');
}

process.exit(ok ? 0 : 1);

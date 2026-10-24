// Prove the smoke runtime's hook-count invariant catches React #310: reinsert
// the early return above the last useLayoutEffect and confirm the suite throws,
// rather than passing while the real page blanks the control.
//
//   node tools/prove-hook-order.js          (static gate)
//   node tools/prove-hook-order-runtime.js  (runtime invariant, this file)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUNDLE = path.join(__dirname, '..', 'client.js');
const good = fs.readFileSync(BUNDLE, 'utf8');
const lines = good.split('\n');

const at = lines.findIndex((line) => line.trim() === 'if (!supported) return null;');
const target = lines.findIndex((line) => line.includes('/* ---- park the thumb on the settled value ----'));
if (at < 0 || target < 0) {
  console.error('anchors not found');
  process.exit(2);
}
const returnLine = lines[at];
lines.splice(at, 1);
lines.splice(target, 0, returnLine, '');
fs.writeFileSync(BUNDLE, lines.join('\n'), 'utf8');
console.log('moved the early return back above the last useLayoutEffect');

let ok = true;
try {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'smoke.js')], { encoding: 'utf8' });
  const out = (run.stdout || '') + (run.stderr || '');
  const caught = /hooks on a later render/.test(out);
  const line = out.split('\n').find((l) => l.includes('hooks on a later render'));
  if (line) console.log('  caught: ' + line.trim().slice(0, 160));
  console.log(caught
    ? '\nGOOD: the runtime invariant fails on the hook-order bug'
    : '\nBAD: the suite passed with the bug in place');
  ok = caught;
} finally {
  fs.writeFileSync(BUNDLE, good, 'utf8');
  console.log('bundle restored');
}

process.exit(ok ? 0 : 1);

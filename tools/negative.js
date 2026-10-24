// Negative tests for the gates: prove each one still fails on a bad sheet.
//   node tools/negative.js
//
// Every case is expressed against the CURRENT value found in the bundle, not a
// hardcoded snapshot, so retuning a palette cannot silently turn a case into a
// no-op (an earlier version hardcoded the old constant and reported SKIP after
// the palette changed 鈥?a gate self-test that stops testing is worse than none).
//
// Each case rewrites one thing in a COPY and asserts the named gate exits
// non-zero.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const CLIENT = path.join(HERE, '..', 'client.js');
const source = fs.readFileSync(CLIENT, 'utf8');

/** Current literal of one string constant. */
function literalOf(name) {
  const match = new RegExp('const ' + name + ' = "([^"]*)";').exec(source);
  if (match === null) throw new Error('constant not found: ' + name);
  return match[1];
}
/** Current value of one numeric constant. */
function numberOf(name) {
  const match = new RegExp('const ' + name + ' = (-?[\\d.]+);').exec(source);
  if (match === null) throw new Error('numeric constant not found: ' + name);
  return match[1];
}

/** Swap the value of one string constant. */
function retune(name, value) {
  return {
    from: 'const ' + name + ' = "' + literalOf(name) + '";',
    to: 'const ' + name + ' = "' + value + '";'
  };
}
/** Swap the value of one numeric constant. */
function retuneNumber(name, value) {
  return {
    from: 'const ' + name + ' = ' + numberOf(name) + ';',
    to: 'const ' + name + ' = ' + String(value) + ';'
  };
}

const cases = [
  {
    name: 'a raw chromatic literal pasted into a rule (not a declared palette value)',
    from: 'background:" + TICK_ON + ";opacity:1',
    to: 'background:#ff2d55;opacity:1',
    gate: 'audit-css.js'
  },
  {
    name: 'an undefined theme token',
    from: '--dsw-alias-label-tertiary',
    to: '--dsw-alias-label-tertiaryy',
    gate: 'audit-css.js'
  },
  {
    name: 'a font shorthand with a CSS-wide keyword',
    from: 'font-family:inherit;font-size:11px;font-weight:500;line-height:16px;',
    to: 'font:500 11px/16px inherit;',
    gate: 'audit-css.js'
  },
  {
    /* The exact relationship that produced "瀵规瘮搴︽瀬浣? and then "杩欎箞娣?: a
       groove so heavily loaded with brand blue that the rail is a dark bar. */
    name: 'a groove so loaded it becomes a dark bar',
    ...retuneNumber('GROOVE_MIX', 92),
    gate: 'contrast.js'
  },
  {
    name: 'a groove that vanishes into the light panel',
    ...retuneNumber('GROOVE_MIX', 2),
    gate: 'contrast.js'
  },
  {
    name: 'a consumed portion that blends into the groove',
    ...retune('BRAND', '#d3e0ff'),
    gate: 'contrast.js'
  },
  {
    /* A key with no elevation: the light-theme mechanism is ring + shadow, so
       removing the shadow layers must fail the gate. Expressed against the
       current constant names, not a literal snapshot. */
    name: 'a flattened key with no shadow depth',
    from: '"box-shadow:0 0 0 1px " + THUMB_RING + ",0 1px 2px " + THUMB_DROP + "," +\n\t\t\t"0 3px 8px " + THUMB_LIFT + ";",',
    to: '"box-shadow:none;padding-right:0;",',
    gate: 'contrast.js'
  }
];

let failures = 0;
for (const item of cases) {
  if (!source.includes(item.from)) {
    /* A pattern that no longer matches means this self-test stopped covering
       the case 鈥?report it as a failure, not a skip. */
    console.log('  BAD     ' + item.name + '   (pattern not found, case is dead)');
    failures += 1;
    continue;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-neg-'));
  const file = path.join(dir, 'client.js');
  fs.writeFileSync(file, source.split(item.from).join(item.to), 'utf8');
  const run = spawnSync(process.execPath, [path.join(HERE, item.gate), file], { encoding: 'utf8' });
  const rejected = run.status !== 0;
  console.log('  ' + (rejected ? 'GOOD' : 'BAD ') + '    ' + item.gate + ' rejects ' + item.name);
  if (!rejected) {
    failures += 1;
    console.log('        ' + (run.stdout || '').trim().split('\n').slice(-3).join('\n        '));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0
  ? '\nOK: every gate rejects the defect it is meant to catch'
  : '\nFAIL: ' + String(failures) + ' gate(s) did not catch their defect');
process.exit(failures === 0 ? 0 : 1);

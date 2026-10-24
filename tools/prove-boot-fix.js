// Prove the boot-order regression test actually catches the bug it was written
// for: swap `useDirectory` back to the memoized version that cached the first
// failure forever, then confirm the suite fails.
//
//   node tools/prove-boot-fix.mjs [--keep]
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'client.js');
const good = fs.readFileSync(BUNDLE, 'utf8');

const START = '\t\tfunction useDirectory(models, sessionId, directoryCache) {';
const END_MARK = '\t\t\treturn directory;\n\t\t}';
const startAt = good.indexOf(START);
const endAt = good.indexOf(END_MARK, startAt);
if (startAt < 0 || endAt < 0) {
  console.error('anchors not found; bundle shape changed');
  process.exit(2);
}
const end = endAt + END_MARK.length;

/** The shape that shipped: resolve once, cache the failure permanently. */
const REGRESSED = [
  '\t\tfunction useDirectory(models, sessionId, directoryCache) {',
  '\t\t\treturn useMemo(() => {',
  '\t\t\t\tif (absent(models)) return null;',
  '\t\t\t\tif (typeof sessionId !== "string" || sessionId.length === 0) return null;',
  '\t\t\t\tconst cached = directoryCache.get(sessionId);',
  '\t\t\t\tif (cached !== void 0) return cached;',
  '\t\t\t\ttry {',
  '\t\t\t\t\tconst found = models.directoryFor(sessionId);',
  '\t\t\t\t\tdirectoryCache.set(sessionId, found);',
  '\t\t\t\t\treturn found;',
  '\t\t\t\t} catch (error) {',
  '\t\t\t\t\treturn null;',
  '\t\t\t\t}',
  '\t\t\t}, [models, sessionId, directoryCache]);',
  '\t\t}'
].join('\n');

fs.writeFileSync(BUNDLE, good.slice(0, startAt) + REGRESSED + good.slice(end), 'utf8');
console.log('patched bundle back to the memoized (buggy) useDirectory');

let failed = true;
try {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'smoke.js')], { encoding: 'utf8' });
  const out = run.stdout + run.stderr;
  const caught = /FAILED:.*addressable|FAILED:.*appears once/.test(out);
  console.log(run.stdout.trim().split('\n').slice(-3).join('\n'));
  console.log(caught
    ? '\nGOOD: the suite fails on the memoized version, so the fix is genuinely covered'
    : '\nBAD: the suite passed on the buggy version 鈥?the test does not cover the bug');
  failed = !caught;
} finally {
  fs.writeFileSync(BUNDLE, good, 'utf8');
  console.log('bundle restored');
}

process.exit(failed ? 1 : 0);

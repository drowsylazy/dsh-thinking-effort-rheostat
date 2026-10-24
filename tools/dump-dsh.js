const fs = require('fs');
const OUT = 'F:\\dsh-thinking-effort-rheostat\\tools\\dsh-fields.txt';
const lines = [];
const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(ASAR, 'r');
const sb = Buffer.alloc(8);
fs.readSync(fd, sb, 0, 8, 0);
const H = sb.readUInt32LE(4);
const hb = Buffer.alloc(H);
fs.readSync(fd, hb, 0, H, 8);
const jsonLen = hb.readUInt32LE(4);
const header = JSON.parse(hb.toString('utf8', 8, 8 + jsonLen));
const BASE = 8 + H;
function readEnt(e) {
  const b = Buffer.alloc(e.size);
  fs.readSync(fd, b, 0, e.size, BASE + Number(e.offset));
  return b.toString('utf8');
}
const acc = [];
(function walk(n, p) {
  if (!n.files) return;
  for (const k of Object.keys(n.files)) {
    const c = n.files[k], q = p + '/' + k;
    if (c.files) walk(c, q);
    else if (k === 'package.json' && /@deepseek-ai/.test(q)) acc.push({ p: q, e: c });
  }
})(header, '');

for (const { p, e } of acc.sort((a, b) => a.p.localeCompare(b.p))) {
  let j;
  try { j = JSON.parse(readEnt(e)); } catch (err) { continue; }
  if (!j.dsh) continue;
  const keys = Object.keys(j.dsh);
  const isBundle = keys.some(k => k === 'profile' || k === 'patch' || k === 'bundle' || k === 'rows');
  lines.push('=== ' + j.name + '@' + j.version + (isBundle ? '   [BUNDLE?]' : '') + '  dsh keys=' + JSON.stringify(keys));
  lines.push(JSON.stringify(j.dsh, null, 1).split('\n').map(s => '   ' + s).join('\n'));
}
fs.closeSync(fd);
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('packages with dsh: ' + lines.filter(l => l.startsWith('===')).length);

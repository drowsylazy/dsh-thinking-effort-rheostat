// 通用 asar 读取工具
//   node tools/asar.js list  <dir>
//   node tools/asar.js cat   <file> [maxBytes]
//   node tools/asar.js find  <regex>
//   node tools/asar.js grep  <regex> <pathPrefix> [maxHits]
const fs = require('fs');
const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';

const fd = fs.openSync(ASAR, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const H = sizeBuf.readUInt32LE(4);
const headBuf = Buffer.alloc(H);
fs.readSync(fd, headBuf, 0, H, 8);
const jsonLen = headBuf.readUInt32LE(4);
const header = JSON.parse(headBuf.toString('utf8', 8, 8 + jsonLen));
const BASE = 8 + H;

function nodeAt(p) {
  const parts = p.split('/').filter(Boolean);
  let n = header;
  for (const part of parts) {
    if (!n.files || !n.files[part]) return null;
    n = n.files[part];
  }
  return n;
}
function readEnt(ent) {
  const b = Buffer.alloc(ent.size);
  fs.readSync(fd, b, 0, ent.size, BASE + Number(ent.offset));
  return b.toString('utf8');
}
function readPath(p) {
  const n = nodeAt(p);
  if (!n || n.files) return null;
  return readEnt(n);
}
function allFiles(node, prefix, acc) {
  if (!node.files) return acc;
  for (const k of Object.keys(node.files)) {
    const c = node.files[k];
    const p = prefix + '/' + k;
    if (c.files) allFiles(c, p, acc);
    else acc.push({ path: p, size: c.size });
  }
  return acc;
}
const ALL = allFiles(header, '', []);

const [cmd, a1, a2, a3] = process.argv.slice(2);
if (cmd === 'list') {
  const n = nodeAt(a1);
  if (!n || !n.files) { console.log('(not a dir)'); process.exit(0); }
  for (const k of Object.keys(n.files).sort()) {
    const c = n.files[k];
    console.log((c.files ? '[d] ' : '    ') + k + (c.files ? '' : '   ' + c.size));
  }
} else if (cmd === 'cat') {
  const n = nodeAt(a1);
  if (!n || n.files) { console.log('(not a file)'); process.exit(0); }
  const max = a2 ? Number(a2) : n.size;
  const b = Buffer.alloc(Math.min(n.size, max));
  fs.readSync(fd, b, 0, b.length, BASE + Number(n.offset));
  console.log('--- ' + a1 + '  size=' + n.size + ' shown=' + b.length + ' ---');
  console.log(b.toString('utf8'));
} else if (cmd === 'find') {
  const re = new RegExp(a1, 'i');
  ALL.filter(f => re.test(f.path)).forEach(f => console.log(String(f.size).padStart(8) + '  ' + f.path));
} else if (cmd === 'grep') {
  const re = new RegExp(a1);
  const prefix = a2 || '/dsh/node_modules/@deepseek-ai';
  const max = a3 ? Number(a3) : 40;
  let hits = 0;
  for (const f of ALL) {
    if (!f.path.startsWith(prefix)) continue;
    if (f.size > 3e6) continue;
    let txt;
    try { txt = readPath(f.path); } catch (e) { continue; }
    if (txt == null) continue;
    const ls = txt.split('\n');
    for (let i = 0; i < ls.length; i++) {
      if (re.test(ls[i])) {
        console.log(f.path + ':' + (i + 1) + ': ' + ls[i].trim().slice(0, 220));
        if (++hits >= max) process.exit(0);
      }
    }
  }
  console.log('(' + hits + ' hits)');
} else {
  console.log('usage: list|cat|find|grep');
}
fs.closeSync(fd);

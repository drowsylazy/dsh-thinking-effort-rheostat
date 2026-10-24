// Print part of one file inside app.asar without shell redirection (keeps UTF-8).
//   node tools/peek.js <path> [fromLine] [toLine]
//   node tools/peek.js <path> /regex/ [context]
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

const [, , target, a1, a2] = process.argv;
const ent = nodeAt(target);
if (!ent || ent.files) {
  console.log('(not a file)');
  process.exit(1);
}
const buf = Buffer.alloc(ent.size);
fs.readSync(fd, buf, 0, ent.size, BASE + Number(ent.offset));
const text = buf.toString('utf8');
fs.closeSync(fd);

const lines = text.split('\n');
if (a1 === undefined) {
  process.stdout.write(text);
} else if (a1.startsWith('/') && a1.endsWith('/')) {
  const re = new RegExp(a1.slice(1, -1));
  const ctx = a2 ? Number(a2) : 0;
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
  const shown = new Set();
  for (const i of hits) {
    for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) shown.add(j);
  }
  for (const i of [...shown].sort((a, b) => a - b)) console.log((i + 1) + ': ' + lines[i]);
} else {
  const from = Number(a1);
  const to = a2 ? Number(a2) : from;
  for (let i = from - 1; i < Math.min(lines.length, to); i++) console.log((i + 1) + ': ' + lines[i]);
}

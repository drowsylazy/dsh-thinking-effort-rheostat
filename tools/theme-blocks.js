/**
 * Show which CSS block actually defines a token, per theme.
 *
 * The earlier extractor collected `--name:value` pairs from anywhere in the
 * bundle and lost the selector, so light and dark values could not be told
 * apart. This walks the sheet with a brace stack and keeps the selector.
 *
 *   node tools/theme-blocks.js --dsw-alias-bg-overlay [more tokens...]
 */
const fs = require('fs');

const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(ASAR, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const H = sizeBuf.readUInt32LE(4);
const headBuf = Buffer.alloc(H);
fs.readSync(fd, headBuf, 0, H, 8);
const header = JSON.parse(headBuf.toString('utf8', 8, 8 + headBuf.readUInt32LE(4)));
const BASE = 8 + H;
function nodeAt(p) {
  let n = header;
  for (const part of p.split('/').filter(Boolean)) {
    if (!n.files || !n.files[part]) return null;
    n = n.files[part];
  }
  return n;
}
function readPath(p) {
  const n = nodeAt(p);
  const b = Buffer.alloc(n.size);
  fs.readSync(fd, b, 0, n.size, BASE + Number(n.offset));
  return b.toString('utf8');
}
const source = readPath('/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js');
fs.closeSync(fd);

const blobs = [];
const re = /"((?:[^"\\]|\\.)*)"/g;
let m;
while ((m = re.exec(source)) !== null) {
  const s = m[1];
  if (s.indexOf('{') >= 0 && s.indexOf('--dsw') >= 0 && s.length > 200) {
    try { blobs.push(JSON.parse('"' + s + '"')); } catch (e) { /* skip */ }
  }
}
const css = blobs.join('\n');
console.log('css chars: ' + css.length + '  blobs: ' + blobs.length);

/* Brace-stack walk: emit { selector, body } for every rule. */
const blocks = [];
const stack = [];
let selectorStart = 0;
for (let i = 0; i < css.length; i++) {
  const ch = css[i];
  if (ch === '{') {
    stack.push({ selector: css.slice(selectorStart, i).trim(), bodyStart: i + 1 });
  } else if (ch === '}') {
    const top = stack.pop();
    if (top !== void 0) {
      blocks.push({
        selector: top.selector.slice(-120),
        body: css.slice(top.bodyStart, i),
        at: top.bodyStart
      });
    }
  }
  if (ch === '}' || ch === ';') selectorStart = i + 1;
}
console.log('rules: ' + blocks.length);

const wanted = process.argv.slice(2);
const list = wanted.length > 0 ? wanted : ['--dsw-alias-bg-overlay'];

for (const token of list) {
  console.log('\n########## ' + token);
  const hits = [];
  for (const block of blocks) {
    for (const decl of block.body.split(';')) {
      const at = decl.indexOf(':');
      if (at < 0) continue;
      if (decl.slice(0, at).trim() !== token) continue;
      hits.push({ selector: block.selector, value: decl.slice(at + 1).trim() });
    }
  }
  for (const hit of hits) {
    const theme = hit.selector.indexOf('data-ds-dark-theme') >= 0 ? 'DARK '
      : (hit.selector === 'body' || hit.selector === ':root' || hit.selector === 'html') ? 'BASE ' : 'OTHER';
    console.log('  [' + theme + '] ' + hit.selector.padEnd(46) + ' = ' + hit.value);
  }
}

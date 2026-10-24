// 抽取任意 client bundle 内联 CSS 中的指定选择器
const fs = require('fs');
const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(ASAR, 'r');
const sb = Buffer.alloc(8); fs.readSync(fd, sb, 0, 8, 0);
const H = sb.readUInt32LE(4);
const hb = Buffer.alloc(H); fs.readSync(fd, hb, 0, H, 8);
const header = JSON.parse(hb.toString('utf8', 8, 8 + hb.readUInt32LE(4)));
const BASE = 8 + H;
function nodeAt(p) { let n = header;
  for (const part of p.split('/').filter(Boolean)) { if (!n.files || !n.files[part]) return null; n = n.files[part]; } return n; }
function readPath(p) { const n = nodeAt(p); const b = Buffer.alloc(n.size);
  fs.readSync(fd, b, 0, n.size, BASE + Number(n.offset)); return b.toString('utf8'); }

const pkg = process.argv[2];
const needles = process.argv.slice(3);
const src = readPath('/dsh/node_modules/@deepseek-ai/' + pkg + '/lib/client.js');

// 收集所有 css 字符串常量（形如 const css = "..."; 以及 css: "..."）
const cssTexts = [];
const re = /"((?:[^"\\]|\\.)*)"/g;
let m;
while ((m = re.exec(src)) !== null) {
  const s = m[1];
  if (s.includes('{') && s.includes('--dsw') && s.length > 200) {
    try { cssTexts.push(JSON.parse('"' + s + '"')); } catch (e) {}
  }
}
console.error('css blobs=' + cssTexts.length + ' total=' + cssTexts.reduce((a, b) => a + b.length, 0));
const all = cssTexts.join('\n').replace(/\}/g, '}\n').replace(/\{/g, '{\n  ');
const lines2 = all.split('\n').map(s => s.trim()).filter(Boolean);
for (const n of needles) {
  console.log('\n########## ' + n);
  for (let i = 0; i < lines2.length; i++) {
    if (lines2[i].includes(n)) {
      console.log('  ' + lines2.slice(i, i + 14).join('\n  '));
      console.log('  ---');
    }
  }
}

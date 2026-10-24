// 从 ui-model-selection 的 client bundle 中抽出完整的 CSS 字符串并格式化
const fs = require('fs');
const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';
const fd = fs.openSync(ASAR, 'r');
const sb = Buffer.alloc(8); fs.readSync(fd, sb, 0, 8, 0);
const H = sb.readUInt32LE(4);
const hb = Buffer.alloc(H); fs.readSync(fd, hb, 0, H, 8);
const header = JSON.parse(hb.toString('utf8', 8, 8 + hb.readUInt32LE(4)));
const BASE = 8 + H;
function nodeAt(p) {
  let n = header;
  for (const part of p.split('/').filter(Boolean)) { if (!n.files || !n.files[part]) return null; n = n.files[part]; }
  return n;
}
function readPath(p) {
  const n = nodeAt(p); const b = Buffer.alloc(n.size);
  fs.readSync(fd, b, 0, n.size, BASE + Number(n.offset));
  return b.toString('utf8');
}
const src = readPath('/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js');
// 找 const css = "...";
const m = src.match(/const css = "((?:[^"\\]|\\.)*)";/);
if (!m) { console.log('css not found'); process.exit(1); }
let css = JSON.parse('"' + m[1] + '"');
// 规范化：每个 } 后换行，缩进
css = css.replace(/\}/g, '}\n').replace(/\{/g, '{\n  ').replace(/;/g, ';\n');
const out = css.split('\n').map(s => s.trim()).filter(Boolean).join('\n');
fs.writeFileSync('F:\\dsh-thinking-effort-rheostat\\ref\\model-selection.css', out, 'utf8');
console.log('css chars=' + out.length);

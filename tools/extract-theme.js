// 从 ui-theme 的 client bundle 抽出所有 --dsw-* 令牌定义（明暗两套）
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

const OUT = [];
const PKGS = ['dsh-client-ui-theme'];
for (const pkg of PKGS) {
  const src = readPath('/dsh/node_modules/@deepseek-ai/' + pkg + '/lib/client.js');
  // 收集所有 "const css = \"...\"" 以及普通字符串里的令牌定义
  const re = /--dsw-[a-z0-9-]+\s*:\s*[^;\\"']+/g;
  const found = new Map();
  let m;
  while ((m = re.exec(src)) !== null) {
    const s = m[0].replace(/\s+/g, ' ').trim();
    const name = s.split(':')[0].trim();
    if (!found.has(s)) found.set(s, 0);
    found.set(s, found.get(s) + 1);
  }
  OUT.push('#### ' + pkg + '   distinct-token-defs=' + found.size);
  [...found.keys()].sort().forEach(k => OUT.push('  ' + k));
}
fs.writeFileSync('F:\\dsh-thinking-effort-rheostat\\ref\\theme-tokens.txt', OUT.join('\n'), 'utf8');
console.log('lines=' + OUT.length);

const fs = require('fs');
const OUT = 'F:\\dsh-thinking-effort-rheostat\\tools\\asar-out.txt';
const lines = [];
function log(s) { lines.push(s); }

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

function readEnt(ent) {
  const b = Buffer.alloc(ent.size);
  fs.readSync(fd, b, 0, ent.size, BASE + Number(ent.offset));
  return b.toString('utf8');
}
function getNode(p) {
  const parts = p.split('/').filter(Boolean);
  let n = header;
  for (const part of parts) {
    if (!n.files || !n.files[part]) return null;
    n = n.files[part];
  }
  return n;
}
function listDir(p) {
  const n = getNode(p);
  if (!n || !n.files) return null;
  return Object.keys(n.files).map(k => k + (n.files[k].files ? '/' : '')).sort();
}

const FOCUS = [
  'dsh-client-ui-conversation',
  'dsh-client-ui-model-selection',
  'dsh-client-ui-settings-general',
  'dsh-client-ui-chat',
  'dsh-client-ui-theme',
  'dsh-client-hmr',
  'dsh-skill-badge',
];

for (const pkg of FOCUS) {
  const dir = '/dsh/node_modules/@deepseek-ai/' + pkg;
  const pj = getNode(dir + '/package.json');
  log('\n############ ' + pkg);
  if (!pj) { log('  (not found)'); continue; }
  const j = JSON.parse(readEnt(pj));
  log('  name    : ' + j.name + '@' + j.version);
  log('  main    : ' + JSON.stringify(j.main));
  log('  exports : ' + JSON.stringify(j.exports));
  log('  module  : ' + JSON.stringify(j.module));
  log('  browser : ' + JSON.stringify(j.browser));
  log('  files   : ' + JSON.stringify(j.files));
  log('  type    : ' + JSON.stringify(j.type));
  log('  peers   : ' + JSON.stringify(j.peerDependencies));
  log('  deps    : ' + JSON.stringify(j.dependencies));
  log('  scripts : ' + JSON.stringify(j.scripts));
  log('  dsh     : ' + JSON.stringify(j.dsh, null, 2));
  const d = listDir(dir);
  log('  DIR     : ' + JSON.stringify(d));
}

fs.closeSync(fd);
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('done ' + lines.length);

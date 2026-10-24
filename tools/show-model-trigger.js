// Print the shipped model-selection trigger CSS straight from the asar.
//   node tools/show-model-trigger.js
//
// Written without JSON.parse: the bundle embeds the sheet as a JS string
// literal, and round-tripping it through JSON chokes on the escaping.
const fs = require('fs');

const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';
const PATH = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js';

const fd = fs.openSync(ASAR, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const headerSize = sizeBuf.readUInt32LE(4);
const headBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headBuf, 0, headerSize, 8);
const header = JSON.parse(headBuf.toString('utf8', 8, 8 + headBuf.readUInt32LE(4)));
const base = 8 + headerSize;

let node = header;
for (const part of PATH.split('/').filter(Boolean)) node = node.files[part];
const bytes = Buffer.alloc(node.size);
fs.readSync(fd, bytes, 0, node.size, base + Number(node.offset));
fs.closeSync(fd);

const source = bytes.toString('utf8');
const marker = 'const css = "';
const start = source.indexOf(marker);
if (start < 0) throw new Error('sheet not found');
const from = start + marker.length;
const css = source.slice(from, source.indexOf('";', from)).replace(/\\"/g, '"').replace(/\\\\/g, '\\');

const wanted = process.argv.slice(2);
const selectors = wanted.length > 0 ? wanted : [
  '.wq12jW_trigger{',
  '.wq12jW_trigger:hover',
  '.wq12jW_trigger:focus-visible',
  '.wq12jW_trigger:disabled',
  '.wq12jW_triggerEffort',
  '.wq12jW_chevron{'
];

for (const selector of selectors) {
  const at = css.indexOf(selector);
  if (at < 0) {
    console.log(selector + '  (not found)');
    continue;
  }
  const end = css.indexOf('}', at);
  console.log(css.slice(at, end + 1).replace(/\s+$/, ''));
}

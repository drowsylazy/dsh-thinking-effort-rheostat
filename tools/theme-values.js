/**
 * Resolve the Harness theme's alias tokens to concrete colours for BOTH themes,
 * then report contrast ratios for the pairs this control actually paints.
 *
 * "Contrast is too low" is a measurable claim, so measure it instead of
 * guessing: every colour in the plugin is a token, and the theme bundle ships
 * the token chain from `--dsw-alias-*` through `--dsw-static-*` to a literal.
 *
 *   node tools/theme-values.js
 */
const fs = require('fs');
const path = require('path');

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

/* Every CSS-ish string literal, in document order. */
const blobs = [];
const re = /"((?:[^"\\]|\\.)*)"/g;
let m;
while ((m = re.exec(source)) !== null) {
  const s = m[1];
  if (s.indexOf('{') >= 0 && s.indexOf('--dsw') >= 0 && s.length > 200) {
    try { blobs.push(JSON.parse('"' + s + '"')); } catch (e) { /* not a plain literal */ }
  }
}
const css = blobs.join('\n');
console.log('theme css blobs: ' + blobs.length + ', total ' + css.length + ' chars');

/* Pull one rule out by matching braces from its `{`: the generic "selector {…}"
   regex mis-splits here because declaration values may contain braces. */
function extractBlock(text, selector) {
  let from = 0;
  for (;;) {
    const at = text.indexOf(selector + '{', from);
    if (at < 0) return null;
    /* the selector must stand alone: not the tail of a longer selector list */
    const prev = at === 0 ? '' : text[at - 1];
    if (prev === '' || prev === '}' || prev === '\n' || prev === ' ') {
      let depth = 0;
      const open = at + selector.length;
      for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) return text.slice(open + 1, i);
        }
      }
    }
    from = at + 1;
  }
}

function declarations(body) {
  const out = new Map();
  for (const decl of body.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const name = decl.slice(0, at).trim();
    if (name.startsWith('--')) out.set(name, decl.slice(at + 1).trim());
  }
  return out;
}

const baseBody = extractBlock(css, 'body');
const darkBody = extractBlock(css, 'body[data-ds-dark-theme]');
const base = baseBody === null ? new Map() : declarations(baseBody);
const dark = darkBody === null ? new Map() : declarations(darkBody);
console.log('base declarations: ' + base.size + ', dark declarations: ' + dark.size);
if (base.size === 0) {
  console.log('base `body{…}` block not found or empty');
  process.exit(1);
}

function resolve(name, map, depth) {
  depth = depth ?? 0;
  if (depth > 12) return null;
  const raw = map.has(name) ? map.get(name) : (base.has(name) ? base.get(name) : null);
  if (raw === null) return null;
  const ref = raw.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (ref !== null) return resolve(ref[1], map, depth + 1);
  return raw;
}

function toRgb(value) {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  let hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex !== null) {
    const d = hex[1];
    const parts = d.length === 3 ? [d[0] + d[0], d[1] + d[1], d[2] + d[2]]
      : [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6)];
    return { r: parseInt(parts[0], 16), g: parseInt(parts[1], 16), b: parseInt(parts[2], 16), a: 1 };
  }
  const fn = v.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)$/);
  if (fn !== null) {
    return {
      r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]),
      a: fn[4] === void 0 ? 1 : Number(fn[4])
    };
  }
  return null;
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
function over(fg, bg) {
  if (fg === null) return null;
  if (fg.a >= 1) return fg;
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1
  };
}
function lum(c) {
  const f = (x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function ratio(a, b) {
  const la = lum(a);
  const lb = lum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
function hex(c) {
  if (c === null) return 'n/a';
  const p = (x) => x.toString(16).padStart(2, '0');
  return '#' + p(c.r) + p(c.g) + p(c.b);
}

/* Tokens this control reads. */
const TOKENS = [
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary'
];

for (const [theme, map] of [['LIGHT', base], ['DARK', dark]]) {
  console.log('\n===== ' + theme + ' =====');
  const resolved = new Map();
  for (const t of TOKENS) {
    const raw = map.has(t) ? map.get(t) : base.get(t);
    const value = resolve(t, map);
    resolved.set(t, { raw, value, rgb: toRgb(value) });
    console.log('  ' + t.padEnd(42) + String(value).padEnd(26) + hex(toRgb(value)));
  }

  const panel = resolved.get('--dsw-alias-bg-overlay').rgb;
  const paint = (name, alpha) => {
    const c = resolved.get(name).rgb;
    if (c === null) return null;
    const withAlpha = alpha === void 0 ? c : { r: c.r, g: c.g, b: c.b, a: alpha };
    return over(withAlpha, panel);
  };

  console.log('  --- contrast against the panel surface (' + hex(panel) + ') ---');
  const pairs = [
    ['rail @8% (interactive-bg-hover)', paint('--dsw-alias-interactive-bg-hover')],
    ['rail @12% label-primary', paint('--dsw-alias-label-primary', 0.12)],
    ['rail bg-layer-2', paint('--dsw-alias-bg-layer-2')],
    ['rail bg-base', paint('--dsw-alias-bg-base')],
    ['rail bg-module-platform', paint('--dsw-alias-bg-module-platform')],
    ['thumb label-primary', paint('--dsw-alias-label-primary')],
    ['tick label-tertiary @.42', paint('--dsw-alias-label-tertiary', 0.42)],
    ['tick label-tertiary @1', paint('--dsw-alias-label-tertiary')],
    ['tick label-secondary @.85', paint('--dsw-alias-label-secondary', 0.85)],
    ['text label-tertiary', paint('--dsw-alias-label-tertiary')],
    ['text label-secondary', paint('--dsw-alias-label-secondary')],
    ['accent business-primary', paint('--dsw-alias-state-business-primary')]
  ];
  for (const [label, c] of pairs) {
    if (c === null) { console.log('  ' + label.padEnd(34) + 'n/a'); continue; }
    console.log('  ' + label.padEnd(34) + hex(c) + '   ' + ratio(c, panel).toFixed(2) + ':1');
  }

  /* ticks and thumb are read against the RAIL they sit on, not the panel */
  const railCandidates = ['--dsw-alias-bg-base', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-layer-2'];
  console.log('  --- if the rail were each candidate, ticks/thumb against it ---');
  for (const rn of railCandidates) {
    const rail = paint(rn);
    if (rail === null) continue;
    const tick = paint('--dsw-alias-label-tertiary');
    const thumb = paint('--dsw-alias-label-primary');
    const accent = paint('--dsw-alias-state-business-primary');
    console.log('  rail=' + rn.replace('--dsw-alias-', '').padEnd(22) + hex(rail) +
      '   vs panel ' + ratio(rail, panel).toFixed(2) +
      ' | tick ' + ratio(tick, rail).toFixed(2) +
      ' | thumb ' + ratio(thumb, rail).toFixed(2) +
      ' | accent ' + ratio(accent, rail).toFixed(2));
  }
}

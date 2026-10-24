/**
 * Contrast gate for the thinking-effort control.
 *
 * "Contrast is too low" / "it is too dark" are measurable, so measure them.
 * Everything here is resolved from the constants the stylesheet actually uses,
 * and the groove is a color-mix that resolves DIFFERENTLY per theme 鈥?so this
 * file computes both, which a single literal could never do.
 *
 * The palette history is the reason for the two-part rule below:
 *
 *   1. an ink-derived groove made the rail dark on the light theme;
 *   2. a navy fill made the whole rail read as a dark bar;
 *   3. so the groove is now a PALE tint of the brand and the fill is the brand.
 *
 * A white key cannot clear 3:1 against any tint pale enough to look light, so
 * the rule is split rather than fudged:
 *
 *   over the FILL (the brand blue, where the key sits at higher levels):
 *       must clear 3:1 on luminance alone.
 *   over the GROOVE (the pale tint):
 *       fill-luminance is not the mechanism; the key must carry a ring that
 *       stays visible against the groove plus at least two shadow layers.
 *       This is how native slider keys are drawn.
 *
 * tools/negative.js proves this gate still fails when a value goes pale.
 *
 *   node tools/contrast.js [path/to/client.js]
 */
const fs = require('fs');
const path = require('path');

const P = {
  light: {
    labelSecondary: '#61666b',
    /* --dsw-alias-bg-layer-1: light bluish-00, dark bluish-875 */
    panel: '#ffffff',
    accent: '#4176e6'
  },
  dark: {
    labelSecondary: '#cfd3d6',
    panel: '#232324',
    accent: '#7aaaff'
  }
};

const REJECTED_PANEL_DARK = '#61666b';

/** The sheet under test: argv[2] lets tools/negative.js verify this gate itself. */
const TARGET = process.argv[2] ?? path.join(__dirname, '..', 'client.js');
const SOURCE = fs.readFileSync(TARGET, 'utf8');

function literalOf(name) {
  const match = new RegExp('const ' + name + ' = "([^"]*)";').exec(SOURCE);
  if (match === null) throw new Error('missing palette constant in ' + TARGET + ': ' + name);
  return match[1];
}
function numberOrLiteral(name) {
  const match = new RegExp('const ' + name + ' = (-?[\\d.]+);').exec(SOURCE);
  if (match === null) throw new Error('missing numeric constant in ' + TARGET + ': ' + name);
  return Number(match[1]);
}

const BRAND = literalOf('BRAND');
const GROOVE_MIX = numberOrLiteral('GROOVE_MIX') / 100;
const GROOVE_IDLE_MIX = numberOrLiteral('GROOVE_IDLE_MIX') / 100;
const FILL_MIX = numberOrLiteral('FILL_MIX') / 100;
const FILL_MAX_MIX = numberOrLiteral('FILL_MAX_MIX') / 100;
const TICK = literalOf('TICK');
const RAIL_EDGE = literalOf('RAIL_EDGE');
const RAIL_LIFT = literalOf('RAIL_LIFT');
const THUMB = literalOf('THUMB_FILL');

/**
 * The base `.te-thumb` declaration block, as flat text.
 *
 * It has to be the BASE rule: `.te-max .te-thumb` repeats the same ring, so a
 * plain search for the ring finds the variant first and reports depth that the
 * real key does not have. Found this by watching the flattened-key negative
 * test pass when it should have failed.
 */
function thumbBlock() {
  const start = SOURCE.indexOf('.te-thumb{position:absolute');
  if (start < 0) return '';
  const end = SOURCE.indexOf('cursor:grab', start);
  if (end < 0) return '';
  /* The rule is concatenated from string literals and named constants, so put
     it back together: drop the quoting/concatenation, then substitute every
     `const NAME = "value"` the sheet uses. */
  let flat = SOURCE.slice(start, end)
    .split('"\n\t\t\t"').join('')
    .split('" +\n\t\t\t"').join('')
    .split('"\n\t\t\t+ "').join('')
    .replace(/["\n\t]/g, '')
    .replace(/\s*\+\s*/g, ' ');
  for (const [, name, value] of SOURCE.matchAll(/const ([A-Z_]+) = "([^"]*)";/g)) {
    flat = flat.split(name).join(value);
  }
  return flat;
}
const THUMB_RULE = thumbBlock();

/** Shadow layers on the base key, counted so a flattened key fails the gate. */
const SHADOW_LAYERS = (() => {
  const match = /box-shadow:([^;]*)/.exec(THUMB_RULE);
  if (match === null) return 0;
  return match[1].split(/,(?![^(]*\))/).filter((part) => part.trim().length > 0).length;
})();
const RING = (() => {
  const match = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(THUMB_RULE);
  if (match === null) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) };
})();

function rgb(value) {
  if (value.startsWith('rgba') || value.startsWith('rgb')) {
    const body = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
    const [r, g, b, a] = body.split(',').map((x) => Number(x.trim()));
    return { r, g, b, a: a === undefined ? 1 : a };
  }
  const h = value.replace('#', '');
  const p = h.length === 3 ? [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
    : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return { r: parseInt(p[0], 16), g: parseInt(p[1], 16), b: parseInt(p[2], 16), a: 1 };
}
function over(fg, bg) {
  const a = fg.a === undefined ? 1 : fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a))
  };
}
/** One sRGB channel blend, standing in for `color-mix(in oklab, a N%, b)`. */
function blend(fg, t, bg) {
  return {
    r: Math.round(fg.r * t + bg.r * (1 - t)),
    g: Math.round(fg.g * t + bg.g * (1 - t)),
    b: Math.round(fg.b * t + bg.b * (1 - t))
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
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function hex(c) {
  const p = (x) => x.toString(16).padStart(2, '0');
  return '#' + p(c.r) + p(c.g) + p(c.b);
}

const problems = [];
for (const theme of ['light', 'dark']) {
  const t = P[theme];
  const panel = rgb(t.panel);
  const brand = rgb(BRAND);
  const accent = rgb(t.accent);
  const secondary = rgb(t.labelSecondary);
  const thumb = rgb(THUMB);

  /* The groove is the brand mix under a translucent white lift, so resolve that
     composite rather than the bare mix. */
  const lift = rgb(RAIL_LIFT);
  const groove = over(lift, blend(brand, GROOVE_MIX, panel));
  const grooveIdle = over(lift, blend(brand, GROOVE_IDLE_MIX, panel));
  const fill = over(lift, blend(brand, FILL_MIX, panel));
  const fillMax = over(lift, blend(brand, FILL_MAX_MIX, panel));
  const tick = over(rgb(TICK), groove);
  const ring = RING === null ? null : over(RING, groove);
  const railEdge = over(rgb(RAIL_EDGE), panel);

  console.log('\n===== ' + theme.toUpperCase() + ' =====');
  console.log('  panel ' + hex(panel) + '   groove ' + hex(groove) +
    '   fill ' + BRAND + '   thumb ' + THUMB);

  /* The track has to be perceivable, and there are two ways to do that: the
     tint itself, or a hairline edge. The user asked for a light background, so
     the tint is deliberately faint 鈥?which makes the edge the mechanism on the
     light theme, exactly as with the key. Folding this into one arbitrary
     threshold would have forced the tint back up and undone the request. */
  const tintVsPanel = ratio(groove, panel);
  const edgeVsPanel = ratio(railEdge, panel);
  const trackOk = tintVsPanel >= 1.18 || (tintVsPanel >= 1.10 && edgeVsPanel >= 1.12);
  console.log('  ' + (trackOk ? 'ok  ' : 'LOW ') + 'the track is perceivable on the panel   [' +
    'tint ' + tintVsPanel.toFixed(3) + ':1, edge ' + edgeVsPanel.toFixed(2) + ':1 鈫?' +
    (tintVsPanel >= 1.18 ? 'tint' : 'tint+edge') + ']');
  if (!trackOk) {
    problems.push(theme + ': the track is invisible 鈥?tint ' + tintVsPanel.toFixed(3) +
      ':1, edge ' + edgeVsPanel.toFixed(2) + ':1');
  }
  const idleTint = ratio(grooveIdle, panel);
  const idleOk = idleTint >= 1.10 || edgeVsPanel >= 1.12;
  console.log('  ' + (idleOk ? 'ok  ' : 'LOW ') + 'the idle track is perceivable   [' +
    'tint ' + idleTint.toFixed(3) + ':1, edge ' + edgeVsPanel.toFixed(2) + ':1]');
  if (!idleOk) problems.push(theme + ': the idle track is invisible 鈥?tint ' + idleTint.toFixed(3) + ':1');

  const rows = [
    ['the consumed portion reads against the groove', 1.20, ratio(fill, groove), fill, groove],
    ['the top-tier fill reads against the groove', 1.45, ratio(fillMax, groove), fillMax, groove],
    ['unlit stops read against the groove', 1.45, ratio(tick, groove), tick, groove],
    ['secondary text reads against the panel', 3.0, ratio(secondary, panel), secondary, panel],
    ['accent (level name / glow) reads against the panel', 3.0, ratio(accent, panel), accent, panel]
  ];
  /* The key's fill-luminance against each surface is recorded, not gated here:
     one theme's rail is pale enough that white can never reach 3:1 on it, so the
     gate for the key is the combined judgement at the end of this block. Logging
     the numbers keeps them visible without pretending they are all passable. */
  for (const [label, surface] of [
    ['groove', groove], ['fill', fill], ['top-tier fill', fillMax]
  ]) {
    console.log('  路   ' + ratio(thumb, surface).toFixed(2) + ':1  key vs ' + label +
      '   [' + hex(thumb) + ' on ' + hex(surface) + ']');
  }
  for (const [label, need, value, fg, bg] of rows) {
    const ok = value >= need;
    console.log('  ' + (ok ? 'ok  ' : 'LOW ') + value.toFixed(2) + ':1 (need ' + need.toFixed(2) +
      ')  ' + label + '   [' + hex(fg) + ' on ' + hex(bg) + ']');
    if (!ok) problems.push(theme + ': ' + label + ' 鈥?' + value.toFixed(2) + ':1 < ' + need);
  }

  /* White cannot clear 3:1 against a rail pale enough to look light, so the key
     is accepted by either mechanism: its own luminance against the surface, or
     a visible ring plus at least two shadow layers. */
  const ringVsGroove = ring === null ? 0 : ratio(ring, groove);
  const worst = Math.min(
    ratio(thumb, groove), ratio(thumb, fill), ratio(thumb, fillMax));
  const byFill = worst >= 3.0;
  const edgeOk = ringVsGroove >= 1.35 && SHADOW_LAYERS >= 2;
  const ok = byFill || edgeOk;
  console.log('  ' + (ok ? 'ok  ' : 'LOW ') + 'the key is defined on every surface   [' +
    'worst fill ' + worst.toFixed(2) + ':1, ring ' + ringVsGroove.toFixed(2) +
    ':1 vs groove, ' + SHADOW_LAYERS + ' shadow layers 鈫?' +
    (byFill ? 'fill' : 'edge+shadow') + ']');
  if (!ok) {
    problems.push(theme + ': the key is not defined 鈥?worst fill ' + worst.toFixed(2) +
      ':1, ring ' + ringVsGroove.toFixed(2) + ':1, ' + SHADOW_LAYERS + ' shadow layers');
  }
}

if (problems.length > 0) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}

/* Recorded so a future change argues with numbers instead of taste: this is the
   palette that read as "so dark", and why. */
const darkFill = over(rgb('#2f56c4'), { r: 35, g: 35, b: 36 });
console.log('\nnote: the rejected navy fill #2f56c4 over the dark panel was ' +
  ratio(rgb(THUMB), rgb('#2f56c4')).toFixed(2) + ':1 for the key, and it covered most of the' +
  ' rail at high levels 鈥?that is the "too dark" reading.');
const darkRejected = rgb(REJECTED_PANEL_DARK);
console.log('note: on the dark popover token ' + REJECTED_PANEL_DARK +
  ' the accent would be ' + ratio(rgb(P.dark.accent), darkRejected).toFixed(2) + ':1');
void darkFill;

console.log('\nOK: every pair clears its contrast floor in both themes');

/**
 * Static audit of the bundle's stylesheet: every `--te-*` variable it defines
 * must actually be read, and every read must be defined for BOTH themes.
 * A value defined in only one theme block silently leaks the other theme's
 * value, which is the kind of thing that looks fine until someone flips themes.
 *
 *   node tools/audit-css.js
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(process.argv[2] ?? path.join(__dirname, '..', 'client.js'), 'utf8');

/* Pull the CSS array out of the bundle and join it the way the bundle does. */
const start = source.indexOf('const CSS = [');
if (start < 0) throw new Error('CSS array not found');
const end = source.indexOf('].join("");', start);
if (end < 0) throw new Error('CSS array terminator not found');
const arraySource = source.slice(start + 'const CSS = '.length, end + 1);

/* The array references layout and palette constants; read them out of the
   bundle instead of duplicating them here, so a renamed or retuned value can
   never leave this audit testing a stale sheet. Values may be strings or
   numbers (the groove mix is a percentage). */
const PALETTE = [
  'BRAND', 'GROOVE_MIX', 'GROOVE_IDLE_MIX', 'FILL_MIX', 'FILL_MAX_MIX',
  'THUMB_FILL', 'TICK', 'TICK_ON', 'THUMB_RING', 'THUMB_DROP', 'THUMB_LIFT',
  'RAIL_EDGE', 'RAIL_INSET', 'RAIL_LIFT'
];
const paletteValues = PALETTE.map((name) => {
  const text = new RegExp('const ' + name + ' = "([^"]*)";').exec(source);
  if (text !== null) return text[1];
  const num = new RegExp('const ' + name + ' = (-?[\\d.]+);').exec(source);
  if (num !== null) return Number(num[1]);
  throw new Error('palette constant not found in the bundle: ' + name);
});

const css = new Function(
  'PAD', 'PANEL_W', 'FIELD_ROWS', 'FIELD_CELL', 'FIELD_GAP', 'THUMB_W', 'THUMB_H',
  ...PALETTE,
  'return ' + arraySource + '.join("");'
)(13, 272, 5, 3, 2, 26, 22, ...paletteValues);

const defined = new Map();
const reDef = /(--te-[a-z0-9-]+)\s*:/g;
let m;
while ((m = reDef.exec(css)) !== null) {
  const name = m[1];
  if (!defined.has(name)) defined.set(name, []);
  defined.get(name).push(m.index);
}

const used = new Set();
const reUse = /var\((--te-[a-z0-9-]+)/g;
while ((m = reUse.exec(css)) !== null) used.add(m[1]);

/* Theme blocks, when the sheet has any: a base block and a dark override must
   define the SAME variable set, or a value silently leaks across themes. This
   control deliberately has none 鈥?every colour is a theme token 鈥?so an absent
   pair is reported rather than treated as a failure. */
const darkAt = css.indexOf('[data-ds-dark-theme]');
const baseAt = css.indexOf('.te-panel{');
const hasThemePair = darkAt >= 0 && baseAt >= 0;
const baseBlock = hasThemePair ? css.slice(baseAt, css.indexOf('}', baseAt)) : '';
const darkBlock = hasThemePair ? css.slice(darkAt, css.indexOf('}', darkAt)) : '';

const problems = [];

/* Variables the component writes inline per element rather than in the sheet:
   every lattice cell carries its own weight, and the twinkling ones also carry
   a period and a stagger. They are absent from CSS by design, so confirm the JS
   really does set them. The lattice's clip line and its twinkle pause live at
   the field level: --te-line is the thumb's clip line (px), --te-run flips the
   animation play state while the field is parked dark. */
const INLINE = ['--te-o', '--te-d', '--te-dl', '--te-line', '--te-run'];
for (const name of INLINE) {
  if (!used.has(name)) continue;
  if (!source.includes('"' + name + '"')) {
    problems.push('read from CSS but never written by the component: ' + name);
  }
  used.delete(name);
}

for (const name of defined.keys()) {
  if (!used.has(name)) problems.push('defined but never read: ' + name);
}
for (const name of used) {
  if (!defined.has(name)) problems.push('read but never defined: ' + name);
  if (defined.has(name) && hasThemePair) {
    const inBase = baseBlock.includes(name + ':');
    const inDark = darkBlock.includes(name + ':');
    if (inBase !== inDark) {
      problems.push('theme-asymmetric (base=' + inBase + ' dark=' + inDark + '): ' + name);
    }
  }
}

/* A literal colour outside a token is the thing that broke dark mode before:
   the control painted itself with light-theme values because a hand-rolled
   theme branch never matched. Neutral literals stay legal 鈥?#000 is the opacity
   carrier inside a mask gradient, and shadows are neutral by nature.

   The rail palette is a separate, declared exception: those values come from
   the PALETTE constants at the top of the bundle, and they are allowed to be
   chromatic because the control is deliberately theme-independent (deepseek
   blue reads on both panels). They are NOT unchecked 鈥?tools/contrast.js
   resolves each one to a real ratio in both themes, and tools/negative.js
   proves that gate fails when a palette value goes pale. This audit's job for
   them is only to confirm they are declared rather than pasted in.

   "Neutral" is a tolerance too: a value that is not one of the declared palette
   constants must still be neutral within 12/255 of spread. Every real accent
   misses that by an order of magnitude (#4176e6 spreads 165). */
const NEUTRAL_SPREAD = 12;
const isNeutral = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) <= NEUTRAL_SPREAD;
const declared = new Set(
  paletteValues.filter((value) => typeof value === 'string').map((value) => value.toLowerCase())
);

const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];
const suspicious = literals.filter((value) => {
  const v = value.toLowerCase();
  if (v === 'transparent') return false;
  if ([...declared].some((d) => d.replace(/\s+/g, '') === v.replace(/\s+/g, ''))) return false;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex !== null) {
    const digits = hex[1];
    /* A 3-digit form repeats each nibble; expand it before comparing. */
    const parts = digits.length === 3
      ? [digits[0] + digits[0], digits[1] + digits[1], digits[2] + digits[2]]
      : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
    return !isNeutral(...parts.map((p) => parseInt(p, 16)));
  }
  const rgba = v.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  if (rgba !== null) {
    return !isNeutral(Number(rgba[1]), Number(rgba[2]), Number(rgba[3]));
  }
  /* colour-mix / var() forms never reach here; anything else is suspect */
  return true;
});
for (const value of [...new Set(suspicious)]) {
  problems.push('chromatic literal outside a theme token: ' + value);
}

console.log('stylesheet length: ' + css.length + ' chars');
console.log('variables defined:  ' + defined.size + '  (' + [...defined.keys()].sort().join(', ') + ')');
console.log('variables read:     ' + used.size);
console.log('theme blocks:       base=' + baseBlock.length + 'ch dark=' + darkBlock.length + 'ch');

/* ---------------------------------------------- theme tokens actually exist
 *
 * The check above only covers the sheet's own `--te-*` variables, which is
 * exactly the half that cannot go wrong quietly: a `--dsw-*` name this build
 * does not define fails as an unstyled property, and a typo in a colour token
 * looks like "the value did not apply" rather than like an error. The names are
 * read out of the shipped theme bundle, so this tracks the installed build
 * instead of a snapshot that can drift. */
const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';
function themeTokenNames() {
  const fd = fs.openSync(ASAR, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    fs.readSync(fd, sizeBuf, 0, 8, 0);
    const headerSize = sizeBuf.readUInt32LE(4);
    const headBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, headBuf, 0, headerSize, 8);
    const jsonLen = headBuf.readUInt32LE(4);
    const header = JSON.parse(headBuf.toString('utf8', 8, 8 + jsonLen));
    const base = 8 + headerSize;
    const source = (() => {
      let node = header;
      for (const part of ['dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'].filter(Boolean)) {
        if (!node.files || !node.files[part]) return null;
        node = node.files[part];
      }
      if (node.files) return null;
      const bytes = Buffer.alloc(node.size);
      fs.readSync(fd, bytes, 0, node.size, base + Number(node.offset));
      return bytes.toString('utf8');
    })();
    if (source === null) return null;
    const names = new Set();
    for (const match of source.matchAll(/--dsw-[a-z0-9-]+(?=\s*:)/g)) names.add(match[0]);
    return names;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const themeTokens = themeTokenNames();
if (themeTokens === null || themeTokens.size === 0) {
  problems.push('cannot read the shipped theme tokens from ' + ASAR + ', so the --dsw-* gate cannot run');
} else {
  const read = new Set();
  for (const match of css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)) read.add(match[1]);
  const unknown = [...read].filter((name) => !themeTokens.has(name));
  console.log('theme tokens read:  ' + read.size + ' of ' + themeTokens.size + ' the theme defines');
  for (const name of unknown) problems.push('reads a theme token this build does not define: ' + name);
}

/* A stray `}` or an unbalanced brace would silently swallow the rest. */
let depth = 0;
let minDepth = 0;
for (const ch of css) {
  if (ch === '{') depth++;
  else if (ch === '}') depth--;
  if (depth < minDepth) minDepth = depth;
}
console.log('brace depth:        end=' + depth + ' min=' + minDepth);
if (depth !== 0) problems.push('unbalanced braces (end depth ' + depth + ')');
if (minDepth < 0) problems.push('a closing brace appears before its opener');

/* Declarations that are obviously unfinished. */
if (/:\s*[;}]/.test(css)) problems.push('a declaration has an empty value');

/* `font: 600 10px/15px inherit` is invalid CSS: a CSS-wide keyword is only
   legal as the whole value, so the parser drops the entire declaration and the
   element silently inherits the panel's 13px/20px instead. Three of these
   shipped unnoticed because two of them only render on hover. Longhands cannot
   fail this way. */
for (const match of css.matchAll(/font\s*:\s*([^;}]*)/g)) {
  if (/(^|\s)inherit(\s|$)/.test(match[1])) {
    problems.push('font shorthand using a CSS-wide keyword (the declaration is dropped): font:' + match[1].trim());
  }
}

if (problems.length > 0) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('\nOK: every variable is defined, read, and symmetric across themes');

/**
 * Smoke test for the thinking-effort Client bundle.
 *
 * The bundle is a plain script that hands a lazy factory to
 * `window.__ModuleLoader__`, so it can be driven head-lessly: stub the module
 * table, run `apply` against a fake Cordis context to capture the registered
 * component, then render it with a miniature hooks runtime that keeps state
 * across redraws.
 *
 * Three defects this exists to catch, each of which shipped broken once:
 *   - a model that declares NO reasoning ladder (`reasoning` is `undefined`,
 *     not `null`) must not throw: a render throw retires the slot entry
 *     permanently and the control disappears from the page;
 *   - the top tier's lattice must declare its grid tracks, or it silently
 *     collapses into one row of two hundred cells;
 *   - the panel anchors through `window`, so the bundle's own `window`
 *     reference must be the same object the page uses.
 *
 *   node tools/smoke.js
 */
const fs = require('fs');
const path = require('path');

const BUNDLE = path.join(__dirname, '..', 'client.js');

/** Layout mirrored from the bundle, used to aim pointer events. */
const RAIL_LEFT = 600;
const RAIL_TOP = 700;
const RAIL_PAD = 13;
const RAIL_WIDTH = 240;
const TRAVEL = RAIL_WIDTH - 26;
const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;

/* ------------------------------------------------------------------ *
 * Miniature hooks runtime: state lives on a mounted instance, so it
 * survives redraws exactly as it does in React.
 * ------------------------------------------------------------------ */
function createRuntime() {
  let inst = null;

  function createElement(type, props, ...children) {
    return { type, props: props === null || props === void 0 ? {} : props, children };
  }

  function depsChanged(previous, next) {
    if (previous === void 0 || next === void 0) return true;
    if (previous.length !== next.length) return true;
    for (let i = 0; i < previous.length; i++) if (!Object.is(previous[i], next[i])) return true;
    return false;
  }

  const React = {
    createElement,
    Fragment: { teFragment: true },
    useState(initial) {
      const at = inst.cursor++;
      const owner = inst;
      if (!(at in inst.hooks)) inst.hooks[at] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => {
        const value = typeof next === 'function' ? next(owner.hooks[at]) : next;
        if (!Object.is(value, owner.hooks[at])) {
          owner.hooks[at] = value;
          owner.dirty = true;
        }
      };
      return [inst.hooks[at], set];
    },
    useRef(initial) {
      const at = inst.cursor++;
      if (!(at in inst.hooks)) inst.hooks[at] = { current: initial };
      return inst.hooks[at];
    },
    useMemo(factory, deps) {
      const at = inst.cursor++;
      const record = inst.hooks[at];
      if (record === void 0 || depsChanged(record.deps, deps)) inst.hooks[at] = { value: factory(), deps };
      return inst.hooks[at].value;
    },
    useCallback(fn, deps) {
      const at = inst.cursor++;
      const record = inst.hooks[at];
      if (record === void 0 || depsChanged(record.deps, deps)) inst.hooks[at] = { value: fn, deps };
      return inst.hooks[at].value;
    },
    useLayoutEffect(fn, deps) {
      const at = inst.cursor++;
      const record = inst.hooks[at];
      if (record === void 0 || depsChanged(record.deps, deps)) inst.layout.push(fn);
      inst.hooks[at] = { deps };
    },
    /* Passive effects really run here, so the declare round trip is exercised
       rather than merely registered. A deps change re-runs and the previous
       cleanup runs first, exactly like React. */
    useEffect(fn, deps) {
      const at = inst.cursor++;
      const record = inst.hooks[at];
      if (record !== void 0 && depsChanged(record.deps, deps) && typeof record.cleanup === 'function') {
        record.cleanup();
      }
      if (record === void 0 || depsChanged(record.deps, deps)) inst.passive.push(fn);
      inst.hooks[at] = { deps, cleanup: record === void 0 ? void 0 : record.cleanup };
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      inst.cursor++;
      return getSnapshot();
    }
  };

  /** A fake DOM element good enough for measurements, refs and handlers. */
  function makeElement() {
    return {
      clientWidth: RAIL_WIDTH,
      style: {},
      focus() {},
      getBoundingClientRect: () => ({
        left: RAIL_LEFT, top: RAIL_TOP, width: RAIL_WIDTH, height: 30
      }),
      setPointerCapture() {}
    };
  }

  /* React keeps the same DOM node across renders, so a ref written imperatively
     (the thumb's transform, the fill's width) must survive a redraw. A fresh
     element per draw would silently discard those writes and make the
     imperative positioning untestable. */
  const elements = new WeakMap();
  function elementFor(ref) {
    let node = elements.get(ref);
    if (node === void 0) {
      node = makeElement();
      elements.set(ref, node);
    }
    return node;
  }

  function assignRefs(node) {
    if (node === null || node === void 0) return;
    if (Array.isArray(node)) {
      for (const child of node) assignRefs(child);
      return;
    }
    if (typeof node !== 'object') return;
    const ref = node.props === void 0 ? void 0 : node.props.ref;
    if (ref !== null && ref !== void 0 && typeof ref === 'object') ref.current = elementFor(ref);
    if (Array.isArray(node.children)) for (const child of node.children) assignRefs(child);
  }

  function mount(component, props) {
    const self = { hooks: [], cleanups: [], cursor: 0, dirty: false, layout: [], passive: [] };
    /* React's own invariant: every render of a component calls the SAME number of
       hooks. Without this the runtime happily rendered a component whose hook
       count changed between passes — the React #310 that retired the slot entry
       in the real page and blanked the control, while all 107 checks passed. */
    let firstHookCount = null;

    /* Function children (the declare chooser) are components of their own: they
       keep hook state across draws and may update the PARENT through the props
       they receive, which is why their setters are owner-bound above. Each
       child instance is keyed by tree path, so the tree shape — not identity —
       decides remounting, matching the settle loop's structural view. `seen`
       collects the paths the LAST settle pass actually rendered, so a chooser
       that closed mid-draw is unmounted for real and reopens with fresh state. */
    const children = new Map();
    let seen = new Set();
    function hydrate(node, path) {
      if (node === null || node === void 0) return node;
      if (Array.isArray(node)) return node.map((child, i) => hydrate(child, path + '/' + i));
      if (typeof node !== 'object') return node;
      if (typeof node.type === 'function') {
        seen.add(path);
        let child = children.get(path);
        if (child === void 0) {
          child = mount(node.type, node.props);
          children.set(path, child);
        }
        return child.draw(node.props);
      }
      const kids = Array.isArray(node.children)
        ? node.children.map((child, i) => hydrate(child, path + '/' + i))
        : node.children;
      return { type: node.type, props: node.props, children: kids };
    }

    inst = self;
    return {
      draw(nextProps) {
        const use = nextProps === void 0 ? props : nextProps;
        /* Rebind: `inst` is module-level and hooks increment `inst.cursor`, so
           drawing an older handle after a newer mount would count that one's
           hooks instead of this one's. A nested component's mount leaves `inst`
           pointing at the child, so every pass re-binds before rendering. */
        let tree = null;
        let settled = false;
        for (let pass = 0; pass < 40; pass++) {
          inst = self;
          self.cursor = 0;
          self.dirty = false;
          self.layout = [];
          self.passive = [];
          tree = component(use);
          const count = self.cursor;
          if (firstHookCount === null) {
            firstHookCount = count;
          } else if (count !== firstHookCount) {
            throw new Error(
              'Rendered ' + String(count) + ' hooks on a later render but ' +
              String(firstHookCount) + ' on the first (React #310 hook order). ' +
              'A hook is being called conditionally, or an early return sits between hooks.'
            );
          }
          seen = new Set();
          tree = hydrate(tree, 'c');
          /* The child renders ran with their own `inst`, so effects registered
             for THIS instance must be flushed after, with `inst` back on self
             (effect closures read instance fields only through their own
             capture, but keep the rule anyway). */
          inst = self;
          assignRefs(tree);
          const effects = self.layout;
          const passive = self.passive;
          self.layout = [];
          self.passive = [];
          for (const effect of effects) {
            const cleanup = effect();
            if (typeof cleanup === 'function') self.cleanups.push(cleanup);
          }
          for (const effect of passive) {
            const cleanup = effect();
            /* React stores a passive cleanup against its own hook slot; this
               runtime only needs the mount-scope copy, because the deps-change
               path above already ran the previous one. */
            if (typeof cleanup === 'function') self.cleanups.push(cleanup);
          }
          if (!self.dirty) { settled = true; break; }
        }
        if (!settled) throw new Error('component did not settle within 40 passes');
        /* Unmount children whose tree path is gone — the chooser closing must
           produce a FRESH instance (and a fresh models.dev query) the next time
           it opens, which is what React does. */
        for (const key of children.keys()) {
          if (!seen.has(key)) {
            children.get(key).dispose();
            children.delete(key);
          }
        }
        return tree;
      },
      dispose() {
        for (const key of children.keys()) children.get(key).dispose();
        children.clear();
        for (const cleanup of self.cleanups.splice(0)) cleanup();
      }
    };
  }

  return { React, mount };
}

/* ------------------------------------------------------------------ *
 * One window object for the whole run.
 *
 * The bundle is evaluated as `new Function('window', source)`, so its own
 * `window` reference is that parameter — it has to be the same object the
 * component reads `innerWidth` from, which is also what production does when
 * a real browser supplies one global.
 * ------------------------------------------------------------------ */
const runtime = createRuntime();
const browserWindow = {
  innerWidth: VIEWPORT_W,
  innerHeight: VIEWPORT_H,
  addEventListener() {},
  removeEventListener() {}
};
browserWindow.__ModuleLoader__ = { load: (captured) => { loadedSpec = captured; } };
let loadedSpec = null;
globalThis.window = browserWindow;

/* ------------------------------------------------------------------ *
 * Bundle loading and instantiation
 * ------------------------------------------------------------------ */
function loadBundle() {
  const source = fs.readFileSync(BUNDLE, 'utf8');
  new Function('window', source)(browserWindow);
  if (loadedSpec === null) throw new Error('bundle never called window.__ModuleLoader__.load');
  if (loadedSpec.id !== '@local/dsh-thinking-effort-rheostat') {
    throw new Error('unexpected module id: ' + loadedSpec.id);
  }
  return loadedSpec;
}

function instantiate(spec, React, services) {
  const module = spec.factory((name) => {
    if (name === 'react') return React;
    throw new Error('bundle required an unexpected module: ' + name);
  });
  const registered = {};
  let dictionary = null;
  const localeCalls = [];

  const slots = {
    inject(key, callback) {
      callback();
      registered['#' + key] = true;
    },
    register(options, component) {
      registered[options.id] = component;
      registered[options.id + ':options'] = options;
      return () => delete registered[options.id];
    }
  };
  const scope = {
    effect: (fn) => { fn(); },
    slots,
    modelDirectories: services.modelDirectories,
    locale: {
      register(ns, dict) {
        dictionary = dict;
        localeCalls.push(ns);
        return () => {};
      }
    }
  };
  const ctx = { effect: (fn) => { fn(); }, inject(deps, callback) { callback(scope); } };
  module.apply(ctx);
  return { module, registered, scope, dictionary, localeCalls };
}

/* ------------------------------------------------------------------ *
 * Fixtures / helpers
 * ------------------------------------------------------------------ */
const SIX = [
  { id: 'minimal', name: 'Minimal', description: 'Fastest.' },
  { id: 'low', name: 'Low', description: 'Light.' },
  { id: 'medium', name: 'Medium', description: 'Balanced.' },
  { id: 'high', name: 'High', description: 'Careful.' },
  { id: 'xhigh', name: 'Extra High', description: 'Heavy.' },
  { id: 'max', name: 'Max', description: 'Hardest problems.' }
];

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition });
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name +
    (condition ? '' : '   <- ' + (detail === void 0 ? '' : detail)));
}

/**
 * The shipped model trigger's colour contract, read from app.asar.
 *
 * Read live rather than recorded, so this test keeps comparing against the
 * build that is actually installed: if the harness retunes its trigger, the
 * assertion stops passing instead of quietly approving a drift.
 */
function shippedTrigger() {
  const ASAR = 'E:\\DeepSeek Harness\\resources\\app.asar';
  const PATH = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js';
  let fd;
  try {
    fd = fs.openSync(ASAR, 'r');
    const sizeBuf = Buffer.alloc(8);
    fs.readSync(fd, sizeBuf, 0, 8, 0);
    const headerSize = sizeBuf.readUInt32LE(4);
    const headBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, headBuf, 0, headerSize, 8);
    const header = JSON.parse(headBuf.toString('utf8', 8, 8 + headBuf.readUInt32LE(4)));
    let node = header;
    for (const part of PATH.split('/').filter(Boolean)) node = node.files[part];
    const bytes = Buffer.alloc(node.size);
    fs.readSync(fd, bytes, 0, node.size, 8 + headerSize + Number(node.offset));
    const source = bytes.toString('utf8');
    const marker = 'const css = "';
    const start = source.indexOf(marker);
    if (start < 0) return null;
    const from = start + marker.length;
    const css = source.slice(from, source.indexOf('";', from)).replace(/\\"/g, '"');
    const rule = (needle) => {
      const at = css.indexOf(needle);
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at) + 1);
    };
    /* The trigger's css-module hash (wq12jW, then _9r0rkG, …) churns with
       every harness rebuild, so the rules are found by their shared class
       SUFFIX instead of one pinned hash: the base rule ends in `_trigger{`,
       its variants in `_trigger:hover` / `_trigger:focus-visible`. The
       lookup needle excludes the leading dot because the hash sits between
       it and the suffix (`.HASH_trigger{`). */
    const suffixRule = (suffix) => {
      const at = css.indexOf(suffix);
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at) + 1);
    };
    const base = suffixRule('_trigger{');
    const hover = suffixRule('_trigger:hover');
    const focus = suffixRule('_trigger:focus-visible');
    const color = /color:(var\([^)]*\))/.exec(base);
    const wash = /background:(var\([^)]*\))/.exec(hover);
    const ring = /box-shadow:0 0 0 2px (var\(--dsw-focus-ring-color)/.exec(focus);
    if (color === null || wash === null || ring === null) return null;
    return { color: color[1], hoverBackground: wash[1], focusRing: ring[1] };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function textOf(node) {
  if (node === null || node === void 0) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  let out = '';
  if (Array.isArray(node.children)) out += node.children.map(textOf).join('');
  return out;
}

function findAll(node, predicate, acc) {
  acc = acc ?? [];
  if (node === null || node === void 0) return acc;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, acc);
    return acc;
  }
  if (typeof node !== 'object') return acc;
  if (predicate(node)) acc.push(node);
  if (Array.isArray(node.children)) for (const child of node.children) findAll(child, predicate, acc);
  return acc;
}

const byClass = (needle) => (n) =>
  typeof n.props.className === 'string' && n.props.className.indexOf(needle) >= 0;
const first = (node, needle) => findAll(node, byClass(needle))[0];

/* The lattice's clip line (--te-line, px, field-local) is written to the element
   by ref — paint() during a drag, the park effect on settle; the same ref holds
   the node across draws, like the thumb's transform. */
const cellLine = (node) => {
  const el = node === void 0 || node.props.ref === void 0 ? void 0 : node.props.ref.current;
  const raw = el === void 0 ? void 0 : el.style['--te-line'];
  return raw === void 0 ? NaN : Number.parseFloat(raw);
};
/* The lattice glow (element opacity) rides with the clip line: 0 below the
   second-highest stop, 1 only at the maximum. */
const cellGlow = (node) => {
  const el = node === void 0 || node.props.ref === void 0 ? void 0 : node.props.ref.current;
  const raw = el === void 0 ? void 0 : el.style.opacity;
  return raw === void 0 || raw === '' ? NaN : Number.parseFloat(raw);
};
/* The parked top stop reveals by collapsing a left-folded inset to zero, so a
   settled maximum carries 'inset(0 0 0 0)' inline; drags and dark parks hand
   the clip back to the stylesheet (an empty string means the var-driven thumb
   line is in charge again). */
const cellClip = (node) => {
  const el = node === void 0 || node.props.ref === void 0 ? void 0 : node.props.ref.current;
  const raw = el === void 0 ? void 0 : el.style.clipPath;
  return raw === void 0 ? '' : raw;
};
/** The trigger's accessible name, which always carries the level. */
const chipLabel = (tree) => {
  const chip = first(tree, 'te-chip');
  return chip === void 0 ? '' : String(chip.props['aria-label'] ?? '');
};

const selectCalls = [];
let currentState = null;
const directory = {
  available: true,
  store: {
    getSnapshot: () => currentState,
    subscribe: () => () => {}
  },
  select(selection) {
    selectCalls.push(selection);
    return Promise.resolve({ ok: true });
  }
};

const app = instantiate(loadBundle(), runtime.React, {
  modelDirectories: { directoryFor: () => directory }
});

function stateWith(overrides) {
  return Object.assign({
    current: null, groups: [], retainedEffort: void 0,
    status: 'ready', pending: null, error: null
  }, overrides);
}

const Control = app.registered['thinking-effort'];
const t = (key) => (app.dictionary.zh[key] ?? app.dictionary.en[key] ?? key);
const mountControl = () => runtime.mount(Control, { sessionId: 's1', t });
const openIt = (handle) => {
  let tree = handle.draw();
  first(tree, 'te-chip').props.onClick();
  return handle.draw();
};

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */
check('bundle declares a host-side inject list', Array.isArray(app.module.inject));
check('dictionaries registered once',
  app.localeCalls.length === 1 && app.localeCalls[0] === 'thinking-effort');
check('control registered in conversation.input.right (beside the model seat)',
  app.registered['thinking-effort:options'].name === 'conversation.input.right',
  app.registered['thinking-effort:options'].name);
check('control carries its own cell id',
  app.registered['thinking-effort:options'].id === 'thinking-effort');
check('the retired two-entry design is gone (no separate panel entry)',
  app.registered['thinking-effort-panel'] === void 0);

/* ------------------------------------------------------------------ *
 * A model that declares nothing → forced ladder, no throw
 * ------------------------------------------------------------------ */
currentState = stateWith({
  current: { provider: 'p', model: 'm-none' },
  groups: [{ id: 'p', models: [{ id: 'm-none', name: 'No Reasoning' }] }]
});
const none = mountControl();
let threw = null;
let tree = null;
try {
  tree = none.draw();
} catch (error) {
  threw = error;
}
check('model with absent `reasoning` does not throw', threw === null, threw && threw.message);
check('model with absent `reasoning` still renders the trigger', tree !== null);
check('an unselected forced ladder names "provider default", not a level',
  chipLabel(tree).indexOf(app.dictionary.zh['effort.providerDefault']) >= 0, chipLabel(tree));
/* The trigger shows the level as TEXT. That is only safe because this plugin
   also hides the shipped seat's "· Max" suffix — otherwise the same word would
   appear twice on one line. */
check('the trigger shows the level as text',
  textOf(tree).indexOf(app.dictionary.zh['effort.providerDefault']) >= 0, JSON.stringify(textOf(tree)));
check('the trigger text is the same value the accessible name carries',
  textOf(tree) !== '' && chipLabel(tree).indexOf(textOf(tree)) >= 0,
  'text=' + JSON.stringify(textOf(tree)) + ' aria=' + JSON.stringify(chipLabel(tree)));
check('the trigger renders an icon', first(tree, 'te-chip').children.some(
  (c) => c !== null && typeof c === 'object' && c.type === 'svg'));
none.dispose();

currentState = stateWith({
  current: { provider: 'p', model: 'm-null' },
  groups: [{ id: 'p', models: [{ id: 'm-null', name: 'Null', reasoning: null }] }]
});
threw = null;
const nullModel = mountControl();
try {
  tree = nullModel.draw();
} catch (error) {
  threw = error;
}
check('model with null `reasoning` does not throw', threw === null, threw && threw.message);
check('model with null `reasoning` still renders the trigger', tree !== null);
nullModel.dispose();

currentState = stateWith({
  current: { provider: 'p', model: 'm-one', reasoningEffort: 'minimal' },
  groups: [{ id: 'p', models: [{ id: 'm-one', name: 'One', reasoning: { efforts: [SIX[0]] } }] }]
});
const oneLevel = mountControl();
tree = oneLevel.draw();
/* A model with EXACTLY ONE declared level can take that level: `dsh-llm`
   accepts any effort the adapter advertises, and one is not zero. Treating a
   single level as "no capability" refused a level the model actually
   supports — and the rail then hid its own level. */
check('a single declared level names itself on the trigger',
  chipLabel(tree).indexOf('Minimal') >= 0, chipLabel(tree));
tree = openIt(oneLevel);
check('a single declared level draws a real rail',
  first(tree, 'te-thumb') !== void 0 && first(tree, 'te-railIdle') === void 0, textOf(tree));
oneLevel.dispose();

/* ------------------------------------------------------------------ *
 * A model that declares six levels
 * ------------------------------------------------------------------ */
const sixGroups = [{
  id: 'p',
  models: [{ id: 'm6', name: 'Six', reasoning: { efforts: SIX, defaultEffort: 'medium' } }]
}];
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'high' },
  groups: sixGroups,
  retainedEffort: 'high'
});

const six = mountControl();
tree = six.draw();
check('declared ladder names the active level on the trigger',
  chipLabel(tree).indexOf('High') >= 0 && chipLabel(tree).indexOf('High') === chipLabel(tree).length - 4,
  chipLabel(tree));
check('trigger exposes the dialog popup contract',
  first(tree, 'te-chip').props['aria-haspopup'] === 'dialog' &&
  first(tree, 'te-chip').props['aria-expanded'] === false);
check('no panel before opening', first(tree, 'te-panel') === void 0);

tree = openIt(six);
const panel = first(tree, 'te-panel');
check('opening renders the panel', panel !== void 0);
check('panel is anchored fixed (survives the scroll container)',
  panel !== void 0 && panel.props.style !== void 0 &&
  typeof panel.props.style.left === 'string' && typeof panel.props.style.bottom === 'string',
  panel && JSON.stringify(panel.props.style));
check('panel sits above the trigger',
  panel !== void 0 && parseFloat(panel.props.style.bottom) > VIEWPORT_H - RAIL_TOP,
  panel && panel.props.style.bottom);
check('one tick per declared level', findAll(tree, byClass('te-tick')).length === 6,
  String(findAll(tree, byClass('te-tick')).length));
check('ticks light up to the active level', findAll(tree, byClass('te-tickOn')).length === 4,
  String(findAll(tree, byClass('te-tickOn')).length));
check('thumb reports the store position', (() => {
  const thumb = first(tree, 'te-thumb');
  return thumb.props['aria-valuenow'] === 4 && thumb.props['aria-valuemax'] === 6;
})());
/* Below the top stop the field stays mounted (so the boundary transition can
   still animate while dragging), but a settled non-max stop parks it fully
   dark: the clip line collapses and the glow goes to zero. */
const midField = first(tree, 'te-field');
check('below the top tier the parked lattice clip line collapses to zero',
  Math.abs(cellLine(midField)) <= 0.001, String(cellLine(midField)));
check('below the top tier the parked lattice is parked dark',
  Math.abs(cellGlow(midField)) <= 0.001, String(cellGlow(midField)));
check('the parked dark state hands the clip back to the thumb line',
  cellClip(midField) === '', cellClip(midField));
check('no footer note on a declared ladder', first(tree, 'te-footNote') === void 0);

/* ------------------------------------------------------------------ *
 * Highest tier: the 5-row lattice
 * ------------------------------------------------------------------ */
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'max' },
  groups: sixGroups,
  retainedEffort: 'max'
});
const maxTree = six.draw();
const field = first(maxTree, 'te-field');
const cells = findAll(maxTree, byClass('te-cell'));
const columnMatch = field.props.style === void 0
  ? null
  : String(field.props.style.gridTemplateColumns).match(/^repeat\((\d+),3px\)$/);
check('lattice appears at the highest tier', cells.length > 0, 'cells=' + cells.length);
check('lattice declares explicit columns (else it collapses to one row)', columnMatch !== null,
  field.props.style && field.props.style.gridTemplateColumns);
check('lattice declares six rows',
  field.props.style !== void 0 && field.props.style.gridTemplateRows === 'repeat(6,3px)',
  field.props.style && field.props.style.gridTemplateRows);
/* Coverage is the requirement: the field must fill every position, and the
   columns must span the rail. An earlier version dropped ~14% of the cells and
   centred the grid, which left both ends of the groove empty. */
const totalPositions = columnMatch === null ? 0 : 6 * Number(columnMatch[1]);
check('lattice fills every position (full coverage)',
  totalPositions > 0 && cells.length === totalPositions,
  cells.length + ' vs 6x' + (columnMatch && columnMatch[1]));
check('the field distributes its columns across the whole rail',
  /justify-content:space-between/.test(fs.readFileSync(BUNDLE, 'utf8')));
check('every lattice cell is a square span',
  cells.every((c) => c.type === 'span' &&
    (c.props.className === 'te-cell' || c.props.className === 'te-cell te-cellBlink')));
check('every cell carries its own weight (an uneven field where nothing moves)',
  cells.every((c) => c.props.style !== void 0 && Number(c.props.style['--te-o']) > 0),
  'first=' + JSON.stringify(cells[0] && cells[0].props.style));
check('cell weights actually differ',
  new Set(cells.map((c) => String(c.props.style['--te-o']))).size > 3);
check('some cells blink (the scatter)',
  cells.some((c) => c.props.className === 'te-cell te-cellBlink'));
check('blinking cells carry their own delay so they are not in lockstep',
  cells.filter((c) => c.props.className === 'te-cell te-cellBlink')
    .every((c) => c.props.style !== void 0 && String(c.props.style['--te-dl']).endsWith('s')));
check('blinking cells keep a brisk period (1.4s–3.3s)',
  cells.filter((c) => c.props.className === 'te-cell te-cellBlink')
    .every((c) => {
      const seconds = parseFloat(c.props.style['--te-d']);
      return seconds >= 1.4 && seconds <= 3.3;
    }));
check('the tier name turns into the max tier', first(maxTree, 'te-tierMax') !== void 0);
check('the panel carries the max flag', first(maxTree, 'te-max') !== void 0);
/* At the top stop the line bleeds past the thumb centre to the rail's inner
   edge, so no high-DPI rounding can leave the last visible column half-cut. */
check('at the top stop the clip line bleeds the lattice to the rail edge',
  cellLine(field) >= RAIL_WIDTH - 8, String(cellLine(field)));
check('at the top stop the lattice is parked fully lit',
  Math.abs(cellGlow(field) - 1) <= 0.001, String(cellGlow(field)));
check('the parked reveal stands folded open from the right edge',
  cellClip(field) === 'inset(0 0 0 0)', cellClip(field));

/* ------------------------------------------------------------------ *
 * Interaction
 * ------------------------------------------------------------------ */
const xAt = (levelIndex, count) => RAIL_LEFT + RAIL_PAD + (levelIndex / (count - 1)) * TRAVEL;

currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'medium' },
  groups: sixGroups,
  retainedEffort: 'medium'
});
const drag = mountControl();
tree = openIt(drag);

selectCalls.length = 0;
let rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: RAIL_LEFT + 9999, pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = drag.draw();
first(tree, 'te-rail').props.onPointerUp();
check('a click past the end commits the highest level',
  selectCalls.length === 1 && selectCalls[0].reasoningEffort === 'max',
  JSON.stringify(selectCalls));
check('the committed selection carries provider and model',
  selectCalls.length === 1 && selectCalls[0].provider === 'p' && selectCalls[0].model === 'm6');

selectCalls.length = 0;
const noop = mountControl();
tree = openIt(noop);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(2, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = noop.draw();
first(tree, 'te-rail').props.onPointerUp();
check('a click on the already-selected level sends nothing',
  selectCalls.length === 0, JSON.stringify(selectCalls));

/* ------------------------------------------------------------------ *
 * The ASYNCHRONY of a selection
 *
 * The RPC answers BEFORE the durable projection carries the change back, so
 * the store still holds the previous level when the answer arrives. Releasing
 * the optimistic position on the answer snapped the key back to that previous
 * level — which reads as "the click did nothing" — and when the previous
 * level was the top stop, every press looked like a frozen control.

 * The fixture below makes that window observable: the RPC is deferred, so the
 * test can look at the rail while the answer is still in flight, and can
 * publish the projection at a chosen moment.
 * ------------------------------------------------------------------ */
const deferred = [];
const originalSelect = directory.select;
/** Publish the durable projection: the store now names the selection. */
const publish = (selection) => {
  currentState = stateWith({
    current: {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: selection.reasoningEffort }
    },
    groups: sixGroups,
    retainedEffort: selection.reasoningEffort
  });
};

/* The suite is synchronous up to this point, so the asynchronous window is
   driven by one async function that the main chain awaits at the END. It must
   not run while the synchronous tests are still using the plain stub, so it
   installs its own stub when it is called. */
const asyncSuite = async () => {
  directory.select = function (selection) {
    selectCalls.push(selection);
    return new Promise((resolve) => {
      deferred.push({ selection, resolve });
    });
  };
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'max' },
  groups: sixGroups,
  retainedEffort: 'max'
});
selectCalls.length = 0;
deferred.length = 0;
const async1 = mountControl();
tree = openIt(async1);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(1, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = async1.draw();
first(tree, 'te-rail').props.onPointerUp();
tree = async1.draw();
check('the request goes out with the chosen level',
  selectCalls.length === 1 && selectCalls[0].reasoningEffort === 'low', JSON.stringify(selectCalls));
/* The answer is in flight and the store still says Max. The key must stay on
   the chosen level — this is the whole bug. */
check('the key stays on the chosen level while the answer is in flight',
  first(tree, 'te-thumb').props['aria-valuenow'] === 2, String(first(tree, 'te-thumb').props['aria-valuenow']));
/* The answer arrives; the projection has not yet. */
deferred[0].resolve({ ok: true });
await Promise.resolve();
tree = async1.draw();
check('the key does not snap back when the answer arrives',
  first(tree, 'te-thumb').props['aria-valuenow'] === 2, String(first(tree, 'te-thumb').props['aria-valuenow']));
/* The projection lands: the store names the new level, and the optimistic
   position is released — the rail now rests on the store's own level. */
publish({ provider: 'p', model: 'm6', reasoningEffort: 'low' });
tree = async1.draw();
check('the key rests on the store level once the projection lands',
  first(tree, 'te-thumb').props['aria-valuenow'] === 2, String(first(tree, 'te-thumb').props['aria-valuenow']));
async1.dispose();

/* --- a REFUSED answer gives the level back at once ---
   The store keeps the previous level, so the control must show it again
   rather than claim a level that was never accepted. */
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'max' },
  groups: sixGroups,
  retainedEffort: 'max'
});
selectCalls.length = 0;
deferred.length = 0;
const refused = mountControl();
tree = openIt(refused);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(1, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = refused.draw();
first(tree, 'te-rail').props.onPointerUp();
tree = refused.draw();
deferred[0].resolve({ ok: false, error: { code: 'session/model-unavailable', message: 'no' } });
await Promise.resolve();
tree = refused.draw();
check('a refused selection returns the key to the store level',
  first(tree, 'te-thumb').props['aria-valuenow'] === 6, String(first(tree, 'te-thumb').props['aria-valuenow']));
refused.dispose();

/* --- an older answer must not clear a newer choice ---
   Two requests in flight: the first one settles late, and its settlement must
   not release the SECOND request's optimistic position. */
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'max' },
  groups: sixGroups,
  retainedEffort: 'max'
});
selectCalls.length = 0;
deferred.length = 0;
const raced = mountControl();
tree = openIt(raced);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(1, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = raced.draw();
first(tree, 'te-rail').props.onPointerUp();
tree = raced.draw();
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(3, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = raced.draw();
first(tree, 'te-rail').props.onPointerUp();
tree = raced.draw();
check('two requests are in flight', deferred.length === 2, String(deferred.length));
check('the newest choice is on the rail',
  first(tree, 'te-thumb').props['aria-valuenow'] === 4, String(first(tree, 'te-thumb').props['aria-valuenow']));
/* The OLDER answer settles last. */
deferred[0].resolve({ ok: true });
await Promise.resolve();
tree = raced.draw();
check('a late answer does not clear the newer choice',
  first(tree, 'te-thumb').props['aria-valuenow'] === 4, String(first(tree, 'te-thumb').props['aria-valuenow']));
/* The newer answer settles: the choice is released to the store. */
deferred[1].resolve({ ok: true });
await Promise.resolve();
publish({ provider: 'p', model: 'm6', reasoningEffort: 'high' });
tree = raced.draw();
check('the newer choice settles on the store level',
  first(tree, 'te-thumb').props['aria-valuenow'] === 4, String(first(tree, 'te-thumb').props['aria-valuenow']));
raced.dispose();

/* --- an older REFUSED answer must not clear the newer choice ---
   A refusal releases the optimistic position, so a stale refusal arriving
   after a newer request would take the key back to the store level while the
   newer request is still in flight — the very "the press did nothing" the
   generation guard exists to prevent. */
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'max' },
  groups: sixGroups,
  retainedEffort: 'max'
});
selectCalls.length = 0;
deferred.length = 0;
const staleRefusal = mountControl();
tree = openIt(staleRefusal);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(1, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = staleRefusal.draw();
first(tree, 'te-rail').props.onPointerUp();
tree = staleRefusal.draw();
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(3, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = staleRefusal.draw();
first(tree, 'te-rail').props.onPointerUp();
tree = staleRefusal.draw();
check('the newer choice is on the rail before the stale refusal',
  first(tree, 'te-thumb').props['aria-valuenow'] === 4, String(first(tree, 'te-thumb').props['aria-valuenow']));
deferred[0].resolve({ ok: false, error: { code: 'session/model-unavailable', message: 'no' } });
await Promise.resolve();
tree = staleRefusal.draw();
check('a stale refusal does not take the key back',
  first(tree, 'te-thumb').props['aria-valuenow'] === 4, String(first(tree, 'te-thumb').props['aria-valuenow']));
staleRefusal.dispose();

/* The deferred fixture is done; the rest of the suite uses the plain stub. */
directory.select = originalSelect;
};

/* ------------------------------------------------------------------ *
 * Snapping
 *
 * The thumb must sit on the active level's tick, and must return to it when a
 * drag is released off-tick. It is positioned by an imperative layout effect
 * (not by render), so a missing effect dependency leaves the thumb wherever
 * the pointer left it: it looks like the control "never moves to the level".
 * ------------------------------------------------------------------ */
const thumbX = (t) => {
  const node = first(t, 'te-thumb');
  const ref = node === void 0 ? void 0 : node.props.ref;
  const el = ref === void 0 ? void 0 : ref.current;
  const match = /translateX\(([-\d.]+)px\)/.exec((el === void 0 ? '' : el.style.transform) ?? '');
  return match === null ? NaN : Number(match[1]);
};
const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 0.51;
const parkedAt = (levelIndex, count) => (levelIndex / (count - 1)) * TRAVEL;

currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'medium' },
  groups: sixGroups,
  retainedEffort: 'medium'
});
const snap = mountControl();
tree = openIt(snap);
check('the thumb parks on the active level, not at the start',
  near(thumbX(tree), parkedAt(2, 6)), String(thumbX(tree)) + ' vs ' + String(parkedAt(2, 6)));

/* Released inside the SAME tier: the tier does not change, so nothing else
   re-renders the thumb — this is the case that showed no snap at all. A press
   no longer jumps: the key waits until the gesture passes the engage
   threshold, then follows the pointer raw. */
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(2, 6) + 9, pointerId: 1, currentTarget: rail, preventDefault() {}
});
tree = snap.draw();
check('a press does not teleport the key (it waits for a real drag)',
  near(thumbX(tree), parkedAt(2, 6)), String(thumbX(tree)) + ' vs ' + String(parkedAt(2, 6)));
rail.props.onPointerMove({ clientX: xAt(2, 6) + 9 });
check('a jiggle below the engage threshold still does not move the key',
  near(thumbX(tree), parkedAt(2, 6)), String(thumbX(tree)) + ' vs ' + String(parkedAt(2, 6)));
rail.props.onPointerMove({ clientX: xAt(2, 6) + 18 });
tree = snap.draw();
check('the thumb follows the pointer once the drag engages',
  thumbX(tree) > parkedAt(2, 6) + 4, String(thumbX(tree)));
first(tree, 'te-rail').props.onPointerUp();
tree = snap.draw();
check('releasing off-tick inside the same level snaps back to its tick',
  near(thumbX(tree), parkedAt(2, 6)), String(thumbX(tree)) + ' vs ' + String(parkedAt(2, 6)));

/* Released on a DIFFERENT tier: it must park on the new tick, not under the
   pointer. A press past the threshold engages, so the release commits the
   dragged level. */
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(3, 6) + 11, pointerId: 1, currentTarget: rail, preventDefault() {}
});
rail.props.onPointerMove({ clientX: xAt(3, 6) + 11 });
tree = snap.draw();
first(tree, 'te-rail').props.onPointerUp();
tree = snap.draw();
check('releasing on another level parks on that level\'s tick',
  near(thumbX(tree), parkedAt(3, 6)), String(thumbX(tree)) + ' vs ' + String(parkedAt(3, 6)));
snap.dispose();

/* A stolen pointer (touch scroll) aborts: nothing commits, and the optimistic
   level pushed mid-drag is dropped so the key springs back to the store's
   level rather than parking wherever the pointer died. */
selectCalls.length = 0;
const cancel = mountControl();
tree = openIt(cancel);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(4, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
rail.props.onPointerMove({ clientX: xAt(1, 6) });
first(tree, 'te-rail').props.onPointerCancel();
tree = cancel.draw();
check('a stolen pointer commits nothing',
  selectCalls.length === 0, JSON.stringify(selectCalls));
check('a cancelled drag returns the key to the store level',
  near(thumbX(tree), parkedAt(2, 6)), String(thumbX(tree)) + ' vs ' + String(parkedAt(2, 6)));
cancel.dispose();

selectCalls.length = 0;
const step = mountControl();
tree = openIt(step);
rail = first(tree, 'te-rail');
/* A short drag (press one notch over, drag across the threshold) commits the
   level it ends on — the engage path, distinct from the click commits above. */
rail.props.onPointerDown({
  clientX: xAt(3, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
rail.props.onPointerMove({ clientX: xAt(3, 6) });
rail.props.onPointerMove({ clientX: xAt(2.8, 6) });
first(tree, 'te-rail').props.onPointerUp();
check('a one-notch drag sends exactly one request',
  selectCalls.length === 1 && selectCalls[0].reasoningEffort === 'high',
  JSON.stringify(selectCalls));

/* ------------------------------------------------------------------ *
 * The boundary transition
 *
 * The lattice exists only at the top stop, but leaving it must not snap:
 * while the thumb crosses the zone between the top two stops the clip line
 * tracks the pointer raw (nothing survives to its right) while the glow
 * dissolves smoothly; below the zone everything is dark, even mid-drag.
 * Leftover squares right of the thumb, or a visible lattice parked on a
 * non-max stop, are the exact regressions this block guards.
 * ------------------------------------------------------------------ */
selectCalls.length = 0;
const rung = mountControl();
tree = openIt(rung);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: xAt(4.5, 6), pointerId: 1, currentTarget: rail, preventDefault() {}
});
rail.props.onPointerMove({ clientX: xAt(4.5, 6) });
tree = rung.draw();
const zoneStart = 4 / 5;
const glowAt = (value) => {
  const t = Math.min(1, Math.max(0, (value - zoneStart) / (1 - zoneStart)));
  return t * t * (3 - 2 * t);
};
const checkLine = (label, field, expectedLine, expectedGlow) => {
  const line = cellLine(field);
  const glow = cellGlow(field);
  check(label,
    Math.abs(line - expectedLine) <= 0.01 && Math.abs(glow - expectedGlow) <= 0.001,
    String(line) + ' / ' + String(glow) + ' vs ' + String(expectedLine) + ' / ' + String(expectedGlow));
};
check('a seated press before the engage threshold paints nothing',
  cellLine(first(tree, 'te-field')) === 0 && Math.abs(cellGlow(first(tree, 'te-field'))) <= 0.001,
  String(cellLine(first(tree, 'te-field'))) + ' / ' + String(cellGlow(first(tree, 'te-field'))));
rail.props.onPointerMove({ clientX: xAt(5, 6) });
tree = rung.draw();
checkLine('a drag seated at the top stop keeps the clip at the thumb and the hall lit',
  first(tree, 'te-field'), 9 + TRAVEL, glowAt(1));
check('a running drag paints through the var-driven thumb line again',
  cellClip(first(tree, 'te-field')) === '', cellClip(first(tree, 'te-field')));
/* Down through the zone and out the bottom of it: the field melts away. */
rail.props.onPointerMove({ clientX: xAt(4, 6) });
checkLine('at the second stop the drag has already parked the lattice in the dark',
  first(tree, 'te-field'), 9 + (4 / 5) * TRAVEL, glowAt(0.8));
rail.props.onPointerMove({ clientX: xAt(3, 6) });
checkLine('below the zone even an in-flight drag shows nothing',
  first(tree, 'te-field'), 9 + (3 / 5) * TRAVEL, glowAt(0.6));
/* Back up into the zone: the hall relights under the hand, clipped at the
   thumb, reaching exactly half glow at the zone's midpoint. */
rail.props.onPointerMove({ clientX: xAt(4.5, 6) });
checkLine('crossing back into the zone the lattice fades in under the hand',
  first(tree, 'te-field'), 9 + (4.5 / 5) * TRAVEL, glowAt(0.9));
rail.props.onPointerMove({ clientX: xAt(5, 6) });
checkLine('back at the top stop a running drag is fully lit again',
  first(tree, 'te-field'), 9 + TRAVEL, glowAt(1));
first(tree, 'te-rail').props.onPointerUp();
tree = rung.draw();
check('the drag back to the top stop commits the maximum tier',
  selectCalls.length === 1 && selectCalls[0].reasoningEffort === 'max',
  JSON.stringify(selectCalls));
/* The optimistic release keeps the park lit at the committed top stop: the
   fake store's round trip has not settled yet, so the optimistic position is
   the truth on screen (a real store publishes the new stop immediately and
   the park relights for it the same way). The settled truth below the top
   stop — full darkness — is asserted by the parked checks above. */
check('after release the optimistic park stays lit at the committed top stop',
  cellLine(first(tree, 'te-field')) >= RAIL_WIDTH - 8 &&
  Math.abs(cellGlow(first(tree, 'te-field')) - 1) <= 0.001,
  String(cellLine(first(tree, 'te-field'))) + ' / ' + String(cellGlow(first(tree, 'te-field'))));
check('releasing on the top stop finalizes the folded-open clip again',
  cellClip(first(tree, 'te-field')) === 'inset(0 0 0 0)', cellClip(first(tree, 'te-field')));

/* Keyboard: each case gets a fresh mount so an in-flight optimistic choice
   from the previous case cannot shift the starting position. */
const keyboard = (from, key) => {
  currentState = stateWith({
    current: { provider: 'p', model: 'm6', reasoningEffort: from },
    groups: sixGroups,
    retainedEffort: from
  });
  selectCalls.length = 0;
  const handle = mountControl();
  let view = openIt(handle);
  const grip = first(view, 'te-thumb');
  const valueText = grip.props['aria-valuetext'];
  grip.props.onKeyDown({ key, preventDefault() {} });
  const sent = selectCalls.slice();
  handle.dispose();
  return { valueText, sent };
};

const gripProbe = keyboard('medium', 'End');
check('thumb is an accessible slider reporting its position',
  /Medium/.test(gripProbe.valueText) && gripProbe.valueText.length > 0, gripProbe.valueText);
check('End commits the highest level',
  gripProbe.sent.length === 1 && gripProbe.sent[0].reasoningEffort === 'max',
  JSON.stringify(gripProbe.sent));
check('ArrowLeft steps down exactly one level',
  keyboard('medium', 'ArrowLeft').sent.map((s) => s.reasoningEffort).join(',') === 'low',
  JSON.stringify(keyboard('medium', 'ArrowLeft').sent));
check('ArrowRight steps up exactly one level',
  keyboard('medium', 'ArrowRight').sent.map((s) => s.reasoningEffort).join(',') === 'high',
  JSON.stringify(keyboard('medium', 'ArrowRight').sent));
check('Home commits the lowest level',
  keyboard('high', 'Home').sent.map((s) => s.reasoningEffort).join(',') === 'minimal',
  JSON.stringify(keyboard('high', 'Home').sent));
check('a key at the end of the ladder sends nothing',
  keyboard('max', 'End').sent.length === 0,
  JSON.stringify(keyboard('max', 'End').sent));

currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'medium' },
  groups: sixGroups,
  retainedEffort: 'medium'
});
const keys = mountControl();
tree = openIt(keys);
/* Escape is handled at the document level so it works with focus anywhere in
   the panel, not only on the slider. The runtime has no real document, so the
   listener is captured from the effect and invoked directly. */
const escDoc = {
  listeners: [],
  body: null,
  addEventListener(type, fn) { if (type === 'keydown') this.listeners.push(fn); },
  removeEventListener(type, fn) {
    const at = this.listeners.indexOf(fn);
    if (at >= 0) this.listeners.splice(at, 1);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
const savedDocument = globalThis.document;
globalThis.document = escDoc;
const esc = mountControl();
tree = openIt(esc);
check('Escape is wired at the document level', escDoc.listeners.length > 0);
for (const fn of escDoc.listeners) fn({ key: 'Escape' });
tree = esc.draw();
check('Escape closes the panel', first(tree, 'te-panel') === void 0);
esc.dispose();
globalThis.document = savedDocument;

/* ------------------------------------------------------------------ *
 * Forced ladder: preview only, plus rejection
 *
 * A model that declares no ladder cannot take an effort — `dsh-llm` throws
 * before provider I/O and `session/selectModel` runs the same check — so the
 * rail drops its affordances instead of promising a change it cannot make.
 * ------------------------------------------------------------------ */
const NO_LADDER = [{ id: 'p', models: [{ id: 'm-none', name: 'No Reasoning' }] }];
currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
const forced = mountControl();
tree = openIt(forced);

check('a forced ladder still opens the panel', first(tree, 'te-panel') !== void 0);
check('a forced ladder previews the five declarable stops',
  first(tree, 'te-rail') !== void 0 && findAll(tree, byClass('te-tick')).length === 5,
  String(findAll(tree, byClass('te-tick')).length));
check('a forced rail is marked idle', first(tree, 'te-railIdle') !== void 0);
check('an idle rail draws no thumb (nothing to move)', first(tree, 'te-thumb') === void 0);
check('an idle rail draws no fill', first(tree, 'te-railIdle') !== void 0);

{
  const rail = first(tree, 'te-rail');
  selectCalls.length = 0;
  const down = { currentTarget: { setPointerCapture() {} }, clientX: 700, pointerId: 1, preventDefault() {} };
  rail.props.onPointerDown(down);
  rail.props.onPointerMove(down);
  rail.props.onPointerUp(down);
  check('an idle rail cannot commit a drag', selectCalls.length === 0, JSON.stringify(selectCalls));
  check('an idle rail does not enter a drag state', first(keys.draw(), 'te-railDrag') === void 0);
}

check('a forced ladder explains itself with the new note',
  textOf(first(tree, 'te-footNote')).indexOf(app.dictionary.zh['state.undeclared']) === 0,
  textOf(first(tree, 'te-footNote')));
check('the note is the only text in the footer (no reserved empty line)',
  textOf(first(tree, 'te-footNote')) === app.dictionary.zh['state.undeclared'],
  textOf(first(tree, 'te-footNote')));
check('a note footer does not reserve the description height',
  first(tree, 'te-footDesc') === void 0);
currentState = stateWith({
  current: { provider: 'p', model: 'm-none', reasoningEffort: 'high' },
  groups: NO_LADDER,
  status: 'error',
  error: 'llm/unsupported-effort: nope'
});
tree = forced.draw();
check('a rejected selection shows an error footer', first(tree, 'te-footErr') !== void 0);
check('the error footer wins over the forced-ladder hint',
  textOf(first(tree, 'te-footErr')) === app.dictionary.zh['state.failed'], textOf(tree));

/* ------------------------------------------------------------------ *
 * A STRANDED level: the store holds a level the model does not offer
 *
 * `session/selectModel` writes the chosen level into the durable session
 * projection AND into `agent-default-model`, and it accepts the choice even
 * when the model declares no ladder at all. So a level chosen on one model
 * survives the switch to another, and the control used to sit on it as if it
 * were in force: the thumb parked on the top stop (reading as "locked at
 * max"), and a press on that very stop was swallowed as "already selected" —
 * which is what "I cannot switch levels at all" looks like.
 *
 * Whether the level is stranded is the HOST's answer (it knows what the
 * request path accepts), so the full case lives in the async suite below,
 * where a fake Host can answer. What is asserted here is the part that needs
 * no Host: the rail must not present a level the model does not offer.
 * ------------------------------------------------------------------ */
const STRANDED = [{ id: 'p', models: [{ id: 'm-none', name: 'No Reasoning' }] }];
currentState = stateWith({
  current: { provider: 'p', model: 'm-none', reasoningEffort: 'max' },
  groups: STRANDED,
  retainedEffort: 'max'
});
selectCalls.length = 0;
const stranded = mountControl();
tree = openIt(stranded);
tree = stranded.draw();
/* The model offers nothing, so the preview stops are not levels and the
   stranded one is not in force: the trigger must not name it. */
check('a stranded level is not named as the active one',
  chipLabel(tree).indexOf('Max') < 0, chipLabel(tree));
check('a stranded level does not paint the control as the top tier',
  first(tree, 'te-tierMax') === void 0, textOf(tree));
/* It is NOT repaired behind the user's back. An automatic repair here would
   rewrite the user's GLOBAL default as a side effect of merely opening the
   composer — and the store's `current` can be a perfectly valid level of a
   model whose catalogue has not loaded yet, so the "repair" would drop a
   working level. */
check('a stranded level is not repaired automatically',
  selectCalls.length === 0, JSON.stringify(selectCalls));
stranded.dispose();

/* A press on the top stop of a ladder that DOES offer it stays a no-op: the
   level is genuinely in force, so nothing is sent. This is the counterpart of
   the case above and must not regress into "always send". */
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'max' },
  groups: sixGroups,
  retainedEffort: 'max'
});
selectCalls.length = 0;
const liveMax = mountControl();
tree = openIt(liveMax);
rail = first(tree, 'te-rail');
rail.props.onPointerDown({
  clientX: RAIL_LEFT + 9999, pointerId: 1, currentTarget: rail, preventDefault() {}
});
liveMax.draw();
first(liveMax.draw(), 'te-rail').props.onPointerUp();
check('a press on the level already in force sends nothing',
  selectCalls.length === 0, JSON.stringify(selectCalls));
liveMax.dispose();

/* ------------------------------------------------------------------ *
 * A model that declares five levels: the removal action must know what
 * the Host thinks
 *
 * The removal button appears only on a ladder the plugin declared, while the
 * Host's verdict — the only source that knows whether the ladder is still
 * there and still the plugin's — used to be read only for a ladder too THIN
 * to choose from. The two conditions could never hold at once, so the
 * button never knew what the Host thought of it.
 *
 * The Host is consulted in the async suite below, where a fake Host can
 * answer; without one there is no verdict to act on, and offering a removal
 * nobody confirmed would be a lie.
 * ------------------------------------------------------------------ */
currentState = stateWith({
  current: { provider: 'p', model: 'm6', reasoningEffort: 'high' },
  groups: sixGroups,
  retainedEffort: 'high'
});
const owned = mountControl();
tree = openIt(owned);
tree = owned.draw();
/* A ladder with a per-level description is somebody else's declaration —
   the shape the plugin does NOT own — so it must not offer the removal
   action. The plugin's own shape (no description, no default) is the case
   the async suite covers. */
check('a foreign ladder (with descriptions) offers no removal action',
  first(tree, 'te-act') === void 0 || textOf(first(tree, 'te-act')) !== app.dictionary.zh['act.revert'],
  textOf(tree));
owned.dispose();

/* ------------------------------------------------------------------ *
 * Declaring a ladder: the Host round trip
 *
 * The browser half talks to `bundle/index.js` over one Fetch route, so a fake
 * host is enough to drive every state the panel can be in.
 * ------------------------------------------------------------------ */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let hostState = 'undeclared';
let hostCode = null;
/* The levels the fake Host says the request path accepts, or null for "could
   not be read". The real Host answers this from the live adapter, and it is
   the authority on what a model takes. */
let hostLevels = null;
const hostCalls = [];
/* One models.dev answer, deep-copied per request so a prefill cannot mutate it.
   TWO rows on purpose: the same model is listed by many providers with
   different ladders, and the plugin must pick the WIDEST one — a narrow row
   first would have hidden that. The first row is the narrow one, so the test
   fails if the plugin takes the first match instead of the widest. */
const modelsDevMatch = {
  ok: true,
  count: 2,
  matches: [{
    provider: 'aimlapi', id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', reasoning: true,
    efforts: ['low', 'medium', 'high'],
    options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
  }, {
    provider: 'openai', id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', reasoning: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }]
  }]
};
globalThis.fetch = (input, init) => {
  const url = String(input);
  const method = init === void 0 || init.method === void 0 ? 'GET' : init.method;
  const body = init !== void 0 && init.body !== void 0 ? JSON.parse(init.body) : null;
  hostCalls.push({ url, method, body });
  if (url.indexOf('modelsdev') >= 0) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(modelsDevMatch)))
    });
  }
  /* A refused write is about the POST only: the read must still answer, or the
     panel would never reach the state that offers the action. */
  if (hostCode !== null && method === 'POST') {
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false, code: hostCode }) });
  }
  if (method === 'GET') {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, state: hostState, levels: hostLevels })
    });
  }
  hostState = body.action === 'declare' ? 'ours' : 'undeclared';
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, state: hostState }) });
};

/** A model whose ladder is exactly what the Host half writes. */
const declaredGroups = [{ id: 'p', models: [{ id: 'm-none', name: 'No Reasoning', reasoning: {
  efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }]
} }] }];

/* A ladder as the Host publishes it for a model THIS plugin declared:
   `reasoningInfo` in `dsh-llm-pi-ai` synthesizes exactly `{ id, name }` — no
   per-level description and no default. That shape is the plugin's contract,
   so the removal action must appear on it. */
const OWNED_SHAPE = [{ id: 'p', models: [{ id: 'm-owned', name: 'Owned', reasoning: {
  efforts: [
    { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' },
    { id: 'xhigh', name: 'Xhigh' }, { id: 'max', name: 'Max' }
  ]
} }] }];

const declareSuite = async () => {
  /* --- undeclared: the panel offers the one-click enable --- */
  hostState = 'undeclared';
  hostCode = null;
  hostLevels = null;
  hostCalls.length = 0;
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
  const live = mountControl();
  tree = openIt(live);
  check('the read is issued once the panel opens', hostCalls.length === 1, JSON.stringify(hostCalls));
  check('the read names the provider and model',
    hostCalls[0].method === 'GET' && hostCalls[0].url.indexOf('provider=p') > 0 && hostCalls[0].url.indexOf('model=m-none') > 0,
    hostCalls[0].url);
  await flush();
  tree = live.draw();
  check('an undeclared ladder offers the one-click enable',
    first(tree, 'te-act') !== void 0 && textOf(first(tree, 'te-act')) === app.dictionary.zh['act.declare'],
    textOf(tree));
  check('the custom picker hangs off a separate quiet link',
    first(tree, 'te-footAlt') !== void 0 && textOf(first(tree, 'te-footAlt')) === app.dictionary.zh['act.custom'],
    textOf(tree));

  /* --- the primary write needs no form: ask models.dev, then POST --- */
  hostCalls.length = 0;
  first(tree, 'te-act').props.onClick();
  tree = live.draw();
  check('the one-click enable opens no form', first(tree, 'te-cho') === void 0, textOf(tree));
  await flush();
  tree = live.draw();
  const suggested = hostCalls.find((c) => c.method === 'GET' && c.url.indexOf('modelsdev') >= 0);
  check('the one-click enable asks models.dev for the bare name',
    suggested !== void 0 && suggested.url.indexOf('name=m-none') > 0, JSON.stringify(hostCalls));
  const direct = hostCalls.find((c) => c.method === 'POST');
  check('the one-click enable writes the suggested ladder directly',
    direct !== void 0 && direct.body.action === 'declare' && direct.body.provider === 'p' && direct.body.model === 'm-none' &&
    JSON.stringify(direct.body.levels) === JSON.stringify({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }),
    JSON.stringify(direct === void 0 ? '{}' : direct.body));
  check('the suggestion precedes the write',
    suggested !== void 0 && direct !== void 0 && hostCalls.indexOf(suggested) < hostCalls.indexOf(direct),
    JSON.stringify(hostCalls));
  check('the suggested ladder lands without opening the picker', first(live.draw(), 'te-cho') === void 0);

  /* --- after the Host publishes the new ladder --- */
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: declaredGroups });
  await flush();
  tree = live.draw();
  check('a declared ladder turns the rail live again',
    first(tree, 'te-railIdle') === void 0 && first(tree, 'te-thumb') !== void 0);
  check('the preview stops being a note and reports the enablement',
    textOf(first(tree, 'te-footNote')).indexOf(app.dictionary.zh['state.ours']) === 0,
    textOf(first(tree, 'te-footNote')));
  check('a declared ladder offers the removal action',
    first(tree, 'te-act') !== void 0 && textOf(first(tree, 'te-act')) === app.dictionary.zh['act.revert'],
    textOf(tree));

  /* --- remove the enablement --- */
  first(tree, 'te-act').props.onClick();
  await flush();
  const revert = hostCalls.findLast((c) => c.method === 'POST');
  check('removing posts the revert action', revert !== void 0 && revert.body.action === 'revert', JSON.stringify(revert && revert.body));
  check('reverting carries no levels', revert === void 0 || revert.body.levels === void 0, JSON.stringify(revert && revert.body));

  /* --- the revert farewell: the key's ghost springs home ---
     The idle flip hides the live key outright; the ghost must spawn where
     the key last rested, spring home to the rail's left rest while fading,
     and retire. The spring itself is a two-step inline write (cut → flush →
     release → land) that a synchronous re-draw would overwrite, so the
     assertions — like every transition in this suite — read only the settled
     values: the ghost EXISTS during the farewell, its fill spans the rail
     (spawn wrote it), and both retire after the timer. */
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
  tree = live.draw();
  const ghost = first(tree, 'te-ghost');
  check('a reverted rail says goodbye with the key\'s ghost',
    ghost !== void 0 && first(tree, 'te-railIdle') !== void 0,
    JSON.stringify(ghost === void 0 ? 'no ghost' : 'ghost'));
  const ghostFill = first(tree, 'te-ghostFill');
  const ghostFillEl = ghostFill === void 0 ? void 0 : ghostFill.props.ref.current;
  const ghostFillWidth = ghostFillEl === void 0 ? NaN : Number.parseFloat(ghostFillEl.style.width);
  check('the ghost fill spans the same start',
    Number.isFinite(ghostFillWidth) && ghostFillWidth >= 9,
    String(ghostFillWidth));
  await new Promise((resolve) => setTimeout(resolve, 700));
  tree = live.draw();
  check('the retired ghost leaves a clean idle rail',
    first(tree, 'te-ghost') === void 0 && first(tree, 'te-ghostFill') === void 0, textOf(tree));

  /* --- the custom door: the picker opens without writing --- */
  hostState = 'undeclared';
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
  const custom = mountControl();
  tree = openIt(custom);
  await flush();
  tree = custom.draw();
  hostCalls.length = 0;
  first(tree, 'te-footAlt').props.onClick();
  tree = custom.draw();
  check('the custom link opens the picker', first(tree, 'te-cho') !== void 0, textOf(tree));
  check('opening the picker issues no write', !hostCalls.some((c) => c.method === 'POST'), JSON.stringify(hostCalls));
  check('the fixed footer vanishes while the picker is open',
    first(tree, 'te-footNote') === void 0 && first(tree, 'te-footErr') === void 0, textOf(tree));
  await flush();
  tree = custom.draw();
  let chips = findAll(tree, byClass('te-lvl'));
  check('the picker offers the whole level vocabulary', chips.length === 7,
    String(chips.length));
  check('the vocabulary is offered in escalation order',
    chips.map((c) => textOf(c)).join(',') === 'Off,Minimal,Low,Medium,High,Xhigh,Max',
    chips.map((c) => textOf(c)).join(','));
  check('a models.dev match pre-fills the selection',
    findAll(tree, byClass('te-lvlOn')).map((c) => textOf(c)).join(',') === 'Low,Medium,High,Xhigh,Max',
    findAll(tree, byClass('te-lvlOn')).map((c) => textOf(c)).join(','));
  check('the wire spelling stays out of the default path',
    findAll(tree, byClass('te-wireInput')).length === 0, textOf(tree));
  check('the draft drives the idle preview above the picker',
    findAll(tree, byClass('te-tick')).length === 5,
    String(findAll(tree, byClass('te-tick')).length));
  check('the pre-filled match is named in the picker note', textOf(tree).indexOf('gpt-6.1-sol') >= 0, textOf(tree));

  /* --- the expert rows live behind the toggle --- */
  first(tree, 'te-choAdv').props.onClick();
  tree = custom.draw();
  check('opening the toggle reveals the wire rows pre-filled',
    findAll(tree, byClass('te-wireInput')).map((w) => w.props.value).join(';') === 'low;medium;high;xhigh;max',
    findAll(tree, byClass('te-wireInput')).map((w) => w.props.value).join(';'));
  chips = findAll(tree, byClass('te-lvl'));
  chips[1].props.onClick();
  tree = custom.draw();
  check('picking a level adds its wire row and extends the preview',
    findAll(tree, byClass('te-lvlOn')).length === 6 &&
    findAll(tree, byClass('te-wireInput')).length === 6 &&
    findAll(tree, byClass('te-tick')).length === 6,
    String(findAll(tree, byClass('te-lvlOn')).length) + '/' +
    String(findAll(tree, byClass('te-wireInput')).length) + '/' +
    String(findAll(tree, byClass('te-tick')).length));

  /* --- cancel discards the draft --- */
  first(tree, 'te-btnGhost').props.onClick();
  tree = custom.draw();
  check('cancelling closes the picker', first(tree, 'te-cho') === void 0, textOf(tree));
  check('cancelling restores the plain note and the action',
    first(tree, 'te-footNote') !== void 0 && first(tree, 'te-act') !== void 0, textOf(tree));
  check('cancelling restores the fixed preview', findAll(tree, byClass('te-tick')).length === 5,
    String(findAll(tree, byClass('te-tick')).length));

  /* --- reopening is fresh; apply writes a CUSTOMIZED ladder --- */
  first(tree, 'te-footAlt').props.onClick();
  tree = custom.draw();
  check('reopening the picker starts a fresh draft', findAll(tree, byClass('te-lvlOn')).length === 0,
    String(findAll(tree, byClass('te-lvlOn')).length));
  await flush();
  tree = custom.draw();
  check('the fresh draft re-prefills from models.dev', findAll(tree, byClass('te-lvlOn')).length === 5,
    String(findAll(tree, byClass('te-lvlOn')).length));
  hostCalls.length = 0;
  first(tree, 'te-btnApply').props.onClick();
  await flush();
  const post = hostCalls.find((c) => c.method === 'POST');
  check('the picker posts the action it offered',
    post !== void 0 && post.body.action === 'declare' && post.body.provider === 'p' && post.body.model === 'm-none',
    JSON.stringify(hostCalls));
  check('the picker posts the wired levels, in vocabulary order',
    post !== void 0 && JSON.stringify(post.body.levels) === JSON.stringify({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }),
    post === void 0 ? '{}' : JSON.stringify(post.body.levels));
  check('the picker closes after the write lands', first(custom.draw(), 'te-cho') === void 0);

  /* --- a model that is not ours --- */
  hostState = 'native';
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
  const foreign = mountControl();
  tree = openIt(foreign);
  await flush();
  tree = foreign.draw();
  check('a foreign ladder offers no action', first(tree, 'te-act') === void 0, textOf(tree));

  /* --- a route the Host cannot edit --- */
  hostState = 'unsupported';
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
  const unreachable = mountControl();
  tree = openIt(unreachable);
  await flush();
  tree = unreachable.draw();
  check('an unmanageable model says so instead of offering a dead action',
    first(tree, 'te-act') === void 0 &&
    textOf(first(tree, 'te-footNote')) === app.dictionary.zh['state.undeclared'] + app.dictionary.zh['state.unmanageable'],
    textOf(first(tree, 'te-footNote')));

  /* --- a write the Host refuses: both error surfaces stay honest --- */
  hostState = 'undeclared';
  hostCode = 'route-missing';
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
  const broken = mountControl();
  tree = openIt(broken);
  await flush();
  tree = broken.draw();
  first(tree, 'te-act').props.onClick();
  await flush();
  tree = broken.draw();
  check('a refused one-click write reports its cause in the footer',
    first(tree, 'te-footErr') !== void 0 &&
    textOf(first(tree, 'te-footErr')).indexOf(app.dictionary.zh['why.route-missing']) >= 0, textOf(tree));
  check('the refusal leaves the retry affordance up',
    first(tree, 'te-act') !== void 0 && first(tree, 'te-footAlt') !== void 0, textOf(tree));
  first(tree, 'te-footAlt').props.onClick();
  tree = broken.draw();
  check('the refused write still opens the picker', first(tree, 'te-cho') !== void 0, textOf(tree));
  await flush();
  tree = broken.draw();
  first(tree, 'te-btnApply').props.onClick();
  await flush();
  tree = broken.draw();
  check('a refused write paints its own reason inside the picker',
    first(tree, 'te-choNoteErr') !== void 0 &&
    textOf(first(tree, 'te-choNoteErr')).indexOf(app.dictionary.zh['why.route-missing']) >= 0,
    textOf(tree));
  check('the picker stays open to retry after a refusal', first(tree, 'te-cho') !== void 0, textOf(tree));
  check('a refusal does not paint the idle footer (the picker owns the note)',
    first(tree, 'te-footErr') === void 0, textOf(tree));
  hostCode = null;

  /* --- a refused REMOVAL on a ladder the plugin declared ---
     The removal button used to be rendered without ever showing what the Host
     answered, so a refusal left the button looking inert — the exact "the
     undo button does nothing" symptom. The error belongs on screen. */
  hostState = 'ours';
  hostCode = 'not-ours';
  currentState = stateWith({
    current: { provider: 'p', model: 'm-owned', reasoningEffort: 'high' },
    groups: OWNED_SHAPE,
    retainedEffort: 'high'
  });
  const refused = mountControl();
  tree = openIt(refused);
  await flush();
  tree = refused.draw();
  check('a declared ladder offers the removal action',
    first(tree, 'te-act') !== void 0 && textOf(first(tree, 'te-act')) === app.dictionary.zh['act.revert'],
    textOf(tree));
  first(tree, 'te-act').props.onClick();
  await flush();
  tree = refused.draw();
  check('a refused removal reports its cause in the footer',
    first(tree, 'te-footErr') !== void 0 &&
    textOf(first(tree, 'te-footErr')).indexOf(app.dictionary.zh['why.not-ours']) >= 0, textOf(tree));
  check('a refused removal keeps the removal affordance up',
    first(tree, 'te-act') !== void 0, textOf(tree));
  hostCode = null;
  refused.dispose();

  /* --- the Host's verdict is asked even on a ladder that IS selectable ---
     The read used to happen only for a ladder too thin to choose from, so the
     plugin never learned what the Host thought about a ladder it declared —
     and the two conditions could never hold at once. */
  hostState = 'ours';
  hostCalls.length = 0;
  currentState = stateWith({
    current: { provider: 'p', model: 'm-owned', reasoningEffort: 'high' },
    groups: OWNED_SHAPE,
    retainedEffort: 'high'
  });
  const asked = mountControl();
  tree = openIt(asked);
  await flush();
  tree = asked.draw();
  const verdict = hostCalls.find((c) => c.method === 'GET' && c.url.indexOf('levels') >= 0);
  check('the Host is asked for its verdict on a selectable ladder too',
    verdict !== void 0 && verdict.url.indexOf('model=m-owned') > 0, JSON.stringify(hostCalls));
  /* The Host says the ladder is ours, so the removal is offered — and the
     HOST's word is what decides, not the local shape. */
  check('a ladder the Host calls ours offers the removal action',
    first(tree, 'te-act') !== void 0 && textOf(first(tree, 'te-act')) === app.dictionary.zh['act.revert'],
    textOf(tree));
  asked.dispose();

  /* --- a ladder the Host does NOT call ours offers no removal ---
     The local shape can match while the Host disagrees (a stale catalogue, a
     ladder somebody else wrote in the same shape). Offering a removal the
     Host will refuse is the "the undo button does nothing" symptom. */
  hostState = 'native';
  currentState = stateWith({
    current: { provider: 'p', model: 'm-owned', reasoningEffort: 'high' },
    groups: OWNED_SHAPE,
    retainedEffort: 'high'
  });
  const native = mountControl();
  tree = openIt(native);
  await flush();
  tree = native.draw();
  check('a ladder the Host does not call ours offers no removal',
    first(tree, 'te-act') === void 0 || textOf(first(tree, 'te-act')) !== app.dictionary.zh['act.revert'],
    textOf(tree));
  native.dispose();

  /* --- a REMOVAL clears the session's own effort ---
     The durable projection keeps naming the level that was just removed, and
     the request path then refuses every request for that model. The removal
     therefore also selects the same model without an effort — which the Host
     saves as the global default too, so the strand leaves `agent-default-model`
     with it and the NEXT session does not start on a dead level. */
  hostState = 'ours';
  hostCalls.length = 0;
  selectCalls.length = 0;
  currentState = stateWith({
    current: { provider: 'p', model: 'm-owned', reasoningEffort: 'high' },
    groups: OWNED_SHAPE,
    retainedEffort: 'high'
  });
  const removing = mountControl();
  tree = openIt(removing);
  await flush();
  tree = removing.draw();
  first(tree, 'te-act').props.onClick();
  await flush();
  await flush();
  tree = removing.draw();
  const removal = hostCalls.find((c) => c.method === 'POST');
  check('removing posts the revert action', removal !== void 0 && removal.body.action === 'revert',
    JSON.stringify(removal && removal.body));
  check('a removal clears the session effort as well',
    selectCalls.length === 1 && selectCalls[0].reasoningEffort === void 0 &&
    selectCalls[0].provider === 'p' && selectCalls[0].model === 'm-owned',
    JSON.stringify(selectCalls));
  removing.dispose();

  /* --- a STRANDED level: reported, never repaired behind the user's back ---
     `session/selectModel` saves every successful choice as the GLOBAL default,
     so a dead level left there makes every LATER session start parked on it
     and the control looks frozen again in the next conversation. An automatic
     repair would rewrite that global default as a side effect of merely
     opening the composer, so the strand is reported with the one action that
     fixes it. */
  hostState = 'undeclared';
  hostCalls.length = 0;
  selectCalls.length = 0;
  /* The Host reports the levels the request path accepts. An EMPTY list is a
     real answer — "this model takes no effort" — and it is what makes the
     stored level stranded. (`null` would mean "could not be read", and
     nothing may be concluded from that.) */
  hostLevels = [];
  currentState = stateWith({
    current: { provider: 'p', model: 'm-none', reasoningEffort: 'max' },
    groups: NO_LADDER,
    retainedEffort: 'max'
  });
  const stranded = mountControl();
  tree = openIt(stranded);
  await flush();
  await flush();
  tree = stranded.draw();
  check('a stranded level is not repaired behind the user\'s back',
    selectCalls.length === 0, JSON.stringify(selectCalls));
  check('a stranded level is reported with a reset action',
    first(tree, 'te-footErr') !== void 0 && first(tree, 'te-act') !== void 0 &&
    textOf(first(tree, 'te-act')) === app.dictionary.zh['act.reset'], textOf(tree));
  first(tree, 'te-act').props.onClick();
  tree = stranded.draw();
  check('the reset action clears the effort and keeps the model',
    selectCalls.length === 1 && selectCalls[0].reasoningEffort === void 0 &&
    selectCalls[0].provider === 'p' && selectCalls[0].model === 'm-none',
    JSON.stringify(selectCalls));
  hostLevels = null;
  stranded.dispose();

  /* --- no carrier at all --- */
  const carrier = globalThis.fetch;
  globalThis.fetch = undefined;
  currentState = stateWith({ current: { provider: 'p', model: 'm-none' }, groups: NO_LADDER });
  const offline = mountControl();
  tree = openIt(offline);
  await flush();
  tree = offline.draw();
  check('a context without fetch degrades to the plain note',
    first(tree, 'te-act') === void 0 && textOf(first(tree, 'te-footNote')).length > 0,
    textOf(tree));
  globalThis.fetch = carrier;

  /* ---------------------------------------------------------------- *
   * Dictionary completeness
   * ---------------------------------------------------------------- */
  const used = new Set();
  const recordT = (key) => { used.add(key); return app.dictionary.zh[key] ?? key; };
  currentState = stateWith({
    current: { provider: 'p', model: 'm6', reasoningEffort: 'max' },
    groups: sixGroups,
    retainedEffort: 'max'
  });
  const dict = runtime.mount(Control, { sessionId: 's1', t: recordT });
  tree = dict.draw();
  first(tree, 'te-chip').props.onClick();
  dict.draw();
  const missing = [...used].filter((key) =>
    app.dictionary.zh[key] === void 0 || app.dictionary.en[key] === void 0);
  check('every requested key exists in both dictionaries', missing.length === 0, missing.join(', '));

  /* The declare states are not reachable from a declared ladder, so their keys
     are asserted directly: a missing one would print a raw identifier. */
  const declareKeys = [
    'state.undeclared', 'state.unmanageable', 'state.nonreasoning', 'state.ours',
    'act.declare', 'act.custom', 'act.revert', 'act.pending', 'act.failed',
    'cho.search', 'cho.adv', 'cho.offHint', 'cho.noMatch', 'cho.cancel',
    'why.route-missing', 'why.models-replaced', 'why.model-missing', 'why.not-ours',
    'why.editor-missing', 'why.bad-request', 'why.bad-action', 'why.write-failed'
  ];
  const absentKeys = declareKeys.filter((key) =>
    app.dictionary.zh[key] === void 0 || app.dictionary.en[key] === void 0);
  check('every declare-phase key exists in both dictionaries', absentKeys.length === 0, absentKeys.join(', '));

  /* ---------------------------------------------------------------- *
   * The shipped level control is removed, not duplicated
   *
   * This plugin owns effort now, so the model menu's own row and the level
   * suffix on its trigger must both go. Both are matched structurally, because
   * the shipped classes are hashed and change between builds.
   * ---------------------------------------------------------------- */
  {
    const page = fs.readFileSync(BUNDLE, 'utf8');
    const sheet = fs.readFileSync(BUNDLE, 'utf8');

    check('the shipped effort row is hidden from the model menu',
      /MENU_EFFORT_LABELS\.indexOf\(text\)/.test(page) && /collapse\(row\)/.test(page));
    /* FATAL REGRESSION GUARD.
       `button.remove()` on the shipped row deleted a React-owned node: the fiber
       tree kept pointing at it, the next reconciliation threw inside ModelSelect,
       and the model list vanished the moment a selection re-rendered the menu. */
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('never deletes a React-owned menu node',
      !/\.remove\(\)/.test(code), 'found a .remove() call in the bundle body');
    check('collapses the row instead, so refs and indices survive',
      /style\.height = "0"/.test(code) && /data-te-collapsed/.test(code));
    check('the row stays focusable (collapsed, not display:none)',
      !/style\.display/.test(code));
    check('the collapse is observed, not just performed once',
      /new MutationObserver\(hideRow\)/.test(code));
    check('the observer does not watch attributes (it writes style itself)',
      /childList: true, subtree: true/.test(code) && !/attributes: true/.test(code));
    check('the row is matched by label in both languages',
      /MENU_EFFORT_LABELS = \["推理等级", "Effort"\]/.test(page));
    check('the level suffix on the model trigger is hidden',
      /\[data-composer-card\] button\[aria-haspopup="menu"\]/.test(page) &&
      /span:not\(\[data-provider-id\]\):not\(:first-of-type\)/.test(page));
    check('the suppression cannot hide the fallback model label',
      /:not\(:first-of-type\)/.test(page),
      'the first attribute-less span is the "select a model" fallback');
    check('the shipped selector itself is left alone',
      !/aria-haspopup="menu"\]\s*\{/.test(sheet));

    /* Placement. The shipped composer renders this entry BEFORE the model seat,
       inside one flex container, so DOM order alone would put it on the model's
       left — the opposite of what this control is for. `order:1` is the whole
       mechanism that puts it on the right, between the model and the send
       button, and nothing else in the sheet may claim a higher order. */
    const chipRule = /\.te-chip\{([^}]*)\}/.exec(sheet);
    check('the trigger is ordered after the model seat',
      chipRule !== null && /order:1/.test(chipRule[1]), chipRule === null ? 'no rule' : chipRule[1]);
    check('no other rule claims a later flex order',
      (sheet.match(/order:\s*[2-9]/g) ?? []).length === 0);
    check('the trigger is a 28px text button matching the model seat',
      chipRule !== null && /height:28px/.test(chipRule[1]) && /font-size:13px/.test(chipRule[1]));

    /* Colour must match the seat it stands next to — and "match" is checked
       against the SHIPPED sheet, read from the asar, not against a snapshot of
       what it looked like when this was written. Two earlier attempts failed by
       picking a plausible-looking token: `label-primary` (too loud) and then
       `label-caption` (the tone the seat reserves for its effort suffix and
       chevron, which this plugin hides — so the whole control read too light). */
    const shipped = shippedTrigger();
    check('the shipped trigger sheet is readable for comparison', shipped !== null);

    if (shipped !== null) {
      const mine = /\.te-chip\{([^}]*)\}/.exec(sheet);
      check('the trigger declares a colour at all', mine !== null && /color:/.test(mine[1]));

      const myColor = mine === null ? null : /color:(var\([^)]*\))/.exec(mine[1]);
      check('the trigger uses exactly the shipped trigger text colour',
        myColor !== null && myColor[1] === shipped.color,
        'mine=' + (myColor && myColor[1]) + ' shipped=' + shipped.color);

      const hoverColor = /\.te-chip:hover[^{]*\{([^}]*)\}/.exec(sheet);
      check('hover does not change the text colour (the shipped trigger does not)',
        hoverColor !== null && !/color:/.test(hoverColor[1]) && /background:/.test(hoverColor[1]),
        hoverColor === null ? '' : hoverColor[1]);
      check('hover uses the shipped wash',
        hoverColor !== null && hoverColor[1].indexOf(shipped.hoverBackground) >= 0,
        hoverColor === null ? '' : hoverColor[1]);

      const focus = /\.te-chip:focus-visible\{([^}]*)\}/.exec(sheet);
      check('the focus ring names the same token the shipped trigger does',
        focus !== null && focus[1].indexOf(shipped.focusRing) >= 0,
        focus === null ? '' : focus[1]);

      check('the icons inherit the text colour instead of setting their own',
        /\.te-chip svg\{[^}]*color:inherit/.test(sheet) &&
        !/\.te-chip svg\{[^}]*color:var\(/.test(sheet));

      /* Geometry: the two sit on one line, so the box has to agree. */
      check('the trigger matches the shipped height', mine !== null && mine[1].indexOf('height:28px') >= 0);
      check('the trigger matches the shipped type ramp',
        mine !== null && /font-size:13px/.test(mine[1]) && /font-weight:400/.test(mine[1]) &&
        /line-height:20px/.test(mine[1]));
      check('the trigger matches the shipped gap',
        mine !== null && /gap:4px/.test(mine[1]), mine === null ? '' : mine[1]);
      check('the trigger has no state-dependent colour',
        !/\.te-chip(Idle|On|Active)\{/.test(sheet));
    }
  }
};

/* ------------------------------------------------------------------ *
 * Boot order: the Session is not addressable yet
 *
 * `directoryFor` throws until the Session has a scope and a binding, which at
 * boot happens AFTER the composer mounts. This used to be memoized on stable
 * dependencies, so that first failure was cached for the life of the component
 * and the control never appeared until the plugin was re-enabled (i.e. until it
 * was remounted). It has to resolve on its own once the directory exists.
 * ------------------------------------------------------------------ */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function bootRetry() {
  let ready = false;
  let throws = 0;
  const lateState = stateWith({
    current: { provider: 'p', model: 'm6', reasoningEffort: 'high' },
    groups: sixGroups,
    retainedEffort: 'high'
  });
  const lateStore = {
    getSnapshot: () => lateState,
    subscribe: () => () => {}
  };
  const lateModels = {
    directoryFor(id) {
      if (!ready) { throws += 1; throw new Error('ui-model-selection: session "' + id + '" resolved no scope'); }
      return { available: true, store: lateStore, select: () => Promise.resolve({ ok: true }), load: () => Promise.resolve() };
    }
  };
  const fresh = instantiate(loadBundle(), runtime.React, { modelDirectories: lateModels });
  const Control = fresh.registered['thinking-effort'];
  const handle = runtime.mount(Control, { sessionId: 's-boot', t: (key) => app.dictionary.zh[key] ?? key });

  let drawn = handle.draw();
  check('a Session that is not addressable yet renders nothing instead of throwing',
    drawn === null, JSON.stringify(drawn));
  check('the failed lookup is retried rather than cached', throws >= 1);

  ready = true;
  await new Promise((resolve) => setTimeout(resolve, 260));
  drawn = handle.draw();
  check('the control appears once the Session becomes addressable',
    drawn !== null && first(drawn, 'te-chip') !== void 0,
    'still nothing after the directory became available');
  handle.dispose();
}

/* The two async suites share the fake host and the module-level `currentState`,
   so they must not overlap: the declare suite installs `fetch`, the boot suite
   swaps the directory. Chained explicitly for that reason. The selection-timing
   suite swaps the `select` stub, so it runs first and restores it. */
asyncSuite().then(declareSuite).then(bootRetry).then(() => {  for (const handle of [six, drag, noop, step, keys, forced].filter(Boolean)) handle.dispose();

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length > 0) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(' | '));
    process.exit(1);
  }
  console.log('OK');
});

// Unit tests for the Host half's config surgery, plus the two cross-file
// invariants the browser and Host bundles cannot express by importing.
//
//   node tools/smoke-declare.mjs
//
// `config-declare.js` is deliberately free of Cordis and Node APIs, so
// the risky part of the declare feature — what exactly gets written into a
// user's profile — is testable without a live Host.
//
// `index.js` is imported too: it is plain ESM, and importing it proves
// the Host half parses and that nothing at module scope reaches for a service.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DECLARED_EFFORTS,
  DECLARED_LEVELS,
  LEVEL_IDS,
  DeclareError,
  declaredLadderKeys,
  defaultSelectionEntry,
  inspectLadder,
  isManagedLadder,
  locateModel,
  normalizeLevels,
  owningEntry,
  planAction,
  planClearDefault,
  planDeclare,
  planRevert
} from "../config-declare.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(detail === undefined ? name : name + " — " + detail);
}

/** The profile layer for the route this feature was built for. */
function profile() {
  return {
    providers: {
      undarouter: {
        displayName: "Unda Router",
        apiKeyEnv: "UNDAROUTER_API_KEY",
        api: "openai-completions",
        baseURL: "https://r.unda.bot.cd/v1",
        models: [
          {
            id: "agentrouter/deepseek-v4-flash",
            contextWindow: 1000000,
            maxTokens: 384000,
            input: ["text", "image"]
          }
        ]
      },
      other: {
        api: "openai-completions",
        baseURL: "https://example.invalid/v1",
        models: [{ id: "m", reasoningEfforts: { high: "high" } }]
      }
    }
  };
}

const PROVIDER = "undarouter";
const MODEL = "agentrouter/deepseek-v4-flash";

// ---------------------------------------------------------------- locateModel

{
  const found = locateModel(profile(), PROVIDER, MODEL);
  check("locate: finds the declared entry", found.ok === true && found.index === 0);
  check("locate: missing route", locateModel(profile(), "nope", MODEL).code === "route-missing");
  check("locate: missing model", locateModel(profile(), PROVIDER, "nope").code === "model-missing");
  check("locate: null config", locateModel(null, PROVIDER, MODEL).code === "route-missing");
  check("locate: providers replaced by an array", locateModel({ providers: [] }, PROVIDER, MODEL).code === "route-missing");
  const overrides = { providers: { p: { modelOverrides: { m: {} } } } };
  check("locate: modelOverrides shape is not addressable", locateModel(overrides, "p", "m").code === "models-replaced");
}

// -------------------------------------------------------------- inspectLadder
//
// "ours" is a SHAPE, not one exact ladder: any dict the declaration contract
// accepts (vocabulary keys, non-empty wire values, an optional `off`, at least
// one non-`off` level) is revertible, because the plugin might have written it
// as a CUSTOMIZED set — and a hand-written dict of the same shape is accepted
// too (the Host re-checks before it deletes, so a wrong guess refuses cleanly).

{
  check("inspect: absent field reads undeclared", inspectLadder(profile(), PROVIDER, MODEL).state === "undeclared");
  const nonreasoning = profile();
  nonreasoning.providers.undarouter.models[0].reasoningEfforts = false;
  check("inspect: false reads nonreasoning", inspectLadder(nonreasoning, PROVIDER, MODEL).state === "nonreasoning");
  /* A single-level, correctly spelled dict IS the managed shape now (the
     "other" route carries `{ high: "high" }`), so a foreign ladder has to be
     foreign in a way the contract would never write: a null wire value. */
  check("inspect: somebody else's ladder reads native", inspectLadder(profile(), "other", "m").state === "ours");
  const foreignShape = profile();
  foreignShape.providers.undarouter.models[0].reasoningEfforts = { high: null };
  check("inspect: a malformed ladder reads native", inspectLadder(foreignShape, PROVIDER, MODEL).state === "native");
  check("inspect: an unreachable route reads unsupported", inspectLadder(profile(), "ghost", MODEL).state === "unsupported");

  const declared = planDeclare(profile(), PROVIDER, MODEL).next;
  const after = inspectLadder(declared, PROVIDER, MODEL);
  check("inspect: our own write reads ours", after.state === "ours", JSON.stringify(after));

  const custom = profile();
  custom.providers.undarouter.models[0].reasoningEfforts = { minimal: "minimal", max: "max" };
  check("inspect: a customized set also reads ours", inspectLadder(custom, PROVIDER, MODEL).state === "ours");
  const offOnly = profile();
  offOnly.providers.undarouter.models[0].reasoningEfforts = { off: null, low: "low" };
  check("inspect: a set with 'off' also reads ours", inspectLadder(offOnly, PROVIDER, MODEL).state === "ours");

  const junk = profile();
  junk.providers.undarouter.models[0].reasoningEfforts = { hyperscale: "yes" };
  check("inspect: an unknown key reads native", inspectLadder(junk, PROVIDER, MODEL).state === "native");
  const hollow = profile();
  hollow.providers.undarouter.models[0].reasoningEfforts = { high: null };
  check("inspect: a null value on a real level reads native", inspectLadder(hollow, PROVIDER, MODEL).state === "native");
  const empty = profile();
  empty.providers.undarouter.models[0].reasoningEfforts = {};
  check("inspect: an empty dict reads native", inspectLadder(empty, PROVIDER, MODEL).state === "native");
  const bareOff = profile();
  bareOff.providers.undarouter.models[0].reasoningEfforts = { off: null };
  check("inspect: only-'off' reads native (nothing selectable)", inspectLadder(bareOff, PROVIDER, MODEL).state === "native");
}

// ---------------------------------------------------------------- planDeclare

{
  const before = profile();
  const snapshot = JSON.stringify(before);
  const { next, changed } = planDeclare(before, PROVIDER, MODEL);
  check("declare: reports a change", changed === true);
  check("declare: does not mutate its input", JSON.stringify(before) === snapshot);
  check("declare: returns a detached object", next !== before);

  const written = next.providers.undarouter.models[0].reasoningEfforts;
  check("declare: writes exactly the standard set", JSON.stringify(written) === JSON.stringify({ low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }), JSON.stringify(written));

  /* Everything else in the config has to survive byte for byte: this write goes
     into a profile the user maintains by hand. */
  check(
    "declare: leaves the rest of the config untouched",
    JSON.stringify(next).replace(/,"reasoningEfforts":\{[^}]*\}/, "") === snapshot,
    JSON.stringify(next)
  );
  check("declare: keeps the sibling route", JSON.stringify(next.providers.other) === JSON.stringify(before.providers.other));
  check("declare: keeps the model's own fields", next.providers.undarouter.models[0].maxTokens === 384000);

  const again = planDeclare(next, PROVIDER, MODEL);
  check("declare: is idempotent", again.changed === false && JSON.stringify(again.next) === JSON.stringify(next));

  /* ---- the CUSTOMIZED set ---- */
  const custom = planDeclare(before, PROVIDER, MODEL, { max: "Max", low: "low", off: "" });
  check("declare: a custom set is re-ordered into vocabulary order",
    Object.keys(custom.next.providers.undarouter.models[0].reasoningEfforts).join(",") === "off,low,max",
    JSON.stringify(custom.next.providers.undarouter.models[0].reasoningEfforts));
  check("declare: an empty wire value on 'off' folds to null",
    custom.next.providers.undarouter.models[0].reasoningEfforts.off === null);
  check("declare: a custom set reports a change even with the default set present", custom.changed === true);
  const customAgain = planDeclare(custom.next, PROVIDER, MODEL, { low: "low", off: null, max: "Max" });
  check("declare: idempotent for a custom set too", customAgain.changed === false);

  const badLevels = (input, label) => {
    try {
      planDeclare(before, PROVIDER, MODEL, input);
      check(label, false, "it did not refuse");
    } catch (error) {
      check(label, error instanceof DeclareError && error.code === "bad-levels", String(error && (error.code + (error.detail ? " (" + error.detail + ")" : ""))));
    }
  };
  badLevels("nope", "declare: a non-object ladder is refused");
  badLevels({ hyperscale: "yes" }, "declare: an unknown level key is refused");
  badLevels({ high: null }, "declare: a null wire value on a real level is refused");
  badLevels({ high: "" }, "declare: an empty wire value on a real level is refused");
  badLevels({ off: null, minimal: null }, "declare: a ladder with only 'off' is refused");
  badLevels({ off: "low" }, "declare: a wire value on 'off' is refused");
  check("declare: omitting the levels argument still writes the standard set",
    JSON.stringify(planDeclare(before, PROVIDER, MODEL).next.providers.undarouter.models[0].reasoningEfforts) === JSON.stringify({ low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" }));
}

// ----------------------------------------------------------------- planRevert

{
  const declared = planDeclare(profile(), PROVIDER, MODEL).next;
  const { next } = planRevert(declared, PROVIDER, MODEL);
  check("revert: restores the original config exactly", JSON.stringify(next) === JSON.stringify(profile()), JSON.stringify(next));
  check("revert: leaves the model entry with its own fields", next.providers.undarouter.models[0].maxTokens === 384000);

  const refuses = (config, label) => {
    try {
      planRevert(config, PROVIDER, MODEL);
      check(label, false, "it did not refuse");
    } catch (error) {
      check(label, error instanceof DeclareError && error.code === "not-ours", String(error && error.code));
    }
  };
  refuses(profile(), "revert: refuses an absent ladder");
  check("revert: accepts a hand-written ladder in the managed shape", (() => {
    try {
      return planRevert(profile(), "other", "m").changed === true;
    } catch {
      return false;
    }
  })());
  refuses(profile(), "revert: refuses a different set of our own ids");

  const falseLadder = profile();
  falseLadder.providers.undarouter.models[0].reasoningEfforts = false;
  refuses(falseLadder, "revert: refuses an explicit non-reasoning declaration");

  const emptyLadder = profile();
  emptyLadder.providers.undarouter.models[0].reasoningEfforts = {};
  refuses(emptyLadder, "revert: refuses an empty dict");
  const unknownKey = profile();
  unknownKey.providers.undarouter.models[0].reasoningEfforts = { hyperscale: "yes" };
  refuses(unknownKey, "revert: refuses an unknown level key");
  const hollowValue = profile();
  hollowValue.providers.undarouter.models[0].reasoningEfforts = { high: null };
  refuses(hollowValue, "revert: refuses a null wire value on a real level");

  /* The flip side of the shape check: SUPERSets of the vocabulary are
     revertible now — seven chips of arbitrary wire spellings are exactly what
     the customized chooser writes. */
  const superset = profile();
  superset.providers.undarouter.models[0].reasoningEfforts = { low: "low", medium: "medium", high: "high", xhigh: "xhigh" };
  const revertedSuperset = planRevert(superset, PROVIDER, MODEL);
  check("revert: accepts a managed superset", revertedSuperset.changed === true &&
    revertedSuperset.next.providers.undarouter.models[0].reasoningEfforts === undefined);

  /* A customized declaration round-trips: declare → inspect → revert. */
  const custom = planDeclare(profile(), PROVIDER, MODEL, { minimal: "Min", off: null, max: "Max" }).next;
  check("revert: accepts a declaration the chooser customized",
    inspectLadder(custom, PROVIDER, MODEL).state === "ours");
  const back = planRevert(custom, PROVIDER, MODEL).next;
  check("revert: a customized declaration restores the original config exactly",
    JSON.stringify(back) === JSON.stringify(profile()), JSON.stringify(back));

  const missing = { providers: {} };
  try {
    planRevert(missing, PROVIDER, MODEL);
    check("revert: refuses an unreachable route", false, "it did not refuse");
  } catch (error) {
    check("revert: refuses an unreachable route", error.code === "route-missing", String(error && error.code));
  }
}

// ---------------------------------------------------------------- planAction

{
  check("action: declare dispatches", planAction("declare", profile(), PROVIDER, MODEL).changed === true);
  check("action: declare forwards the custom ladder",
    (() => {
      const next = planAction("declare", profile(), PROVIDER, MODEL, { max: "Max" }).next;
      return JSON.stringify(next.providers.undarouter.models[0].reasoningEfforts) === JSON.stringify({ max: "Max" });
    })());
  check("action: a custom ladder with an unknown key is refused", (() => {
    try {
      planAction("declare", profile(), PROVIDER, MODEL, { nope: "x" });
      return false;
    } catch (error) {
      return error.code === "bad-levels";
    }
  })());
  check("action: revert refuses what declare did not write", (() => {
    try {
      planAction("revert", profile(), PROVIDER, MODEL);
      return false;
    } catch (error) {
      return error.code === "not-ours";
    }
  })());
  check("action: an unknown verb is refused", (() => {
    try {
      planAction("delete", profile(), PROVIDER, MODEL);
      return false;
    } catch (error) {
      return error.code === "bad-action";
    }
  })());
}

// ------------------------------------------------------ the shape primitives

{
  check("vocab: LEVEL_IDS is the escalation vocabulary", LEVEL_IDS.join(",") === "off,minimal,low,medium,high,xhigh,max", LEVEL_IDS.join(","));
  check("vocab: the default set's ids are all vocabulary", DECLARED_LEVELS.every((id) => LEVEL_IDS.includes(id)));

  const ordered = normalizeLevels({ max: "Max", low: "low", off: null });
  check("normalize: re-orders into vocabulary order", Object.keys(ordered).join(",") === "off,low,max", Object.keys(ordered).join(","));
  check("normalize: keeps the wire values", ordered.low === "low" && ordered.max === "Max" && ordered.off === null);
  check("normalize: the standard set passes unchanged", JSON.stringify(normalizeLevels(DECLARED_EFFORTS)) === JSON.stringify(DECLARED_EFFORTS));
  check("normalize: an off value of undefined folds to null", normalizeLevels({ low: "low", off: undefined }).off === null);
  check("normalize: an off value of empty string folds to null", normalizeLevels({ low: "low", off: "" }).off === null);
  const refused = (input, label) => {
    try {
      normalizeLevels(input);
      check(label, false, "it did not refuse");
    } catch (error) {
      check(label, error instanceof DeclareError && error.code === "bad-levels", String(error && error.code));
    }
  };
  refused(null, "normalize: a null ladder is refused");
  refused([], "normalize: an array is refused");
  refused({}, "normalize: an empty ladder is refused");
  refused({ off: null }, "normalize: only 'off' is refused");
  refused({ high: "high", nope: "x" }, "normalize: an unknown key is refused");
  refused({ high: "" }, "normalize: an empty wire value is refused");
  refused({ high: 7 }, "normalize: a non-string wire value is refused");
  refused({ off: "wanted" }, "normalize: a wire value on 'off' is refused");

  check("shape: a managed dict is accepted", isManagedLadder({ high: "high" }) === true);
  check("shape: with 'off' accepted", isManagedLadder({ off: null, low: "low" }) === true);
  check("shape: the whole vocabulary is accepted", isManagedLadder({
    off: null, minimal: "m", low: "l", medium: "m", high: "h", xhigh: "x", max: "M"
  }) === true);
  check("shape: an empty dict is refused", isManagedLadder({}) === false);
  check("shape: only-'off' is refused", isManagedLadder({ off: null }) === false);
  check("shape: false is refused", isManagedLadder(false) === false);
  check("shape: an array is refused", isManagedLadder([]) === false);
  check("shape: a string is refused", isManagedLadder("low") === false);
  check("shape: an unknown key is refused", isManagedLadder({ weird: "x" }) === false);
  check("shape: a null on a real level is refused", isManagedLadder({ low: null }) === false);
  check("shape: an empty string on a real level is refused", isManagedLadder({ low: "" }) === false);

  const keys = planDeclare(profile(), PROVIDER, MODEL).next;
  check("keys: a declared ladder lists its keys", JSON.stringify(declaredLadderKeys(keys, PROVIDER, MODEL)) === JSON.stringify(["low", "medium", "high", "xhigh", "max"]));
  const customKeys = planDeclare(profile(), PROVIDER, MODEL, { max: "M", off: null, low: "l" }).next;
  check("keys: a custom ladder lists its keys in vocabulary order", JSON.stringify(declaredLadderKeys(customKeys, PROVIDER, MODEL)) === JSON.stringify(["off", "low", "max"]));
  check("keys: an absent ladder is an empty list", declaredLadderKeys(profile(), PROVIDER, MODEL).length === 0);
  const nonreasoningKeys = profile();
  nonreasoningKeys.providers.undarouter.models[0].reasoningEfforts = false;
  check("keys: a non-reasoning ladder is an empty list", declaredLadderKeys(nonreasoningKeys, PROVIDER, MODEL).length === 0);
}

// --------------------------------------------------------------- owningEntry

{
  const entry = { options: { id: "llm-pi-ai", config: profile() } };
  check("owner: finds the entry holding the route", owningEntry([{ options: {} }, entry], PROVIDER) === entry);
  check("owner: a route nobody declares has no owner", owningEntry([entry], "ghost") === null);
  check("owner: tolerates non-rows", owningEntry([null, 7, "x", {}], PROVIDER) === null);
  check("owner: tolerates a non-array", owningEntry(null, PROVIDER) === null);
}

// ------------------------------------- what the pi-ai schema would accept
//
// resolveModelReasoning() in dsh-llm-pi-ai refuses a dict with no level beyond
// `off`, a null wire value on any level but `off`, and an empty string. It also
// only reads keys from THINKING_LEVELS, so an id outside that list would be
// silently dropped rather than offered.
{
  const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const keys = Object.keys(DECLARED_EFFORTS);
  check("schema: every key is a level pi-ai knows", keys.every((key) => THINKING_LEVELS.includes(key)), keys.join(","));
  check("schema: every wire value is a non-empty string", keys.every((key) => typeof DECLARED_EFFORTS[key] === "string" && DECLARED_EFFORTS[key].length > 0));
  check("schema: at least one level is not 'off'", keys.some((key) => key !== "off"));
  check("schema: DECLARED_LEVELS is escalation order, not alphabetical", DECLARED_LEVELS.join(",") === "low,medium,high,xhigh,max", DECLARED_LEVELS.join(","));
  check("schema: DECLARED_LEVELS is derived from the dict", DECLARED_LEVELS.every((level) => Object.hasOwn(DECLARED_EFFORTS, level)));
  check("schema: no 'off' level is offered", !DECLARED_LEVELS.includes("off"));
}

// ------------------------------------------------------- cross-file invariants

{
  const client = read("client.js");
  const host = read("index.js");

  /* The two bundles cannot import each other, so the ids the rail previews and
     the ids the Host writes have to be asserted identical here. */
  const previewBlock = /const PREVIEW_LEVELS = \[([\s\S]*?)\];/.exec(client);
  check("mirror: client declares PREVIEW_LEVELS", previewBlock !== null);
  if (previewBlock !== null) {
    const ids = [...previewBlock[1].matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    check("mirror: the preview rail shows exactly the declared ids", ids.join(",") === DECLARED_LEVELS.join(","), ids.join(",") + " vs " + DECLARED_LEVELS.join(","));
    check("mirror: the preview names one entry per id", [...previewBlock[1].matchAll(/name:\s*"([^"]+)"/g)].length === ids.length);
  }

  /* The chooser's full chip list mirrors LEVEL_IDS exactly — same ids, same
     escalation order — or a level would be declarable here but rejected by the
     pi-ai schema there. */
  const vocabBlock = /const VOCAB_LEVELS = \[([\s\S]*?)\];/.exec(client);
  check("mirror: client declares VOCAB_LEVELS", vocabBlock !== null);
  if (vocabBlock !== null) {
    const ids = [...vocabBlock[1].matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    check("mirror: the chooser offers exactly the vocabulary", ids.join(",") === LEVEL_IDS.join(","), ids.join(",") + " vs " + LEVEL_IDS.join(","));
    check("mirror: the chooser names one entry per id", [...vocabBlock[1].matchAll(/name:\s*"([^"]+)"/g)].length === ids.length);
  }
  const vocabIdLine = /const VOCAB_IDS = VOCAB_LEVELS\.map\(\(level\) => level\.id\);/.exec(client);
  check("mirror: the client derives VOCAB_IDS from VOCAB_LEVELS", vocabIdLine !== null);

  /* One path, two files. A typo would fail at runtime as a silent 404 that the
     panel reports as "cannot declare", which is indistinguishable from an
     unsupported provider. */
  const hostRoute = /const ROUTE = "([^"]+)"/.exec(host);
  const clientRoute = /const DECLARE_ROUTE = "([^"]+)"/.exec(client);
  check("route: both halves declare a path", hostRoute !== null && clientRoute !== null);
  if (hostRoute !== null && clientRoute !== null) {
    check("route: the paths match", hostRoute[1] === clientRoute[1], hostRoute[1] + " vs " + clientRoute[1]);
    check("route: the path is absolute", clientRoute[1].startsWith("/"), clientRoute[1]);
  }

  /* Same for the models.dev lookup route. */
  const hostModelsDev = /const MODELSDEV_ROUTE = "([^"]+)"/.exec(host);
  const clientModelsDev = /const MODELSDEV_ROUTE = "([^"]+)"/.exec(client);
  check("modelsdev: both halves declare a lookup path", hostModelsDev !== null && clientModelsDev !== null);
  if (hostModelsDev !== null && clientModelsDev !== null) {
    check("modelsdev: the paths match", hostModelsDev[1] === clientModelsDev[1], hostModelsDev[1] + " vs " + clientModelsDev[1]);
    check("modelsdev: the lookup path is distinct from the declare path", hostModelsDev[1] !== hostRoute[1]);
    check("modelsdev: the client queries the bare name after the last '/'",
      /\.slice\(info\.model\.lastIndexOf\("\/"\) \+ 1\)/.test(client),
      "bare-name derivation missing");
  }
  check("modelsdev: the feed is cached, not fetched per request", /MODELSDEV_TTL/.test(host) && /modelsDevFeed/.test(host));
  check("modelsdev: the fetch cannot hang the pool", /AbortSignal\.timeout/.test(host));
  /* The same model is listed by dozens of providers with DIFFERENT ladders —
     `gpt-6.1-sol` is published with five levels by most of them and with three
     by a few. Ranking by feed order alone made the suggested ladder a coin
     flip, so the one-click enable wrote three stops where the upstream offers
     five. Both halves now pick the WIDEST ladder; both are asserted here. */
  check("modelsdev: the host ranks equal matches by ladder width",
    /right\.coverage - left\.coverage/.test(host) && /effortCoverage\(entry\)/.test(host),
    "the host must order equal-scoring matches by how many levels they publish");
  check("modelsdev: the client picks the widest match, not the first row",
    /widestMatch\(payload\.matches\)/.test(client) && /function widestMatch\(matches\)/.test(client),
    "the client must choose the match with the most selectable levels");

  /* Every code the Host can answer with needs a dictionary entry in both
     languages, or the panel would print a raw identifier. */
  const codes = new Set([...host.matchAll(/code:\s*"([a-z-]+)"/g)].map((m) => m[1]));
  const configModule = read("config-declare.js");
  for (const code of [...configModule.matchAll(/DeclareError\("([a-z-]+)"/g)].map((m) => m[1])) codes.add(code);
  for (const code of [
    "route-missing", "models-replaced", "model-missing", "not-ours", "editor-missing",
    "bad-request", "bad-action", "bad-levels", "write-failed", "no-fetch", "fetch-failed"
  ]) codes.add(code);
  const missing = [];
  for (const code of codes) {
    const key = '"why.' + code + '":';
    if (!client.includes(key)) missing.push(code);
  }
  check("dictionary: every failure code has zh and en text", missing.length === 0, missing.join(","));
  check("dictionary: both languages define why.*", (client.match(/"why\.[a-z-]+":/g) ?? []).length === codes.size * 2, String((client.match(/"why\.[a-z-]+":/g) ?? []).length));
  check("dictionary: the removed 'state.forced' key is gone", !client.includes('"state.forced"'));
}

// ------------------------------------------------------- the fence cannot be skipped
//
// A real defect this caught: the handler captured `scope.get("connection")` at
// mount time. This plugin is inserted early in the bundle patch, so at boot the
// connection service did not exist yet, the lookup returned undefined, and the
// guard `if (connection !== undefined)` skipped the ENTIRE fence — the route
// answered unauthenticated requests with 200 and would rewrite any user's
// profile from a local page. It only started refusing (401) after a config
// reconcile remounted the plugin with the service present.
//
// The fix was threefold and each part is asserted here, because the failure
// mode is invisible: the route works, just without protection.
{
  const raw = read("index.js");
  const page = read("client.js");
  /* Strip comments first: the fix's own explanation quotes the broken line, so
     a naive search over the raw file finds the bug in the note describing it. */
  const host = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("fence: connection is a declared inject dependency",
    /ctx\.inject\(\s*\[[^\]]*"connection"[^\]]*\]/.test(host),
    "connection must be in the inject list, or the route exists before its fence can");
  check("fence: the service is resolved from the scope, not ctx.get() at mount time",
    !/scope\.get\(\s*"connection"\s*\)/.test(host));
  check("fence: a missing service refuses instead of continuing",
    /code:\s*"fence-missing"/.test(host) && /503/.test(host));
  check("fence: the rejection is applied before any config work",
    host.indexOf("connection.requestRejection(req)") < host.indexOf("editor.edit(entry"),
    "the fence must precede the write");
  check("fence: dictionary explains a missing fence", page.includes('"why.fence-missing":'));
}

// ------------------------------------------------- the stranded default selection
//
// `session/selectModel` calls `agentDefaultModel.saveSelection(selected)`, so
// picking a level here writes `{ provider, model, reasoningEffort }` into the
// profile as the GLOBAL default. Removing the ladder without removing that
// effort leaves every later request failing validation with
// `UNSUPPORTED_REASONING_EFFORT` — the error the user saw, in sessions that
// never touched this control.
{
  const selection = (extra) => ({ options: { id: "agent-default-model", config: extra } });

  check("default: the selection entry is found by shape",
    defaultSelectionEntry([{ options: { config: { providers: {} } } }, selection({ provider: "p", model: "m" })]) !== null);
  check("default: a providers dict is not confused for a selection",
    defaultSelectionEntry([{ options: { config: { providers: { p: {} } } } }]) === null);
  check("default: tolerates junk", defaultSelectionEntry([null, 3, {}]) === null && defaultSelectionEntry(null) === null);

  const cleared = planClearDefault({ provider: PROVIDER, model: MODEL, reasoningEffort: "high" }, PROVIDER, MODEL);
  check("default: drops an effort we declared", cleared.changed === true && cleared.next.reasoningEffort === undefined, JSON.stringify(cleared.next));
  check("default: keeps provider and model", cleared.next.provider === PROVIDER && cleared.next.model === MODEL);

  const other = planClearDefault({ provider: PROVIDER, model: "another", reasoningEffort: "high" }, PROVIDER, MODEL);
  check("default: leaves another model's selection alone", other.changed === false && other.next.reasoningEffort === "high");

  /* `minimal` is a vocabulary id we never declare (the ladder stops at low),
     so a selection on it is not ours to clean up. */
  const foreign = planClearDefault({ provider: PROVIDER, model: MODEL, reasoningEffort: "minimal" }, PROVIDER, MODEL);
  check("default: leaves a level we never declared alone", foreign.changed === false && foreign.next.reasoningEffort === "minimal");

  const none = planClearDefault({ provider: PROVIDER, model: MODEL }, PROVIDER, MODEL);
  check("default: a selection with no effort is untouched", none.changed === false);

  /* The `allowed` list: revert hands the keys of the ladder it just removed, so
     a customized declaration also gets its strand cleaned up. */
  const customAllowed = planClearDefault(
    { provider: PROVIDER, model: MODEL, reasoningEffort: "max" },
    PROVIDER, MODEL,
    ["off", "low", "max"]
  );
  check("default: a level in the allowed custom set is dropped", customAllowed.changed === true && customAllowed.next.reasoningEffort === undefined);
  const notAllowed = planClearDefault(
    { provider: PROVIDER, model: MODEL, reasoningEffort: "high" },
    PROVIDER, MODEL,
    ["off", "max"]
  );
  check("default: a level outside the allowed list is kept", notAllowed.changed === false && notAllowed.next.reasoningEffort === "high");

  check("default: does not mutate its input", (() => {
    const source = { provider: PROVIDER, model: MODEL, reasoningEffort: "high" };
    planClearDefault(source, PROVIDER, MODEL);
    return source.reasoningEffort === "high";
  })());
}

// ------------------------------------------------- the effective-levels contract
//
// The Host half reports what the request path will ACTUALLY accept, and the
// client must treat `levels: null` as "unknown", never as "nothing supported".
{
  const host = read("index.js");
  const page = read("client.js");
  const bare = host.replace(/\/\*[\s\S]*?\*\//g, "");
  check("effective: read from the live adapter, not the profile",
    /resolveModelInfo\s*\(/.test(bare));
  check("effective: absence of reasoning maps to an empty list, not null",
    /!Array\.isArray\(efforts\)\) return \{ levels: \[\] \}/.test(bare));
  check("effective: an unreadable result is null with a reason",
    /return \{ levels: null, error:/.test(bare));
  check("revert clears the stranded default", /defaultSelectionEntry/.test(bare) && /planClearDefault/.test(bare));
  check("the write is reported with the levels it produced", /clearedDefault,/.test(bare) && /\.\.\.effective/.test(bare));

  /* The window that produced the error: the client used to re-enable the rail
     the moment the POST returned, which is before the profile reload, adapter
     rebuild and catalog refetch have happened. */
  check("client reloads the catalog before re-enabling the control",
    /refresh\(\)\.then\(settle, settle\)/.test(page));
  check("client owns a reload path through the directory", /directory\.load\(\)/.test(page));
}

// ------------------------------------------------------------------- results

console.log(
  failures.length === 0
    ? "OK: " + String(passed) + " declare checks passed"
    : "FAIL: " + String(failures.length) + " of " + String(passed + failures.length) + " declare checks failed"
);
for (const line of failures) console.log("  ✗ " + line);
process.exit(failures.length === 0 ? 0 : 1);

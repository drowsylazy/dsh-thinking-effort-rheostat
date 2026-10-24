/**
 * Declaring a thinking ladder for a provider route that reports none.
 *
 * WHY THIS EXISTS
 * ---------------
 * `dsh-llm` refuses an explicit effort for a model whose adapter reports no
 * reasoning metadata, and it refuses it *before* provider I/O:
 *
 *   resolveCallWithInfo(): if (reasoning === undefined) {
 *     if (requested !== undefined) throw new LlmError(..., "UNSUPPORTED_REASONING_EFFORT")
 *   }
 *
 * `session/selectModel` runs that same check, so a client cannot install an
 * unvalidated selection and there is no runtime override. For a route this
 * build does not ship, the only supported way to make an effort real is to
 * declare the ladder in the profile, which is exactly what `dsh-llm-pi-ai`'s
 * own `reasoningEfforts` field documents:
 *
 *   "declares a model's selectable thinking levels: each key is a level
 *    selectors offer, its value the spelling dispatch sends on the wire"
 *
 * With the declaration in place the Harness offers the ladder natively, the
 * slider stops falling back to a dead set, and the chosen level reaches
 * `openai-completions` as `reasoning_effort`. Nothing here bypasses a check;
 * it supplies the declaration the check is asking for.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Only the model entry's own `reasoningEfforts`, inside the route the caller
 * named. Everything else in the config is cloned unchanged.
 *
 * A declaration is only USEFUL in one shape: a dict whose keys are the
 * official `THINKING_LEVELS` vocabulary with a non-empty wire value on every
 * non-`off` key (an `off` key carries `null`, meaning "send nothing").
 * `revert` therefore refuses anything outside that shape — the set of levels
 * itself is the caller's choice (`declare` takes a custom map, defaulting to
 * `DECLARED_EFFORTS`) — so a declaration some other tool wrote in a shape this
 * plugin does not manage can never be deleted here.
 *
 * The module is deliberately free of Cordis and Node APIs: it is pure
 * JSON-in/JSON-out so it can be tested without a live Host. See
 * `tools/smoke-declare.mjs`.
 */

/**
 * The levels a declaration offers, and the spelling each sends on the wire.
 *
 * `THINKING_LEVELS` in `dsh-llm-pi-ai` is
 * `off, minimal, low, medium, high, xhigh, max` (escalation order). This set
 * takes the OpenAI-compatible spellings a `openai-completions` gateway
 * understands: `minimal` is an OpenAI-only value many aggregators reject, and
 * `off` is left out on purpose — undeclared levels are pinned to unsupported by
 * `resolveModelReasoning`, and adding `off` would only add a position that
 * merely omits the parameter.
 *
 * The ladder is FIVE levels, not three: `gpt-6.1-sol` and the other
 * OpenAI-line models publish `low, medium, high, xhigh, max` upstream (the
 * OpenAI catalogue, opencode, openrouter and most aggregators agree), and a
 * declaration that stops at `high` silently removes the two top stops from
 * models that do offer them. `xhigh` and `max` are the same spelling upstream
 * uses, so a gateway that does not know them is a gateway that never offered
 * them either — the Host refuses an unsupported effort at request time
 * anyway, so an extra stop costs the user nothing and a missing one costs a
 * level they could have used.
 *
 * The client half mirrors these ids in its own `PREVIEW_LEVELS`; the two files
 * cannot import each other (host and browser bundles are separate), so
 * `tools/smoke-declare.mjs` asserts that the mirror stays identical.
 */
export const DECLARED_EFFORTS = {
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max"
};

/** Levels in escalation order, for a caller that needs the ordered list. */
export const DECLARED_LEVELS = ["low", "medium", "high", "xhigh", "max"];

/**
 * The full `THINKING_LEVELS` vocabulary of `dsh-llm-pi-ai`, escalation order.
 *
 * A declaration's KEYS must come from this list (the value side is free text,
 * the wire spelling, and `null` on `off` alone); anything else is refused by
 * {@link normalizeLevels} because the pi-ai schema itself rejects unknown
 * keys. The client half mirrors it in `VOCAB_LEVELS`; the mirror is asserted
 * by `tools/smoke-declare.mjs`.
 */
export const LEVEL_IDS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * A refusal the caller is expected to render, not to crash on.
 *
 * `code` is stable and localizable; `detail` is raw diagnostic text for a
 * cause this plugin did not anticipate.
 */
export class DeclareError extends Error {
	constructor(code, detail) {
		super(detail ? code + ": " + detail : code);
		this.name = "DeclareError";
		this.code = code;
		this.detail = detail === undefined ? "" : String(detail);
	}
}

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality over JSON values; key order is not part of the value. */
function sameJson(left, right) {
	if (left === right) return true;
	if (typeof left !== typeof right) return false;
	if (left === null || right === null) return false;
	if (typeof left !== "object") return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	for (const key of keys) {
		if (!Object.hasOwn(right, key)) return false;
		if (!sameJson(left[key], right[key])) return false;
	}
	return true;
}

/**
 * Validate a caller-supplied ladder into the exact map a declaration writes.
 *
 * `input` must be a plain object; each key must be one of {@link LEVEL_IDS};
 * every non-`off` value must be a non-empty string (the wire spelling), and
 * `off` may carry `null` — or `""`, which is normalized to `null` — meaning
 * "offer this level and send no parameter for it". At least one non-`off`
 * key is required: a declaration that offers nothing or only `off` gives
 * selectors nothing to pick. Keys are reordered into
 * vocabulary order so the profile reads the way selectors list levels.
 *
 * The default set {@link DECLARED_EFFORTS} passes unchanged; `revert` calls a
 * stricter check ({@link isManagedLadder}) on what is ALREADY there instead.
 *
 * @throws {DeclareError} code `bad-levels`, with the offending key as detail.
 */
export function normalizeLevels(input) {
	if (!isPlainObject(input)) throw new DeclareError("bad-levels", "not an object");
	const out = {};
	let nonOff = 0;
	for (const key of Object.keys(input)) {
		if (!LEVEL_IDS.includes(key)) throw new DeclareError("bad-levels", key);
		const raw = input[key];
		if (key === "off") {
			/* An `off` key must mean "not sent": empty-string spelling is the UI's
			   way of saying the same thing, so both readings fold to `null`. */
			if (raw === null || raw === void 0 || raw === "") {
				out.off = null;
			} else {
				throw new DeclareError("bad-levels", "off");
			}
			continue;
		}
		if (typeof raw !== "string" || raw.length === 0) {
			throw new DeclareError("bad-levels", key);
		}
		out[key] = raw;
		nonOff += 1;
	}
	if (nonOff === 0) throw new DeclareError("bad-levels", "no selectable level");
	const ordered = {};
	for (const id of LEVEL_IDS) {
		if (Object.hasOwn(out, id)) ordered[id] = out[id];
	}
	return ordered;
}

/**
 * Whether a declaration reads as one this plugin manages.
 *
 * The shape check replaces the old byte-for-byte comparison: a declaration is
 * managed when every key is known vocabulary, every non-`off` value is a
 * non-empty wire string, `off` (when present) carries `null`, and at least one
 * non-`off` key exists. That is exactly the shape `normalizeLevels` produces,
 * so an `inspectLadder` of `ours` matches ANY set this plugin customized — and
 * a hand-written dict with the same shape can be reverted too, which is
 * accepted: the shape is the plugin's contract, and the pi-ai schema accepts
 * nothing outside it anyway.
 *
 * Anything else — `false`, an empty object, an unknown key, an empty or null
 * value on a non-`off` level, a `null` on a non-`off` key — is foreign.
 */
export function isManagedLadder(declared) {
	if (!isPlainObject(declared)) return false;
	const keys = Object.keys(declared);
	if (keys.length === 0) return false;
	let nonOff = 0;
	for (const key of keys) {
		if (!LEVEL_IDS.includes(key)) return false;
		const value = declared[key];
		if (key === "off") {
			if (value !== null) return false;
		} else {
			if (typeof value !== "string" || value.length === 0) return false;
			nonOff += 1;
		}
	}
	return nonOff > 0;
}

/**
 * Find the `models` entry one provider route declares for one model.
 *
 * A route that replaced its catalog with a `models` list is the only shape
 * this plugin can edit. `modelOverrides` keys a model by the dict key rather
 * than an `id` field, and `dsh-llm-pi-ai` refuses `modelOverrides` on a
 * hand-declared route anyway, so that shape is reported rather than guessed at.
 */
export function locateModel(config, provider, model) {
	const providers = isPlainObject(config) && isPlainObject(config.providers) ? config.providers : null;
	if (providers === null || !Object.hasOwn(providers, provider)) return { ok: false, code: "route-missing" };
	const route = providers[provider];
	if (!isPlainObject(route)) return { ok: false, code: "route-missing" };
	if (!Array.isArray(route.models)) return { ok: false, code: "models-replaced" };
	const index = route.models.findIndex((entry) => isPlainObject(entry) && entry.id === model);
	if (index < 0) return { ok: false, code: "model-missing" };
	return { ok: true, route, models: route.models, index };
}

/**
 * Classify the ladder one model carries.
 *
 * - `ours`       anything {@link isManagedLadder} accepts — written by this
 *                plugin (custom sets included), so `revert` may undo it
 * - `undeclared` the field is absent, so `declare` may add it
 * - `nonreasoning` declared as explicitly not supporting thinking
 * - `native`     somebody else's declaration in a foreign shape; report only
 * - `unsupported` the route or model is not reachable through this config
 */
export function inspectLadder(config, provider, model) {
	const found = locateModel(config, provider, model);
	if (!found.ok) return { state: "unsupported", code: found.code };
	const declared = found.models[found.index].reasoningEfforts;
	if (declared === undefined) return { state: "undeclared", code: "" };
	if (declared === false) return { state: "nonreasoning", code: "" };
	if (isManagedLadder(declared)) return { state: "ours", code: "" };
	return { state: "native", code: "" };
}

/**
 * The Loader entry that owns one provider route.
 *
 * `configEditor.entries()` returns only the profile rows it can address
 * uniquely, and the pi-ai entry is the one whose `providers` dict holds the
 * route. The lookup is by shape rather than by package name, so a second
 * adapter using the same field keeps working without a change here.
 *
 * @param rows - whatever `configEditor.entries()` returned; anything else is ignored.
 * @param provider - the provider route key to find an owner for.
 * @returns the owning entry, or null when this config cannot own it.
 */
export function owningEntry(rows, provider) {
	if (!Array.isArray(rows)) return null;
	for (const entry of rows) {
		const config = entry === null || entry === void 0 ? void 0 : entry.options?.config;
		if (config === null || typeof config !== "object") continue;
		const providers = config.providers;
		if (providers === null || typeof providers !== "object") continue;
		if (Object.hasOwn(providers, provider)) return entry;
	}
	return null;
}

function cloneConfig(config) {
	try {
		return structuredClone(config);
	} catch (error) {
		/* A profile may hold a `!!js` value that does not clone; the editor
		   clones the same object and would fail the same way, so report it. */
		throw new DeclareError("write-failed", error === null ? "" : String(error && error.message));
	}
}

/**
 * The Loader entry that stores the global default model selection.
 *
 * Its shape is `{ provider, model, reasoningEffort? }` — no `providers` dict —
 * so {@link owningEntry} cannot find it. `session/selectModel` calls
 * `agentDefaultModel.saveSelection(selected)` after every successful selection,
 * which means choosing a level here silently makes it the default for every
 * new Agent.
 *
 * @param rows - whatever `configEditor.entries()` returned.
 * @returns the entry, or null.
 */
export function defaultSelectionEntry(rows) {
	if (!Array.isArray(rows)) return null;
	for (const entry of rows) {
		const config = entry === null || entry === void 0 ? void 0 : entry.options?.config;
		if (config === null || typeof config !== "object") continue;
		if (typeof config.provider === "string" && typeof config.model === "string" &&
			config.providers === void 0) {
			return entry;
		}
	}
	return null;
}

/**
 * Drop a default selection's effort when the ladder it names is being removed.
 *
 * Without this, `revert` strands the profile: `agent-default-model` keeps
 * `reasoningEffort: "high"` for a route that no longer declares any level, and
 * every later request fails with `UNSUPPORTED_REASONING_EFFORT` — including in
 * sessions the user never touched. The level is only removed when `allowed`
 * contains it — the keys of the ladder being removed, which covers the
 * customized sets — AND the selection points at this exact route, so a
 * default the user set for another model is never disturbed.
 *
 * @param config - the default-selection entry's config.
 * @param provider - the route whose ladder is being removed.
 * @param model - the model on that route.
 * @param allowed - the wire ids still legal to strip; defaults to
 *   {@link DECLARED_LEVELS} for callers that could not read the ladder.
 * @returns the next config and whether anything changed.
 */
export function planClearDefault(config, provider, model, allowed) {
	const keep = cloneConfig(config);
	if (config === null || typeof config !== "object") return { next: keep, changed: false };
	if (config.provider !== provider || config.model !== model) return { next: keep, changed: false };
	const effort = config.reasoningEffort;
	const set = Array.isArray(allowed) && allowed.length > 0 ? allowed : DECLARED_LEVELS;
	if (typeof effort !== "string" || !set.includes(effort)) {
		return { next: keep, changed: false };
	}
	delete keep.reasoningEffort;
	return { next: keep, changed: true };
}

/**
 * The keys of the ladder a model currently carries, vocabulary order.
 *
 * `revert` hands these to {@link planClearDefault} so a stranded default is
 * stripped for ANY managed declaration, customized sets included. An array is
 * returned even for `false`/absent/foreign ladders: an empty list then means
 * "nothing to strip", and the caller falls back to the built-in set.
 */
export function declaredLadderKeys(config, provider, model) {
	const found = locateModel(config, provider, model);
	if (!found.ok) return [];
	const ladder = found.models[found.index].reasoningEfforts;
	if (ladder === undefined || ladder === false || !isPlainObject(ladder)) return [];
	return LEVEL_IDS.filter((id) => Object.hasOwn(ladder, id));
}

/**
 * The exact config `declare` would write; returns the input unchanged when it
 * is already there.
 *
 * `levels` is a caller-supplied custom ladder — a `{ level: wire }` dict
 * validated by {@link normalizeLevels} — and defaults to the built-in
 * {@link DECLARED_EFFORTS}.
 *
 * @throws {DeclareError} `bad-levels` for an invalid custom set, or the
 *   {@link locateModel} codes for an unreachable route/model.
 */
export function planDeclare(config, provider, model, levels) {
	const found = locateModel(config, provider, model);
	if (!found.ok) throw new DeclareError(found.code);
	const target = normalizeLevels(levels === void 0 || levels === null ? DECLARED_EFFORTS : levels);
	if (sameJson(found.models[found.index].reasoningEfforts, target)) {
		return { next: cloneConfig(config), changed: false };
	}
	const next = cloneConfig(config);
	next.providers[provider].models[found.index].reasoningEfforts = { ...target };
	return { next, changed: true };
}

/** The exact config that removes a managed declaration; refuses anything else. */
export function planRevert(config, provider, model) {
	const found = locateModel(config, provider, model);
	if (!found.ok) throw new DeclareError(found.code);
	if (!isManagedLadder(found.models[found.index].reasoningEfforts)) {
		throw new DeclareError("not-ours");
	}
	const next = cloneConfig(config);
	delete next.providers[provider].models[found.index].reasoningEfforts;
	return { next, changed: true };
}

/** One entry point for the two actions, so a route handler stays a dispatcher. */
export function planAction(action, config, provider, model, levels) {
	if (action === "declare") return planDeclare(config, provider, model, levels);
	if (action === "revert") return planRevert(config, provider, model);
	throw new DeclareError("bad-action");
}

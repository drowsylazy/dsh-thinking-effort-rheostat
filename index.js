/**
 * Host half of the thinking-effort bundle.
 *
 * The control itself is Client UI, but one operation cannot live in a browser:
 * a model whose adapter reports no reasoning metadata has no adjustable effort,
 * and `dsh-llm` refuses an explicit one before provider I/O. The only supported
 * way to make such a route adjustable is to declare its ladder in the profile —
 * `dsh-llm-pi-ai`'s own `reasoningEfforts` field, which is what turns an effort
 * into the `reasoning_effort` a gateway sends. This half owns that declaration.
 *
 * The browser reaches it over one exact Fetch route rather than a Client
 * Service: registering a Remote would need generated Typert schemas, while
 * `ctx.webServer.register` is the same seam `dsh-host-open-in-app` uses for its
 * browser-facing writes, including the trust fence. See `config-declare.js` for
 * the config surgery, and `lib/types` in `dsh-config-editor` for the write:
 * `configEditor.edit` validates the next config against the plugin's own
 * schema, writes the profile patch atomically, and rolls the file back if the
 * Loader refuses the reload.
 */

import {
	DeclareError,
	inspectLadder,
	owningEntry,
	defaultSelectionEntry,
	planAction,
	planClearDefault,
	declaredLadderKeys
} from "./config-declare.js";

/** Browser-relative path the Client half fetches; the leading slash is absolute on purpose. */
const ROUTE = "/thinking-effort/levels";
/** Browser-relative path the Client half queries for models.dev lookups. */
const MODELSDEV_ROUTE = "/thinking-effort/modelsdev";
/** A request body here is two short strings; anything larger is not ours. */
const BODY_LIMIT = 8 * 1024;

const MODELSDEV_URL = "https://models.dev/api.json";
const MODELSDEV_TTL = 30 * 60 * 1000;
const MODELSDEV_TIMEOUT = 12 * 1000;
/** Cap per query; the feed carries thousands of models and one row of matches is the point. */
const MODELSDEV_MATCHES = 6;

function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(payload));
}

/** Read a bounded request body; a client that will not stop is cut off, not buffered. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > BODY_LIMIT) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", (error) => reject(error));
	});
}

/**
 * Read the addressable profile rows, tolerating a Host without an editor.
 * @param editor - the `configEditor` service.
 * @returns the rows, or an empty list when the service cannot answer.
 */
function editorRows(editor) {
	try {
		const rows = editor.entries();
		return Array.isArray(rows) ? rows : [];
	} catch {
		return [];
	}
}

function failure(error) {
	if (error instanceof DeclareError) return { ok: false, code: error.code, detail: error.detail };
	const detail = error === null || error === void 0 ? "" : String(error.message ?? error);
	return { ok: false, code: "write-failed", detail };
}

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value) {
	return typeof value === "string" ? value : "";
}

/**
 * The levels the Host will ACTUALLY accept for one exact model, read from the
 * live adapter rather than from the profile.
 *
 * This is the answer to "why does it sometimes say the provider does not
 * support that level": a written declaration and the capability the dispatch
 * path validates are two different readings of the same config, and they can
 * disagree for as long as the adapter has not been reloaded. Reporting the
 * effective set lets the surface refuse to offer a level the request would
 * reject.
 *
 * @param llm - the `llm` service, when mounted.
 * @param provider - route key.
 * @param model - exact model id.
 * @returns `{ levels }` on success, `{ levels: null, error }` when it cannot be read.
 */
async function effectiveLevels(llm, provider, model) {
	if (llm === null || llm === void 0 || typeof llm.resolveModelInfo !== "function") {
		return { levels: null, error: "no-llm" };
	}
	try {
		const info = await llm.resolveModelInfo(provider, model);
		const efforts = info === null || info === void 0 ? void 0 : info.reasoning?.efforts;
		if (!Array.isArray(efforts)) return { levels: [] };
		const levels = [];
		for (const effort of efforts) {
			if (typeof effort?.id === "string") levels.push(effort.id);
		}
		return { levels };
	} catch (error) {
		return { levels: null, error: text(error === null || error === void 0 ? "" : error.message) };
	}
}

/**
 * @param ctx - the plugin's root context, used only for `llm/adapters-updated`.
 * @param scope - the child context holding `configEditor`.
 * @returns the route handler, or null when the composition cannot serve it.
 */
function makeHandler(ctx, scope) {
	const editor = scope.configEditor;
	if (editor === null || editor === void 0 || typeof editor.edit !== "function") return null;
	/* `llm` is resolved per request, NOT captured at mount and NOT injected:
	   it only feeds the informational `levels` field, while a hard dependency
	   would let boot order remove the whole route. The services that must not be
	   missing — the editor and the fence — are the ones injected. */
	const llmOf = () => scope.get("llm");

	/* Fail CLOSED. These routes re-write a user's profile or serve cached
	   catalogue data, so a request that cannot be checked must not be served.
	   Resolving the fence per request instead of capturing it once is
	   deliberate: an earlier version read `scope.get("connection")` at mount
	   time, which returned undefined while this plugin (inserted early in the
	   bundle patch) loaded before the connection service existed — the whole
	   fence was skipped, and any local page could rewrite the profile.
	   Requiring `connection` in the inject list below means the route is not
	   registered until the fence can exist; this check also covers the service
	   disappearing later. */
	const fence = (req, res) => {
		const connection = scope.connection;
		if (connection === null || connection === void 0 || typeof connection.requestRejection !== "function") {
			sendJson(res, 503, { ok: false, code: "fence-missing", detail: "" });
			return false;
		}
		/* Same fence every browser-facing Host route applies: Host/Origin, then
		   the page's own authentication cookie. */
		const rejection = connection.requestRejection(req);
		if (rejection !== void 0) {
			res.statusCode = rejection;
			res.end();
			return false;
		}
		return true;
	};

	return async function handler(req, res) {
		if (!fence(req, res)) return;

		const url = new URL(String(req.url), "http://127.0.0.1");
		if (req.method === "GET") {
			const provider = text(url.searchParams.get("provider"));
			const model = text(url.searchParams.get("model"));
			if (provider.length === 0 || model.length === 0) {
				sendJson(res, 400, { ok: false, code: "bad-request", detail: "" });
				return;
			}
			const entry = owningEntry(editorRows(editor), provider);
			if (entry === null) {
				sendJson(res, 200, { ok: true, state: "unsupported", code: "editor-missing" });
				return;
			}
			const seen = inspectLadder(entry.options?.config, provider, model);
			const effective = await effectiveLevels(llmOf(), provider, model);
			sendJson(res, 200, { ok: true, ...seen, ...effective });
			return;
		}

		if (req.method !== "POST") {
			res.statusCode = 405;
			res.setHeader("allow", "GET, POST");
			res.end();
			return;
		}

		let body;
		try {
			body = JSON.parse(await readBody(req));
		} catch (error) {
			sendJson(res, 400, { ok: false, code: "bad-request", detail: String(error && error.message) });
			return;
		}
		const provider = text(body?.provider);
		const model = text(body?.model);
		const action = text(body?.action);
		/* The declaration body may carry a caller-chosen ladder. It is passed
		   through as opaque JSON; `normalizeLevels` (through `planDeclare`)
		   rejects anything the pi-ai schema would refuse, with `bad-levels`. */
		const rawLevels = body === void 0 || body === null ? void 0 : body.levels;
		const levels = isPlainObject(rawLevels) ? rawLevels : void 0;
		if (provider.length === 0 || model.length === 0 || (action !== "declare" && action !== "revert")) {
			sendJson(res, 400, { ok: false, code: "bad-request", detail: "" });
			return;
		}

		const entry = owningEntry(editorRows(editor), provider);
		if (entry === null) {
			sendJson(res, 409, { ok: false, code: "editor-missing", detail: "" });
			return;
		}

		/* Re-plan inside `change` against the config the editor hands back,
		   not the one read above: that object is the authoritative current
		   value at the moment of the write. On revert, read the ladder keys
		   from that same authoritative value — the stranded-default cleanup
		   below needs them, and they are gone after the write. */
		let ladderKeys = null;
		try {
			await editor.edit(entry, (raw) => {
				if (action === "revert") {
					try {
						ladderKeys = declaredLadderKeys(raw, provider, model);
					} catch {
						ladderKeys = null;
					}
				}
				return planAction(action, raw, provider, model, levels).next;
			});
		} catch (error) {
			sendJson(res, 409, failure(error));
			return;
		}
		/* Removing a ladder has to take the strand with it. `selectModel` saves
		   the selection as the global default, so the profile may hold
		   `{ provider, model, reasoningEffort: "high" }` for this exact route.
		   Leaving it behind means every later request fails validation — the
		   "provider does not support that level" error arriving in sessions that
		   never touched this control. Best effort: the ladder is already removed,
		   so a failure here is reported, not thrown. */
		let clearedDefault = false;
		if (action === "revert") {
			const rows = editorRows(editor);
			const holder = defaultSelectionEntry(rows);
			if (holder !== null) {
				const planned = planClearDefault(holder.options?.config, provider, model, ladderKeys ?? void 0);
				if (planned.changed) {
					try {
						await editor.edit(holder, (raw) => planClearDefault(raw, provider, model, ladderKeys ?? void 0).next);
						clearedDefault = true;
					} catch {
						/* reported below via the effective-levels mismatch instead */
					}
				}
			}
		}

		/* The route's ladder changed, so every model picker is stale. pi-ai does
		   not emit this itself (its own catalog is rebuilt per request), and the
		   Client directory only listens for the event, so publish it. */
		try {
			ctx.emit("llm/adapters-updated");
		} catch {
			/* A listener failure must not turn a committed write into an error. */
		}

		/* Read back what the Host will actually accept. The client uses this to
		   refuse to offer a level the dispatch path would reject; a `null` means
		   "could not be read", never "nothing is supported". */
		const effective = await effectiveLevels(llmOf(), provider, model);
		sendJson(res, 200, {
			ok: true,
			state: action === "declare" ? "ours" : "undeclared",
			code: "",
			clearedDefault,
			...effective
		});
	};
}

/* ------------------------------------------------------------------ *
 * models.dev lookups
 *
 * `https://models.dev/api.json` lists every provider's models with their
 * reasoning capabilities. The Client asks for it by the bare model name (the
 * part of the configured id after the last "/"), because a gateway route's id
 * rarely matches the upstream catalogue — but the bare name usually does.
 * ------------------------------------------------------------------ */

/** One cached feed; a ~6 MB payload fetched per query would be uncivil, so a crisp TTL instead. */
let modelsDevFeed = { at: 0, data: null };

function fetchModelsDev() {
	if (modelsDevFeed.data !== null && Date.now() - modelsDevFeed.at < MODELSDEV_TTL) {
		return Promise.resolve(modelsDevFeed.data);
	}
	if (typeof fetch !== "function") {
		return Promise.reject(Object.assign(new Error("no fetch implementation"), { code: "no-fetch" }));
	}
	/* A hung fetch must not hang the pool: AbortSignal.timeout is the clean way
	   when the runtime offers it, no timeout otherwise (best effort). */
	const signal = typeof AbortSignal === "function" && typeof AbortSignal.timeout === "function"
		? AbortSignal.timeout(MODELSDEV_TIMEOUT)
		: void 0;
	return fetch(MODELSDEV_URL, signal === void 0 ? { headers: { accept: "application/json" } } : {
		headers: { accept: "application/json" },
		signal
	}).then((response) => {
		if (!response.ok) throw new Error("HTTP " + String(response.status));
		return response.json();
	}).then((data) => {
		modelsDevFeed = { at: Date.now(), data: isPlainObject(data) ? data : {} };
		return modelsDevFeed.data;
	});
}

/**
 * Compact one catalogue model into what the Client needs.
 *
 * `reasoning_options` is kept one level deep and value lists are capped — a
 * provider may publish a long budget scale the plugin never uses — so a
 * seven-match reply stays a few hundred bytes, not the feed's 6 MB.
 */
function modelsDevEntry(provider, model) {
	const options = [];
	for (const option of Array.isArray(model.reasoning_options) ? model.reasoning_options : []) {
		if (!isPlainObject(option) || typeof option.type !== "string") continue;
		const entry = { type: option.type };
		if (Array.isArray(option.values)) entry.values = option.values.slice(0, 12).map(String);
		options.push(entry);
	}
	const efforts = options.find((option) => option.type === "effort" && Array.isArray(option.values));
	return {
		provider,
		id: typeof model.id === "string" ? model.id : "",
		name: typeof model.name === "string" ? model.name : "",
		reasoning: model.reasoning === true,
		efforts: efforts === void 0 ? [] : efforts.values,
		options
	};
}

/**
 * Rank catalogue models whose id or name answers one query.
 *
 * A full `provider/model` id always outranks a substring guess; within one
 * score, providers keep feed order. The query is the model id's own spelling:
 * matching is a lookup aid, the Client still decides what to declare from the
 * matched model's option values.
 */
function matchModelsDev(feed, query, providerFilter) {
	const needle = query.toLowerCase();
	const results = [];
	const providers = isPlainObject(feed) ? feed : {};
	for (const providerKey of Object.keys(providers)) {
		if (providerFilter !== "" && providerKey.toLowerCase() !== providerFilter) continue;
		const provider = providers[providerKey];
		if (!isPlainObject(provider) || !isPlainObject(provider.models)) continue;
		for (const modelKey of Object.keys(provider.models)) {
			const model = provider.models[modelKey];
			if (!isPlainObject(model)) continue;
			const id = typeof model.id === "string" && model.id.length > 0 ? model.id : modelKey;
			const bare = id.toLowerCase().slice(id.lastIndexOf("/") + 1);
			const name = typeof model.name === "string" ? model.name.toLowerCase() : "";
			let score = -1;
			if (bare === needle) score = 0;
			else if (id.toLowerCase() === needle) score = 1;
			else if (needle.length >= 4 && (bare.includes(needle) || id.toLowerCase().includes(needle))) score = 2;
			else if (needle.length >= 4 && name.includes(needle)) score = 3;
			if (score < 0) continue;
			results.push({ score, entry: modelsDevEntry(providerKey, model) });
		}
	}
	/* Dedupe by provider + id: two aliases in the feed must not fill the row. */
	const seen = new Set();
	results.sort((left, right) => left.score - right.score);
	const unique = [];
	for (const result of results) {
		const key = result.entry.provider + "\x1f" + result.entry.id;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(result.entry);
		if (unique.length >= MODELSDEV_MATCHES) break;
	}
	return unique;
}

/**
 * The lookup handler for `/thinking-effort/modelsdev`.
 *
 * Read-only: same fence, no editor, no writes. A query may name a provider to
 * disambiguate (`provider=deepseek&name=deepseek-v4-flash`); without it the
 * bare name is matched across every provider.
 */
function makeModelsDevHandler(scope) {
	return async function handler(req, res) {
		/* An undefined-differs-from-false distinction is not needed here: the
		   fence helper already wrote every failure it rejects. */
		const connection = scope.connection;
		if (connection === null || connection === void 0 || typeof connection.requestRejection !== "function") {
			sendJson(res, 503, { ok: false, code: "fence-missing", detail: "" });
			return;
		}
		const rejection = connection.requestRejection(req);
		if (rejection !== void 0) {
			res.statusCode = rejection;
			res.end();
			return;
		}
		if (req.method !== "GET") {
			res.statusCode = 405;
			res.setHeader("allow", "GET");
			res.end();
			return;
		}
		const url = new URL(String(req.url), "http://127.0.0.1");
		const name = text(url.searchParams.get("name"));
		const providerFilter = text(url.searchParams.get("provider")).toLowerCase();
		if (name.length === 0) {
			sendJson(res, 400, { ok: false, code: "bad-request", detail: "" });
			return;
		}
		try {
			const feed = await fetchModelsDev();
			let matches = matchModelsDev(feed, name, providerFilter);
			/* A gateway id like `agentrouter/deepseek-v4-flash` almost always
			   hides a catalogue name one segment shorter: fall back to the
			   segment after the last "/" when the full id matched nothing. */
			if (matches.length === 0 && name.includes("/")) {
				matches = matchModelsDev(feed, name.slice(name.lastIndexOf("/") + 1), providerFilter);
			}
			sendJson(res, 200, { ok: true, matches, count: matches.length });
		} catch (error) {
			const code = error !== null && typeof error === "object" && typeof error.code === "string"
				? error.code
				: "fetch-failed";
			sendJson(res, code === "no-fetch" ? 501 : 502, {
				ok: false,
				code,
				detail: error === null || error === void 0 ? "" : String(error.message ?? error)
			});
		}
	};
}

export function apply(ctx) {
	/* `connection` is a hard dependency, not an optional lookup: this route
	   writes the profile, and the connection service is what fences it. Waiting
	   for it means the route simply does not exist in a composition that cannot
	   fence it, which is the correct degradation. */
	ctx.inject(["configEditor", "webServer", "connection", "llm"], (scope) => {
		const handler = makeHandler(ctx, scope);
		if (handler !== null) {
			scope.effect(
				() => scope.webServer.register({ kind: "exact", path: ROUTE, handler }),
				"thinking-effort: ladder declaration route"
			);
		}
		/* The lookup needs no editor, so it survives a composition the ladder
		   route must degrade from; the fence alone is the dependency. */
		const lookup = makeModelsDevHandler(scope);
		scope.effect(
			() => scope.webServer.register({ kind: "exact", path: MODELSDEV_ROUTE, handler: lookup }),
			"thinking-effort: models.dev lookup route"
		);
	});
}

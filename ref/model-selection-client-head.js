--- /dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js  size=57279 shown=4000 ---
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-model-selection",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		//#region ../../util/values/src/index.ts
		/**
		* Weak-key lookup with a strongly retained iterable set of associated values.
		*
		* Each value must belong to only one key. The container performs no automatic
		* cleanup; owners delete associations or clear the container at lifecycle end.
		*/
		var WeakMapWithValues = class {
			keys = /* @__PURE__ */ new WeakMap();
			valueSet = /* @__PURE__ */ new Set();
			/** Live strongly retained values in insertion order. */
			values = this.valueSet;
			/**
			* Read the value associated with a key.
			* @param key - weakly held lookup key.
			* @returns the associated value, or absence.
			*/
			get(key) {
				return this.keys.get(key);
			}
			/**
			* Test whether a key has an association.
			* @param key - weakly held lookup key.
			* @returns whether the key is present.
			*/
			has(key) {
				return this.keys.has(key);
			}
			/**
			* Associate one key with one caller-unique value.
			* @param key - weakly held lookup key.
			* @param value - strongly retained value that belongs to no other key.
			* @returns this container.
			*/
			set(key, value) {
				if (this.keys.has(key)) {
					const previous = this.keys.get(key);
					if (previous === value) return this;
					this.valueSet.delete(previous);
				}
				this.keys.set(key, value);
				this.valueSet.add(value);
				return this;
			}
			/**
			* Remove one association and its strongly retained value.
			* @param key - weakly held lookup key.
			* @returns whether an association was removed.
			*/
			delete(key) {
				if (!this.keys.has(key)) return false;
				const value = this.keys.get(key);
				const deleted = this.keys.delete(key);
				this.valueSet.delete(value);
				return deleted;
			}
			/** Remove every association and strongly retained value. */
			clear() {
				this.keys = /* @__PURE__ */ new WeakMap();
				this.valueSet.clear();
			}
		};
		//#endregion
		//#region lib/types/client/catalog.js
		/** One Host-generation model catalog shared by every Session selector. */
		/** Loads at most one model catalog for the current Host generation. */
		var ModelCatalogDirectory = class {
			ctx;
			/** Current shared catalog value and load lifecycle. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				value: null,
				status: "idle",
				error: null
			});
			reasoning = /* @__PURE__ */ new Map();
			/**
			* Read the last advertised reasoning metadata, including unavailable models.
			* @param selection - provider and model whose effort is displayed.
			* @returns reasoning metadata observed during this Host generation.
			*/
			reasoningFor(selection) {
				return this.reasoning.get(JSON.stringify([selection.provider, selection.model]));
			}
			generation = 0;
			inflight;
			/**
			* @param ctx - the providing plugin's context, whose `remote.session`
			* namespace carries the Host-generation catalog.
			*/
			constructor(ctx) {
				this.ctx = ctx;
			}
			/**
			* Return the current generation's catalog, sharing its one in-flight load.
			* @returns the loaded global catalog.
			*/
			load() {
				const state = this.store.getSnapshot();
				if (state.status === "ready" && state.value !== null) return Promise.resolve(state.value);
				if (this.inflight !== void 0) return this.inflight;
				const generation = this.generation;
				this.store.update((draft) => {
					draft.status = "loading";
					

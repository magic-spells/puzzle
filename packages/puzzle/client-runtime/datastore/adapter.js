/**
 * Opt-in server adapter runtime (D157).
 *
 * Importing this module has no side effects. Passing the exported capability
 * to PuzzleApp installs the server surface on Store and PuzzleModel; apps that
 * never pass it keep the entire implementation out of their bundle.
 */

import { createAdapterCapability, registerReadState } from '../capabilities.js';
import { HANDLE_CTX, Store } from './store.js';
import { PuzzleView } from '../views/PuzzleView.js';
import {
	PuzzleModel,
	PuzzleValidationError,
	coerceJSONDates,
	recordKey,
	recordMutationRevision,
	safeMerge,
} from '../model.js';

const DELETED_SAVE_MESSAGE = '[puzzle] cannot save a deleted record';
const ADAPTER_VERBS = ['loadMany', 'loadOne', 'create', 'update', 'delete'];
// The 0.6 spelling of loadMany. Every site that could accept it as an ordinary
// custom verb rejects it by name instead, so an unmigrated app fails at build/boot
// rather than silently never loading a collection (D161).
const LEGACY_LOAD_ALL = 'loadAll';
// D161: how many times one refresh may re-run data() behind fetches before it
// gives up. Ten is deep enough for any realistic dependency chain and shallow
// enough that a query which can never be satisfied fails fast instead of
// hammering the API. Exhaustion THROWS — committing partial data would make a
// null mean "still loading", which is exactly the contract this feature buys.
const MAX_SETTLE_ROUNDS = 10;

const noop = () => {};
const writeChainsByStore = new WeakMap();
// D161: subscriber → its store handle. One entry per subscriber, matching the
// one HANDLE_CTX slot a subscriber carries: a subscriber belongs to exactly one
// store, which is what a PuzzleView is — `this.ctx.store` is minted once, in its
// constructor, and never re-pointed.
const handleBySubscriber = new WeakMap();
// A handle's raw Store, for the consumer that needs the true identity, and the
// marker naming the app ctx a per-view ctx derives from. Declared here rather
// than in core: nothing without the adapter ever mints a handle or a derived
// ctx, so a no-adapter bundle carries neither symbol.
export const STORE_RAW = Symbol('puzzleRawStore');
const CTX_BASE = Symbol('puzzleCtxBase');
const adapterBindingsByStore = new WeakMap();
const warnedAdapterConfigs = new WeakSet();
const warnedTrackedLoads = new WeakMap();
let installed = false;

// Core Store methods this module WRAPS rather than replaces. Captured before
// installAdapter() overwrites them on the prototype (D157 keeps the read-state
// bookkeeping out of store.js, so the hooks it needs are added from out here).
const baseCreateRecord = Store.prototype.createRecord;
const baseRemoveRecord = Store.prototype.removeRecord;
const baseHydrateAll = Store.prototype._hydrateAll;
const baseInstallRelationships = Store.prototype._installRelationships;

function validateAdapterConfig(type, Model, config) {
	if (!config || typeof config !== 'object' || Array.isArray(config)) return;
	const invalid = Object.entries(config)
		.filter(([key, value]) => key !== 'endpoint' && key !== 'mock' && typeof value !== 'function')
		.map(([key]) => key);
	if (!invalid.length || warnedAdapterConfigs.has(Model)) return;
	warnedAdapterConfigs.add(Model);
	console.warn(
		`[puzzle] model '${type}' has invalid adapter ${invalid.length === 1 ? 'key' : 'keys'} ${invalid
			.map((key) => JSON.stringify(key))
			.join(', ')} — adapter keys must be "endpoint", "mock", or functions`
	);
}

/** The one migration message, so every guard site reads identically. */
function legacyLoadAllError(where) {
	return new Error(
		`[puzzle] ${where} — the adapter verb 'loadAll' was renamed 'loadMany' in 0.7.0; rename it (and store.loadAll() → store.loadMany())`
	);
}

/** Fail at Store construction, before any navigation, on an unrenamed verb. */
function assertRenamedVerbs(models) {
	for (const [type, Model] of Object.entries(models)) {
		const config = Model?.adapter;
		if (
			config &&
			typeof config === 'object' &&
			Object.prototype.hasOwnProperty.call(config, LEGACY_LOAD_ALL)
		) {
			throw legacyLoadAllError(`model '${type}' declares adapter.loadAll`);
		}
	}
}

/**
 * Dev nudge (D161): the imperative loaders inside a tracked data() run are almost
 * always a leftover from hand-rolled loading — findOne/findMany fetch what is
 * missing and settle before the view commits. Once per store per verb; the
 * internal fault path calls _loadOne/_loadMany and never lands here.
 *
 * Attributed by HANDLE IDENTITY, exactly as faulting is: only a call arriving
 * through a view's own store handle whose evaluation is open (`hctx.requests`
 * is installed) is that view's read. The ambient `store._tracking` is not a
 * usable test — it stays set across every `await` of any suspended async
 * `data()`, so a click handler or a timer calling `store.loadMany()` in that
 * window warned about a run it has nothing to do with, and the warn-once latch
 * then hid the genuine case for the rest of the session.
 */
function warnTrackedLoad(store, hctx, verb, replacement) {
	if (!hctx.requests) return;
	let warned = warnedTrackedLoads.get(store);
	if (!warned) warnedTrackedLoads.set(store, (warned = new Set()));
	if (warned.has(verb)) return;
	warned.add(verb);
	console.warn(
		`[puzzle] store.${verb}() was called inside a tracked data() run — use store.${replacement}(), which fetches what is missing and settles before the view commits`
	);
}

function validateAdapterDefaults(verbs) {
	if (!verbs || typeof verbs !== 'object' || Array.isArray(verbs)) {
		console.warn(
			'[puzzle] adapter.defaults() expects an object whose keys are adapter verbs and whose values are functions'
		);
		return;
	}
	const invalid = Object.entries(verbs)
		.filter(([key, value]) => !ADAPTER_VERBS.includes(key) || typeof value !== 'function')
		.map(([key]) => key);
	if (!invalid.length) return;
	console.warn(
		`[puzzle] adapter.defaults() has invalid ${invalid.length === 1 ? 'key' : 'keys'} ${invalid
			.map((key) => JSON.stringify(key))
			.join(', ')} — defaults keys must be loadMany, loadOne, create, update, or delete, and every value must be a function`
	);
}

/**
 * Thrown by adapter write verbs when the server responds non-OK.
 */
export class PuzzleAdapterError extends Error {
	constructor(status, statusText, body) {
		super(`[puzzle] adapter request failed: ${status} ${statusText || ''}`.trimEnd());
		this.name = 'PuzzleAdapterError';
		this.status = status;
		this.statusText = statusText;
		this.body = body;
	}
}

/** Read a Response body once, preferring JSON and preserving non-JSON text. */
async function readBody(res) {
	let text;
	try {
		text = await res.text();
	} catch {
		return undefined;
	}
	if (text == null || text === '') return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function queryURL(url, options) {
	if (options == null) return url;
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(options)) {
		if (value != null) search.append(key, String(value));
	}
	const query = search.toString();
	return query ? url + (url.includes('?') ? '&' : '?') + query : url;
}

async function responseData(response) {
	if (!response.ok) {
		throw new PuzzleAdapterError(
			response.status,
			response.statusText,
			await readBody(response)
		);
	}
	return readBody(response);
}

// Registry symbol shared with the `/fixtures` mock, which cannot use the real
// Response constructor (not uniform across Node/jsdom) and so fails instanceof.
// A brand, not a duck-type on ok/status: a plain payload could carry those keys.
const RESPONSE_BRAND = Symbol.for('puzzle.response');

function isResponse(value) {
	if (typeof Response !== 'undefined' && value instanceof Response) return true;
	return value != null && typeof value === 'object' && value[RESPONSE_BRAND] === true;
}

async function generatedTransport(url, verb, fetch, arg) {
	let method;
	let body;
	if (verb === 'loadMany') {
		method = 'GET';
		url = queryURL(url, arg);
	} else if (verb === 'loadOne') {
		method = 'GET';
		url += '/' + encodeURIComponent(arg);
	} else {
		method = verb === 'create' ? 'POST' : verb === 'update' ? 'PUT' : 'DELETE';
		if (verb !== 'create') {
			const pk = arg.constructor.primaryKey();
			url += '/' + encodeURIComponent(arg[pk]);
		}
		if (verb !== 'delete') body = JSON.stringify(arg.toJSON());
	}
	const init = { method };
	if (body !== undefined) {
		init.headers = { 'Content-Type': 'application/json' };
		init.body = body;
	}
	const response = await fetch(url, init);
	// Reads normalize through PuzzleAdapterError exactly like writes and like an
	// author function that returns a non-OK Response (D161): the auto-fetch path
	// recognises absence by `status === 404`, and a plain Error carries no status.
	if (verb === 'delete' && response.status === 404) return;
	return responseData(response);
}

function writeChainsFor(store) {
	let chains = writeChainsByStore.get(store);
	if (!chains) {
		chains = new WeakMap();
		writeChainsByStore.set(store, chains);
	}
	return chains;
}

// ---- read state (D161) -------------------------------------------------------
//
// Every piece of fetch bookkeeping the auto-fetching finds need lives HERE,
// keyed by Store in a module WeakMap, never as Store fields: a no-adapter app
// imports none of this file, so it must ship none of this state (D157).

const readStateByStore = new WeakMap();
// record → the highest read generation that has landed on it. Keyed by the
// record itself so the entry dies with it: no pruning, no serialization.
const LOAD_GENERATIONS = new WeakMap();
// Bounded so a page that walks user-supplied ids cannot grow the negative cache
// without limit. No TTL: an identity the server 404s is absent until something
// makes it present (see clearAbsent's call sites).
const MAX_ABSENT = 1000;
const REC_SEP = ' '; // matches Store's record-key convention: a type name has no space

function readStateFor(store) {
	let state = readStateByStore.get(store);
	if (!state) {
		state = {
			one: new Map(), // "type id" → in-flight single-record request
			many: new Map(), // type → in-flight complete-collection request
			absent: new Map(), // "type id" → true, insertion-ordered (LRU)
			// Two facts, not one (D161). `loaded`: a no-options collection request
			// finished, so a tracked findMany must not re-fault. `complete`: that
			// response was EXHAUSTIVE, so a findOne miss is an authoritative "does
			// not exist" and owes no detail request. Only the generated REST
			// transport earns the second — an authored loadMany is opaque, and a
			// paginated first page is a perfectly good response. complete ⊆ loaded.
			loaded: new Set(),
			complete: new Set(),
			seq: 0, // monotonic read-dispatch counter (see LOAD_GENERATIONS)
		};
		readStateByStore.set(store, state);
	}
	return state;
}

/**
 * The cache key for one record identity, or null when the id has no stable
 * spelling. `recordKey` normalizes numbers, so 7 and '7' share an entry while
 * '01' and 1 do not; anything else (an object used as an id) is unkeyable, and
 * an absence we cannot record is one we must never fetch for — otherwise the
 * settle loop would re-request it every round until the cap.
 */
function identityKey(type, id) {
	const key = recordKey(id);
	return typeof key === 'string' ? type + REC_SEP + key : null;
}

function markAbsent(state, key) {
	state.absent.delete(key); // re-insert so the eviction order is true LRU
	state.absent.set(key, true);
	if (state.absent.size > MAX_ABSENT) {
		state.absent.delete(state.absent.keys().next().value);
	}
}

function isAbsent(state, key) {
	if (!state.absent.has(key)) return false;
	markAbsent(state, key); // a consulted entry is a used entry
	return true;
}

/** Drop the negative entry for one identity — it just became present. */
function clearAbsent(store, type, id) {
	const state = readStateByStore.get(store);
	if (!state || state.absent.size === 0) return;
	const key = identityKey(type, id);
	if (key !== null) state.absent.delete(key);
}

/** Drop every negative entry whose record is now in the store (bulk inserts). */
function sweepAbsent(store) {
	const state = readStateByStore.get(store);
	if (!state || state.absent.size === 0) return;
	for (const key of [...state.absent.keys()]) {
		const sep = key.indexOf(REC_SEP);
		const map = store.recordsByType.get(key.slice(0, sep));
		if (map && map.has(key.slice(sep + 1))) state.absent.delete(key);
	}
}

/**
 * The read state a prerendered page hands its browser kernel (D161). Records
 * travel in the existing data island; this is what the island cannot infer from
 * them — which collections are known complete and which identities are known
 * absent. Versioned so an older kernel can reject a newer envelope.
 */
export function serializeReadState(store) {
	// Read state is keyed by the RAW Store, so unwrap a per-view handle first: a
	// caller holding `this.ctx.store` is holding a Store as far as it knows, and
	// must not silently get an empty envelope (D161).
	const state = readStateByStore.get(store?.[STORE_RAW] ?? store);
	if (!state) return { v: 1, complete: [], loaded: [], absent: [] };
	return {
		v: 1,
		// `complete` keeps its original meaning — exhaustive — so an older kernel
		// reading a newer envelope is still right about every id. `loaded` is
		// additive; a kernel that does not know it falls back to `complete`.
		complete: [...state.complete],
		loaded: [...state.loaded],
		absent: [...state.absent.keys()],
	};
}

/**
 * Adopt a serialized envelope. Call AFTER the records hydrate: a negative entry
 * whose record is present is dropped rather than trusted, so a build that 404'd
 * an id another page later supplied cannot suppress a live read. In-flight work
 * is never transferred — an unresolved miss simply refetches.
 */
export function hydrateReadState(handleOrStore, envelope) {
	if (!envelope || envelope.v !== 1) return;
	const store = handleOrStore?.[STORE_RAW] ?? handleOrStore; // see serializeReadState
	const state = readStateFor(store);
	if (Array.isArray(envelope.complete)) {
		for (const type of envelope.complete) {
			state.complete.add(type);
			state.loaded.add(type);
		}
	}
	// Absent from an envelope written before the loaded/complete split, in which
	// case `complete` above already carried everything that had loaded.
	if (Array.isArray(envelope.loaded)) {
		for (const type of envelope.loaded) state.loaded.add(type);
	}
	if (Array.isArray(envelope.absent)) {
		for (const key of envelope.absent) {
			if (typeof key === 'string' && key.includes(REC_SEP)) markAbsent(state, key);
		}
	}
	sweepAbsent(store);
}

// The prerenderer, the static kernel and the HMR snapshot reach the two functions
// above through capabilities.js, never by importing this module: a no-adapter app
// must not pull the sync runtime into its pages (D157).
registerReadState({ serialize: serializeReadState, hydrate: hydrateReadState });

/**
 * D161 fetch eligibility for a TRACKED miss — deliberately stricter than D158
 * dispatch. A model declares server intent with its OWN `static adapter`: an
 * `endpoint` (which the generated REST tier and every app default can address)
 * or an authored function for the verb in question. An app-wide
 * `adapter.defaults()` dialect says HOW this app talks to its server, not WHICH
 * models are server-backed — so on its own it must never turn a purely local
 * model into a fetching one. Without this gate a dialect binds a read verb onto
 * every registered model with `endpoint: undefined`, and the first tracked
 * findMany on a local-only model issues `GET /undefined` whose failure rejects
 * the whole view ("No adapter, no read verb ⇒ nothing changes").
 *
 * Only the AUTOMATIC path is gated: an explicit store.loadOne/loadMany still
 * dispatches through the app-default tier for a model with no endpoint, which
 * is what a type-derived dialect relies on (D158).
 */
function faultVerb(store, type, verb) {
	const declared = store.modelFor(type).adapter;
	const config =
		declared && typeof declared === 'object' && !Array.isArray(declared) ? declared : null;
	if (!config) return null;
	// Bind BEFORE the eligibility test so a declared-but-unusable config still
	// reaches the dev config warning and the loadAll guard, exactly as it did when
	// this was a bare `typeof store.adapter(type)[verb] !== 'function'` check.
	const bound = store.adapter(type);
	if (typeof config[verb] !== 'function' && !config.endpoint) return null;
	return typeof bound[verb] === 'function' ? bound[verb] : null;
}

/**
 * Did the FRAMEWORK generate this verb's request (the D158 endpoint-derived
 * REST transport), rather than an author or an app-wide dialect? Only then can
 * the framework make claims about what a response means beyond the records it
 * carried — see the `loaded` / `complete` split in readStateFor (D161/D158).
 */
function isGeneratedVerb(store, type, verb) {
	const declared = store.modelFor(type).adapter;
	const config =
		declared && typeof declared === 'object' && !Array.isArray(declared) ? declared : null;
	if (!config?.endpoint) return false;
	if (typeof config[verb] === 'function') return false;
	return typeof store._a?.d?.[verb] !== 'function';
}

class AdapterStoreMethods {
	// ---- wrapped core methods (D161 read-state invalidation) --

	/** Store init is where an unrenamed adapter verb has to be caught (D161). */
	_installRelationships() {
		assertRenamedVerbs(this.models);
		baseInstallRelationships.call(this);
	}

	createRecord(type, data) {
		const record = baseCreateRecord.call(this, type, data);
		clearAbsent(this, type, record[this.modelFor(type).primaryKey()]);
		return record;
	}

	/**
	 * Removing a record by ANY path — `record.destroy()`, a confirmed
	 * `delete()` — records that identity absent, so a tracked findOne on a type
	 * whose collection is not known exhaustive returns null instead of faulting it
	 * straight back in (D161). Anything that brings the id back clears the entry:
	 * createRecord, _upsert via loadOne/loadMany/upsert, and the hydration sweep.
	 * `loadOne` is the explicit refresh.
	 */
	removeRecord(record) {
		const type = record._type;
		if (!type) return baseRemoveRecord.call(this, record);
		// Key the identity BEFORE the base call — it detaches the record.
		const key = identityKey(type, record[this.modelFor(type).primaryKey()]);
		baseRemoveRecord.call(this, record);
		if (key !== null) markAbsent(readStateFor(this), key);
	}

	_hydrateAll(data, options) {
		baseHydrateAll.call(this, data, options);
		sweepAbsent(this); // storage / static-island / HMR restore all land here
	}

	// ---- adapter dispatch + bound author surface (D158) -------

	/**
	 * Return the model adapter with every author function bound to this model's
	 * enhanced fetch. Standard verbs resolve model function → app default →
	 * endpoint-generated REST transport. Stable per store+type.
	 */
	adapter(type) {
		let bindings = adapterBindingsByStore.get(this);
		if (!bindings) {
			bindings = new Map();
			adapterBindingsByStore.set(this, bindings);
		}
		if (bindings.has(type)) return bindings.get(type);

		const Model = this.modelFor(type);
		const declared = Model.adapter;
		const config =
			declared && typeof declared === 'object' && !Array.isArray(declared) ? declared : {};
		const defaults = this._a?.d;
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			validateAdapterConfig(type, Model, declared);
		}
		const fetch = (input, init) => {
			const requestInit = init && typeof init === 'object' ? { ...init } : {};
			const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
			const method = String(requestInit.method || request?.method || 'GET').toUpperCase();
			requestInit.method = method;
			return this._fetch(input, requestInit, { type, method, url: request?.url || String(input) });
		};
		const bound = {};
		for (const [key, value] of Object.entries(config)) {
			// Rejected BEFORE the custom-verb branch below (D161): an unrenamed
			// loadAll is a function, so it would otherwise bind as a harmless custom
			// verb nothing ever calls.
			if (key === LEGACY_LOAD_ALL) {
				throw legacyLoadAllError(`model '${type}' declares adapter.loadAll`);
			}
			bound[key] = typeof value === 'function' ? (...args) => value(fetch, ...args) : value;
		}
		const defaultContext = { type, endpoint: config.endpoint };
		const url = config.endpoint && this.apiURL + config.endpoint;
		for (const verb of ADAPTER_VERBS) {
			if (typeof bound[verb] !== 'function') {
				if (typeof defaults?.[verb] === 'function') {
					bound[verb] = (...args) => defaults[verb](fetch, ...args, defaultContext);
				} else if (config.endpoint) {
					bound[verb] = (arg) => generatedTransport(url, verb, fetch, arg);
				}
			}
		}
		bindings.set(type, bound);
		return bound;
	}

	_adapterVerb(type, verb) {
		const fn = this.adapter(type)[verb];
		if (typeof fn === 'function') return fn;
		throw new Error(
			`[puzzle] no adapter ${verb}() declared for '${type}' — add ${verb}(fetch${
				verb === 'loadOne' ? ', id' : verb === 'create' || verb === 'update' || verb === 'delete' ? ', record' : ''
			}) or an endpoint for the generated default`
		);
	}

	// ---- server read path (D21) ------------------------------

	/**
	 * The 0.6 spelling. Kept as a trap rather than an alias: an app that keeps
	 * calling it would otherwise look migrated while its models never renamed
	 * their verb (D161).
	 */
	loadAll() {
		throw legacyLoadAllError('store.loadAll() no longer exists');
	}

	/**
	 * GET apiURL + adapter.endpoint and upsert every record in the response.
	 * Records with matching primary keys are updated in place — no duplicates.
	 * Subscribers are notified as data lands (batched, as usual).
	 *
	 * Imperative and unconditional: it always issues a request (the force-refresh
	 * escape hatch), unlike the deduplicated fault the tracked findMany queues.
	 * Called with NO options it is a whole-collection load, so the type is marked
	 * loaded — and exhaustive too when the generated transport made the request
	 * (see _loadMany). An options-bearing call — `{}` included — is a partial,
	 * accumulating load and marks nothing (D161).
	 */
	loadMany(type, options) {
		return this._loadMany(type, options);
	}

	async _loadMany(type, options) {
		const pk = this.modelFor(type).primaryKey();
		// Dispatch order, so a response that lost the race cannot overwrite a newer
		// one that already landed on the same record.
		const gen = ++readStateFor(this).seq;
		const revisionsAtDispatch = new Map(
			Array.from(this._typeMap(type).values(), (record) => [
				recordKey(record[pk]),
				recordMutationRevision(record),
			])
		);
		const list = await this._adapterResult(this._adapterVerb(type, 'loadMany')(options));
		if (!Array.isArray(list)) {
			throw new Error(`[puzzle] loadMany('${type}') expected a JSON array from the server`);
		}
		// Per-element shape guard (mirrors loadOne): validate EVERY entry up front,
		// before any upsert, so a null/array/non-object mid-array can't half-apply
		// the response — a null would slip through _upsert → _instantiate as a
		// phantom record with a generated pk marked _synced; a string would spread
		// its indices as fields.
		for (const data of list) {
			if (data == null || typeof data !== 'object' || Array.isArray(data)) {
				throw new Error(
					`[puzzle] loadMany('${type}') expected an array of JSON objects from the server`
				);
			}
			if (data[pk] == null) {
				throw new Error(
					`[puzzle] loadMany('${type}') requires primary key "${pk}" on every record`
				);
			}
		}
		const records = list.map((data) =>
			this._upsert(type, data, revisionsAtDispatch.get(recordKey(data[pk])), gen)
		);
		// A no-options load is the whole collection as far as REQUESTING goes, so
		// the tracked findMany stops faulting either way. It answers "is this
		// identity absent?" for every id it omits only when the FRAMEWORK built the
		// request — an authored loadMany may well have returned page one (D161). An
		// empty array counts; an options-bearing call marks nothing.
		if (options == null) {
			const state = readStateFor(this);
			state.loaded.add(type);
			if (isGeneratedVerb(this, type, 'loadMany')) state.complete.add(type);
		}
		this._persist();
		return records;
	}

	/**
	 * GET apiURL + adapter.endpoint + '/' + id and upsert the single record.
	 *
	 * Imperative: it always issues a request and deliberately BYPASSES the negative
	 * cache, which makes it the force-refresh escape hatch for an id the framework
	 * has recorded as absent. A 404 refreshes that entry; success clears it (D161).
	 *
	 * Permissive about identity: whatever record the server returns for this key is
	 * upserted, so a lookup by a non-primary key — `loadOne('post', 'my-slug')`
	 * against a slug-resolving endpoint — works. Only the automatic fault path is
	 * strict (see _loadOne).
	 */
	loadOne(type, id) {
		return this._loadOne(type, id);
	}

	async _loadOne(type, id, strict = false) {
		const existing = this._typeMap(type).get(recordKey(id));
		const revisionAtDispatch = existing ? recordMutationRevision(existing) : undefined;
		// Dispatch order, so a response that lost the race cannot overwrite a newer
		// one that already landed on the same record.
		const gen = ++readStateFor(this).seq;
		let data;
		try {
			data = await this._adapterResult(this._adapterVerb(type, 'loadOne')(id));
		} catch (err) {
			// The one error the framework reads as a fact about the data rather than
			// about the request. Everything else (network, 5xx, 401) leaves the caches
			// untouched and stays retryable.
			if (err instanceof PuzzleAdapterError && err.status === 404) {
				const key = identityKey(type, id);
				if (key !== null) markAbsent(readStateFor(this), key);
			}
			throw err;
		}
		// Response-shape guard (mirrors loadAll): a null/array/non-object body would
		// slip through _upsert → _instantiate as a bogus record (200 null → an empty
		// record with a generated pk marked _synced; an array spreads indices as fields).
		if (data == null || typeof data !== 'object' || Array.isArray(data)) {
			throw new Error(`[puzzle] loadOne('${type}', id) expected a JSON object from the server`);
		}
		const pk = this.modelFor(type).primaryKey();
		if (data[pk] == null) {
			throw new Error(
				`[puzzle] loadOne('${type}', id) requires primary key "${pk}" on the record`
			);
		}
		// Identity guard (D161), checked BEFORE any mutation and only on the AUTOMATIC
		// fault path: there, a response for some other record leaves the requested id
		// still missing, so the settle loop re-requests it every round until the cap.
		// An explicit loadOne is one-shot — no storm to prevent — and may legitimately
		// resolve a non-primary key, so it takes whatever record the server returns.
		// Normalized, so a numeric id answering a string request is the same identity.
		if (strict && recordKey(data[pk]) !== recordKey(id)) {
			throw new Error(
				`[puzzle] loadOne('${type}', ${JSON.stringify(id)}) returned a record with primary key ${JSON.stringify(data[pk])} — the response must be the requested record`
			);
		}
		const record = this._upsert(type, data, revisionAtDispatch, gen);
		// _upsert clears the negative entry for the key the RESPONSE carried. On the
		// permissive path those keys can differ, so clear the REQUESTED one too — a
		// slug the server just resolved is not an absent identity. Redundant whenever
		// the response's primary key is the requested id, which is every strict call.
		clearAbsent(this, type, id);
		this._persist();
		return record;
	}

	/**
	 * Merge server-authoritative data into the Store without another GET (D21/D50).
	 * This is the public companion to request() for custom-action responses: existing
	 * records update in place; new records instantiate validation-exempt and synced.
	 *
	 * Every payload must be a JSON-object shape with an explicit primary key. The pk
	 * guard is load-bearing: private _upsert would otherwise generate an id and mark
	 * the phantom record synced, making its next save() PUT to a nonsense URL. Arrays
	 * preflight every element before mutation, then persist once for the whole batch.
	 */
	upsert(type, objectOrArray) {
		const isArray = Array.isArray(objectOrArray);
		const list = isArray ? objectOrArray : [objectOrArray];
		const pk = this.modelFor(type).primaryKey();

		for (const data of list) {
			if (data == null || typeof data !== 'object' || Array.isArray(data)) {
				throw new Error(
					isArray
						? `[puzzle] upsert('${type}') expected an array of JSON objects`
						: `[puzzle] upsert('${type}') expected a JSON object`
				);
			}
			if (data[pk] == null) {
				throw new Error(
					`[puzzle] upsert('${type}') requires primary key "${pk}" on every record`
				);
			}
		}

		const records = list.map((data) => this._upsert(type, data));
		this._persist();
		return isArray ? records : records[0];
	}

	// ---- tracked auto-fetch (D161) ---------------------------

	/**
	 * The tracked halves of the two queries — the only reads that can fault, and
	 * only ever called by a store handle. `requests` is the open evaluation's
	 * request map, handed in by that handle: never read off ambient state, which
	 * is the whole point. A null map is a local read, whoever is mid-evaluation
	 * elsewhere. Core's public `findOne`/`findMany` are the plain local reads and
	 * do not route through these, so a no-adapter bundle carries neither.
	 */
	_findOneTracked(type, id, requests) {
		const record = this._findOneLocal(type, id);
		if (!record && requests) this._faultOne(type, id, requests);
		return record;
	}

	_findManyTracked(type, options, requests) {
		// The collection, not the filter, is what can be missing: a filter is always
		// applied locally and is never serialized into a request.
		if (requests) this._faultMany(type, requests);
		return this._findManyLocal(type, options);
	}

	/**
	 * The per-subscriber STORE HANDLE — the channel a tracked read has to come
	 * through to be allowed to fault. PuzzleView mints one per view in its
	 * constructor and exposes it as `this.ctx.store`; nothing else does.
	 *
	 * It is a Proxy over the raw Store whose only real overrides are
	 * `findOne`/`findMany`, which pass this subscriber's currently-open request
	 * map (null when it has none) to the tracked forms. Everything else forwards
	 * to the raw store, and every forwarded METHOD is bound to it: `this === the
	 * raw Store` is load-bearing all over this module — readStateFor's WeakMap
	 * key, `_a`, `_asyncTrackingChain`, `_typeMap`, the subscription Maps — and
	 * none of that may end up shadowed onto a proxy.
	 *
	 * Returns null for a store with no adapter capability, which is what keeps an
	 * adapter-free app on the raw store with its `ctx.store === app.store`
	 * identity intact (D157).
	 */
	_handleFor(subscriber) {
		if (!this._a || !subscriber) return null;
		const cached = handleBySubscriber.get(subscriber);
		if (cached) return cached;

		const store = this;
		const hctx = { requests: null };
		const findOne = (type, id) => store._findOneTracked(type, id, hctx.requests);
		const findMany = (type, options) => store._findManyTracked(type, options, hctx.requests);
		// The dev nudge's call seam (D161). It lives HERE, not on Store.loadMany /
		// Store.loadOne, because that is where the identity is: a forwarded handle
		// method is bound to the raw store, so by the time the verb runs there is
		// nothing left to say which reference the caller held. Built only in dev,
		// so production keeps the plain forwarding path.
		let trackedLoadMany;
		let trackedLoadOne;
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			trackedLoadMany = (type, options) => {
				warnTrackedLoad(store, hctx, 'loadMany', 'findMany');
				return store._loadMany(type, options);
			};
			trackedLoadOne = (type, id) => {
				warnTrackedLoad(store, hctx, 'loadOne', 'findOne');
				return store._loadOne(type, id);
			};
		}
		// Bound methods are memoized per key, re-bound only if the underlying
		// function changes — installFixtures() swaps `_network` on the prototype
		// mid-session, so a permanently cached binding would outlive its source.
		const bound = new Map();
		const handle = new Proxy(store, {
			get(target, key) {
				if (key === 'findOne') return findOne;
				if (key === 'findMany') return findMany;
				if (trackedLoadMany && key === 'loadMany') return trackedLoadMany;
				if (trackedLoadOne && key === 'loadOne') return trackedLoadOne;
				if (key === STORE_RAW) return target;
				if (key === HANDLE_CTX) return hctx;
				const value = Reflect.get(target, key, target);
				if (typeof value !== 'function') return value;
				const entry = bound.get(key);
				if (entry && entry.raw === value) return entry.fn;
				const fn = value.bind(target);
				bound.set(key, { raw: value, fn });
				return fn;
			},
			set(target, key, value) {
				target[key] = value;
				return true;
			},
		});

		// The context rides on the SUBSCRIBER so Store.withTracking finds it by
		// identity, with no lookup table in core. Non-enumerable: a view's own
		// property surface must not grow a framework key.
		Object.defineProperty(subscriber, HANDLE_CTX, { value: hctx, configurable: true });
		handleBySubscriber.set(subscriber, handle);
		return handle;
	}

	/**
	 * The per-view ctx a PuzzleView reads through — the whole of D161's view-side
	 * mechanics, kept out of core so a no-adapter bundle carries none of it. The
	 * app's ctx is the prototype, so `router`, `formatters` and any other field
	 * stay LIVE rather than snapshotted, and only `store` is overridden.
	 *
	 * Always chained off the BASE ctx: a nested component is constructed with its
	 * parent's DERIVED ctx, and re-deriving from that would add one prototype link
	 * per level of nesting. The chain is therefore exactly two deep at any depth.
	 *
	 * Returns undefined for a store with no capability, so core's call site falls
	 * back to the app ctx itself — identity and all.
	 */
	_deriveCtx(ctx, view) {
		const handle = this._handleFor(view);
		if (!handle) return undefined;
		const base = ctx[CTX_BASE] ?? ctx;
		return Object.create(base, {
			store: { value: handle, enumerable: true },
			[CTX_BASE]: { value: base },
		});
	}

	/**
	 * Core Store calls this from findOne() when a tracked evaluation missed. It
	 * decides — with all the state that decision needs living out here — whether a
	 * request is owed, and records the one to wait for under its diagnostic key.
	 *
	 * Silent (no request, no entry) when: the id is nullish or unkeyable, the
	 * type's collection is known exhaustive, the identity is known absent, or the
	 * model declares no loadOne of its own and no endpoint (see faultVerb — an app-wide dialect
	 * alone never makes a local model fault). A pending identical request is
	 * joined rather than reissued.
	 */
	_faultOne(type, id, requests) {
		if (id == null) return;
		const key = identityKey(type, id);
		if (key === null) return;
		const state = readStateFor(this);
		// An EXHAUSTIVE collection already answered every id it omits, so a miss here
		// is a local fact, not a cache gap — pure local, same as a negative-cache hit
		// (D161). Without this, a stale link's id would fetch a detail GET whose 500
		// turns a known absence into a failed view. `loaded` is deliberately NOT the
		// test: an authored loadMany may have returned page one, and an id it left
		// out is a record that exists.
		if (state.complete.has(type)) return;
		if (isAbsent(state, key)) return;
		const inflight = state.one.get(key);
		if (inflight) {
			requests.set(key, inflight);
			return;
		}
		if (!faultVerb(this, type, 'loadOne')) return;

		const request = (async () => {
			try {
				await this._loadOne(type, id, true);
			} catch (err) {
				// A 404 is an answer: the identity is absent, the round resolves, and the
				// committed null means "does not exist". Everything else fails the run.
				if (!(err instanceof PuzzleAdapterError) || err.status !== 404) throw err;
			} finally {
				if (state.one.get(key) === request) state.one.delete(key);
			}
		})();
		state.one.set(key, request);
		request.catch(noop); // observed even if the pass that started it is discarded
		requests.set(key, request);
	}

	/**
	 * The findMany half. Having loaded is tracked independently of record
	 * presence: local records prove nothing about the rest of the collection, so
	 * the first tracked findMany on a type still loads it once. Filters stay
	 * local. This half asks only "has the collection request run?" — an authored
	 * loadMany answers that as well as a generated one, which is what keeps a
	 * paginated adapter from re-requesting page one on every settle pass.
	 */
	_faultMany(type, requests) {
		const state = readStateFor(this);
		if (state.loaded.has(type)) return;
		const inflight = state.many.get(type);
		if (inflight) {
			requests.set(type, inflight);
			return;
		}
		if (!faultVerb(this, type, 'loadMany')) return;

		const request = (async () => {
			try {
				await this._loadMany(type);
			} finally {
				// Failure clears the in-flight entry WITHOUT marking the type complete
				// (_loadMany marks it only on success), so a retry is a real retry.
				if (state.many.get(type) === request) state.many.delete(type);
			}
		})();
		state.many.set(type, request);
		request.catch(noop);
		requests.set(type, request);
	}

	async _adapterResult(result) {
		const value = await result;
		return isResponse(value) ? responseData(value) : value;
	}

	/**
	 * Create or update-in-place by primary key; notifies either way.
	 * @param {string} type
	 * @param {object} data
	 * @param {number} [throughRevision] D138 load-response revision boundary.
	 * Public callers use upsert(), which deliberately leaves this undefined.
	 * @param {number} [gen] D138 read-dispatch generation. Only loadOne/loadMany
	 * (and so the auto-fetch faults routed through them) pass it; save
	 * reconciliation, the public upsert(), and the rehydrate sweep do not
	 * participate in read ordering and deliberately leave it undefined.
	 */
	_upsert(type, data, throughRevision, gen) {
		const Model = this.modelFor(type);
		const pk = Model.primaryKey();
		// The JSON hydration boundary for EVERY read path: loadOne/loadMany (and so
		// D161's auto-fetch faults, which route through them), the public upsert(),
		// and the static-island rehydrate all land here. Revive declared date()
		// fields once, for both the merge and the instantiate branch below (see
		// coerceJSONDates).
		const fields = coerceJSONDates(Model, data);
		clearAbsent(this, type, fields?.[pk]); // present now, whichever branch below runs
		const existing = fields?.[pk] != null ? this._typeMap(type).get(recordKey(fields[pk])) : null;
		if (existing) {
			// A later read already landed here, so this response is stale for THIS
			// record: nothing merges, nothing notifies, _synced is left alone.
			if (gen !== undefined && (LOAD_GENERATIONS.get(existing) ?? 0) > gen) return existing;
			safeMerge(existing, fields, throughRevision);
			if (gen !== undefined) LOAD_GENERATIONS.set(existing, gen);
			existing._synced = true; // came from the server (constellation/doc/DOC-SPEC.md §22, D50)
			this._notify(type, fields[pk]);
			return existing;
		}
		const record = this._instantiate(type, fields);
		if (gen !== undefined) LOAD_GENERATIONS.set(record, gen);
		record._synced = true; // server-sourced → PUT on first save() (§22, D50)
		this._notify(type, record[pk]);
		return record;
	}

	// ---- server write path (constellation/doc/DOC-SPEC.md §22, D50) ------------

	/** Resolve the endpoint used by the unchanged store.request() escape hatch. */
	_requireEndpoint(type) {
		const endpoint = this.modelFor(type).adapter?.endpoint;
		if (!endpoint) {
			throw new Error(
				`[puzzle] no adapter declared for '${type}' — add static adapter = { endpoint: '/api/...' } to the model`
			);
		}
		return endpoint;
	}

	/**
	 * The ONE adapter fetch (v1.55/D91, extended by D158). Generated transports,
	 * the enhanced fetch given to author functions, and request() go through here,
	 * so `beforeRequest` attaches auth headers, credentials, or an AbortSignal to
	 * all of them at once. An author explicitly using global fetch bypasses it.
	 *
	 * The hook is SYNCHRONOUS and may either mutate `init` in place or return a
	 * replacement object; a truthy object return wins, otherwise the (possibly
	 * mutated) original is used. Both shapes are supported on purpose — mutation
	 * reads better for a header push, a return for a spread. A returned
	 * replacement is shallow-COPIED before the re-stamp below: the re-stamp must
	 * never write into an object the app owns, so `Object.freeze({ ...init })`
	 * and getter-only fields are supported shapes, not TypeErrors. `context` is
	 * frozen: it is information about the request, not a second output channel.
	 *
	 * `method` and `body` are RE-STAMPED from the original init after the hook
	 * runs. This is load-bearing, not defensive: the write path captures
	 * `requestKey = record[pk]` before the await and reconciles against exactly
	 * that key afterwards (§22, D50), so a hook that flipped POST→PUT or rewrote
	 * the body would silently break identity re-checks, pk adoption, and the
	 * synced-flag contract. The URL is a separate fetch argument, so it is out of
	 * the hook's reach by construction. Everything else — headers, signal,
	 * credentials, mode, cache — passes through untouched.
	 *
	 * A throwing hook is NOT caught: it is app code, and an auth error raised
	 * there must reject the calling verb rather than ship an unauthenticated
	 * request. Every caller is async, so the throw surfaces as a rejection.
	 *
	 * The network step itself is delegated to `_network` (D98), so dev/test
	 * tooling can intercept a request AFTER the hook has run without this method
	 * — or any verb above it — knowing such tooling exists.
	 *
	 * @param {RequestInfo | URL} url the author-supplied or generated request target
	 * @param {object} init     the fetch init this verb requires
	 * @param {object} context  { type, method, url } — frozen before the hook sees it
	 */
	_fetch(url, init, context) {
		const frozenContext = Object.freeze(context);
		if (!this.beforeRequest) return this._network(url, init, frozenContext);
		const method = init.method;
		const body = init.body;
		const returned = this.beforeRequest(init, frozenContext);
		const final =
			returned && typeof returned === 'object' && returned !== init ? { ...returned } : init;
		final.method = method;
		if (body === undefined) delete final.body;
		else final.body = body;
		return this._network(url, final, frozenContext);
	}

	/**
	 * The one place generated/enhanced adapter traffic touches the network (D98).
	 * Dev/test tooling replaces this method to serve requests from memory.
	 * `context` is the same frozen { type, method, url } _fetch built, so a
	 * replacement can dispatch per model type without re-deriving anything.
	 */
	_network(url, init, context) {
		return fetch(url, init);
	}

	/**
	 * Save a record to the server (constellation/doc/DOC-SPEC.md §22, D50). Called by
	 * record.save(); the Store owns the network.
	 *
	 * Order: validate the FULL record first (§20, D48) — invalid rejects with
	 * PuzzleValidationError and NO request is made. Then dispatch create for a
	 * never-synced record, update for a synced one (the generated defaults are
	 * POST apiURL+endpoint and PUT endpoint/:id). A non-OK Response
	 * rejects with PuzzleAdapterError and leaves local state untouched (still dirty;
	 * retry = call again). On 2xx a JSON-OBJECT body merges via the exempt upsert
	 * path (server-computed fields, no validation); 204/empty keeps local
	 * state. Server pk adoption: a FIRST save whose response carries a different pk
	 * re-keys the index atomically; an UPDATE-save with a differing pk warns and
	 * drops it from the merge. On success the record is marked synced.
	 *
	 * Concurrent writes on ONE record serialize through its write chain (see
	 * _chain): a second save waits for the first to settle, then re-evaluates
	 * wasSynced — so a double-click POSTs once then PUTs, never double-creates.
	 * A save that finds its record already removed when its turn comes sends
	 * nothing and rejects with the same message record.save() gives at call time —
	 * no write may create or revive a row for a record the app has discarded.
	 */
	saveRecord(record) {
		return this._chain(record, () => this._saveRecordNow(record));
	}

	/**
	 * Serialize one record's server writes — save AND delete — behind a single
	 * per-record chain. Both verbs mutate the SAME server row and the same map
	 * entry, so ordering them separately is not enough: an unchained delete
	 * racing a first save either orphans the row the POST creates or builds its
	 * URL from a client-side pk the POST is about to replace, and then removes
	 * nothing anywhere while resolving successfully.
	 *
	 * Each link reads the record's state when it REACHES the front of the queue,
	 * never when it was enqueued — that is what makes a queued delete see the
	 * adopted primary key and a queued save see a removal that happened while it
	 * waited.
	 *
	 * The prior link's rejection is swallowed FOR CHAINING ONLY; its own caller
	 * still observes it (they hold that promise). This holds ACROSS verbs: a
	 * queued delete does not inherit a failed save's rejection, and vice versa.
	 * Every caller observes exactly its own outcome.
	 */
	_chain(record, fn) {
		const chains = writeChainsFor(this);
		const prev = chains.get(record);
		const run = (prev ? prev.then(noop, noop) : Promise.resolve()).then(fn);
		chains.set(record, run);
		const cleanup = () => {
			if (chains.get(record) === run) chains.delete(record);
		};
		run.then(cleanup, cleanup);
		return run;
	}

	/** The actual save (network + merge); serialized per record by saveRecord(). */
	async _saveRecordNow(record) {
		// Removal check at RUN time, not call time: model.js's save() already
		// rejects a record that was gone when save() was called, but a queued save
		// can outlive its record — a delete or destroy() may land while it waits.
		// removeRecord is the only path that evicts a record from the type map (the
		// pk-adoption re-key below re-inserts synchronously), and it always sets
		// _deleted, so this flag alone is the whole guard: no map lookup, and no
		// chance of false-positiving a normal first save, which IS indexed under its
		// client-side key before the POST goes out.
		if (record._deleted) throw new Error(DELETED_SAVE_MESSAGE);

		const type = record._type;
		const Model = this.modelFor(type);
		const pk = Model.primaryKey();
		const wasSynced = record._synced;
		const transport = this._adapterVerb(type, wasSynced ? 'update' : 'create');

		// a. validate the full record BEFORE any network (§20, D48).
		const errors = Model._collectErrors(record.toJSON());
		if (errors.length) throw new PuzzleValidationError(errors);

		// b. Dispatch create for a never-synced record, update otherwise. The
		// transport owns the HTTP conversation; every reconciliation rule below is
		// framework-owned and therefore identical for generated and author verbs.
		// Capture the key the record is indexed under NOW, before the await — the
		// post-response identity check reconciles against exactly this key.
		const requestKey = recordKey(record[pk]);
		// Capture the local mutation revision beside the exact body sent. A later
		// update() advances the edited fields beyond this boundary, so the response
		// can still contribute untouched server fields without overwriting them.
		const requestRevision = recordMutationRevision(record);
		// Same JSON hydration boundary as _upsert: the echoed row is JSON, so its
		// declared date() fields are revived before any merge below. Non-object
		// bodies pass through untouched for the shape guards that follow.
		const body = coerceJSONDates(Model, await this._adapterResult(transport(record)));

		// c. success: merge a JSON-object body via the exempt path (no validation,
		// mirroring _upsert's update branch); 204/empty keeps local state.
		if (body != null && (typeof body !== 'object' || Array.isArray(body))) {
			throw new Error(
				`[puzzle] adapter ${wasSynced ? 'update' : 'create'}('${type}') expected a JSON object or nullish response`
			);
		}
		if (body != null && body[pk] == null) {
			throw new Error(
				`[puzzle] adapter ${wasSynced ? 'update' : 'create'}('${type}') requires primary key "${pk}" on the returned record`
			);
		}

		// Identity re-check (constellation/doc/DOC-SPEC.md §22, D50): the record may have
		// been removeRecord'd — or replaced at its key — while the request was in flight.
		// If it is no longer the indexed record at its request-time key, skip ALL local
		// reconciliation (no map ops, merge, _synced flip, notify, or persist) and resolve
		// with the detached record. A completed POST must never resurrect a destroyed one.
		const map = this._typeMap(type);
		if (map.get(requestKey) !== record) return record;

		const isObject = body != null;
		if (isObject) {
			const responsePk = body[pk];
			// Same normalization the index uses: a server echoing numeric 1 for a record
			// keyed '1' is NOT a pk change — it merges normally and the map key is
			// identical either way (the field still adopts the server's type).
			const pkDiffers = responsePk != null && recordKey(responsePk) !== recordKey(record[pk]);
			if (pkDiffers && !wasSynced) {
				// e. server pk adoption on a first save — the one sanctioned pk change,
				// performed by the store. Re-key atomically: assign the new pk DIRECTLY
				// (not via update(), which throws on pk change) and swap the map key.
				// Collision guard: if the assigned pk already indexes a DIFFERENT record,
				// reject with a plain Error — the HTTP request SUCCEEDED, only local
				// reconciliation failed, so NOT a PuzzleAdapterError — and leave both
				// records + the map untouched (the delete rides the success path only).
				const occupant = map.get(recordKey(responsePk));
				if (occupant && occupant !== record) {
					throw new Error(
						`[puzzle] save() response for '${type}' assigned primary key ${JSON.stringify(responsePk)}, which already belongs to a different record — refusing to overwrite it`
					);
				}
				const oldId = record[pk];
				map.delete(recordKey(oldId));
				// The server-assigned pk is the sanctioned identity change and must
				// always land. Reconcile every other field against requestRevision.
				const { [pk]: adoptedPk, ...rest } = body;
				safeMerge(record, { [pk]: adoptedPk });
				safeMerge(record, rest, requestRevision);
				map.set(recordKey(record[pk]), record);
				clearAbsent(this, type, record[pk]); // the adopted identity is present now
				record._synced = true;
				this._notify(type, oldId); // old key: subscribers of the gone id
				this._notify(type, record[pk]); // new key + collection
				this._persist();
				return record;
			}
			if (pkDiffers && wasSynced) {
				// An update-save must never change the pk — warn and drop it, merge rest.
				console.warn(
					`[puzzle] save() response for '${type}' carried a different primary key ${JSON.stringify(responsePk)} — ignoring; primary keys are immutable after creation`
				);
				const { [pk]: _ignored, ...rest } = body;
				safeMerge(record, rest, requestRevision);
			} else if (responsePk == null && pk in body) {
				// An explicit-null (or undefined) pk present in the body would blank the
				// record's local pk while the type map still keys it under the old id —
				// index desync + a _notify(type, null). Drop it; keep the local pk (normal,
				// no warn — an absent/missing pk in the body is expected).
				const { [pk]: _ignored, ...rest } = body;
				safeMerge(record, rest, requestRevision);
			} else {
				safeMerge(record, body, requestRevision);
			}
			// _synced is server-provenance, not a clean/dirty bit: this request
			// succeeded even when a newer local field was intentionally preserved.
			// Keeping it true also makes a queued follow-up PUT instead of POSTing a
			// duplicate after a successful first save.
			record._synced = true;
			this._notify(type, record[pk]);
			this._persist();
			return record;
		}

		// 204 / empty body: keep local state, mark synced.
		record._synced = true;
		this._persist();
		return record;
	}

	/**
	 * Confirmed server delete (constellation/doc/DOC-SPEC.md §22, D50). Called by
	 * record.delete(). Dispatches the delete transport, then removes locally. The
	 * generated DELETE endpoint/:id treats 404 as already gone. A returned non-OK
	 * Response rejects with PuzzleAdapterError and the record stays.
	 *
	 * Serialized behind the record's write chain (see _chain), so a delete fired
	 * during a save waits for it: the URL below is then built from the primary key
	 * the save reconciled, which is the row the server actually created.
	 *
	 * Two cases resolve without a request: a record already removed when the turn
	 * comes (idempotent), and a NEVER-SYNCED record, which the server has no row
	 * for — that one is removed locally, so a `delete()` on a freshly created
	 * record is a local removal, not a doomed DELETE that can reject.
	 */
	deleteRecord(record) {
		return this._chain(record, () => this._deleteRecordNow(record));
	}

	/** The actual delete (network + removal); serialized per record by deleteRecord(). */
	async _deleteRecordNow(record) {
		// a. already gone when this link reaches the front — a second delete, or a
		// destroy()/delete() that landed while this one waited. Resolve idempotently
		// with the detached record, exactly as model.js's call-time check does, and
		// send nothing: the row is either already deleted or never existed.
		if (record._deleted || !record._store) return record;

		const type = record._type;
		const Model = this.modelFor(type);
		const pk = Model.primaryKey();
		// Resolve the verb FIRST, before the never-synced short-circuit below:
		// delete() is the server verb, so a partial adapter still reports its missing
		// delete transport rather than quietly behaving like destroy().
		const transport = this._adapterVerb(type, 'delete');

		// b. never round-tripped with the server — nothing exists to DELETE. Remove
		// locally (notifying as usual) and skip the network: the request could only
		// 404, or worse 4xx on an id the server has never issued, and a rejection
		// there would strand a record the app has already discarded.
		if (!record._synced) {
			this.removeRecord(record);
			return record;
		}

		// Capture the key the record is indexed under NOW, before the await — the
		// post-response identity check reconciles against exactly this key.
		const requestKey = recordKey(record[pk]);

		await this._adapterResult(transport(record));
		// Identity re-check (mirrors saveRecord's, constellation/doc/DOC-SPEC.md §22):
		// while the delete transport was in flight, THIS record may have been destroyed
		// locally and a NEWER record created under the same id. removeRecord
		// unconditionally evicts the id, so without this guard an in-flight delete of A
		// would evict an unrelated B that reused A's id.
		if (this._typeMap(type).get(requestKey) === record) {
			// notifies as usual, and records the identity absent (D161) — so does the
			// never-synced branch above, and so does a local destroy().
			this.removeRecord(record);
		}
		return record;
	}

	/**
	 * Custom-endpoint escape hatch (constellation/doc/DOC-SPEC.md §22, D50): fetch
	 * apiURL + adapter.endpoint + path, JSON in (body is JSON-encoded when provided,
	 * Content-Type added, caller headers merged) and JSON out. Non-OK rejects with
	 * PuzzleAdapterError; 204/empty resolves null; otherwise resolves the parsed
	 * body. The documented idiom wraps this in model instance methods.
	 */
	async request(type, path = '', { method = 'GET', body, headers } = {}) {
		const endpoint = this._requireEndpoint(type);
		const init = { method, headers: { ...(headers || {}) } };
		if (body !== undefined) {
			init.body = JSON.stringify(body);
			init.headers['Content-Type'] = 'application/json';
		}
		const url = this.apiURL + endpoint + path;
		const res = await this._fetch(url, init, { type, method, url });
		if (!res.ok) {
			throw new PuzzleAdapterError(res.status, res.statusText, await readBody(res));
		}
		const parsed = await readBody(res);
		return parsed === undefined ? null : parsed;
	}
}

class AdapterModelMethods {
	/**
	 * Sync this record to the server (constellation/doc/DOC-SPEC.md §22, D50). The
	 * Store owns the network; the verb just delegates. Local-first: the mutation is
	 * already on screen, so a failed save() rejects and keeps the dirty local state
	 * (retry by calling again). A deleted record cannot be resurrected through this
	 * verb; any other store-less record has nowhere to sync. Both reject asynchronously
	 * (never a sync throw) so callers only ever `await`.
	 * @returns {Promise<PuzzleModel>}
	 */
	save() {
		if (this._deleted) {
			return Promise.reject(new Error(DELETED_SAVE_MESSAGE));
		}
		if (!this._store) {
			return Promise.reject(
				new Error('[puzzle] cannot save() a store-less record — create it via store.createRecord() first')
			);
		}
		return this._store.saveRecord(this);
	}

	/**
	 * Confirmed server delete (constellation/doc/DOC-SPEC.md §22, D50): DELETE first,
	 * local remove on ack. Distinct from destroy() (local-only). A removed instance
	 * resolves idempotently; a never-added instance still rejects asynchronously.
	 * @returns {Promise<PuzzleModel>}
	 */
	delete() {
		if (this._deleted) return Promise.resolve(this);
		if (!this._store) {
			return Promise.reject(
				new Error('[puzzle] cannot delete() a record that was never added to a store')
			);
		}
		return this._store.deleteRecord(this);
	}
}

/**
 * The view half of the capability (D161). PuzzleView holds the CALL SEAM — the
 * settle window's token, the dirty flag, and one branch per entry point — while
 * the loop itself lives here: without an adapter no query can fault, so a pass's
 * request map can never fill and an app that ships no adapter must not ship the
 * loop either (D157). Installed onto the prototype, so refresh(), preload(),
 * prepareRefresh(), nested/skeleton mounting, prerender and static mounting all
 * reach the one implementation.
 */
class AdapterViewMethods {
	/**
	 * Run data() until it queries nothing it has to fetch (D161).
	 *
	 * Each pass evaluates data() with its OWN request map and its own held
	 * subscription reconciliation. A pass that queued nothing is the committed one:
	 * its subscriptions are adopted (or parked for a D146 prepare) and its model
	 * returned. A pass that queued requests is provisional — its subscriptions are
	 * unwound once the batch settles, and data() runs again against the records
	 * that landed. Dependent reads (post → post.authorId → author) therefore settle
	 * across rounds, while queries discovered in the same pass fetch in parallel.
	 *
	 * Returns the model synchronously when the FIRST pass is synchronous and clean,
	 * which is what keeps a hit-only data() free of a skeleton (D39).
	 *
	 * @param {function(): any} run             the data() invocation, re-runnable
	 * @param {function(): boolean} isStale     stop without committing (destroyed,
	 *   leaving, or superseded by a newer run) — shared in-flight requests are
	 *   deliberately NOT aborted; other consumers may still need them
	 * @param {?object} parked  D146 held-eval channel; when given, the final pass's
	 *   reconcile is parked on it for the caller's commit/discard decision
	 * @param {number} [token]  the refresh run this loop belongs to. Opens the
	 *   settle window (`_settlingToken`) for its lifetime, so a store notification
	 *   arriving mid-run sets the dirty flag instead of starting a competing
	 *   refresh. A PREPARED run passes none: while the D146 gate is open the
	 *   ancestor still shows its committed route and must keep taking live updates.
	 */
	_settleData(store, run, expectsAsync, isStale, parked, token) {
		let rounds = 0;
		const owns = !parked;
		if (owns) {
			this._settlingToken = token;
			this._settleDirty = false;
		}
		// This run still holds the settle window it opened. A SUPERSEDED run (a newer
		// refresh reopened the window under its own token) may no longer touch
		// `_settleDirty`: the flag it would clear is the newer run's deferred store
		// notification, and clearing it drops that update until an unrelated later
		// write. Every write to the flag below is gated on this, exactly as close() is.
		const ownsWindow = () => owns && this._settlingToken === token;
		const close = (value) => {
			if (ownsWindow()) {
				this._settlingToken = 0;
				const folded = this._settleDirty;
				this._settleDirty = false;
				// A folded notification is only DELIVERED by the pass that commits
				// (the extra round in afterPass below). A run that closes the window
				// still carrying one never committed — it was superseded by a D146
				// prepared commit, went stale, or failed — and the model now on screen
				// predates that store change. Hand the notification back rather than
				// swallow it; onStoreChange re-folds it into whatever run owns the
				// window by then, or refreshes. Deferred so this never re-enters the
				// loop ahead of its own caller's commit.
				if (folded) queueMicrotask(() => this.onStoreChange());
			}
			return value;
		};

		const afterPass = (model, requests, channel, mark) => {
			if (isStale()) {
				channel.reconcile?.(false);
				return undefined;
			}
			if (requests.size === 0) {
				// A store change delivered during this run (PuzzleView's onStoreChange sets
				// the flag rather than refreshing)
				// takes one more pass here rather than a second competing refresh.
				if (ownsWindow() && this._settleDirty) {
					this._settleDirty = false;
					channel.reconcile?.(false);
					return pass();
				}
				if (parked) parked.reconcile = channel.reconcile;
				else {
					channel.reconcile?.(true);
					// This pass is the committed one, so every notification the store
					// had already queued when it started is baked into `model` — most
					// of them this run's OWN upserts, whose flush lands after the
					// subscriptions above go live. Record the boundary so that flush
					// does not buy a third data() run and a second render of identical
					// content (D161). Only an owning run marks: a prepared run's model
					// is not on screen until its commit.
					this._settleMark = mark;
				}
				return model;
			}
			if (++rounds > MAX_SETTLE_ROUNDS) {
				channel.reconcile?.(false);
				throw new Error(
					`[puzzle] ${this.constructor.name}: data() still needed server data after ${MAX_SETTLE_ROUNDS} settle rounds — last round requested ${[...requests.keys()].join(', ')}`
				);
			}
			return Promise.all(requests.values()).then(
				() => {
					// Release this pass's hold BEFORE the next pass runs: a held key still
					// looks live to the committing pass's reconciliation, so an unreleased
					// intermediate branch would strand subscriptions the final pass dropped.
					channel.reconcile?.(false);
					// Clearing the dirty flag is only earned by the pass about to run —
					// that pass is what delivers the folded change. A run that stops here
					// leaves the flag set for close() to hand back, or the change is lost.
					if (isStale()) return undefined;
					if (ownsWindow()) this._settleDirty = false;
					return pass();
				},
				(err) => {
					channel.reconcile?.(false);
					if (isStale()) return undefined;
					throw err;
				}
			);
		};

		const pass = () => {
			const requests = new Map();
			const channel = {};
			// The store's notification sequence as this pass begins (see the commit
			// branch in afterPass). Read before data() runs, so it can only be
			// conservative: a change queued later is delivered, never dropped.
			const mark = store._notifySeq ?? 0;
			// Re-read the sticky shape flag per pass, not once for the loop: a
			// .then-style data() only reveals itself by returning a promise, and the
			// pass that revealed it must not leave the NEXT round still hinting sync
			// (D161 — see PuzzleView._dataAsyncShape).
			const result = store.withTracking(
				this,
				run,
				expectsAsync || this._dataAsyncShape,
				channel,
				requests
			);
			return result && typeof result.then === 'function'
				? result.then((model) => afterPass(model, requests, channel, mark))
				: afterPass(result, requests, channel, mark);
		};

		let out;
		try {
			out = pass();
		} catch (err) {
			close();
			throw err;
		}
		return out && typeof out.then === 'function'
			? out.then(close, (err) => {
					close();
					throw err;
				})
			: close(out);
	}
}

function installMethods(target, source) {
	const descriptors = Object.getOwnPropertyDescriptors(source.prototype);
	delete descriptors.constructor;
	Object.defineProperties(target.prototype, descriptors);
}

function installAdapter() {
	if (installed) return;
	installMethods(Store, AdapterStoreMethods);
	installMethods(PuzzleModel, AdapterModelMethods);
	installMethods(PuzzleView, AdapterViewMethods);
	installed = true;
}

function createDefaultsCapability(verbs = {}) {
	// Unconditional, production included: an app-wide loadAll default silently
	// covers every model, so a missed rename would look like a working app whose
	// collections never load (D161).
	if (verbs && Object.prototype.hasOwnProperty.call(verbs, LEGACY_LOAD_ALL)) {
		throw legacyLoadAllError('adapter.defaults({ loadAll })');
	}
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		validateAdapterDefaults(verbs);
	}
	return createAdapterCapability({ install: installAdapter, d: verbs });
}

/** Opaque app-config capability; its internal install is idempotent. */
export const adapter = createAdapterCapability({
	install: installAdapter,
	defaults: createDefaultsCapability,
});

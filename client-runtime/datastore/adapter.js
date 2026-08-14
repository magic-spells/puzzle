/**
 * Opt-in server adapter runtime (D157).
 *
 * Importing this module has no side effects. Passing the exported capability
 * to PuzzleApp installs the server surface on Store and PuzzleModel; apps that
 * never pass it keep the entire implementation out of their bundle.
 */

import { createAdapterCapability } from '../capabilities.js';
import { Store } from './store.js';
import {
	PuzzleModel,
	PuzzleValidationError,
	recordKey,
	recordMutationRevision,
	safeMerge,
} from '../model.js';

const DELETED_SAVE_MESSAGE = '[puzzle] cannot save a deleted record';
const ADAPTER_VERBS = ['loadAll', 'loadOne', 'create', 'update', 'delete'];

const noop = () => {};
const writeChainsByStore = new WeakMap();
const adapterBindingsByStore = new WeakMap();
const warnedAdapterConfigs = new WeakSet();
let installed = false;

function validateAdapterConfig(type, Model, config) {
	if (!config || typeof config !== 'object' || Array.isArray(config)) return;
	const invalid = Object.entries(config)
		.filter(([key, value]) => key !== 'endpoint' && typeof value !== 'function')
		.map(([key]) => key);
	if (!invalid.length || warnedAdapterConfigs.has(Model)) return;
	warnedAdapterConfigs.add(Model);
	console.warn(
		`[puzzle] model '${type}' has invalid adapter ${invalid.length === 1 ? 'key' : 'keys'} ${invalid
			.map((key) => JSON.stringify(key))
			.join(', ')} — adapter keys must be "endpoint" or functions`
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

function isResponse(value) {
	return typeof Response !== 'undefined' && value instanceof Response;
}

async function generatedTransport(type, url, verb, fetch, arg) {
	let method;
	let body;
	if (verb === 'loadAll') {
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
	if (verb === 'loadAll' || verb === 'loadOne') {
		if (!response.ok) {
			throw new Error(`[puzzle] load '${type}' failed: ${response.status} ${response.statusText}`);
		}
		return readBody(response);
	}
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

class AdapterStoreMethods {
	// ---- adapter dispatch + bound author surface (D158) -------

	/**
	 * Return the model adapter with every author function bound to this model's
	 * enhanced fetch. When endpoint shorthand is present, missing standard verbs
	 * are filled with generated REST transports. Stable per store+type.
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
			bound[key] = typeof value === 'function' ? (...args) => value(fetch, ...args) : value;
		}
		if (config.endpoint) {
			const url = this.apiURL + config.endpoint;
			for (const verb of ADAPTER_VERBS) {
				if (typeof bound[verb] !== 'function') {
					bound[verb] = (arg) => generatedTransport(type, url, verb, fetch, arg);
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
	 * GET apiURL + adapter.endpoint and upsert every record in the response.
	 * Records with matching primary keys are updated in place — no duplicates.
	 * Subscribers are notified as data lands (batched, as usual).
	 */
	async loadAll(type, options) {
		const pk = this.modelFor(type).primaryKey();
		const revisionsAtDispatch = new Map(
			Array.from(this._typeMap(type).values(), (record) => [
				recordKey(record[pk]),
				recordMutationRevision(record),
			])
		);
		const list = await this._adapterResult(this._adapterVerb(type, 'loadAll')(options));
		if (!Array.isArray(list)) {
			throw new Error(`[puzzle] loadAll('${type}') expected a JSON array from the server`);
		}
		// Per-element shape guard (mirrors loadOne): validate EVERY entry up front,
		// before any upsert, so a null/array/non-object mid-array can't half-apply
		// the response — a null would slip through _upsert → _instantiate as a
		// phantom record with a generated pk marked _synced; a string would spread
		// its indices as fields.
		for (const data of list) {
			if (data == null || typeof data !== 'object' || Array.isArray(data)) {
				throw new Error(
					`[puzzle] loadAll('${type}') expected an array of JSON objects from the server`
				);
			}
			if (data[pk] == null) {
				throw new Error(
					`[puzzle] loadAll('${type}') requires primary key "${pk}" on every record`
				);
			}
		}
		const records = list.map((data) =>
			this._upsert(type, data, revisionsAtDispatch.get(recordKey(data[pk])))
		);
		this._persist();
		return records;
	}

	/** GET apiURL + adapter.endpoint + '/' + id and upsert the single record. */
	async loadOne(type, id) {
		const existing = this._typeMap(type).get(recordKey(id));
		const revisionAtDispatch = existing ? recordMutationRevision(existing) : undefined;
		const data = await this._adapterResult(this._adapterVerb(type, 'loadOne')(id));
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
		const record = this._upsert(type, data, revisionAtDispatch);
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
	 */
	_upsert(type, data, throughRevision) {
		const pk = this.modelFor(type).primaryKey();
		const existing = data?.[pk] != null ? this._typeMap(type).get(recordKey(data[pk])) : null;
		if (existing) {
			safeMerge(existing, data, throughRevision);
			existing._synced = true; // came from the server (constellation/doc/DOC-SPEC.md §22, D50)
			this._notify(type, data[pk]);
			return existing;
		}
		const record = this._instantiate(type, data);
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
		const body = await this._adapterResult(transport(record));

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
			this.removeRecord(record); // notifies as usual
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

function installMethods(target, source) {
	const descriptors = Object.getOwnPropertyDescriptors(source.prototype);
	delete descriptors.constructor;
	Object.defineProperties(target.prototype, descriptors);
}

function installAdapter() {
	if (installed) return;
	installMethods(Store, AdapterStoreMethods);
	installMethods(PuzzleModel, AdapterModelMethods);
	installed = true;
}

/** Opaque app-config capability; its internal install is idempotent. */
export const adapter = createAdapterCapability(installAdapter);

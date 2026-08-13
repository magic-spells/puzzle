/**
 * Opt-in server adapter runtime (D157).
 *
 * Importing this module has no side effects. The first adapter(config) call
 * installs the server surface on Store and PuzzleModel; apps that never call
 * the factory keep the entire implementation out of their bundle.
 */

import { Store } from './store.js';
import {
	PuzzleModel,
	PuzzleValidationError,
	recordKey,
	recordMutationRevision,
	safeMerge,
} from '../model.js';

const DELETED_SAVE_MESSAGE = '[puzzle] cannot save a deleted record';

const noop = () => {};
const adapterConfigs = new WeakSet();
const writeChainsByStore = new WeakMap();
let installed = false;
let warnedBareConfig = false;

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

function writeChainsFor(store) {
	let chains = writeChainsByStore.get(store);
	if (!chains) {
		chains = new WeakMap();
		writeChainsByStore.set(store, chains);
	}
	return chains;
}

class AdapterStoreMethods {
	// ---- server read path (D21) ------------------------------

	/**
	 * GET apiURL + adapter.endpoint and upsert every record in the response.
	 * Records with matching primary keys are updated in place — no duplicates.
	 * Subscribers are notified as data lands (batched, as usual).
	 */
	async loadAll(type) {
		const pk = this.modelFor(type).primaryKey();
		const revisionsAtDispatch = new Map(
			Array.from(this._typeMap(type).values(), (record) => [
				recordKey(record[pk]),
				recordMutationRevision(record),
			])
		);
		const list = await this._fetchAdapter(type, '');
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
		const data = await this._fetchAdapter(type, '/' + encodeURIComponent(id));
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

	async _fetchAdapter(type, suffix) {
		const endpoint = this._requireEndpoint(type);
		// An explicit `{ method: 'GET' }` rather than a bare fetch(url): identical on
		// the wire, and it hands beforeRequest the same init shape every other verb
		// passes, so a hook never has to special-case the read path (v1.55, D91).
		const url = this.apiURL + endpoint + suffix;
		const res = await this._fetch(url, { method: 'GET' }, { type, method: 'GET', url });
		if (!res.ok) {
			throw new Error(`[puzzle] load '${type}' failed: ${res.status} ${res.statusText}`);
		}
		return readBody(res);
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

	/**
	 * Resolve a model's adapter endpoint or throw the D21 no-adapter message.
	 * Shared by the read path (_fetchAdapter) and the write verbs; every caller
	 * is async, so this throw becomes a rejected promise — never a sync throw
	 * at the call site.
	 */
	_requireEndpoint(type) {
		const config = this.modelFor(type).adapter;
		if (
			(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) &&
			config &&
			typeof config === 'object' &&
			!adapterConfigs.has(config) &&
			!warnedBareConfig
		) {
			warnedBareConfig = true;
			console.warn(
				"[puzzle] bare static adapter config detected — import { adapter } from " +
					"'@magic-spells/puzzle/adapter' and wrap it: static adapter = adapter({ endpoint: '/api/...' })"
			);
		}
		const endpoint = config?.endpoint;
		if (!endpoint) {
			throw new Error(
				`[puzzle] no adapter declared for '${type}' — add static adapter = adapter({ endpoint: '/api/...' }) to the model`
			);
		}
		return endpoint;
	}

	/**
	 * The ONE adapter fetch (v1.55, D91). Every server call — the D21 read path
	 * (loadAll/loadOne), the D50 write verbs (save/delete), and request() — goes
	 * through here, so `beforeRequest` is the single place an app attaches auth
	 * headers, `credentials`, or an AbortSignal to all of them at once.
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
	 * @param {string} url      the fully built request URL
	 * @param {object} init     the fetch init this verb requires
	 * @param {object} context  { type, method, url } — frozen before the hook sees it
	 */
	_fetch(url, init, context) {
		if (!this.beforeRequest) return this._network(url, init, context);
		const method = init.method;
		const body = init.body;
		const returned = this.beforeRequest(init, Object.freeze(context));
		const final =
			returned && typeof returned === 'object' && returned !== init ? { ...returned } : init;
		final.method = method;
		if (body === undefined) delete final.body;
		else final.body = body;
		return this._network(url, final, context);
	}

	/**
	 * The one place an adapter request touches the network (D98). Dev/test
	 * tooling — the /fixtures module's mock adapter — replaces this method to
	 * serve requests from memory; nothing else calls it. `context` is the same
	 * frozen { type, method, url } _fetch built, so a replacement can dispatch
	 * per model type without re-deriving anything.
	 */
	_network(url, init, context) {
		return fetch(url, init);
	}

	/**
	 * Save a record to the server (constellation/doc/DOC-SPEC.md §22, D50). Called by
	 * record.save(); the Store owns the network.
	 *
	 * Order: validate the FULL record first (§20, D48) — invalid rejects with
	 * PuzzleValidationError and NO request is made. Then POST apiURL+endpoint for a
	 * never-synced record, PUT endpoint/:id for a synced one. A non-OK response
	 * rejects with PuzzleAdapterError and leaves local state untouched (still dirty;
	 * retry = call again). On 2xx a JSON-OBJECT body merges via the exempt upsert
	 * path (server-computed fields, no validation); 204/empty/non-object keeps local
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
		const endpoint = this._requireEndpoint(type);
		const pk = Model.primaryKey();

		// a. validate the full record BEFORE any network (§20, D48).
		const errors = Model._collectErrors(record.toJSON());
		if (errors.length) throw new PuzzleValidationError(errors);

		// b. POST (create) for a never-synced record, PUT (update) otherwise.
		// Capture the key the record is indexed under NOW, before the await — the
		// post-response identity check reconciles against exactly this key.
		const wasSynced = record._synced;
		const requestKey = recordKey(record[pk]);
		const url = wasSynced
			? this.apiURL + endpoint + '/' + encodeURIComponent(record[pk])
			: this.apiURL + endpoint;
		const method = wasSynced ? 'PUT' : 'POST';
		// Capture the local mutation revision beside the exact body sent. A later
		// update() advances the edited fields beyond this boundary, so the response
		// can still contribute untouched server fields without overwriting them.
		const requestRevision = recordMutationRevision(record);
		const requestBody = JSON.stringify(record.toJSON());
		const res = await this._fetch(
			url,
			{
				method,
				headers: { 'Content-Type': 'application/json' },
				body: requestBody,
			},
			{ type, method, url }
		);

		// c. failure: reject; local state stays dirty, unchanged.
		if (!res.ok) {
			throw new PuzzleAdapterError(res.status, res.statusText, await readBody(res));
		}

		// d. success: merge a JSON-object body via the exempt path (no validation,
		// mirroring _upsert's update branch); 204/empty/non-object keeps local state.
		const body = await readBody(res);

		// Identity re-check (constellation/doc/DOC-SPEC.md §22, D50): the record may have
		// been removeRecord'd — or replaced at its key — while the request was in flight.
		// If it is no longer the indexed record at its request-time key, skip ALL local
		// reconciliation (no map ops, merge, _synced flip, notify, or persist) and resolve
		// with the detached record. A completed POST must never resurrect a destroyed one.
		const map = this._typeMap(type);
		if (map.get(requestKey) !== record) return record;

		const isObject = body != null && typeof body === 'object' && !Array.isArray(body);
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

		// 204 / empty / non-object body: keep local state, mark synced.
		record._synced = true;
		this._persist();
		return record;
	}

	/**
	 * Confirmed server delete (constellation/doc/DOC-SPEC.md §22, D50). Called by
	 * record.delete(). DELETE endpoint/:id, then remove locally via the normal
	 * notify path on 2xx OR 404 (already gone — idempotent). Any other status
	 * rejects with PuzzleAdapterError and the record stays.
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
		// Endpoint FIRST, before the never-synced short-circuit below: delete() is
		// the server verb, so a model with no adapter reports that the same way it
		// always has rather than quietly behaving like destroy().
		const endpoint = this._requireEndpoint(type);
		const pk = Model.primaryKey();

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

		const url = this.apiURL + endpoint + '/' + encodeURIComponent(record[pk]);
		const res = await this._fetch(url, { method: 'DELETE' }, { type, method: 'DELETE', url });
		if (res.ok || res.status === 404) {
			// Identity re-check (mirrors saveRecord's, constellation/doc/DOC-SPEC.md §22):
			// while the DELETE was in flight, THIS record may have been destroyed locally
			// and a NEWER record created under the same id. removeRecord unconditionally
			// evicts the id, so without this guard an in-flight delete of A would evict an
			// unrelated B that reused A's id. Only remove when this instance still indexes
			// the request-time key.
			if (this._typeMap(type).get(requestKey) === record) {
				this.removeRecord(record); // notifies as usual
			}
			return record;
		}
		throw new PuzzleAdapterError(res.status, res.statusText, await readBody(res));
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

/**
 * Validate and brand a model adapter config, installing the opt-in runtime on
 * first use. The exact config object is returned for static adapter = adapter(…).
 */
export function adapter(config) {
	installAdapter();
	if (config == null || typeof config !== 'object' || Array.isArray(config)) {
		throw new TypeError('[puzzle] adapter(config) expects an object with a string endpoint');
	}
	if (typeof config.endpoint !== 'string' || config.endpoint.length === 0) {
		throw new TypeError('[puzzle] adapter(config) requires a non-empty string endpoint');
	}
	adapterConfigs.add(config);
	return config;
}

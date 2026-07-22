/**
 * Store — the reactive datastore (constellation/doc/DOC-SPEC.md §8, constellation/doc/DOC-RUNTIME-KERNEL.md).
 *
 * Records ARE instances of the registered model classes (PuzzleModel
 * subclasses). Queries made inside a tracking scope (a component's data()
 * evaluation) auto-subscribe the subscriber; record changes notify — batched —
 * so subscribed components re-run data().
 *
 * Subscription keys are two-level: `type` (collection) and `type id`
 * (single record). createRecord/update/destroy notify both levels, so
 * findMany('todo') re-runs on any todo change while findOne('user', 7)
 * only re-runs for user 7.
 *
 * Rewritten from the prototype per constellation/doc/DOC-CODE-REVIEW.md §2.6: models registry,
 * schema defaults + primary-key handling, findMany filter option, query
 * auto-subscription, collection-level subscriptions, notify-after-delete,
 * optional (injectable) persistence.
 */

import { PuzzleModel, PuzzleValidationError, safeMerge } from '../model.js';

const REC_SEP = ' '; // never appears in a type name
const noop = () => {}; // swallows a chained save()'s rejection (§22, D50)

/**
 * Thrown by the write verbs — saveRecord/deleteRecord/request — when the server
 * responds non-OK (constellation/doc/DOC-SPEC.md §22, D50). `.status`/`.statusText`
 * echo the HTTP response; `.body` is the parsed JSON when the body parses as JSON,
 * else the raw text, else undefined (empty body). The D21 read path deliberately
 * keeps its plain-Error messages — only the new write verbs carry this shape.
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

/**
 * Read a fetch Response body once: parsed JSON when it parses, raw text when it
 * doesn't, undefined when empty/unreadable (covers 204). Used by every write verb
 * for both the merge path and PuzzleAdapterError's `.body`.
 */
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

// Marks which relationship names a model prototype has already had installed —
// getter install is idempotent so a class shared across stores (tests) is wired
// exactly once (constellation/doc/DOC-SPEC.md §21, D49).
const RELS_INSTALLED = Symbol('puzzleRelationshipsInstalled');

export class Store {
	/**
	 * @param {object} models   type name → model class (from PuzzleApp config)
	 * @param {object} options  { storage, storageKey, apiURL } — storage is any
	 *   Storage-like object (getItem/setItem); pass window.localStorage to
	 *   persist. apiURL is the base for the D21 server read path.
	 */
	constructor(models = {}, options = {}) {
		this.models = models;
		this.storage = options.storage || null;
		this.storageKey = options.storageKey || 'puzzle-store';
		this.apiURL = options.apiURL || '';

		this.recordsByType = new Map(); // type → Map(id → record)
		this.subscribersByKey = new Map(); // key → Set(subscriber)
		this.keysBySubscriber = new Map(); // subscriber → Set(key), for cheap reset

		this._tracking = null; // current subscriber during data() evaluation
		this._asyncTrackingChain = null; // in-flight async tracked eval, or null
		this._trackingAdded = null; // keys the in-flight eval has queried (transactional reset)
		this._pendingKeys = new Set();
		this._flushScheduled = false;
		this._flushTimer = null; // armed fallback timer (D63); cleared by flush()
		this._persistPending = false; // dirty flag: storage write is batched into flush()
		this._saveChains = new WeakMap(); // record → in-flight save() promise (§22, D50)

		this._installRelationships();

		if (this.storage) this._load();
	}

	// ---- model plumbing ----------------------------------------------------

	modelFor(type) {
		return this.models[type] || PuzzleModel;
	}

	// ---- relationships (constellation/doc/DOC-SPEC.md §21, D49) ---------------

	/**
	 * Install a lazy prototype getter on each registered model for every
	 * declared `belongsTo`/`hasMany` relationship. A relationship only means
	 * something relative to a registry, so this is the Store's job, done once at
	 * construction. The foreign key is inferred HERE — the registry key (`type`)
	 * is known — so `belongsTo` → `<relationshipName>Id` and `hasMany` →
	 * `<ownerType>Id`; `{ key }` overrides. See constellation/doc/DOC-SPEC.md §21.
	 *
	 * Single-store assumption: the getter is installed on the shared class
	 * prototype. Resolution routes through the RECORD's own `_store`, so records
	 * belonging to different stores still resolve against their own store; only
	 * the accessor definition is shared (and idempotent, guarded by
	 * RELS_INSTALLED — a class registered in two stores is wired once).
	 */
	_installRelationships() {
		for (const [type, Model] of Object.entries(this.models)) {
			if (typeof Model.relationshipDefs !== 'function') continue;
			const defs = Model.relationshipDefs();
			for (const [name, def] of Object.entries(defs)) {
				this._defineRelationship(Model, type, name, def);
			}
		}
	}

	_defineRelationship(Model, type, name, def) {
		const proto = Model.prototype;
		const installed = Object.prototype.hasOwnProperty.call(proto, RELS_INSTALLED)
			? proto[RELS_INSTALLED]
			: (proto[RELS_INSTALLED] = new Set());
		if (installed.has(name)) return; // idempotent across stores
		installed.add(name);

		// FK by convention (constellation/doc/DOC-SPEC.md §21): belongsTo uses the
		// relationship name; hasMany uses the OWNER's registry type. `{ key }` wins.
		const fkKey = def.key || (def.kind === 'belongsTo' ? name + 'Id' : type + 'Id');
		let warned = false; // warn-once per class+relationship on assignment

		Object.defineProperty(proto, name, {
			configurable: true,
			enumerable: false, // never own-enumerable → excluded from toJSON()'s spread
			get() {
				// Resolution is an ordinary query, so a traversal inside a tracked
				// data() auto-subscribes exactly like the manual join it replaces.
				if (def.kind === 'belongsTo') {
					if (!this._store) return null;
					const fk = this[fkKey];
					// Short-circuit a null/undefined FK: don't subscribe a junk
					// 'type undefined' key. A record that later GAINS the FK does so
					// via update(), which notifies this record's own key — and the
					// component's data() also read this record, so it re-runs.
					if (fk === null || fk === undefined) return null;
					return this._store.findOne(def.type, fk);
				}
				// hasMany: filter the related collection by the owner's primary key.
				if (!this._store) return [];
				const ownerPk = this.constructor.primaryKey();
				const ownerId = this[ownerPk];
				return this._store.findMany(def.type, { filter: (r) => r[fkKey] === ownerId });
			},
			set() {
				// Reserved name: an embedded server payload (`{ author: {...} }`)
				// must not throw under Object.assign in strict mode (the exempt read
				// path), so this is a warn-once no-op pointing at the FK field.
				if (!warned) {
					warned = true;
					console.warn(
						`[puzzle] "${name}" is a relationship on model "${type}" — assignments are ignored; set "${fkKey}" instead`
					);
				}
			},
		});
	}

	_typeMap(type) {
		if (!this.recordsByType.has(type)) this.recordsByType.set(type, new Map());
		return this.recordsByType.get(type);
	}

	_genId(map) {
		let id;
		do {
			id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
		} while (map.has(id));
		return id;
	}

	// ---- CRUD (constellation/doc/DOC-SPEC.md §8) ---------------------------------------------

	/**
	 * Create a record: schema defaults applied, primary key ensured, then
	 * schema validation enforced (constellation/doc/DOC-SPEC.md §20, D48) — on
	 * failure PuzzleValidationError throws and nothing is inserted, notified,
	 * or persisted.
	 */
	createRecord(type, data = {}) {
		const record = this._instantiate(type, data, 'throw', true);
		this._notify(type, record[this.modelFor(type).primaryKey()]);
		this._persist();
		return record;
	}

	/**
	 * @param {'throw'|'skip'} [onDuplicate='throw'] how to handle an explicit
	 *   primary key that already indexes a live record. createRecord/_upsert
	 *   throw (a duplicate id is a programming error); _load skips (keep the
	 *   first hydrated record, warn) so a corrupt storage blob can't crash
	 *   startup. Generated ids never collide (_genId probes the map).
	 * @param {boolean} [validate=false] enforce schema validation rules
	 *   (constellation/doc/DOC-SPEC.md §20, D48). Only createRecord passes true;
	 *   hydration (_load) and server upserts (_upsert) leave it false — the
	 *   server is authoritative and startup hydration is fail-soft, so neither
	 *   read path may crash on data that would fail local validation.
	 */
	_instantiate(type, data, onDuplicate = 'throw', validate = false) {
		const Model = this.modelFor(type);
		const map = this._typeMap(type);
		const pk = Model.primaryKey();

		const withDefaults = Model.applyDefaults(data);
		if (withDefaults[pk] == null) withDefaults[pk] = this._genId(map);

		// Local write boundary: validate after defaults + pk generation, before
		// the record is constructed or inserted (constellation/doc/DOC-SPEC.md §20).
		if (validate) {
			const errors = Model._collectErrors(withDefaults);
			if (errors.length) throw new PuzzleValidationError(errors);
		}

		if (map.has(withDefaults[pk])) {
			if (onDuplicate === 'skip') {
				console.warn(
					`[puzzle] duplicate primary key ${JSON.stringify(withDefaults[pk])} for model "${type}" during hydration — keeping the first record, skipping the rest`
				);
				return map.get(withDefaults[pk]);
			}
			throw new Error(
				`[puzzle] duplicate primary key ${JSON.stringify(withDefaults[pk])} for model "${type}" — a record with that ${pk} already exists`
			);
		}

		const record = new Model(withDefaults);
		record._store = this;
		Object.defineProperty(record, '_type', {
			value: type,
			enumerable: false,
			configurable: true,
		});

		map.set(record[pk], record);
		return record;
	}

	findOne(type, id) {
		this._subscribe(type + REC_SEP + id);
		return this._typeMap(type).get(id) ?? null;
	}

	/** @param {object} [options] { filter: (record) => boolean } */
	findMany(type, options = {}) {
		this._subscribe(type);
		let records = [...this._typeMap(type).values()];
		if (typeof options.filter === 'function') {
			records = records.filter(options.filter);
		}
		return records;
	}

	/** Called by PuzzleModel.update() — batched change notification. */
	recordChanged(record) {
		const type = record._type;
		if (!type) return;
		this._notify(type, record[this.modelFor(type).primaryKey()]);
		this._persist();
	}

	/** Called by PuzzleModel.destroy() — removes FIRST, then notifies. */
	removeRecord(record) {
		const type = record._type;
		if (!type) return;
		const id = record[this.modelFor(type).primaryKey()];
		this._typeMap(type).delete(id);
		record._store = null;
		this._notify(type, id);
		this._persist();
	}

	// ---- server read path (constellation/doc/DOC-DECISIONS.md D21) ------------------------------

	/**
	 * GET apiURL + adapter.endpoint and upsert every record in the response.
	 * Records with matching primary keys are updated in place — no duplicates.
	 * Subscribers are notified as data lands (batched, as usual).
	 */
	async loadAll(type) {
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
		}
		const records = list.map((data) => this._upsert(type, data));
		this._persist();
		return records;
	}

	/** GET apiURL + adapter.endpoint + '/' + id and upsert the single record. */
	async loadOne(type, id) {
		const data = await this._fetchAdapter(type, '/' + encodeURIComponent(id));
		// Response-shape guard (mirrors loadAll): a null/array/non-object body would
		// slip through _upsert → _instantiate as a bogus record (200 null → an empty
		// record with a generated pk marked _synced; an array spreads indices as fields).
		if (data == null || typeof data !== 'object' || Array.isArray(data)) {
			throw new Error(`[puzzle] loadOne('${type}', id) expected a JSON object from the server`);
		}
		const record = this._upsert(type, data);
		this._persist();
		return record;
	}

	async _fetchAdapter(type, suffix) {
		const endpoint = this.modelFor(type).adapter?.endpoint;
		if (!endpoint) {
			throw new Error(
				`[puzzle] no adapter declared for '${type}' — add static adapter = { endpoint: '/api/...' } to the model`
			);
		}
		const res = await fetch(this.apiURL + endpoint + suffix);
		if (!res.ok) {
			throw new Error(`[puzzle] load '${type}' failed: ${res.status} ${res.statusText}`);
		}
		return res.json();
	}

	/** Create or update-in-place by primary key; notifies either way. */
	_upsert(type, data) {
		const pk = this.modelFor(type).primaryKey();
		const existing = data?.[pk] != null ? this._typeMap(type).get(data[pk]) : null;
		if (existing) {
			safeMerge(existing, data);
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
	 * The write verbs are async, so this throw becomes a rejected promise —
	 * never a sync throw at the call site.
	 */
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
	 * Concurrent save()s on ONE record serialize through a per-record in-flight
	 * chain: a second save waits for the first to settle, then re-evaluates
	 * wasSynced — so a double-click POSTs once then PUTs, never double-creates. The
	 * prior link's rejection is swallowed FOR CHAINING ONLY; its own caller still
	 * observes it (they hold that promise).
	 */
	saveRecord(record) {
		const prev = this._saveChains.get(record);
		const run = (prev ? prev.then(noop, noop) : Promise.resolve()).then(() =>
			this._saveRecordNow(record)
		);
		this._saveChains.set(record, run);
		const cleanup = () => {
			if (this._saveChains.get(record) === run) this._saveChains.delete(record);
		};
		run.then(cleanup, cleanup);
		return run;
	}

	/** The actual save (network + merge); serialized per record by saveRecord(). */
	async _saveRecordNow(record) {
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
		const requestKey = record[pk];
		const url = wasSynced
			? this.apiURL + endpoint + '/' + encodeURIComponent(record[pk])
			: this.apiURL + endpoint;
		const res = await fetch(url, {
			method: wasSynced ? 'PUT' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(record.toJSON()),
		});

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
			const pkDiffers = responsePk != null && responsePk !== record[pk];
			if (pkDiffers && !wasSynced) {
				// e. server pk adoption on a first save — the one sanctioned pk change,
				// performed by the store. Re-key atomically: assign the new pk DIRECTLY
				// (not via update(), which throws on pk change) and swap the map key.
				// Collision guard: if the assigned pk already indexes a DIFFERENT record,
				// reject with a plain Error — the HTTP request SUCCEEDED, only local
				// reconciliation failed, so NOT a PuzzleAdapterError — and leave both
				// records + the map untouched (the delete rides the success path only).
				const occupant = map.get(responsePk);
				if (occupant && occupant !== record) {
					throw new Error(
						`[puzzle] save() response for '${type}' assigned primary key ${JSON.stringify(responsePk)}, which already belongs to a different record — refusing to overwrite it`
					);
				}
				const oldId = record[pk];
				map.delete(oldId);
				safeMerge(record, body); // includes the new pk
				map.set(record[pk], record);
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
				safeMerge(record, rest);
			} else if (responsePk == null && pk in body) {
				// An explicit-null (or undefined) pk present in the body would blank the
				// record's local pk while the type map still keys it under the old id —
				// index desync + a _notify(type, null). Drop it; keep the local pk (normal,
				// no warn — an absent/missing pk in the body is expected).
				const { [pk]: _ignored, ...rest } = body;
				safeMerge(record, rest);
			} else {
				safeMerge(record, body);
			}
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
	 */
	async deleteRecord(record) {
		const type = record._type;
		const Model = this.modelFor(type);
		const endpoint = this._requireEndpoint(type);
		const pk = Model.primaryKey();

		// Capture the key the record is indexed under NOW, before the await — the
		// post-response identity check reconciles against exactly this key.
		const requestKey = record[pk];

		const res = await fetch(this.apiURL + endpoint + '/' + encodeURIComponent(record[pk]), {
			method: 'DELETE',
		});
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
		const res = await fetch(this.apiURL + endpoint + path, init);
		if (!res.ok) {
			throw new PuzzleAdapterError(res.status, res.statusText, await readBody(res));
		}
		const parsed = await readBody(res);
		return parsed === undefined ? null : parsed;
	}

	// ---- subscriptions -------------------------------------------------------

	/**
	 * Run fn with `subscriber` as the tracking target: every query inside
	 * auto-subscribes it. Previous subscriptions are reset first, so each
	 * data() re-run reflects only the queries it actually made.
	 *
	 * Policy (why sync and async are treated differently):
	 *
	 * - SYNCHRONOUS evals ALWAYS run inline, even while an async eval sits
	 *   suspended at an await. A sync eval is atomic: the `prevTracking`/
	 *   `prevAdded` save/restore around it is exact stack discipline, so the
	 *   suspended scope's `_tracking` is restored before it can resume — the
	 *   nested inline eval cannot corrupt it. Running sync evals inline is what
	 *   keeps one slow async data() from freezing every other component's
	 *   data() re-run (the D39/D30 skeleton-under-reused-ancestor bug).
	 *
	 * - ASYNC evals must SERIALIZE against each other. Tracking is carried by a
	 *   single mutable `_tracking` field that cannot survive concurrent awaits —
	 *   if two async scopes interleave, a query made after an await lands under
	 *   whichever scope happens to hold `_tracking` at that moment (or none), so
	 *   the real subscriber loses the subscription while the other over-subscribes
	 *   and `_tracking` is left dangling. At most one async tracked eval is in
	 *   flight at a time; overlapping async calls defer until the chain settles.
	 *
	 * The caller hints a known-async fn via `expectsAsync` (PuzzleView.refresh
	 * passes `data.constructor.name === 'AsyncFunction'`), so such evals defer
	 * up front — a single invocation — instead of running, discovering they are
	 * async, and retrying. The rare sync-SHAPED fn that nonetheless returns a
	 * raw Promise while a chain is in flight is caught in the thenable branch
	 * below: its first invocation is dropped and it is retried behind the chain.
	 * The double invocation is acceptable because data() is contractually
	 * re-runnable — it re-runs on every store change.
	 *
	 * @param {boolean} [expectsAsync=false] caller's hint that fn is async.
	 */
	withTracking(subscriber, fn, expectsAsync = false) {
		// Liveness probe: a subscriber destroyed since this eval was scheduled must
		// never (re-)subscribe. Run fn UNTRACKED so any in-flight promise chain
		// still settles for its caller, but no query inside can add a subscription.
		// Covers both the initial call and a DEFERRED retry re-entering here after
		// the chain settles (the retry closure below calls straight back in). A
		// plain function subscriber has no such property → unaffected.
		if (subscriber?.isDestroyed) return fn();

		// A KNOWN-async eval while another async eval is in flight: defer this
		// whole call (before we touch subscriptions or run fn) until it settles,
		// then retry. Only async evals serialize — a sync eval is safe inline.
		if (this._asyncTrackingChain && expectsAsync) {
			const retry = () => this.withTracking(subscriber, fn, true);
			return this._asyncTrackingChain.then(retry, retry);
		}

		// Transactional reset: keep the subscriber's last-good subscriptions LIVE
		// throughout the evaluation and reconcile only once the outcome is known.
		// `before` is the pre-eval key set; `added` collects the keys THIS eval
		// queries (via _subscribe). On SUCCESS we drop the last-good keys the eval
		// no longer queries; on FAILURE (throw/reject) we drop ONLY the eval's own
		// additions and leave the last-good set intact — so a data() that throws
		// mid-refresh can't strand a still-mounted view with partial failed subs.
		// We never RE-ADD, so a concurrent destroy()/unsubscribe() always wins and
		// a torn-down subscriber is never resurrected.
		const before = new Set(this.keysBySubscriber.get(subscriber) ?? []);
		const prevTracking = this._tracking;
		const prevAdded = this._trackingAdded;
		const added = new Set();
		this._tracking = subscriber;
		this._trackingAdded = added;

		const finalize = (ok) => {
			if (ok) {
				for (const key of before) if (!added.has(key)) this._dropSubscription(key, subscriber);
			} else {
				for (const key of added) if (!before.has(key)) this._dropSubscription(key, subscriber);
			}
			this._tracking = prevTracking;
			this._trackingAdded = prevAdded;
		};

		let result;
		try {
			result = fn();
		} catch (err) {
			finalize(false);
			throw err;
		}

		if (result && typeof result.then === 'function') {
			// A sync-SHAPED fn (ran inline because expectsAsync was false) turned
			// out to be async while ANOTHER async eval is already in flight. We
			// cannot register a second concurrent chain, so drop this eval's own
			// additions (finalize(false)) and retry the whole thing behind the
			// in-flight chain. The abandoned first invocation's promise is not
			// awaited here, but we DO attach a noop handler so a REJECTION (e.g. a
			// sync-shaped data() that returned `fetch().then(...)` which fails)
			// doesn't surface as an unhandled rejection; its post-await queries may
			// over-subscribe the in-flight scope's subscriber — benign (an extra
			// notify at worst) and self-healing on that subscriber's next re-track.
			// Passing true to the retry prevents a third invocation if the chain is
			// busy again when it fires.
			if (this._asyncTrackingChain) {
				result.then(noop, noop); // observe the abandoned promise — no unhandled rejection
				finalize(false);
				const retry = () => this.withTracking(subscriber, fn, true);
				return this._asyncTrackingChain.then(retry, retry);
			}

			let release;
			const chain = new Promise((r) => (release = r));
			this._asyncTrackingChain = chain;
			const settle = () => {
				if (this._asyncTrackingChain === chain) this._asyncTrackingChain = null;
				release();
			};
			return result.then(
				(model) => {
					finalize(true);
					settle();
					return model;
				},
				(err) => {
					finalize(false);
					settle();
					throw err;
				}
			);
		}
		finalize(true);
		return result;
	}

	/** Drop every subscription held by this subscriber (component destroy). */
	unsubscribe(subscriber) {
		// A destroy() during this subscriber's OWN suspended async data() leaves it
		// as the live tracking target (_tracking stays set across the eval's awaits).
		// Clear it so the resumed eval's post-await queries can't re-subscribe it —
		// the common case dies here immediately, rather than waiting on the
		// _subscribe/withTracking isDestroyed probes.
		if (this._tracking === subscriber) {
			this._tracking = null;
			this._trackingAdded = null;
		}
		const keys = this.keysBySubscriber.get(subscriber);
		if (!keys) return;
		// Copy first: _dropSubscription mutates this set (and may delete it).
		for (const key of [...keys]) this._dropSubscription(key, subscriber);
	}

	/** Remove one (key, subscriber) link, pruning now-empty sets on both sides. */
	_dropSubscription(key, subscriber) {
		const subs = this.subscribersByKey.get(key);
		if (subs) {
			subs.delete(subscriber);
			// Drop now-empty key sets so findOne over many ids can't grow the
			// subscribersByKey map unboundedly.
			if (subs.size === 0) this.subscribersByKey.delete(key);
		}
		const keys = this.keysBySubscriber.get(subscriber);
		if (keys) {
			keys.delete(key);
			if (keys.size === 0) this.keysBySubscriber.delete(subscriber);
		}
	}

	_subscribe(key) {
		const subscriber = this._tracking;
		if (!subscriber) return;
		// Liveness probe: a subscriber whose async data() resumed AFTER it was
		// destroyed must not be re-added (its keys were already dropped by
		// unsubscribe()). A plain function subscriber has no isDestroyed → passes.
		if (subscriber.isDestroyed) return;
		if (!this.subscribersByKey.has(key)) this.subscribersByKey.set(key, new Set());
		this.subscribersByKey.get(key).add(subscriber);
		if (!this.keysBySubscriber.has(subscriber)) this.keysBySubscriber.set(subscriber, new Set());
		this.keysBySubscriber.get(subscriber).add(key);
		this._trackingAdded?.add(key); // record for the transactional finalize
	}

	// ---- change notification (batched) ---------------------------------------

	_notify(type, id) {
		this._pendingKeys.add(type);
		this._pendingKeys.add(type + REC_SEP + id);
		this._scheduleFlush();
	}

	/**
	 * Arm the batched flush() if one isn't already scheduled. Shared by _notify
	 * (subscriber delivery) and _persist (the batched storage write) so a mutation
	 * that only persists — no key notified, e.g. loadAll of an empty array or a
	 * save whose 204 body changes nothing observable — still guarantees the
	 * pending storage write lands.
	 *
	 * D63: rAF stays the primary scheduler (frame-aligned batching — one flush
	 * per frame however many records changed), but Chrome suspends rAF entirely
	 * in hidden tabs, so a backgrounded app would queue mutations forever behind
	 * one frozen rAF. When hidden (or in node/tests with no rAF), take the timer
	 * queue directly; when visible, ALSO arm a fallback timer so a flush
	 * scheduled at the visibility boundary — the tab hiding after we schedule but
	 * before the next frame — still delivers. flush() clears the fallback and is
	 * idempotent, so the rAF and the timer can never double-deliver.
	 */
	_scheduleFlush() {
		if (this._flushScheduled) return;
		this._flushScheduled = true;

		const hidden = typeof document !== 'undefined' && document.hidden;
		if (!hidden && typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(() => this.flush());
			this._flushTimer = setTimeout(() => this.flush(), 220);
		} else {
			setTimeout(() => this.flush(), 0);
		}
	}

	/**
	 * Deliver pending notifications now — each affected subscriber exactly
	 * once per flush, regardless of how many records changed — then write the
	 * batched storage snapshot if the store went dirty. Safe to call when
	 * nothing is pending. This is also the public "force a write" entry point:
	 * a caller that needs storage current immediately calls flush().
	 */
	flush() {
		this._flushScheduled = false;
		// Clear any armed D63 fallback timer — whichever scheduler (rAF or the
		// timer) reached flush() first cancels the other, so delivery is once-only.
		if (this._flushTimer) {
			clearTimeout(this._flushTimer);
			this._flushTimer = null;
		}

		this._deliverNotifications();

		// Batched persistence: mutation-path _persist() only flags the store dirty
		// (a full-store serialize + storage.setItem is O(store), too costly to run
		// inline on every keystroke's update()); the real write happens once here,
		// AFTER delivery, so a burst of mutations in one tick serializes the store
		// a single time.
		if (this._persistPending) {
			this._persistPending = false;
			this._persistNow();
		}
	}

	/** Notify each pending subscriber exactly once. Extracted from flush(). */
	_deliverNotifications() {
		if (this._pendingKeys.size === 0) return;

		const keys = [...this._pendingKeys];
		this._pendingKeys.clear();

		const notified = new Set();
		for (const key of keys) {
			const subs = this.subscribersByKey.get(key);
			if (!subs) continue;
			// Snapshot the Set (like `keys` above): a subscriber's sync data() can mount
			// a child that queries this same key, adding it to `subs` mid-iteration —
			// and JS Sets DO visit entries added during iteration, so the live loop
			// would hand the just-mounted child a redundant onStoreChange this same tick
			// (it already has fresh data from its own data()). The snapshot only notifies
			// subscribers present when the flush began.
			for (const sub of [...subs]) {
				if (notified.has(sub)) continue;
				notified.add(sub);
				// Each subscriber is isolated: a synchronous throw is logged and
				// delivery CONTINUES to the remaining subscribers. Without this a
				// single throwing subscriber would both skip every later subscriber
				// AND lose those notifications for good — _pendingKeys was already
				// cleared above, so they never come back. Function subscribers may
				// also return a thenable; a rejection is logged the same way. Object
				// subscribers route through onStoreChange(), which catches its own
				// async failures and returns undefined, so only the function path
				// needs the thenable guard (no double-logging).
				try {
					if (typeof sub === 'function') {
						const result = sub();
						if (result && typeof result.then === 'function') {
							result.catch((err) =>
								console.error('[puzzle] store subscriber failed:', err)
							);
						}
					} else {
						sub.onStoreChange?.();
					}
				} catch (err) {
					console.error('[puzzle] store subscriber failed:', err);
				}
			}
		}
	}

	// ---- optional persistence -------------------------------------------------

	/**
	 * Serialize every record to the persistence wire shape: `type → [toJSON()]`.
	 * The shared body of _persistNow() and the dev HMR snapshot (constellation/doc/DOC-SPEC.md
	 * §27, D57) — the dev path calls this directly (same-package convention).
	 */
	_serializeAll() {
		const out = {};
		for (const [type, map] of this.recordsByType) {
			// __synced rides out-of-band next to the record's fields so save()'s
			// POST-vs-PUT provenance (constellation/doc/DOC-SPEC.md §22, D50) survives
			// persistence AND the HMR snapshot — otherwise a locally-created,
			// never-saved record reloads as synced and wrongly PUTs to an id the
			// server never issued. It is NOT a field: toJSON()/server payloads never
			// see it, and _hydrateAll strips it back off before instantiating.
			out[type] = [...map.values()].map((r) => ({ ...r.toJSON(), __synced: r._synced }));
		}
		return out;
	}

	/**
	 * Mark the store dirty and schedule the flush that writes it. Called from every
	 * mutation path (createRecord / recordChanged / removeRecord / the loadAll &
	 * save reconciliation sites). The actual serialize + storage.setItem is O(store)
	 * and used to run SYNCHRONOUSLY on every mutation — once per keystroke's
	 * update(), once per record in loadAll's upsert loop — so it is now batched:
	 * this only flags, and flush() does the single write after subscriber delivery
	 * (the D63 scheduler already guarantees flush() runs soon, hidden tabs included).
	 * A caller needing the write NOW calls flush(). No-op without configured storage.
	 */
	_persist() {
		if (!this.storage) return;
		this._persistPending = true;
		this._scheduleFlush();
	}

	/** The actual storage write; invoked once per flush when the store is dirty. */
	_persistNow() {
		if (!this.storage) return;
		try {
			this.storage.setItem(this.storageKey, JSON.stringify(this._serializeAll()));
		} catch {
			// storage full / unavailable — persistence is best-effort
		}
	}

	_load() {
		let raw;
		try {
			raw = this.storage.getItem(this.storageKey);
		} catch {
			return;
		}
		if (!raw) return;

		let data;
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}
		this._hydrateAll(data);
	}

	/**
	 * Hydrate records from a parsed wire-shape object (constellation/doc/DOC-SPEC.md §8).
	 * The shared body of _load() and the dev HMR restore (§27, D57): both hydrate
	 * silently (no notify) and validation-exempt.
	 *
	 * Duplicate primary keys resolve per `options.replace`:
	 * - SKIP mode (default — normal persistence _load): keep the first hydrated
	 *   record, warn on the rest (a corrupt storage blob can't crash startup).
	 * - REPLACE mode (`{ replace: true }` — the dev HMR store restore, Change D):
	 *   overwrite an existing record's fields IN PLACE (Object.assign, mirroring
	 *   _upsert's update branch) so the transplanted snapshot wins over records the
	 *   configured `storage:` _load already hydrated during construction, while
	 *   PRESERVING object identity — records are identity-sensitive (subscribers and
	 *   relationship getters hold references). Still silent (no notify): the HMR
	 *   restore runs before navigation #0, so nothing is subscribed yet.
	 *
	 * The out-of-band provenance marker (§22, D50) is stripped and applied in BOTH
	 * modes: a blob WITH the marker restores the true _synced (a never-saved record
	 * still POSTs after a reload); an OLD-format blob with NO marker defaults to
	 * synced (hydrated records predate the session → PUT).
	 *
	 * Fail-soft: a 'null'/array/primitive `data` parses fine but Object.entries()
	 * would throw (null) or iterate garbage — crashing PuzzleApp.mount. Only a
	 * plain object is a valid store snapshot, so anything else is ignored.
	 */
	_hydrateAll(data, { replace = false } = {}) {
		if (!data || typeof data !== 'object' || Array.isArray(data)) return;

		for (const [type, records] of Object.entries(data)) {
			if (!Array.isArray(records)) continue;
			const pk = this.modelFor(type).primaryKey();
			for (const recordData of records) {
				// Per-record fail-soft (mirrors the outer guard): a null/array/primitive
				// entry would slip through _instantiate as a garbage record; skip it.
				if (!recordData || typeof recordData !== 'object' || Array.isArray(recordData)) continue;
				const hasMarker = Object.prototype.hasOwnProperty.call(recordData, '__synced');
				const { __synced: marker, ...fields } = recordData;
				const syncedTo = hasMarker ? marker === true : true;

				const id = fields[pk];
				const existing = id != null ? this._typeMap(type).get(id) : null;
				if (existing && replace) {
					// Overwrite in place — preserve identity (mirror _upsert's update
					// branch), silent, no dup warning (replacing is the intent here).
					safeMerge(existing, fields);
					existing._synced = syncedTo;
					continue;
				}
				// Skip-dup path (default), OR replace mode with no existing record:
				// instantiate, keeping the first on a duplicate pk (warns in that case).
				const record = this._instantiate(type, fields, 'skip'); // silent: no notify
				// Guard the skip-dup case where _instantiate hands back an existing record.
				if (record) record._synced = syncedTo;
			}
		}
	}
}

export default Store;

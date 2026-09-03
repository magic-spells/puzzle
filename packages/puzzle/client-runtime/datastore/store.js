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

import {
	PuzzleModel,
	PuzzleValidationError,
	assertSchemaNames,
	coerceJSONDates,
	recordKey,
	safeMerge,
} from '../model.js';
import { devtoolsFlush } from '../devtools.js';
import {
	devperfStoreFlushEnd,
	devperfStoreFlushNotifications,
	devperfStoreFlushStart,
	devperfStoreNotify,
	devperfTrackingDeferred,
} from '../devperf.js';

const REC_SEP = ' '; // never appears in a type name
const noop = () => {}; // observes an abandoned async tracking evaluation's rejection

// Marks which relationship names a model prototype has already had installed —
// getter install is idempotent so a class shared across stores (tests) is wired
// exactly once (constellation/doc/DOC-SPEC.md §21, D49).
const RELS_INSTALLED = Symbol('puzzleRelationshipsInstalled');

/**
 * D161 tracked-read attribution. A subscriber that reads the store through its
 * own HANDLE (a Proxy minted by `_handleFor`, adapter-side) carries that
 * handle's context here: `{ requests, dead }`. `withTracking` installs the
 * evaluation's request map on the SUBSCRIBER'S context rather than on the
 * Store, so faulting is attributed by object identity — only reads made through
 * that handle, by that subscriber, during that evaluation can queue a fetch.
 * Every other reader in the realm (the raw store, another subscriber's handle,
 * a record's `_store`) gets a pure local snapshot.
 *
 * One slot per subscriber, so a subscriber belongs to exactly one store — which
 * is what a PuzzleView is: `this.ctx.store` is minted once, in its constructor.
 */
export const HANDLE_CTX = Symbol('puzzleStoreHandleCtx');

export class Store {
	/**
	 * @param {object} models   type name → model class (from PuzzleApp config)
	 * @param {object} options  { storage, storageKey, apiURL, adapter, beforeRequest } —
	 *   storage is any Storage-like object (getItem/setItem); pass
	 *   window.localStorage to persist. apiURL is the base for the D21 server read
	 *   path. adapter is the opaque app capability retained for the optional module;
	 *   core never imports or interprets it. beforeRequest is the adapter request
	 *   hook (v1.55, D91) — see _fetch.
	 */
	constructor(models = {}, options = {}) {
		this.models = models;
		this.storage = options.storage || null;
		this.storageKey = options.storageKey || 'puzzle-store';
		this.apiURL = options.apiURL || '';
		this._a = options.adapter;
		// Adapter request hook (v1.55, D91). Stored ONLY when it is a function, so
		// the overwhelmingly common no-hook path costs one truthiness check in
		// _fetch() and nothing else — a non-function config value is simply absent
		// rather than a per-request typeof.
		this.beforeRequest =
			typeof options.beforeRequest === 'function' ? options.beforeRequest : null;

		this.recordsByType = new Map(); // type → Map(id → record)
		this.subscribersByKey = new Map(); // key → Set(subscriber)
		this.keysBySubscriber = new Map(); // subscriber → Set(key), for cheap reset

		this._tracking = null; // current subscriber during data() evaluation
		this._asyncTrackingChain = null; // in-flight async tracked eval, or null
		this._trackingAdded = null; // keys the in-flight eval has queried (transactional reset)
		// D161: there is deliberately NO ambient request slot on the Store. An
		// evaluation's request map lives on its subscriber's handle context
		// (HANDLE_CTX above), so a read by anyone else — including code that runs
		// while an async data() sits at an await — can never fault or join a
		// batch it does not own.
		// D146: subscriber → Map<key, holdCount> for PREPARED (evaluated but not yet
		// committed/discarded) evals. Held keys are live subscriptions that no OTHER
		// eval may reclaim as garbage: a store-change refresh landing mid-gate runs
		// with the old params and would otherwise see the prepared keys in its
		// pre-eval set, not re-query them, and drop the prepare's work. REFCOUNTED so
		// overlapping prepares compose — each holds every key it queried, and only the
		// last hold to be released exposes the key to reconciliation again.
		this._heldKeys = new Map();
		// key → the sequence number of the most recent _notify that queued it.
		// The number is what lets a subscriber tell a change it has ALREADY seen
		// (enqueued before the evaluation that produced its committed model) from
		// one that postdates it — see _deliverNotifications and D161.
		this._pendingKeys = new Map();
		this._notifySeq = 0;
		this._flushScheduled = false;
		this._flushTimer = null; // armed fallback timer (D63); cleared by flush()
		this._persistPending = false; // dirty flag: storage write is batched into flush()
		// Both authoring guards run BEFORE _installRelationships so a relationship
		// named after a model method is caught rather than quietly replacing that
		// method with a getter.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			this._assertNoReservedFields();
			this._assertNoMethodFields();
		}
		this._installRelationships();

		if (this.storage) this._load();
	}

	// ---- model plumbing ----------------------------------------------------

	modelFor(type) {
		// OWN properties only: `models` is a plain object literal, so a bare
		// `this.models[type]` also resolves the Object prototype — a persisted blob
		// keyed "constructor" would hand back Object (truthy) as the "model class"
		// and the caller's Model.primaryKey() would throw on a hydration path that
		// must stay fail-soft.
		const own = Object.prototype.hasOwnProperty.call(this.models, type)
			? this.models[type]
			: null;
		return own || PuzzleModel;
	}

	/**
	 * Dev-only registration guard: `_serializeAll` writes each record's provenance
	 * flag as a literal `__synced` key beside the fields, and `_hydrateAll` strips
	 * that key back off. A model that DECLARES a `__synced` field therefore loses
	 * its value on every persist/hydrate round-trip — silently, and only after a
	 * reload. Nobody names a field this, so the answer is a loud throw at
	 * construction rather than an envelope the wire shape would have to carry.
	 */
	_assertNoReservedFields() {
		for (const [type, Model] of Object.entries(this.models)) {
			if (typeof Model.normalizedSchema !== 'function') continue;
			if ('__synced' in Model.normalizedSchema()) {
				throw new Error(
					`[puzzle] model '${type}' declares a "__synced" field — that name is reserved by persistence; rename it`
				);
			}
		}
	}

	/**
	 * Registration-time schema check: a schema entry may not be named after a
	 * model method. Development-only, like every other authoring diagnostic here:
	 * the schema is static, so the throw fires the first time the app is opened in
	 * dev, and production keeps the runtime protection either way (assignSkipping
	 * drops a colliding key on every write path, in every build).
	 */
	_assertNoMethodFields() {
		for (const [type, Model] of Object.entries(this.models)) {
			assertSchemaNames(Model, type);
		}
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
				// Resolution is an ordinary LOCAL query, so a traversal inside a tracked
				// data() auto-subscribes exactly like the manual join it replaces — and
				// deliberately never faults in a missing record (D161): a list of 50
				// posts reading post.author must not become 50 requests. An author who
				// wants the dependent fetch writes store.findOne() in data().
				if (def.kind === 'belongsTo') {
					if (!this._store) return null;
					const fk = this[fkKey];
					// Short-circuit a null/undefined FK: don't subscribe a junk
					// 'type undefined' key. A record that later GAINS the FK does so
					// via update(), which notifies this record's own key — and the
					// component's data() also read this record, so it re-runs.
					if (fk === null || fk === undefined) return null;
					return this._store._findOneLocal(def.type, fk);
				}
				// hasMany: filter the related collection by the owner's primary key.
				if (!this._store) return [];
				const ownerPk = this.constructor.primaryKey();
				const ownerKey = recordKey(this[ownerPk]);
				return this._store._findManyLocal(def.type, {
					filter: (r) => recordKey(r[fkKey]) === ownerKey,
				});
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
		// A blank primary key auto-generates — EXCEPT an explicit `.primary().required()`
		// under validation (createRecord, validate=true), which must FAIL D48 below
		// exactly as Model.validate() does rather than be silently filled with a random
		// id (constellation/feature/FEATURE-VALIDATE-PK-PARITY.md). Hydration (_load) and
		// server upserts (_upsert) leave validate=false and still auto-generate: those
		// paths are fail-soft / server-authoritative and must not crash on a missing pk.
		const pkDef = Model.normalizedSchema()[pk];
		const autoGeneratePk = !(validate && pkDef && pkDef.explicitRequired);
		if (withDefaults[pk] == null && autoGeneratePk) withDefaults[pk] = this._genId(map);

		// Local write boundary: validate after defaults + pk generation, before
		// the record is constructed or inserted (constellation/doc/DOC-SPEC.md §20).
		if (validate) {
			const errors = Model._collectErrors(withDefaults);
			if (errors.length) throw new PuzzleValidationError(errors);
		}

		if (map.has(recordKey(withDefaults[pk]))) {
			if (onDuplicate === 'skip') {
				console.warn(
					`[puzzle] duplicate primary key ${JSON.stringify(withDefaults[pk])} for model "${type}" during hydration — keeping the first record, skipping the rest`
				);
				return map.get(recordKey(withDefaults[pk]));
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

		map.set(recordKey(record[pk]), record);
		return record;
	}

	/**
	 * Query one record by primary key. On the RAW Store this is, and always is, a
	 * pure local snapshot — the public method faults nothing (D161), which is why
	 * core needs no fault branch here at all.
	 *
	 * Fetching belongs to `_findOneTracked`/`_findManyTracked`, which the adapter
	 * module grafts on beside the fault helpers and which only a view's own store
	 * handle (`this.ctx.store`) calls, during that view's own data() evaluation:
	 * the settle loop awaits whatever that read queued and re-runs data(), so the
	 * model it commits is settled and a committed null means "does not exist".
	 * Event handlers, model methods, timers and adapter-free apps get the local
	 * snapshot this has always been.
	 */
	findOne(type, id) {
		return this._findOneLocal(type, id);
	}

	/** @param {object} [options] { filter: (record) => boolean } */
	findMany(type, options = {}) {
		return this._findManyLocal(type, options);
	}

	/**
	 * The local halves of the two queries, subscribing exactly as the public
	 * methods do but never faulting. The relationship getters use these: traversing
	 * `post.author` must record the subscription that makes it reactive without
	 * turning a rendered list into N requests (D49, D161).
	 */
	_findOneLocal(type, id) {
		this._subscribe(type + REC_SEP + id);
		return this._typeMap(type).get(recordKey(id)) ?? null;
	}

	_findManyLocal(type, options = {}) {
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

	/** Called by PuzzleModel.destroy()/confirmed delete() — removes FIRST, then notifies. */
	removeRecord(record) {
		const type = record._type;
		if (!type) return;
		const id = record[this.modelFor(type).primaryKey()];
		this._typeMap(type).delete(recordKey(id));
		// One removed-instance state for both local destroy() and D50's confirmed
		// delete: stale references can delete idempotently and can never save() a
		// resurrected copy. Set before detaching so lifecycle guards see a coherent
		// terminal state as soon as removal completes.
		record._deleted = true;
		record._store = null;
		this._notify(type, id);
		this._persist();
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
	 * The caller hints a known-async fn via `expectsAsync` (PuzzleView passes
	 * `data.constructor.name === 'AsyncFunction'` OR its sticky
	 * `_dataAsyncShape`), so such evals defer up front — a single invocation —
	 * instead of running, discovering they are async, and retrying. The rare
	 * sync-SHAPED fn that nonetheless returns a raw Promise while a chain is in
	 * flight is caught in the thenable branch below: its first invocation is
	 * dropped and it is retried behind the chain. The double invocation is
	 * acceptable because data() is contractually re-runnable — it re-runs on
	 * every store change. Latching the shape is what keeps that branch to a
	 * view's FIRST promise-shaped evaluation: from the second on, the caller
	 * hints true and the eval defers before it runs.
	 *
	 * @param {boolean} [expectsAsync=false] caller's hint that fn is async.
	 * @param {?{reconcile?: function(boolean): void}} [pending=null] HELD-eval channel
	 *   (D146). When given, a SUCCESSFUL eval does not reconcile subscriptions here —
	 *   it parks the reconcile function on `pending.reconcile` and the caller decides
	 *   later whether the run is committed (`reconcile(true)` → drop the last-good keys
	 *   this eval no longer queries) or discarded (`reconcile(false)` → drop only this
	 *   eval's own additions, leaving the live set exactly as it was). Scope restore
	 *   (`_tracking`/`_trackingAdded`) is NEVER deferred — that is stack discipline.
	 *   A failing eval reconciles(false) immediately and leaves `pending` untouched.
	 * @param {?Map} [requests=null] D161 per-evaluation request map. Installed on
	 *   the SUBSCRIBER'S handle context for the duration of the eval, which is
	 *   what lets a miss read through that subscriber's handle queue the fetch the
	 *   caller's settle loop then awaits. Per EVALUATION and per SUBSCRIBER, never
	 *   Store-global: concurrent views may share a request promise but never each
	 *   other's bookkeeping, and a reader holding anything but this subscriber's
	 *   handle cannot fault at all — before or after an await. A subscriber with
	 *   no handle context (a bare object) installs no map anywhere; its reads are
	 *   local.
	 */
	withTracking(subscriber, fn, expectsAsync = false, pending = null, requests = null) {
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
			const retry = () => this.withTracking(subscriber, fn, true, pending, requests);
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				return devperfTrackingDeferred(
					subscriber,
					this._asyncTrackingChain,
					retry,
					'known-async'
				);
			}
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
		// D161: the request map goes on THIS SUBSCRIBER'S handle context, not on the
		// Store. Same save/restore stack discipline as _tracking, for the same
		// reason — a nested synchronous eval must not leave its map installed under
		// the suspended scope that resumes after it — but scoped to one identity, so
		// a foreign read during a suspension has nothing to find.
		//
		// The capability check is the STORE half of the D157 boundary. install()
		// copies the fault methods onto Store.prototype once per realm and never
		// removes them, so a store built without the capability still CARRIES
		// _faultOne/_faultMany; refusing the request map here is what makes them
		// unreachable, whatever hands this eval one. One check per evaluation, not
		// per query — findOne/findMany stay exactly as cheap as they were.
		const hctx = this._a ? subscriber?.[HANDLE_CTX] : null;
		const prevRequests = hctx ? hctx.requests : null;
		if (hctx) hctx.requests = requests;

		// How many UNCOMMITTED prepared evals currently hold this key for this
		// subscriber (D146). Refcounted, so two overlapping prepares that query the
		// same key both hold it and neither one's outcome can drop it out from under
		// the other. Read fresh from `_heldKeys` every time: a destroy() in the
		// meantime drops the whole entry and the count correctly reads 0.
		const heldCount = (key) => this._heldKeys.get(subscriber)?.get(key)?.count ?? 0;
		const reconcile = (ok, adopted = null) => {
			if (ok) {
				for (const key of before) {
					// Never drop a key another eval is HOLDING for its pending commit.
					if (added.has(key) || heldCount(key) > 0) continue;
					this._dropSubscription(key, subscriber);
				}
			} else {
				for (const key of added) {
					// Symmetric to the success branch: an addition this eval is unwinding
					// may be an addition a LIVE prepare is still holding, in which case it
					// is not ours to drop — or one a prepare that has ALREADY COMMITTED
					// adopted as committed state while we were still open. `before` is a
					// snapshot from this eval's start and cannot see either.
					if (before.has(key) || heldCount(key) > 0 || adopted?.has(key)) continue;
					this._dropSubscription(key, subscriber);
				}
			}
		};
		const finalize = (ok) => {
			// D146 held eval: park the SUCCESS reconcile for the caller's commit/discard
			// decision. The subscriber is transiently over-subscribed (last-good keys AND
			// this eval's additions) between here and that decision — benign: an extra
			// notify at worst, and the live set is never weakened, so a discard cannot
			// strand the still-mounted view. Failures reconcile now: there is nothing to
			// commit, and the caller's `pending.reconcile` stays undefined (a no-op).
			if (ok && pending) {
				// HOLD every key this eval queried — not just its net-new ones — until the
				// caller decides. Holding only `added \ before` is what let a second,
				// overlapping prepare hold NOTHING (its `before` already contains the
				// first prepare's live additions), so the first prepare's discard could
				// unsubscribe a key the winning prepare was about to commit. Counts
				// compose, so an outcome only releases the hold IT took.
				let held = this._heldKeys.get(subscriber);
				if (!held) this._heldKeys.set(subscriber, (held = new Map()));
				for (const key of added) {
					const entry = held.get(key);
					if (entry) entry.count++;
					// `adopted` records that some prepare COMMITTED this key while another
					// hold was still open — the other hold's later discard must then treat
					// it as committed state, not as its own reversible addition.
					else held.set(key, { count: 1, adopted: false });
				}
				pending.reconcile = (commit) => {
					const adopted = new Set();
					for (const key of added) {
						const entry = held.get(key);
						if (!entry) continue;
						if (entry.adopted) adopted.add(key);
						if (commit) entry.adopted = true;
						if (--entry.count <= 0) held.delete(key);
					}
					// Drop the subscriber's entry once no key carries a nonzero count.
					// Identity-checked: a destroy() between prepare and decide already
					// removed this entry, and a LATER prepare may own the current one.
					if (held.size === 0 && this._heldKeys.get(subscriber) === held) {
						this._heldKeys.delete(subscriber);
					}
					reconcile(commit, adopted);
				};
			} else reconcile(ok);
			this._tracking = prevTracking;
			this._trackingAdded = prevAdded;
			// Restoring the enclosing eval's map would re-arm a torn-down view's
			// suspended continuation, which is precisely what unsubscribe() disarmed —
			// so a subscriber DESTROYED while this eval was open restores nothing. The
			// test is the live `isDestroyed` state, never a latch set by unsubscribe():
			// playOut() unsubscribes a view that _restoreFromLeaving() can put back on
			// screen, and that view owes every fault its data() still makes.
			if (hctx) hctx.requests = subscriber?.isDestroyed ? null : prevRequests;
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
				const retry = () => this.withTracking(subscriber, fn, true, pending, requests);
				if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
					return devperfTrackingDeferred(
						subscriber,
						this._asyncTrackingChain,
						retry,
						'sync-shaped'
					);
				}
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
		// D161: disarm this subscriber's handle — its identity, not the ambient
		// tracking target, is what decides whether its reads fault, so a resumed
		// data() must not fetch off a map installed before the teardown. Clearing
		// only; a LIVE view can be unsubscribed (playOut) and restored, and
		// withTracking's own restore consults `isDestroyed` rather than a latch.
		const hctx = subscriber?.[HANDLE_CTX];
		if (hctx) hctx.requests = null;
		// D146: a destroyed subscriber holds nothing. Any prepared eval still pointing
		// at it resolves to a reconcile over an already-empty key set (a no-op).
		this._heldKeys.delete(subscriber);
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
		const seq = ++this._notifySeq;
		this._pendingKeys.set(type, seq);
		this._pendingKeys.set(type + REC_SEP + id, seq);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfStoreNotify(this, this._tracking);
		}
		this._scheduleFlush();
	}

	/**
	 * Arm the batched flush() if one isn't already scheduled. Shared by _notify
	 * (subscriber delivery) and _persist (the batched storage write) so a mutation
	 * that only persists — no key notified, e.g. loadMany of an empty array or a
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
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfStoreFlushStart(this);
		}
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
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfStoreFlushEnd(this);
		}
	}

	/** Notify each pending subscriber exactly once. Extracted from flush(). */
	_deliverNotifications() {
		if (this._pendingKeys.size === 0) return;

		const pending = [...this._pendingKeys];
		this._pendingKeys.clear();

		// Gather first, deliver second. Every target's set is read BEFORE any
		// subscriber runs: a subscriber's sync data() can mount a child that
		// queries one of these keys, and the just-mounted child must not be handed
		// a redundant onStoreChange this same tick (it already has fresh data from
		// its own data()). Gathering also gives each subscriber the HIGHEST
		// sequence number among the keys it is subscribed to in this batch, which
		// is what lets it recognise a batch it has already accounted for (D161).
		// The key that carried that sequence rides along for the membership
		// re-check below.
		const targets = new Map();
		for (const [key, seq] of pending) {
			const subs = this.subscribersByKey.get(key);
			if (!subs) continue;
			for (const sub of subs) {
				const seen = targets.get(sub);
				if (seen === undefined || seq > seen[0]) targets.set(sub, [seq, key]);
			}
		}

		// Dev-only bookkeeping for the DevTools/profiler probe at the tail. Built
		// inside the inline gate — never unconditionally — so production DCE folds
		// both away rather than allocating a Set and a key array on every flush.
		let keys;
		let notified;
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			keys = pending.map(([key]) => key);
			notified = new Set();
		}
		for (const [sub, [seq, key]] of targets) {
			// Membership is re-checked at CALL time, not just at gather time: an
			// earlier subscriber in this same batch may have unsubscribed this one
			// (a parent's data() destroying a child, an app callback removing
			// another). Delivering to a subscriber that asked to stop is a bug the
			// gather pass cannot see — a plain `store.subscribe(fn)` callback has no
			// destroyed-guard of its own, so this is its only protection. The test
			// is the set this subscriber was GATHERED from, which is what
			// unsubscribe() empties, rather than the keysBySubscriber side index.
			if (!this.subscribersByKey.get(key)?.has(sub)) continue;
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) notified.add(sub);
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
						result.catch((err) => console.error('[puzzle] store subscriber failed:', err));
					}
				} else {
					sub.onStoreChange?.(seq);
				}
			} catch (err) {
				console.error('[puzzle] store subscriber failed:', err);
			}
		}

		// DevTools bridge (constellation/doc/DOC-SPEC.md §27, D100): report the batch
		// once BOTH halves are final — `keys` was snapshotted above and `notified`
		// only stops growing after the delivery loop. The probe is spelled INLINE
		// (never hoisted into a shared const) so production DCE folds the whole
		// statement and the devtools import tree-shakes away — see the note in app.js.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			devperfStoreFlushNotifications(this, keys, notified);
			devtoolsFlush(this, keys, notified);
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
	 * mutation path (createRecord / recordChanged / removeRecord / the loadMany &
	 * save reconciliation sites). The actual serialize + storage.setItem is O(store)
	 * and used to run SYNCHRONOUSLY on every mutation — once per keystroke's
	 * update(), once per record in loadMany's upsert loop — so it is now batched:
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
		// Hydration is inside the guard too: _load() runs from the constructor, so
		// anything it throws escapes PuzzleApp construction and leaves a permanently
		// blank page — the bad blob is still in storage, so a reload crashes again.
		// _hydrateAll's own fail-soft guards only cover shapes it can recognise
		// (non-object data, per-record garbage); this catches the rest. Whatever
		// hydrated before the failure is kept; the rest of the blob is dropped.
		// The HMR restore path calls _hydrateAll directly and still propagates —
		// that one is developer-facing.
		try {
			this._hydrateAll(data);
		} catch (err) {
			console.warn('[puzzle] ignoring corrupt persisted store:', err);
		}
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
			const Model = this.modelFor(type);
			const pk = Model.primaryKey();
			for (const recordData of records) {
				// Per-record fail-soft (mirrors the outer guard): a null/array/primitive
				// entry would slip through _instantiate as a garbage record; skip it.
				if (!recordData || typeof recordData !== 'object' || Array.isArray(recordData)) continue;
				const hasMarker = Object.prototype.hasOwnProperty.call(recordData, '__synced');
				const { __synced: marker, ...rest } = recordData;
				// A persisted blob is JSON: revive declared date() fields before they
				// reach a record (see coerceJSONDates).
				const fields = coerceJSONDates(Model, rest);
				const syncedTo = hasMarker ? marker === true : true;

				const id = fields[pk];
				const existing = id != null ? this._typeMap(type).get(recordKey(id)) : null;
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

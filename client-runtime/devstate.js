/**
 * devstate — the dev-only HMR snapshot/restore machinery (constellation/doc/DOC-SPEC.md §27, D57).
 *
 * `puzzle dev`'s live reload is state-preserving: the injected SSE client calls
 * PuzzleApp.__devSnapshot() immediately before `location.reload()`, which writes
 * a one-shot sessionStorage blob; the freshly booted app restores it at the end
 * of mount(). Nothing here swaps modules — the new bundle always runs whole (no
 * stale closures, no partial module graphs); only STATE crosses the reload.
 *
 * Everything in this module is gated on DEV. The build defines __PUZZLE_DEV__
 * (esbuild Define): "true" in dev builds, "false" in production, where
 * MinifySyntax strips every guarded branch — so in production the registry, the
 * serializer, and the HMR_KEY string are all tree-shaken away (the DCE proof
 * lives in compiler/internal/build/build_test.go). The typeof probe treats an
 * UNDEFINED __PUZZLE_DEV__ (unbundled vitest, or a foreign bundler) as true, so
 * the hooks stay present but inert — nothing calls them without the dev client.
 */

// Never dereference __PUZZLE_DEV__ directly: unbundled it is an undeclared
// identifier and a bare read throws ReferenceError — the typeof probe is the
// point. Bundled, esbuild replaces it with the literal so the whole expression
// constant-folds and MinifySyntax DCEs the guarded code (D57).
const DEV = typeof __PUZZLE_DEV__ === 'undefined' ? true : __PUZZLE_DEV__;

// sessionStorage key for the one-shot transplant blob. Referenced ONLY from
// DEV-gated code below, so production DCE drops both the usages and this const.
const HMR_KEY = '__puzzleHMR';

// A blob older than this is stale — a manual F5 (rather than a dev-server
// reload) must cold-start, not resurrect a long-dead session (D57).
const MAX_AGE_MS = 10_000;

// Conservative walk depth + drop sentinel for the JSON-safe view-state filter.
const MAX_DEPTH = 8;
const DROP = Symbol('drop');

// Registry of live MOUNTED PuzzleView instances (dev only). A Set preserves
// insertion (= mount) order, which is what makes the per-class key index
// deterministic across the reload: the same URL mounts the same chain in the
// same order (D57). PuzzleView adds on #mounted-true and removes on destroy();
// key derivation lives here so PuzzleView stays minimal.
const liveViews = new Set();

// The gates below are all written as positive `if (DEV) { … }` blocks, not
// `if (!DEV) return; …`: esbuild eliminates a constant-false `if` branch
// reliably, but does NOT strip statements after an unconditional `return`, so
// the negative form would leave the guarded body (and its string/Set literals)
// in the production bundle and defeat the DCE (D57). Verified by the build test.

/** Register a newly-mounted view (no-op in production). */
export function registerView(view) {
	if (DEV) liveViews.add(view);
}

/** Drop a destroyed view from the registry (no-op in production). */
export function unregisterView(view) {
	if (DEV) liveViews.delete(view);
}

/**
 * Key the currently-live views as `${class name}:${per-class mount index}` —
 * the index counts earlier live instances of the same class in registration
 * order. Computed identically at snapshot and restore time, so a view's state
 * lands back on its counterpart; a class-name collision or a divergent mount
 * order simply mis-keys and that view cold-starts (fail-soft, D57).
 */
function keyedViews() {
	const counts = Object.create(null);
	const out = [];
	for (const view of liveViews) {
		const name = view?.constructor?.name || 'View';
		const idx = counts[name] ?? 0;
		counts[name] = idx + 1;
		out.push({ key: `${name}:${idx}`, view });
	}
	return out;
}

/**
 * sessionStorage, or null when it is unavailable or throws on access (a foreign
 * bundler, a locked-down environment, a test that removes the global). Never
 * throws — the whole HMR path degrades to a cold start.
 */
function getSessionStorage() {
	try {
		return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
	} catch {
		return null;
	}
}

/**
 * Filter getData() down to JSON-safe plain values (D57): primitives (finite
 * numbers, strings, booleans, null), plain arrays, and plain objects are kept
 * and recursed; functions, DOM nodes, class instances (store records!),
 * symbols, and anything else are DROPPED. A dropped object property is OMITTED
 * (not nulled); an array holding a droppable element is dropped whole (its
 * positional shape can't survive omissions). Depth-capped and cycle-guarded so
 * a self-referential or deeply-nested model can never wedge the snapshot. The
 * store records that data() derived from queries are intentionally dropped —
 * the restored store re-provides them; only local setData state (drafts,
 * toggles, form fields) needs to cross the reload. Exported for direct testing.
 */
export function safeState(data) {
	const walked = walk(data, 0, new WeakSet());
	// getData() is always a plain object; a top-level DROP (shouldn't happen)
	// degrades to an empty state rather than a crash.
	return walked === DROP || walked === null || typeof walked !== 'object' ? {} : walked;
}

function walk(value, depth, seen) {
	if (value === null) return null;
	const t = typeof value;
	if (t === 'boolean' || t === 'string') return value;
	// Non-finite numbers (NaN/Infinity) are not JSON-safe — drop them.
	if (t === 'number') return Number.isFinite(value) ? value : DROP;
	// functions, symbols, bigint, undefined — never survive.
	if (t !== 'object') return DROP;

	if (depth >= MAX_DEPTH) return DROP; // over the conservative depth cap
	if (seen.has(value)) return DROP; // cycle
	// DOM nodes: identified structurally (nodeType) to avoid an instanceof that
	// assumes a live DOM. Dropped — they can't cross a reload.
	if (typeof value.nodeType === 'number' && value.nodeName !== undefined) return DROP;

	seen.add(value);
	try {
		if (Array.isArray(value)) {
			const arr = [];
			for (const item of value) {
				const w = walk(item, depth + 1, seen);
				if (w === DROP) return DROP; // a droppable element dooms the array
				arr.push(w);
			}
			return arr;
		}
		// Only genuinely plain objects recurse; a class instance (a store record,
		// a Date, a Map) has a non-Object prototype and is dropped wholesale.
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) return DROP;
		const obj = {};
		for (const k of Object.keys(value)) {
			const w = walk(value[k], depth + 1, seen);
			if (w !== DROP) obj[k] = w; // omit the key; never null it
		}
		return obj;
	} finally {
		seen.delete(value);
	}
}

/**
 * Snapshot the running app to the one-shot sessionStorage blob (D57). Called by
 * PuzzleApp.__devSnapshot() from the dev client, immediately before reload.
 * Every step is wrapped fail-soft: a serialization error, an unreadable view,
 * or a full/absent storage degrades to a partial-or-empty blob, never a throw
 * (the reload must always proceed). No-op in production.
 */
export function snapshotToStorage(app) {
	// Positive gate so DCE empties this (and orphans snapshotImpl) in production.
	if (DEV) snapshotImpl(app);
}

function snapshotImpl(app) {
	try {
		const storage = getSessionStorage();
		if (!storage) return;

		const blob = { t: Date.now(), store: {}, views: [] };

		// Store: the same wire shape _persist() writes (type → [toJSON()]), via
		// the shared serializer. app.store's getter throws once unmounted, so the
		// whole read is guarded.
		try {
			blob.store = app.store._serializeAll();
		} catch {
			blob.store = {};
		}

		// View state: each live view's LOCAL layer (setData + created()-seeded
		// state) through the JSON-safe filter (Change D). Only genuinely-local state
		// crosses the reload — store-derived values in the model layer are recomputed
		// by data() against the transplanted store during navigation #0, so
		// serializing the merged getData() would wrongly pin stale derived values as
		// local overrides. _localState() is PuzzleView's internal reader for exactly
		// this (same-package convention, like store._serializeAll).
		for (const { key, view } of keyedViews()) {
			try {
				blob.views.push({ key, data: safeState(view._localState()) });
			} catch {
				// one unreadable view must not lose the rest
			}
		}

		storage.setItem(HMR_KEY, JSON.stringify(blob));
	} catch {
		// snapshot is best-effort — the reload happens regardless (D57)
	}
}

/**
 * Phase 1 of the two-phase HMR restore (D57 + Change D) — called by
 * PuzzleApp.mount() AFTER beforeMount but BEFORE navigation #0. Reads and DELETES
 * the one-shot blob (a later manual F5 cold-starts), discards it when older than
 * MAX_AGE_MS, then hydrates its STORE records in REPLACE mode so the transplant
 * wins over any records a configured `storage:` load already put down — and, most
 * importantly, so navigation #0's data() queries SEE the restored records (the old
 * single-phase restore ran after start(), leaving store-derived views empty until
 * the next mutation — the masked bug). Returns the validated blob (or null) so
 * phase 2 can restore view-local state without re-reading storage; every step is
 * fail-soft. No-op in production.
 */
export function restoreStoreFromStorage(app) {
	// Positive gate so DCE empties this (and orphans restoreStoreImpl) in production.
	if (DEV) return restoreStoreImpl(app);
	return null;
}

function restoreStoreImpl(app) {
	let blob;
	try {
		const storage = getSessionStorage();
		if (!storage) return null;
		const raw = storage.getItem(HMR_KEY);
		// One-shot: delete BEFORE parsing so even a corrupt/expired blob is gone.
		try {
			storage.removeItem(HMR_KEY);
		} catch {
			// unable to delete — the age check still prevents a stale re-restore
		}
		if (!raw) return null;
		blob = JSON.parse(raw);
	} catch {
		return null; // unreadable / unparseable → cold start
	}

	try {
		if (!blob || typeof blob !== 'object') return null;
		if (typeof blob.t !== 'number' || Date.now() - blob.t > MAX_AGE_MS) return null; // expired

		// Hydrate the store in REPLACE mode — shape-validated inside _hydrateAll; a
		// bad `store` field is ignored rather than fatal. Replace so the snapshot
		// overrides duplicate-pk records from configured storage (Change D).
		try {
			app.store._hydrateAll(blob.store, { replace: true });
		} catch {
			// store restore is best-effort
		}

		return blob; // hand the (validated) blob to phase 2 for view-local restore
	} catch {
		return null; // any failure → cold start (D57 fail-soft posture)
	}
}

/**
 * Phase 2 of the two-phase HMR restore (D57 + Change D) — called by
 * PuzzleApp.mount() after the initial navigation has mounted the view chain,
 * with the blob returned by phase 1. Restores each saved view's LOCAL setData
 * state onto its live keyed counterpart (store already transplanted in phase 1).
 * Fail-soft: a null blob (cold start / expired / corrupt) or a missing view is a
 * no-op, never a crash. No-op in production.
 */
export function restoreViewsFromStorage(blob) {
	// Positive gate so DCE empties this (and orphans restoreViewsImpl) in production.
	if (DEV) restoreViewsImpl(blob);
}

function restoreViewsImpl(blob) {
	try {
		if (!blob || !Array.isArray(blob.views)) return;
		const byKey = new Map();
		for (const { key, view } of keyedViews()) byKey.set(key, view);
		for (const entry of blob.views) {
			try {
				const view = byKey.get(entry?.key);
				if (view && entry.data && typeof entry.data === 'object') view.setData(entry.data);
			} catch {
				// a mis-shaped or missing view just cold-starts
			}
		}
	} catch {
		// any restore failure → cold start (D57 fail-soft posture)
	}
}

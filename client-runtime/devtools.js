/**
 * devtools — the dev-only DevTools-extension bridge (constellation/doc/DOC-SPEC.md §55, D100).
 *
 * A Chrome DevTools extension (separate repo) injects a hook object at
 * document_start as `window.__PUZZLE_DEVTOOLS_HOOK__`. When a PuzzleApp mounts
 * and that hook is present AND sane, this module registers with it and speaks
 * protocol v1:
 *
 *   runtime → extension   hook.emit({ puzzle: 1, v: 1, type, payload })
 *   extension → runtime   the handler this module passes to hook.onRequest(fn),
 *                         called as fn(message) and returning the result payload
 *                         SYNCHRONOUSLY (never throwing — every failure comes
 *                         back as `{ error }`).
 *
 * NO hook (the overwhelmingly common case — a dev build with no extension
 * installed) means every touchpoint below is a cheap no-op: nothing is emitted,
 * no globals are written, no observers are attached.
 *
 * Everything here is gated on DEV, exactly like devstate.js: the build defines
 * __PUZZLE_DEV__ (esbuild Define) "true" in dev builds and "false" in
 * production, where MinifySyntax strips every guarded branch — the call sites in
 * app.js / store.js / router.js fold away, this module loses its last importer,
 * and the whole bridge (including the HOOK_KEY string) tree-shakes out of the
 * bundle. The DCE proof lives in compiler/internal/build/build_test.go.
 *
 * Import direction: devtools → devstate, never the reverse. devstate owns the
 * live-view registry and the JSON-safe state filter; rather than have devstate
 * import this module back (a cycle), devstate exposes a single observer slot
 * that this module fills at registration time (setViewObserver) and clears at
 * unregistration.
 */

import { liveViewList, safeState, setViewObserver } from './devstate.js';

// Never dereference __PUZZLE_DEV__ directly — see the identical note in
// devstate.js. MODULE scope only; class methods must spell the probe inline.
const DEV = typeof __PUZZLE_DEV__ === 'undefined' ? true : __PUZZLE_DEV__;

// Wire-protocol version. `puzzle: 1` is the envelope discriminator (so the
// extension can ignore foreign postMessage traffic); `v` is the protocol
// revision the payload shapes belong to.
const PROTOCOL_VERSION = 1;

// The framework version reported in `hello`. The runtime has no generated
// version constant and the ESM bundle cannot import package.json, so this is a
// literal — BUMP IT WITH package.json AT EVERY RELEASE (D100).
const FRAMEWORK_VERSION = '0.3.0';

// The global the extension installs its hook on. Referenced ONLY from DEV-gated
// code, so production DCE drops the usages and then this const — which is what
// the build test asserts.
const HOOK_KEY = '__PUZZLE_DEVTOOLS_HOOK__';

// Marks the highlight overlay so a test (or a human in the Elements panel) can
// find it, and so a stale one from a previous session is recognizable.
const OVERLAY_MARK = 'data-puzzle-devtools';

// The registered hook, or null when no extension is listening. Every emit path
// short-circuits on null, which is the no-extension fast path.
let hook = null;

// The app instance this bridge is bound to. Store/router reads go through it,
// and app-unmounted only unregisters for the SAME instance.
let boundApp = null;

// The single reused highlight element (fixed-position, pointer-events none).
let overlay = null;

// View names of the most recently committed route chain. router.current exposes
// route ENTRIES (view classes, guards — not JSON-safe) and no instances, so the
// names are captured at commit time and replayed by snapshot:route.
let lastChain = [];

// Stable per-instance ids handed to the extension. A WeakMap so a destroyed
// view is collectable; ids are never reused within a session.
const viewIds = new WeakMap();
let nextViewId = 1;

// The gates below are positive `if (DEV) { … }` blocks, never `if (!DEV) return`
// — see the measured note in devstate.js: only the positive form is reliably
// dead-code-eliminated.

// ---- public touchpoints (all no-ops without a hook) -------------------------

/**
 * Register with the extension hook, if one is installed. Called from
 * PuzzleApp.mount() inside the existing __PUZZLE_DEV__ block that publishes
 * window.__PUZZLE_APP__ — i.e. after the services are wired and before
 * navigation #0, so the store/router are readable and the first view mounts
 * arrive as live events rather than replay.
 */
export function devtoolsAppMounted(app) {
	if (DEV) appMountedImpl(app);
}

/** Unregister at teardown: emit app-unmounted, detach the observer, drop the overlay. */
export function devtoolsAppUnmounted(app) {
	if (DEV) appUnmountedImpl(app);
}

/**
 * Report one completed store flush batch: the keys that changed and the exact
 * subscriber set that was notified (PuzzleView instances become ids, function
 * subscribers become the literal 'fn').
 */
export function devtoolsFlush(store, keys, notified) {
	if (DEV) flushImpl(store, keys, notified);
}

/**
 * Report a committed navigation. Called from Router.#commitState next to the
 * dev-only warnMissingSlots walk, so document.title is already the new route's
 * (the head sync runs inside #commitLocation, immediately before).
 */
export function devtoolsRouteCommit(next) {
	if (DEV) routeCommitImpl(next);
}

// ---- registration ----------------------------------------------------------

function appMountedImpl(app) {
	try {
		if (typeof window === 'undefined') return;
		const candidate = window[HOOK_KEY];
		// Defensive: an unrelated global, an older extension, or a half-installed
		// hook must leave the runtime completely alone.
		if (
			!candidate ||
			typeof candidate.emit !== 'function' ||
			typeof candidate.onRequest !== 'function'
		) {
			return;
		}

		hook = candidate;
		boundApp = app;
		emit('hello', {
			protocolVersion: PROTOCOL_VERSION,
			frameworkVersion: FRAMEWORK_VERSION,
		});
		emit('app-mounted', {});

		try {
			hook.onRequest(handleRequest);
		} catch {
			// The hook refused the handler — stay registered for one-way events
			// rather than tearing the whole bridge down.
		}

		// Live view mount/destroy events from here on.
		setViewObserver(onViewChange);

		// Replay anything already mounted (a beforeMount hook that mounted a view,
		// or an app registered late). liveViewList() preserves mount order.
		for (const view of liveViewList()) emit('view-mounted', viewInfo(view));
	} catch {
		// The bridge must never break the app it is inspecting.
	}
}

function appUnmountedImpl(app) {
	try {
		// A different app tearing down must not unregister this one's bridge.
		if (!hook || (boundApp !== null && boundApp !== app)) return;
		emit('app-unmounted', {});
		setViewObserver(null);
		removeOverlay();
		hook = null;
		boundApp = null;
		lastChain = [];
	} catch {
		// fail-soft, as everywhere in this module
	}
}

// ---- runtime → extension events --------------------------------------------

function emit(type, payload) {
	if (!hook) return;
	try {
		hook.emit({ puzzle: 1, v: PROTOCOL_VERSION, type, payload });
	} catch {
		// An extension-side throw is the extension's problem, never the app's.
	}
}

/** devstate's view-registry observer: true on mount, false on destroy. */
function onViewChange(view, mounted) {
	if (mounted) emit('view-mounted', viewInfo(view));
	else emit('view-destroyed', { id: viewId(view) });
}

function flushImpl(store, keys, notified) {
	try {
		if (!hook) return;
		const ids = [];
		for (const sub of notified) ids.push(subscriberId(sub));
		emit('flush', { keys: [...keys], notified: ids });
	} catch {
		// never let a diagnostic break a store flush
	}
}

function routeCommitImpl(next) {
	try {
		lastChain = chainNames(next?.views);
		if (!hook) return;
		emit('route-commit', {
			pathname: next?.pathname ?? null,
			query: { ...(next?.query ?? {}) },
			params: { ...(next?.params ?? {}) },
			chain: [...lastChain],
			title: typeof document !== 'undefined' ? document.title : null,
		});
	} catch {
		// never let a diagnostic break a navigation commit
	}
}

// ---- extension → runtime requests ------------------------------------------

/**
 * The handler handed to hook.onRequest. SYNCHRONOUS and total: it returns the
 * result payload, or `{ error }` for an unknown type, a missing target, or any
 * throw from the work below (a validation failure on edit:record arrives this
 * way, carrying the real message).
 */
function handleRequest(message) {
	try {
		const type = message?.type;
		const payload = message?.payload ?? {};
		switch (type) {
			case 'snapshot:views':
				return { roots: snapshotViews() };
			case 'inspect:view':
				return inspectView(payload.id);
			case 'snapshot:records':
				return snapshotRecords(payload.type);
			case 'snapshot:subscriptions':
				return snapshotSubscriptions();
			case 'snapshot:route':
				return snapshotRoute();
			case 'edit:record':
				return editRecord(payload.type, payload.id, payload.patch);
			case 'highlight:view':
				return highlightView(payload.id, payload.on);
			case 'log:view':
				return logView(payload.id);
			case 'log:record':
				return logRecord(payload.type, payload.id);
			default:
				return { error: `unknown devtools request "${String(type)}"` };
		}
	} catch (err) {
		return { error: err?.message ?? String(err) };
	}
}

// ---- view tree --------------------------------------------------------------

/**
 * Build the live component forest WITHOUT touching any router private: walk
 * every live view's own vnode tree and read the child instances the ViewManager
 * hung off component vnodes (`vnode.component`). The walk STOPS at each
 * component boundary — a component vnode's children are either its call-site
 * slot content (which the child's own tree re-hosts, since slot expansion
 * splices the very same vnode objects) or nothing, so stopping makes every
 * instance claimed by exactly one parent. Roots are the live views nobody
 * claimed: the router's chain head, or the layout when one is configured.
 */
function snapshotViews() {
	const views = liveViewList();
	const childrenOf = new Map();
	const claimed = new Set();

	for (const view of views) {
		const kids = [];
		collectChildViews(readTree(view), kids);
		childrenOf.set(view, kids);
		for (const kid of kids) claimed.add(kid);
	}

	const roots = [];
	for (const view of views) {
		if (!claimed.has(view)) roots.push(buildTreeNode(view, childrenOf, new Set()));
	}
	return roots;
}

function readTree(view) {
	try {
		return view?._vnodeTree?.() ?? null;
	} catch {
		return null;
	}
}

function collectChildViews(vnode, out) {
	if (!vnode || typeof vnode !== 'object') return;
	if (vnode.component) {
		out.push(vnode.component);
		return; // boundary — everything below belongs to that child's own tree
	}
	// Inline-SVG seeds carry a STRING children payload, not a vnode array.
	if (!Array.isArray(vnode.children)) return;
	for (const child of vnode.children) collectChildViews(child, out);
}

function buildTreeNode(view, childrenOf, seen) {
	const node = { ...viewInfo(view), children: [] };
	// Claiming is unique, so a cycle is impossible — the guard is belt-and-braces
	// against a torn/interrupted tree rather than an expected case.
	if (seen.has(view)) return node;
	seen.add(view);
	for (const child of childrenOf.get(view) ?? []) {
		node.children.push(buildTreeNode(child, childrenOf, seen));
	}
	return node;
}

function inspectView(id) {
	const view = requireView(id);
	return {
		name: viewName(view),
		module: viewModule(view),
		// safeState is devstate's JSON-safe filter: store records, DOM nodes, and
		// functions are dropped rather than serialized (or thrown on).
		params: safeState(view.params),
		props: safeState(view.props),
		model: safeState(view._modelState?.() ?? {}),
		local: safeState(view._localState?.() ?? {}),
	};
}

// ---- store ------------------------------------------------------------------

function snapshotRecords(type) {
	const store = requireStore();
	const types = {};
	for (const [recordType, map] of store.recordsByType) {
		if (type != null && recordType !== type) continue;
		// Mirrors Store._serializeAll's shape, but names the provenance flag
		// `_synced` (the persistence wire shape calls it `__synced`) — this is a
		// live inspection payload, not something that will ever be re-hydrated.
		types[recordType] = [...map.values()].map((record) => ({
			...record.toJSON(),
			_synced: record._synced,
		}));
	}
	return { types };
}

/**
 * The subscription graph, both ways. Function subscribers have no stable
 * identity to hand across the wire, so they all report as the literal 'fn' —
 * which means byView merges them into a single 'fn' bucket by design.
 */
function snapshotSubscriptions() {
	const store = requireStore();
	const byKey = {};
	for (const [key, subs] of store.subscribersByKey) {
		byKey[key] = [...subs].map(subscriberId);
	}
	const byView = {};
	for (const [sub, keys] of store.keysBySubscriber) {
		const id = subscriberId(sub);
		const bucket = (byView[id] ??= []);
		for (const key of keys) if (!bucket.includes(key)) bucket.push(key);
	}
	return { byKey, byView };
}

function editRecord(type, id, patch) {
	const store = requireStore();
	if (!patch || typeof patch !== 'object') {
		return { error: 'edit:record requires an object patch' };
	}
	const record = findRecord(store, type, id);
	if (!record) return { error: `no ${type} record with id ${JSON.stringify(id)}` };
	try {
		// The REAL mutation path: validation, primary-key immutability, store
		// notification and batched persistence all behave exactly as app code.
		record.update(patch);
	} catch (err) {
		return { error: err?.message ?? String(err) };
	}
	return { ok: true };
}

function findRecord(store, type, id) {
	const map = store.recordsByType.get(type);
	if (!map) return null;
	const direct = map.get(id);
	if (direct) return direct;
	// The extension round-trips ids through JSON, so a numeric primary key can
	// arrive as a string (and vice versa). Fall back to a loose match.
	for (const [key, record] of map) {
		if (String(key) === String(id)) return record;
	}
	return null;
}

// ---- router -----------------------------------------------------------------

/**
 * router.current, made JSON-safe: its `chain` is route ENTRIES (view classes,
 * guards) and its `route` is one of them, so both are projected — `routes` to
 * the entries' path patterns, `chain` to the committed chain's VIEW names
 * (captured at commit time, since `current` exposes no instances).
 */
function snapshotRoute() {
	const current = boundApp?.router?.current ?? null;
	if (!current) return null;
	return {
		path: current.path ?? null,
		pathname: current.pathname ?? null,
		query: { ...(current.query ?? {}) },
		hash: current.hash ?? '',
		params: { ...(current.params ?? {}) },
		route: typeof current.route?.path === 'string' ? current.route.path : null,
		routes: Array.isArray(current.chain)
			? current.chain.map((entry) => entry?.path ?? null)
			: [],
		chain: [...lastChain],
		title: typeof document !== 'undefined' ? document.title : null,
	};
}

// ---- highlight + log --------------------------------------------------------

function highlightView(id, on) {
	if (on === false) {
		removeOverlay();
		return { ok: true };
	}
	const view = requireView(id);
	const element = view.element;
	// A view whose data() is still in flight occupies its position with a comment
	// placeholder — nothing to outline.
	if (!element || typeof element.getBoundingClientRect !== 'function') {
		removeOverlay();
		return { ok: false };
	}
	const node = ensureOverlay();
	if (!node) return { ok: false };
	const rect = element.getBoundingClientRect();
	node.style.left = `${rect.left}px`;
	node.style.top = `${rect.top}px`;
	node.style.width = `${rect.width}px`;
	node.style.height = `${rect.height}px`;
	return { ok: true };
}

function ensureOverlay() {
	if (typeof document === 'undefined' || !document.body) return null;
	if (overlay && overlay.isConnected) return overlay;
	overlay = document.createElement('div');
	overlay.setAttribute(OVERLAY_MARK, 'highlight');
	const style = overlay.style;
	style.position = 'fixed';
	style.pointerEvents = 'none';
	style.zIndex = '2147483647';
	style.background = 'rgba(88, 132, 255, 0.28)';
	style.outline = '1px solid rgba(88, 132, 255, 0.9)';
	style.borderRadius = '2px';
	document.body.appendChild(overlay);
	return overlay;
}

function removeOverlay() {
	try {
		overlay?.remove();
	} catch {
		// a detached/half-torn-down document — nothing to clean up
	}
	overlay = null;
}

function logView(id) {
	const view = requireView(id);
	publishInspectGlobal(view);
	console.log('[puzzle] view', viewInfo(view), view);
	return { ok: true };
}

function logRecord(type, id) {
	const store = requireStore();
	const record = findRecord(store, type, id);
	if (!record) return { error: `no ${type} record with id ${JSON.stringify(id)}` };
	publishInspectGlobal(record);
	console.log(`[puzzle] record ${type}#${id}`, record);
	return { ok: true };
}

/** The DevTools console convenience handle, mirroring $0/$r conventions. */
function publishInspectGlobal(value) {
	if (typeof window !== 'undefined') window.$p = value;
}

// ---- identity helpers -------------------------------------------------------

function viewId(view) {
	if (!view) return null;
	let id = viewIds.get(view);
	if (id === undefined) {
		id = nextViewId++;
		viewIds.set(view, id);
	}
	return id;
}

function viewName(view) {
	return view?.constructor?.name || 'View';
}

/** The codegen-stamped app-root-relative source path (D81), or null for a hand-written class. */
function viewModule(view) {
	return view?.constructor?.__pzlModule ?? null;
}

function viewInfo(view) {
	return { id: viewId(view), name: viewName(view), module: viewModule(view) };
}

function chainNames(views) {
	return Array.isArray(views) ? views.map(viewName) : [];
}

function subscriberId(sub) {
	return typeof sub === 'function' ? 'fn' : viewId(sub);
}

function requireView(id) {
	for (const view of liveViewList()) {
		if (viewIds.get(view) === id) return view;
	}
	throw new Error(`no live view with id ${JSON.stringify(id)}`);
}

function requireStore() {
	let store = null;
	try {
		// app.store's getter throws before mount / after unmount by design.
		store = boundApp?.store ?? null;
	} catch {
		store = null;
	}
	if (!store) throw new Error('no store — the app is not mounted');
	return store;
}

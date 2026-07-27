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
 *
 * The same direction holds for the profiler (devperf.js, SPEC §56, D121): this
 * module subscribes to devperf's event sink and aggregates a recording for the
 * extension's Performance panel. devperf knows nothing about the protocol, and
 * the panel never sees devperf's own view numbering — see the profiler section
 * below for why that distinction is load-bearing.
 */

import { devperfInstallSink } from './devperf.js';
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
// literal — BUMP IT WITH package.json AT EVERY RELEASE (D100). `release:prep`
// asserts this matches package.json, because the instruction above was not
// enough on its own: it silently stayed at 0.3.0 through the 0.3.1 bump.
const FRAMEWORK_VERSION = '0.3.1';

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

// The devperf sink detach function while this bridge is registered, else null.
let perfDetach = null;

// The current recording, or null before the first perf:start — which is the
// difference between "0 renders measured" and "never recorded" (the report
// distinguishes them; see profileReport).
let profile = null;

// The flush row awaiting its duration. devtoolsFlush() runs inside the store's
// notify step and knows the KEYS; devperf's 'store-flush' event fires at the end
// of the same synchronous flush() and knows the DURATION. This one-slot handoff
// joins them — and because the inner flush of a re-entrant pair completes first,
// each event fills the row its own flush pushed.
let pendingFlushRow = null;

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

		// Profiler events from here on too. The sink is attached for the whole
		// session rather than only between perf:start and perf:stop: accumulation
		// is gated on `profile`, but a LOOP DETECTION is worth pushing whenever a
		// panel is attached, not only when someone happens to be recording.
		// Detach first so a re-registration replaces its sink the way
		// setViewObserver above replaces its observer — one slot, not a pile.
		perfDetach?.();
		perfDetach = devperfInstallSink(onPerfEvent);

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
		perfDetach?.();
		perfDetach = null;
		profile = null;
		pendingFlushRow = null;
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
		// The store-side half of a recording comes from HERE rather than from
		// devperf's 'store-flush' event, because only this call site carries the
		// changed KEYS (devperf keeps a count). Note the deliberate shape
		// difference the panel documents: the flush EVENT reports `notified` as
		// subscriber ids, the profile reports it as a count.
		if (profile?.recording) recordProfileFlush(keys, ids.length);
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
			case 'perf:start':
				return startProfile();
			case 'perf:stop':
				return stopProfile();
			case 'snapshot:profile':
				return profileReport();
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

// ---- profiler (D121) --------------------------------------------------------

/**
 * The seam between devperf's event sink and the extension's Performance panel.
 *
 * Two things make this a translation layer rather than a pass-through:
 *
 * 1. IDENTITY. devperf numbers views in its OWN space (the id on its private
 *    profiling state). The panel cross-links a profile row into the Views panel
 *    by the id THIS module hands out, so a row keyed by devperf's number would
 *    look right and silently link to the wrong view — or to nothing. Every row
 *    is therefore keyed by viewId(instance), the same session-scoped WeakMap id
 *    `view-mounted` and `inspect:view` use, which is why devperf passes each
 *    event its subject instance alongside the payload.
 * 2. RECORDING. devperf's totals are process-lifetime counters that never reset
 *    — measureRenders() and the __PUZZLE_PERF__ console handle both depend on
 *    that. A panel recording is a WINDOW between perf:start and perf:stop, so
 *    the window is accumulated here instead.
 *
 * Rows hold a view's ID, never the view, so a view destroyed mid-recording keeps
 * its row (the panel marks it "no longer mounted") with nothing pinned in memory.
 *
 * Everything about a profile is PULLED — the panel polls snapshot:profile while
 * recording — because a per-render event would be a firehose that overruns both
 * the hook's pre-attach buffer and the panel's message ring. The one push is
 * `perf-warning`, emitted only when devperf's loop detector actually trips.
 */

/** The rolling cap on the flush timeline. Totals stay exact; only rows drop off. */
const FLUSH_RING = 200;

/** The re-render cause buckets a profile row reports, in the panel's print order. */
const CAUSE_KEYS = ['data', 'store', 'parent', 'route', 'manual', 'slot'];

/**
 * devperf's cause vocabulary → those buckets. An unmapped cause is counted under
 * its own name rather than dropped: the panel appends causes it does not know,
 * so a cause a newer runtime starts emitting stays visible without a panel
 * update.
 */
const CAUSE_BUCKET = {
	initial: 'data', // the mount's first data() run
	refresh: 'data', // an explicit refresh() re-ran data()
	store: 'store',
	props: 'parent', // a parent re-render passed new props down
	route: 'route',
	'local-state': 'manual', // setData()
	render: 'manual', // a direct rerender() with nothing else pending
	slots: 'slot',
};

/** devperf's loop-detector kinds → the protocol's. */
const WARNING_KIND = {
	recursive: 'recursive-loop',
	'cross-frame': 'runaway-rerender',
};

/** Begin (or restart) a recording. Counters before this point are not in it. */
function startProfile() {
	profile = {
		startedAt: Date.now(),
		stoppedAt: 0,
		recording: true,
		views: new Map(),
		dataRuns: 0,
		storeFlushes: 0,
		storeNotifications: 0,
		flushes: [],
		warnings: new Map(),
	};
	pendingFlushRow = null;
	return { ok: true };
}

/** Freeze the recording. The report stays readable — and final — afterwards. */
function stopProfile() {
	if (profile?.recording) {
		profile.recording = false;
		profile.stoppedAt = Date.now();
	}
	pendingFlushRow = null;
	return { ok: true };
}

/**
 * The whole report, rebuilt per request so the extension never shares our
 * objects. Before the first recording this is the zeroed shape, NOT null: the
 * panel renders the report unconditionally.
 */
function profileReport() {
	if (!profile) {
		return {
			recording: false,
			durationMs: 0,
			totals: emptyProfileTotals(),
			views: [],
			flushes: [],
			warnings: [],
		};
	}

	const totals = emptyProfileTotals();
	const views = [];
	for (const row of profile.views.values()) {
		totals.renders += row.renders;
		totals.wastedRenders += row.wastedRenders;
		totals.domMutations += row.domMutations;
		views.push({
			...row,
			renderMs: round2(row.renderMs),
			patchMs: round2(row.patchMs),
			dataMs: round2(row.dataMs),
			causes: { ...row.causes },
		});
	}
	totals.dataRuns = profile.dataRuns;
	// From the running counters, never from the ring: a long recording drops old
	// flush ROWS but must not under-report how many flushes there were.
	totals.storeFlushes = profile.storeFlushes;
	totals.storeNotifications = profile.storeNotifications;

	return {
		recording: profile.recording,
		durationMs: (profile.recording ? Date.now() : profile.stoppedAt) - profile.startedAt,
		totals,
		views,
		flushes: profile.flushes.map((flush) => ({ ...flush, keys: [...flush.keys] })),
		warnings: [...profile.warnings.values()].map((warning) => ({ ...warning })),
	};
}

function emptyProfileTotals() {
	return {
		renders: 0,
		wastedRenders: 0,
		domMutations: 0,
		dataRuns: 0,
		storeFlushes: 0,
		storeNotifications: 0,
	};
}

/**
 * devperf's sink. `subject` is the instance the event is about — a view for
 * every case below, and the only way to reach this module's id space.
 */
function onPerfEvent(event, subject) {
	try {
		// A loop detection is pushed whenever a panel is attached, recording or
		// not: it is the one thing a developer must not have to be recording to
		// find out about.
		if (event.type === 'loop') {
			profileWarning(event, subject);
			return;
		}
		if (!profile?.recording) return;

		switch (event.type) {
			case 'render': {
				const row = profileRow(subject);
				if (!row) return;
				row.renders++;
				if (event.wasted) row.wastedRenders++;
				row.domMutations += event.domMutations;
				row.renderMs += event.treeDuration;
				row.patchMs += event.patchDuration;
				for (const cause of event.causes) countCause(row, cause);
				return;
			}
			case 'data': {
				// Counted per RUN rather than derived from causes: the event fires
				// once per data() call (at settle, for an async one), which is the
				// number the panel's "data() runs" tile means.
				profile.dataRuns++;
				const row = profileRow(subject);
				if (row) row.dataMs += event.duration;
				return;
			}
			case 'memo': {
				const row = profileRow(subject);
				if (!row) return;
				if (event.hit) row.memoHits++;
				else row.memoMisses++;
				return;
			}
			case 'component-props': {
				const row = profileRow(subject);
				if (!row) return;
				if (event.bailedOut) row.propsBailouts++;
				else row.propsReruns++;
				return;
			}
			case 'store-flush': {
				// The duration half of the row devtoolsFlush() pushed earlier in
				// this same synchronous flush().
				if (pendingFlushRow) {
					pendingFlushRow.durationMs = round2(event.duration);
					pendingFlushRow = null;
				}
				return;
			}
			default:
				// 'slot-render' and 'tracking-deferral' need no row of their own: a
				// slot render already marks the next render's cause, and deferrals
				// are a chain-level concern the report does not model.
				return;
		}
	} catch {
		// A profiler must never break the app it is measuring.
	}
}

function profileRow(view) {
	if (!view || !profile) return null;
	const id = viewId(view);
	let row = profile.views.get(id);
	if (row) return row;
	const causes = {};
	for (const key of CAUSE_KEYS) causes[key] = 0;
	row = {
		...viewInfo(view),
		renders: 0,
		wastedRenders: 0,
		domMutations: 0,
		renderMs: 0,
		patchMs: 0,
		dataMs: 0,
		causes,
		memoHits: 0,
		memoMisses: 0,
		propsBailouts: 0,
		propsReruns: 0,
	};
	profile.views.set(id, row);
	return row;
}

function countCause(row, cause) {
	const bucket = CAUSE_BUCKET[cause] ?? cause;
	row.causes[bucket] = (row.causes[bucket] ?? 0) + 1;
}

/**
 * Push one loop detection AND fold it into the report.
 *
 * Both halves matter: the event reaches an attached panel immediately, while the
 * report entry is what a panel opened later still finds. Re-firing the same
 * detection increments `count` instead of adding a row — the panel dedupes by
 * kind + view and keeps the higher count, since it is simply the later
 * observation of one ongoing loop.
 *
 * The push is unconditional (a loop matters whether or not anyone is recording);
 * the FOLD only happens while the recording is open, because perf:stop freezes
 * the report — a detection after the stop must not rewrite a finished window.
 */
function profileWarning(event, subject) {
	const kind = WARNING_KIND[event.kind] ?? event.kind ?? 'unknown';
	const id = subject ? viewId(subject) : null;
	const name = subject ? viewName(subject) : (event.viewName ?? null);
	// devperf's own message already names the view and the numbers that tripped
	// the detector, which is exactly what the panel prints as the detail line.
	const detail = event.message ?? '';
	let count = 1;
	if (profile?.recording) {
		const key = `${kind}#${id ?? '?'}`;
		const existing = profile.warnings.get(key);
		if (existing) {
			existing.count++;
			count = existing.count;
		} else {
			profile.warnings.set(key, { kind, viewId: id, name, detail, count });
		}
	}
	emit('perf-warning', { kind, viewId: id, name, detail, count });
}

function recordProfileFlush(keys, notified) {
	profile.storeFlushes++;
	profile.storeNotifications += notified;
	const row = { at: Date.now(), keys: [...keys], notified, durationMs: 0 };
	profile.flushes.push(row);
	if (profile.flushes.length > FLUSH_RING) profile.flushes.shift();
	pendingFlushRow = row;
}

/** performance.now() is fractional; two decimals is all the panel prints. */
function round2(value) {
	return Math.round(value * 100) / 100;
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

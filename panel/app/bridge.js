/**
 * bridge.js — the seam between panel-glue (chrome ports) and the panel's store.
 *
 * Everything chrome-shaped stops here. Views never see `chrome.*`, never see a
 * postMessage envelope, and never poll: protocol events land as store upserts,
 * so the panel's reactivity is ordinary Puzzle reactivity.
 *
 * Requests go the other way — `bridge.request(type, payload)` returns a promise
 * of the runtime's result payload — and are re-exported here so views can call
 * them without reaching for the global.
 */
import {
	EVENTS,
	REQUESTS,
	PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
	isEnvelope,
} from '../../protocol/constants.js';
import { CONNECTION_ID, CONNECTION_STATE } from './models/connection.js';
import { UI_ID } from './models/ui.js';
import { subscriptionKind, subscriptionParts } from './values.js';

/** Ring capacity for the `event` model. Oldest records are destroyed past this. */
export const EVENT_LIMIT = 200;

/**
 * Ring capacity for `profileSample`. One sample per poll tick at
 * `Performance.pzl`'s interval, so this is about a minute of recording — enough
 * history to be useful, bounded so a recording left running overnight cannot
 * grow the panel without limit.
 */
export const PROFILE_SAMPLE_LIMIT = 60;

/** How long a re-rendered row stays lit after the flush that notified it. */
export const PULSE_MS = 600;

let store = null;
let bridge = null;
let pulseTimer = null;

/** Shared `snapshot:subscriptions` de-duplication — see `ensureSubscriptions`. */
let subscriptionsInFlight = null;
let subscriptionsFetchedAt = 0;

/** Shared `snapshot:views` de-duplication — see `ensureViews`. */
let viewsInFlight = null;
let viewsFetchedAt = 0;

/**
 * Sample sequence for the `profileSample` ring. Like `eventSeq` it is monotonic
 * for the life of the panel and deliberately NOT reset by `resetSession` — an
 * in-flight `snapshot:profile` answering after a page navigation must land on a
 * fresh id rather than resurrecting a sample number the previous document used.
 */
let profileSeq = 0;

/**
 * The stand-in used when the panel runs outside DevTools (`puzzle dev`, tests).
 * Same shape, no behavior — the panel renders its "no Puzzle app detected"
 * state and every request rejects.
 */
function offlineBridge() {
	const noop = () => () => {};
	return {
		tabId: null,
		themeName: 'default',
		offline: true,
		onMessage: noop,
		onStatus: noop,
		onNavigated: noop,
		request: () => Promise.reject(new Error('puzzle-devtools: panel is not attached to a tab')),
		sendListening: () => false,
	};
}

/** Wire the glue's bridge into a store. Call once, before app.mount(). */
export function installBridge(targetStore, injected) {
	store = targetStore;
	bridge =
		injected ||
		(typeof window !== 'undefined' && window.__PUZZLE_DEVTOOLS_PANEL__) ||
		offlineBridge();

	resetSession({ port: bridge.offline ? 'disconnected' : 'connected' });

	bridge.onMessage((message) => {
		try {
			receive(message);
		} catch (err) {
			console.error('[puzzle-devtools] failed to apply protocol message', message, err);
			patchConnection({ error: String(err && err.message ? err.message : err) });
		}
	});

	bridge.onStatus((status) => patchConnection({ port: status }));

	// A reload or a cross-document navigation means a brand-new hook: view ids
	// restart at 1 and no `hello` has been seen yet, so nothing from the previous
	// document is still true.
	bridge.onNavigated(() => resetSession({ port: 'connected' }));

	bridge.sendListening();
	return bridge;
}

/** The installed bridge — for views that need `request()`. */
export function getBridge() {
	return bridge || offlineBridge();
}

/** Convenience wrappers over the SPEC §55 request set. */
export const api = {
	snapshotViews: () => getBridge().request(REQUESTS.SNAPSHOT_VIEWS),
	inspectView: (id) => getBridge().request(REQUESTS.INSPECT_VIEW, { id }),
	snapshotRecords: (type) => getBridge().request(REQUESTS.SNAPSHOT_RECORDS, type ? { type } : {}),
	snapshotSubscriptions: () => getBridge().request(REQUESTS.SNAPSHOT_SUBSCRIPTIONS),
	snapshotRoute: () => getBridge().request(REQUESTS.SNAPSHOT_ROUTE),
	editRecord: (type, id, patch) => getBridge().request(REQUESTS.EDIT_RECORD, { type, id, patch }),
	highlightView: (id, on) => getBridge().request(REQUESTS.HIGHLIGHT_VIEW, { id, on }),
	logView: (id) => getBridge().request(REQUESTS.LOG_VIEW, { id }),
	logRecord: (type, id) => getBridge().request(REQUESTS.LOG_RECORD, { type, id }),

	/*
	 * Profiler. A runtime that predates it answers these with an `{ error }`
	 * result, which panel-glue turns into a rejection — so the Performance panel
	 * reports "this app's framework has no profiler" on one code path and every
	 * other panel keeps working. That is the whole reason these went in without a
	 * protocol version bump.
	 */
	perfStart: () => getBridge().request(REQUESTS.PERF_START, {}),
	perfStop: () => getBridge().request(REQUESTS.PERF_STOP, {}),
	snapshotProfile: () => getBridge().request(REQUESTS.SNAPSHOT_PROFILE, {}),
};

/* -------------------------------------------------------------------------- */
/* Inbound protocol messages                                                   */
/* -------------------------------------------------------------------------- */

function receive(message) {
	if (!isEnvelope(message)) return;

	recordEvent(message);

	switch (message.type) {
		case EVENTS.HELLO:
			onHello(message);
			break;
		case EVENTS.APP_MOUNTED:
			patchConnection({ appMounted: true });
			break;
		case EVENTS.APP_UNMOUNTED:
			patchConnection({ appMounted: false });
			markAllViewsDead();
			break;
		case EVENTS.VIEW_MOUNTED:
			onViewMounted(message.payload);
			break;
		case EVENTS.VIEW_DESTROYED:
			onViewDestroyed(message.payload);
			break;
		case EVENTS.FLUSH:
			onFlush(message.payload);
			break;
		case EVENTS.ROUTE_COMMIT:
			patchConnection({ route: message.payload || null });
			break;
		case EVENTS.PERF_WARNING:
			onPerfWarning();
			break;
		default:
			// A newer runtime emitting an event this build predates: it still shows
			// up in the event list, it just drives no dedicated state.
			break;
	}
}

function onHello(message) {
	const payload = message.payload || {};
	const runtimeProtocol = payload.protocolVersion ?? message.v ?? null;
	const supported = SUPPORTED_PROTOCOL_VERSIONS.includes(runtimeProtocol);
	patchConnection({
		state: supported ? CONNECTION_STATE.CONNECTED : CONNECTION_STATE.MISMATCH,
		protocolVersion: runtimeProtocol,
		frameworkVersion: payload.frameworkVersion ?? null,
		error: null,
	});
}

function onViewMounted(payload) {
	if (!payload || typeof payload.id !== 'number') return;
	store.upsert('pview', {
		id: payload.id,
		name: payload.name || 'View',
		module: payload.module ?? null,
		live: true,
	});
	bumpViewSeq();
}

function onViewDestroyed(payload) {
	if (!payload || typeof payload.id !== 'number') return;
	const view = store.findOne('pview', payload.id);
	if (view) view.update({ live: false, childIds: [], parentId: null });
	bumpViewSeq();
}

function markAllViewsDead() {
	for (const view of store.findMany('pview')) {
		if (view.live) view.update({ live: false, childIds: [], parentId: null });
	}
	bumpViewSeq();
}

/** The tree is stale — the Views panel debounces a `snapshot:views` off this. */
function bumpViewSeq() {
	const connection = store.findOne('connection', CONNECTION_ID);
	patchConnection({ viewSeq: (connection?.viewSeq ?? 0) + 1 });
}

/**
 * The loop detector fired. The warning's own payload needs no special handling —
 * `recordEvent` already put it in the ring, where the Performance panel reads it
 * for the immediate banner — so all this does is move the counter that panel
 * debounces a `snapshot:profile` off, which is what pulls the authoritative
 * report even when nothing is recording.
 */
function onPerfWarning() {
	const connection = store.findOne('connection', CONNECTION_ID);
	patchConnection({ perfSeq: (connection?.perfSeq ?? 0) + 1 });
}

function onFlush(payload) {
	const keys = Array.isArray(payload?.keys) ? payload.keys : [];
	const notified = Array.isArray(payload?.notified) ? payload.notified : [];
	const connection = store.findOne('connection', CONNECTION_ID);
	patchConnection({
		lastFlushKeys: keys,
		flushSeq: (connection?.flushSeq ?? 0) + 1,
	});

	// Store keys are either a bare type ('todo') or `type id` — the runtime joins
	// them with a SPACE (store.js REC_SEP), so the segment before the first space
	// names the bucket whose snapshot went stale.
	for (const key of keys) {
		const bucket = store.findOne('recordType', subscriptionParts(key).type);
		if (bucket) bucket.update({ dirty: true });
	}

	pulseViews(notified);
	pulseSubscriptions(keys);
}

/**
 * Light up the subscription keys this flush named. Same 600ms class discipline
 * as the tree's rows, and the same shared timer clears both.
 */
function pulseSubscriptions(keys) {
	const now = Date.now();
	let lit = false;
	for (const key of keys) {
		const entry = store.findOne('subscription', String(key));
		if (!entry) continue;
		entry.update({ pulseAt: now });
		lit = true;
	}
	if (!lit) return;
	clearTimeout(pulseTimer);
	pulseTimer = setTimeout(clearPulses, PULSE_MS);
}

/**
 * Light up the views this flush actually re-rendered. `notified` carries view
 * ids plus the literal 'fn' for function subscribers (SPEC §55) — the lookup
 * simply misses on those.
 *
 * One shared timer clears every pulse: overlapping flushes extend the glow
 * rather than each arming their own timeout, which keeps a chatty app from
 * queueing hundreds of timers.
 */
function pulseViews(notified) {
	const now = Date.now();
	let lit = false;
	for (const id of notified) {
		const view = store.findOne('pview', id);
		if (!view) continue;
		view.update({ pulseAt: now });
		lit = true;
	}
	if (!lit) return;
	clearTimeout(pulseTimer);
	pulseTimer = setTimeout(clearPulses, PULSE_MS);
}

function clearPulses() {
	pulseTimer = null;
	if (!store) return;
	for (const view of store.findMany('pview')) {
		if (view.pulseAt) view.update({ pulseAt: 0 });
	}
	for (const entry of store.findMany('subscription')) {
		if (entry.pulseAt) entry.update({ pulseAt: 0 });
	}
}

/* -------------------------------------------------------------------------- */
/* Snapshot → store                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Fold a `snapshot:views` answer into the `pview` collection.
 *
 * The response is the recursive `{ id, name, module, children }` forest; the
 * store keeps it flat, with `parentId`/`childIds`/`depth`/`order` reconstructing
 * it. Flat is what the panel wants: rows are keyed by id, so an expand/collapse
 * or a re-snapshot patches individual rows instead of replacing a nested list.
 *
 * The snapshot is authoritative about what is LIVE — the runtime only walks
 * mounted views — so anything it does not name is marked dead here. That is the
 * path a destroyed view takes when its `view-destroyed` event was dropped
 * (buffer overflow, a panel attached mid-session).
 *
 * @returns {number} how many live views the snapshot described.
 */
export function applyViewSnapshot(roots) {
	if (!store) return 0;
	const seen = new Set();
	let order = 0;

	const walk = (nodes, parentId, depth) => {
		for (const node of Array.isArray(nodes) ? nodes : []) {
			if (!node || typeof node.id !== 'number') continue;
			const children = Array.isArray(node.children) ? node.children : [];
			store.upsert('pview', {
				id: node.id,
				name: node.name || 'View',
				module: node.module ?? null,
				parentId,
				childIds: children.filter((c) => c && typeof c.id === 'number').map((c) => c.id),
				depth,
				order: order++,
				live: true,
			});
			seen.add(node.id);
			walk(children, node.id, depth + 1);
		}
	};
	walk(roots, null, 0);

	for (const view of store.findMany('pview')) {
		if (seen.has(view.id)) continue;
		if (view.live || view.childIds.length || view.parentId != null) {
			view.update({ live: false, childIds: [], parentId: null });
		}
	}
	return seen.size;
}

/**
 * Fold a `snapshot:records` answer into the `recordType` collection. `type` is
 * the filter that produced it: a filtered snapshot must not delete the buckets
 * it deliberately left out.
 */
export function applyRecordSnapshot(result, type) {
	if (!store) return [];
	const buckets = result?.types ?? {};
	const names = [];
	for (const [name, records] of Object.entries(buckets)) {
		const rows = Array.isArray(records) ? records : [];
		store.upsert('recordType', {
			id: name,
			records: rows,
			count: rows.length,
			dirty: false,
			snapshotAt: Date.now(),
		});
		names.push(name);
	}
	if (type == null) {
		// An unfiltered snapshot is the whole store: a type that vanished from it
		// no longer exists in the app.
		for (const bucket of store.findMany('recordType')) {
			if (!names.includes(bucket.id)) bucket.destroy();
		}
	}
	return names;
}

/**
 * Fold a `snapshot:subscriptions` answer into the store — BOTH directions at
 * once, because the runtime sends both and two consumers want different halves:
 * the Subscriptions panel reads `byKey` off the `subscription` collection, and
 * the Views inspector reads `byView` off each `pview`'s `subKeys`.
 *
 * Doing it here is what makes one request serve both panels.
 */
export function applySubscriptionSnapshot(result) {
	if (!store) return 0;

	const byKey = result?.byKey && typeof result.byKey === 'object' ? result.byKey : {};
	const seen = new Set();
	for (const [key, subscribers] of Object.entries(byKey)) {
		const list = Array.isArray(subscribers) ? subscribers : [];
		store.upsert('subscription', {
			id: key,
			subscribers: list,
			count: list.length,
			kind: subscriptionKind(key),
		});
		seen.add(key);
	}
	// A key nobody subscribes to any more is gone, not empty.
	for (const entry of store.findMany('subscription')) {
		if (!seen.has(entry.id)) entry.destroy();
	}

	const byView = result?.byView && typeof result.byView === 'object' ? result.byView : {};
	for (const view of store.findMany('pview')) {
		// byView keys arrive as JSON object keys, so a numeric view id is a string.
		const keys = byView[String(view.id)];
		const next = Array.isArray(keys) ? keys : [];
		if (next.length !== view.subKeys.length || next.some((k, i) => k !== view.subKeys[i])) {
			view.update({ subKeys: next });
		}
	}
	return seen.size;
}

/**
 * Fold a `snapshot:profile` answer into the capped `profileSample` ring.
 *
 * The report is stored WHOLE and raw. Splitting it into per-view records was the
 * obvious alternative and is wrong here: a sample is a coherent measurement of
 * one instant, its `views` array is already keyed and ordered by the runtime,
 * and the panel always renders exactly one sample. Per-view records would add a
 * reconciliation pass (which views vanished since the last poll?) that buys
 * nothing, once a second.
 *
 * @returns {object|null} the stored sample record.
 */
export function applyProfileSnapshot(report) {
	if (!store) return null;
	const source = report && typeof report === 'object' ? report : {};

	profileSeq += 1;
	store.upsert('profileSample', {
		id: profileSeq,
		at: Date.now(),
		recording: source.recording === true,
		durationMs: Number.isFinite(source.durationMs) ? source.durationMs : 0,
		totals: source.totals && typeof source.totals === 'object' ? source.totals : {},
		views: Array.isArray(source.views) ? source.views : [],
		flushes: Array.isArray(source.flushes) ? source.flushes : [],
		warnings: Array.isArray(source.warnings) ? source.warnings : [],
	});

	const samples = store.findMany('profileSample');
	if (samples.length > PROFILE_SAMPLE_LIMIT) {
		// Same discipline as the event ring: ids only increase, so findMany's
		// insertion order puts the oldest samples at the head.
		const overflow = samples.length - PROFILE_SAMPLE_LIMIT;
		for (let i = 0; i < overflow; i++) samples[i].destroy();
	}

	return store.findOne('profileSample', profileSeq);
}

/**
 * One `snapshot:subscriptions` per debounce window, shared by every caller.
 *
 * The Views inspector and the Subscriptions panel both want this data and can
 * ask within milliseconds of each other (selecting a view in one navigates to
 * the other). A single in-flight promise plus a freshness window means the
 * second caller joins the first request instead of issuing its own.
 */
export function ensureSubscriptions({ maxAgeMs = 250, force = false } = {}) {
	if (!force && subscriptionsInFlight) return subscriptionsInFlight;
	if (!force && Date.now() - subscriptionsFetchedAt < maxAgeMs) {
		return Promise.resolve(null);
	}
	subscriptionsInFlight = api
		.snapshotSubscriptions()
		.then((result) => {
			subscriptionsFetchedAt = Date.now();
			applySubscriptionSnapshot(result);
			return result;
		})
		.finally(() => {
			subscriptionsInFlight = null;
		});
	return subscriptionsInFlight;
}

/**
 * One `snapshot:views` per debounce window, shared the same way.
 *
 * The Subscriptions panel resolves subscriber IDS against the `pview`
 * collection for a name and module, so it needs the tree even though it never
 * draws one — otherwise a panel opened straight to /subscriptions can only show
 * bare `#2` ids.
 */
export function ensureViews({ maxAgeMs = 250, force = false } = {}) {
	if (!force && viewsInFlight) return viewsInFlight;
	if (!force && Date.now() - viewsFetchedAt < maxAgeMs) return Promise.resolve(null);
	viewsInFlight = api
		.snapshotViews()
		.then((result) => {
			viewsFetchedAt = Date.now();
			applyViewSnapshot(result?.roots);
			return result;
		})
		.finally(() => {
			viewsInFlight = null;
		});
	return viewsInFlight;
}

/** Ask the Views panel to select `id` the next time it renders. */
export function requestViewSelection(id) {
	if (!store) return;
	const current = store.findOne('ui', UI_ID);
	if (current) current.update({ pendingViewId: id });
	else store.upsert('ui', { id: UI_ID, pendingViewId: id });
}

/** Consume the pending selection, if any. Reading it clears it. */
export function takeViewSelection() {
	if (!store) return null;
	const current = store.findOne('ui', UI_ID);
	const pending = current?.pendingViewId ?? null;
	if (pending != null) current.update({ pendingViewId: null });
	return pending;
}

/* -------------------------------------------------------------------------- */
/* Store helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Merge fields into the singleton connection record, creating it if needed. */
export function patchConnection(patch) {
	if (!store) return null;
	const current = store.findOne('connection', CONNECTION_ID);
	if (!current) {
		store.upsert('connection', { id: CONNECTION_ID, ...patch });
		return store.findOne('connection', CONNECTION_ID);
	}
	current.update(patch);
	return current;
}

/** Drop everything the previous document told us and start listening again. */
export function resetSession({ port = 'connected' } = {}) {
	if (!store) return;
	clearTimeout(pulseTimer);
	pulseTimer = null;
	subscriptionsInFlight = null;
	subscriptionsFetchedAt = 0;
	viewsInFlight = null;
	viewsFetchedAt = 0;
	for (const view of store.findMany('pview')) view.destroy();
	for (const event of store.findMany('event')) event.destroy();
	for (const bucket of store.findMany('recordType')) bucket.destroy();
	for (const entry of store.findMany('subscription')) entry.destroy();
	// Every collection the bridge writes has to be listed here. A profile
	// describes one document's views by their session-scoped ids, so surviving a
	// reload would leave the Performance panel reporting counters for views that
	// no longer exist under ids the new document is about to reuse.
	for (const sample of store.findMany('profileSample')) sample.destroy();
	const ui = store.findOne('ui', UI_ID);
	if (ui) ui.update({ pendingViewId: null });

	const existing = store.findOne('connection', CONNECTION_ID);
	const fresh = {
		id: CONNECTION_ID,
		state: CONNECTION_STATE.WAITING,
		port,
		protocolVersion: null,
		frameworkVersion: null,
		appMounted: false,
		route: null,
		lastFlushKeys: [],
		viewSeq: 0,
		flushSeq: 0,
		perfSeq: 0,
		eventCount: 0,
		lastEventAt: 0,
		error: null,
	};
	if (existing) existing.update(fresh);
	else store.upsert('connection', fresh);
}

/** Push one message onto the capped event ring. */
function recordEvent(message) {
	const id = nextEventId();
	store.upsert('event', {
		id,
		type: message.type,
		at: Date.now(),
		summary: summarize(message),
		payload: message.payload ?? {},
	});

	const events = store.findMany('event');
	if (events.length > EVENT_LIMIT) {
		// findMany preserves insertion order and ids only ever increase, so the
		// head of the list is the oldest.
		const overflow = events.length - EVENT_LIMIT;
		for (let i = 0; i < overflow; i++) events[i].destroy();
	}

	const connection = store.findOne('connection', CONNECTION_ID);
	patchConnection({
		eventCount: (connection?.eventCount ?? 0) + 1,
		lastEventAt: Date.now(),
	});
}

let eventSeq = 0;
function nextEventId() {
	eventSeq += 1;
	return eventSeq;
}

function summarize(message) {
	const payload = message.payload || {};
	switch (message.type) {
		case EVENTS.HELLO:
			return `puzzle ${payload.frameworkVersion ?? '?'} · protocol v${payload.protocolVersion ?? '?'}`;
		case EVENTS.VIEW_MOUNTED:
			return `#${payload.id} ${payload.name ?? 'View'}`;
		case EVENTS.VIEW_DESTROYED:
			return `#${payload.id}`;
		case EVENTS.FLUSH: {
			const keys = Array.isArray(payload.keys) ? payload.keys : [];
			const notified = Array.isArray(payload.notified) ? payload.notified.length : 0;
			return `${keys.join(', ') || 'no keys'} → ${notified} subscriber${notified === 1 ? '' : 's'}`;
		}
		case EVENTS.ROUTE_COMMIT:
			return payload.pathname ?? '(no path)';
		case EVENTS.PERF_WARNING: {
			const who = payload.name ?? (payload.viewId != null ? `#${payload.viewId}` : 'unknown view');
			const times = Number(payload.count) || 0;
			return `${payload.kind ?? 'warning'} · ${who}${times ? ` ×${times}` : ''}`;
		}
		default:
			return '';
	}
}

export { PROTOCOL_VERSION, CONNECTION_STATE, CONNECTION_ID };

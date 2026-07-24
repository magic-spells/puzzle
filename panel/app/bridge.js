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

/** Ring capacity for the `event` model. Oldest records are destroyed past this. */
export const EVENT_LIMIT = 200;

/** How long a re-rendered row stays lit after the flush that notified it. */
export const PULSE_MS = 600;

let store = null;
let bridge = null;
let pulseTimer = null;

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

function onFlush(payload) {
	const keys = Array.isArray(payload?.keys) ? payload.keys : [];
	const notified = Array.isArray(payload?.notified) ? payload.notified : [];
	const connection = store.findOne('connection', CONNECTION_ID);
	patchConnection({
		lastFlushKeys: keys,
		flushSeq: (connection?.flushSeq ?? 0) + 1,
	});

	// Store keys are either a bare type ('todo') or 'type:id' — either way the
	// segment before the first colon names the bucket whose snapshot went stale.
	for (const key of keys) {
		const type = String(key).split(':')[0];
		const bucket = store.findOne('recordType', type);
		if (bucket) bucket.update({ dirty: true });
	}

	pulseViews(notified);
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
	for (const view of store.findMany('pview')) view.destroy();
	for (const event of store.findMany('event')) event.destroy();
	for (const bucket of store.findMany('recordType')) bucket.destroy();

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
		default:
			return '';
	}
}

export { PROTOCOL_VERSION, CONNECTION_STATE, CONNECTION_ID };

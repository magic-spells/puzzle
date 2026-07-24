/**
 * Async-work tracking for @magic-spells/puzzle/testing (v1.58, D94).
 *
 * PuzzleView intentionally keeps its last-wins data() token private, and Store
 * notifications intentionally fire subscriber refreshes without returning their
 * promises. The testing module therefore instruments the framework scheduling
 * points — view refresh/render and router work — when a helper is first used.
 * Production runtime imports never reach this module, so app behavior and bundle
 * size stay untouched.
 */

import { PuzzleView } from '../views/PuzzleView.js';

const pendingWork = new Set();
const stores = new Map();
const views = new Set();
const routers = new WeakMap();
const latestWork = new WeakMap();
const activeDiagnostics = new Set();
const navigationMethods = ['push', 'replace', 'go', 'back', 'forward'];
const DEFAULT_MAX_PASSES = 100;

let trackingInstalled = false;
let workVersion = 0;

/**
 * Install data() promise tracking once. The wrapper returns the original value
 * unchanged, preserving refresh()'s sync/async calling convention.
 */
export function ensureTracking() {
	if (trackingInstalled) return;
	trackingInstalled = true;

	const refresh = PuzzleView.prototype.refresh;
	PuzzleView.prototype.refresh = function (...args) {
		views.add(this);
		const name = viewName(this);
		advanceWork(`view ${name} data refresh`);
		return trackLatestWork(this, refresh.apply(this, args), `view ${name} data promise`);
	};

	const setData = PuzzleView.prototype.setData;
	PuzzleView.prototype.setData = function (...args) {
		views.add(this);
		advanceWork(`view ${viewName(this)} re-render`);
		return setData.apply(this, args);
	};

	// Destroy supersedes a suspended data() run just as a newer refresh does. Do
	// not let an abandoned never-resolving promise keep settled() open forever.
	const destroy = PuzzleView.prototype.destroy;
	PuzzleView.prototype.destroy = function (...args) {
		clearLatestWork(this);
		return destroy.apply(this, args);
	};
}

/** Track a thenable without changing its identity or rejection behavior. */
export function trackWork(value, source = 'async framework work') {
	if (!value || typeof value.then !== 'function' || pendingWork.has(value)) return value;
	pendingWork.add(value);
	advanceWork(source);
	const remove = () => {
		removeWork(value);
	};
	// Use both handlers instead of an ignored finally() promise, which would
	// manufacture an unhandled rejection when the original work rejects.
	value.then(remove, remove);
	return value;
}

/**
 * Track only the current promise for one last-wins owner. A newer view refresh
 * or router navigation makes the older promise irrelevant to framework state,
 * even if the app's underlying fetch never resolves.
 */
function trackLatestWork(owner, value, source = 'async framework work') {
	const previous = latestWork.get(owner);
	if (previous && previous !== value) removeWork(previous);

	if (!value || typeof value.then !== 'function') {
		latestWork.delete(owner);
		return value;
	}
	if (previous === value) return value;

	latestWork.set(owner, value);
	trackWork(value, source);
	const remove = () => {
		if (latestWork.get(owner) === value) latestWork.delete(owner);
		removeWork(value);
	};
	value.then(remove, remove);
	return value;
}

function clearLatestWork(owner) {
	const value = latestWork.get(owner);
	if (!value) return;
	latestWork.delete(owner);
	removeWork(value);
}

function removeWork(value) {
	if (!pendingWork.delete(value)) return;
	// Completion changes fixed-point stability but is not a new registration,
	// so include it in the version delta without calling it an active source.
	advanceWork();
}

/** Keep one helper-owned reference count per Store shared across handles. */
export function registerStore(store) {
	if (!store || typeof store.flush !== 'function') return () => {};
	stores.set(store, (stores.get(store) ?? 0) + 1);
	let registered = true;
	return () => {
		if (!registered) return;
		registered = false;
		const count = stores.get(store) ?? 0;
		if (count <= 1) stores.delete(store);
		else stores.set(store, count - 1);
	};
}

/**
 * Track navigation promises started directly by app code, including pushes from
 * event handlers. Wrapping is per Router instance and restored with the last
 * helper handle that registered it.
 */
export function registerRouter(router) {
	if (!router) return () => {};
	let record = routers.get(router);
	if (!record) {
		const ownDescriptors = new Map();
		for (const name of navigationMethods) {
			if (typeof router[name] !== 'function') continue;
			ownDescriptors.set(name, Object.getOwnPropertyDescriptor(router, name) ?? null);
			const navigate = router[name];
			Object.defineProperty(router, name, {
				configurable: true,
				writable: true,
				value(...args) {
					return trackLatestWork(
						router,
						navigate.apply(this, args),
						navigationSource(router, name, args)
					);
				},
			});
		}
		record = { count: 0, ownDescriptors };
		routers.set(router, record);
	}
	record.count++;

	let registered = true;
	return () => {
		if (!registered) return;
		registered = false;
		record.count--;
		if (record.count > 0) return;
		clearLatestWork(router);
		for (const [name, descriptor] of record.ownDescriptors) {
			if (descriptor) Object.defineProperty(router, name, descriptor);
			else delete router[name];
		}
		routers.delete(router);
	};
}

/**
 * Drain framework-owned work to a fixed point (v1.58, D94).
 *
 * Each pass forces registered stores through Store.flush(), applies any
 * rAF-scheduled setData render through PuzzleView.flushUpdates(), awaits the
 * CURRENT last-wins data/navigation promises known at that point, then repeats.
 * Two unchanged microtask-stable passes cover work created by a promise
 * continuation without relying on requestAnimationFrame or D63's 220ms fallback
 * timer firing.
 * At most maxPasses (default 100) are attempted; exhaustion throws a diagnostic
 * instead of returning a false settled state.
 *
 * Deliberate boundaries: this does not advance arbitrary user timers, resolve a
 * fetch/promise that data() or navigation did not await, trigger visibility
 * observers, or finish CSS/WAAPI animations. Because an outgoing animation is
 * part of an awaited navigation, that navigation remains unsettled until the
 * test finishes/cancels it; fire-and-forget enter animations are not awaited.
 *
 * @param {{ maxPasses?: number }} [options]
 */
export async function settled({ maxPasses = DEFAULT_MAX_PASSES } = {}) {
	ensureTracking();
	if (!Number.isInteger(maxPasses) || maxPasses < 1) {
		throw new TypeError('[puzzle/testing] settled() maxPasses must be a positive integer');
	}
	const activity = new Map();
	const startingVersion = workVersion;
	let stablePasses = 0;
	activeDiagnostics.add(activity);

	try {
		// Normal actions settle in 2–5 passes, including the two confirmation passes.
		// 100 leaves ample headroom for deep update chains while still diagnosing a
		// feedback loop instead of surrendering to the test runner's global timeout.
		for (let pass = 1; pass <= maxPasses; pass++) {
			const version = workVersion;
			flushRegisteredWork();
			await Promise.resolve();

			const current = [...pendingWork];
			if (current.length > 0) await Promise.allSettled(current);
			await Promise.resolve();

			flushRegisteredWork();
			await Promise.resolve();

			if (pendingWork.size === 0 && workVersion === version) stablePasses++;
			else stablePasses = 0;
			if (stablePasses === 2) return;
		}

		const advances = workVersion - startingVersion;
		const passes = `${maxPasses} pass${maxPasses === 1 ? '' : 'es'}`;
		throw new Error(
			`[puzzle/testing] settled() did not converge after ${passes} — ` +
				'framework work was still being scheduled ' +
				`(workVersion advanced ${advances} time${advances === 1 ? '' : 's'} ` +
				`across ${passes}). Most active: ${describeActivity(activity)}. ` +
				'Likely cause: a data() → store-write → data() cycle, or a timer mutating the store. ' +
				'Raise the bound with settled({ maxPasses }) if convergence is legitimately slow.'
		);
	} finally {
		activeDiagnostics.delete(activity);
	}
}

function advanceWork(source) {
	workVersion++;
	if (source) recordActivity(source);
}

function recordActivity(source) {
	for (const activity of activeDiagnostics) {
		activity.set(source, (activity.get(source) ?? 0) + 1);
	}
}

function describeActivity(activity) {
	const mostActive = [...activity]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([source, count]) => `${source} (${count})`);
	return mostActive.join(', ') || 'unlabelled framework work';
}

function viewName(view) {
	return view.constructor?.name || 'anonymous';
}

function navigationSource(router, method, args) {
	if (method === 'push' || method === 'replace') {
		return `navigation ${method} to ${String(args[0])}`;
	}
	const current = router.current?.path;
	const argument = method === 'go' ? `(${String(args[0])})` : '';
	return `navigation ${method}${argument}${current ? ` from ${current}` : ''}`;
}

function recordStoreNotifications(store) {
	// Sampling (never mutating) the pending key set is cheap and preserves the
	// model type that would be lost once public, idempotent flush() returns.
	if (!(store._pendingKeys instanceof Set)) return;
	for (const key of store._pendingKeys) {
		if (typeof key === 'string' && !key.includes(' ')) {
			recordActivity(`store notifications for ${key}`);
		}
	}
}

function flushRegisteredWork() {
	for (const store of stores.keys()) {
		recordStoreNotifications(store);
		store.flush();
	}
	for (const view of [...views]) {
		if (view.isDestroyed) {
			views.delete(view);
			continue;
		}
		view.flushUpdates();
	}
}

export default settled;

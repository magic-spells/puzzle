/**
 * Development-only performance instrumentation (SPEC §56, D121).
 *
 * Production builds define __PUZZLE_DEV__ as false. Every runtime importer is
 * guarded at its call site, and every export below is a positive DEV wrapper,
 * so esbuild removes the callers and tree-shakes this whole module. Undefined
 * means true for unbundled tests.
 */

const DEV = typeof __PUZZLE_DEV__ === 'undefined' ? true : __PUZZLE_DEV__;
const PERF_SENTINEL = '__PUZZLE_PERF__';
const RECURSION_LIMIT = 100;
const RUNAWAY_WINDOW_MS = 1000;
const RUNAWAY_RENDER_LIMIT = 60;
const RUNAWAY_WASTED_RATIO = 0.9;

const sinks = new Set();
const viewStates = new WeakMap();
const preparedData = new WeakMap();
const activeRenders = new WeakMap();
const storeChains = new WeakMap();
const activeStoreFlushes = new WeakMap();
const activeScopes = [];

const totals = {
	renders: 0,
	wastedRenders: 0,
	domMutations: 0,
	dataRuns: 0,
	asyncDataRuns: 0,
	storeFlushes: 0,
	storeNotifications: 0,
	componentPropBailouts: 0,
	componentPropReruns: 0,
	slotRenders: 0,
	memoHits: 0,
	memoMisses: 0,
	asyncTrackingDeferrals: 0,
	asyncTrackingDeferredMs: 0,
	maxRecursiveDepth: 0,
};

let nextViewId = 1;
let nextChainId = 1;

// The global is deliberately dev-only and read-only: it makes serialized async
// data() head-of-line blocking visible from the console without adding an app
// config surface. The sentinel is also the minification-proof DCE test marker.
if (DEV && typeof globalThis !== 'undefined') {
	try {
		Object.defineProperty(globalThis, PERF_SENTINEL, {
			configurable: true,
			value: Object.freeze({
				snapshot: snapshotImpl,
				subscribe: installSinkImpl,
			}),
		});
	} catch {
		// A foreign non-configurable global leaves instrumentation otherwise live.
	}
}

// ---- positive DEV wrappers -------------------------------------------------

export function devperfInstallSink(sink) {
	if (DEV) return installSinkImpl(sink);
	return () => {};
}

export function devperfSnapshot() {
	if (DEV) return snapshotImpl();
	return Object.freeze({});
}

export function devperfPrepareData(view, cause) {
	if (DEV) return prepareDataImpl(view, cause);
	return {};
}

export function devperfRunData(view, params, props) {
	if (DEV) return runDataImpl(view, params, props);
	return view.data(params, props);
}

export function devperfRenderScheduled(view, cause) {
	if (DEV) renderScheduledImpl(view, cause);
}

export function devperfMarkCause(view, cause) {
	if (DEV) markCauseImpl(view, cause);
}

export function devperfCanRender(view) {
	if (DEV) return canRenderImpl(view);
	return true;
}

export function devperfRenderPrepare(view) {
	if (DEV) return renderPrepareImpl(view);
	return null;
}

export function devperfRenderTreeBuilt(view) {
	if (DEV) renderTreeBuiltImpl(view);
}

export function devperfRenderStart(view) {
	if (DEV) renderStartImpl(view);
}

export function devperfRenderEnd(view) {
	if (DEV) renderEndImpl(view);
}

export function devperfRenderCancel(view) {
	if (DEV) renderCancelImpl(view);
}

export function devperfMutation(count = 1) {
	if (DEV) mutationImpl(count);
}

export function devperfComponentPatch(view, bailedOut) {
	if (DEV) componentPatchImpl(view, bailedOut);
}

export function devperfSlotRender(view) {
	if (DEV) slotRenderImpl(view);
}

export function devperfMemo(view, key, hit) {
	if (DEV) memoImpl(view, key, hit);
}

export function devperfStoreNotify(store, subscriber) {
	if (DEV) storeNotifyImpl(store, subscriber);
}

export function devperfStoreFlushStart(store) {
	if (DEV) storeFlushStartImpl(store);
}

export function devperfStoreFlushNotifications(store, keys, notified) {
	if (DEV) storeFlushNotificationsImpl(store, keys, notified);
}

export function devperfStoreFlushEnd(store) {
	if (DEV) storeFlushEndImpl(store);
}

export function devperfTrackingDeferred(subscriber, pending, retry, kind) {
	if (DEV) return trackingDeferredImpl(subscriber, pending, retry, kind);
	return pending.then(retry, retry);
}

// ---- sink/global snapshots -------------------------------------------------

function installSinkImpl(sink) {
	if (typeof sink !== 'function') {
		throw new TypeError('[puzzle perf] sink must be a function');
	}
	sinks.add(sink);
	let attached = true;
	return () => {
		if (!attached) return;
		attached = false;
		sinks.delete(sink);
	};
}

function snapshotImpl() {
	return Object.freeze({ ...totals });
}

/**
 * Deliver one event to every sink.
 *
 * `subject` is the INSTANCE the event is about (a view, or a store subscriber),
 * passed beside the event rather than inside it. Two reasons: the event payload
 * stays a plain data record a sink can keep without pinning a destroyed view
 * alive, and `viewId` here is this module's own numbering — a sink that needs a
 * different identity (the DevTools bridge numbers views for the extension) can
 * only derive it from the instance. Sinks that do not care simply ignore the
 * second argument.
 */
function emit(type, payload, subject = null) {
	const event = Object.freeze({ type, ...payload });
	for (const sink of [...sinks]) {
		try {
			sink(event, subject);
		} catch (error) {
			console.error('[puzzle perf] sink failed:', error);
		}
	}
}

// ---- causal chains ---------------------------------------------------------

function newChain() {
	return {
		id: nextChainId++,
		executions: new Map(),
		blockedViews: new Set(),
		pendingStores: new Set(),
		pendingViews: new Set(),
		pendingData: 0,
		pendingAsync: 0,
		active: 0,
		version: 0,
		quiescent: false,
	};
}

function currentChain() {
	for (let i = activeScopes.length - 1; i >= 0; i--) {
		const chain = activeScopes[i].chain;
		if (!chain.quiescent) return chain;
	}
	return null;
}

function viewState(view) {
	let state = viewStates.get(view);
	if (state) return state;
	state = {
		id: nextViewId++,
		name: view?.constructor?.name || 'anonymous',
		pendingChain: null,
		pendingCauses: new Set(),
		dataExecutionChain: null,
		activeDataChain: null,
		dataRuns: 0,
		renderWindow: [],
		runawayUntil: 0,
	};
	viewStates.set(view, state);
	return state;
}

function chainForView(state) {
	const active = currentChain();
	if (active) return active;
	if (state.pendingChain && !state.pendingChain.quiescent) return state.pendingChain;
	return newChain();
}

function touch(chain) {
	chain.version++;
}

function pushScope(chain, render = null) {
	chain.active++;
	touch(chain);
	const scope = { chain, render };
	activeScopes.push(scope);
	return scope;
}

function popScope(scope) {
	const index = activeScopes.lastIndexOf(scope);
	if (index !== -1) activeScopes.splice(index, 1);
	scope.chain.active = Math.max(0, scope.chain.active - 1);
	touch(scope.chain);
	maybeQuiesce(scope.chain);
}

function maybeQuiesce(chain) {
	if (
		chain.quiescent ||
		chain.active > 0 ||
		chain.pendingStores.size > 0 ||
		chain.pendingViews.size > 0 ||
		chain.pendingData > 0 ||
		chain.pendingAsync > 0
	) {
		return;
	}
	const version = chain.version;
	queueMicrotask(() => {
		if (
			chain.quiescent ||
			chain.version !== version ||
			chain.active > 0 ||
			chain.pendingStores.size > 0 ||
			chain.pendingViews.size > 0 ||
			chain.pendingData > 0 ||
			chain.pendingAsync > 0
		) {
			return;
		}
		chain.quiescent = true;
		chain.executions.clear();
		chain.blockedViews.clear();
	});
}

function claimExecution(state, chain, view) {
	if (chain.blockedViews.has(state.id)) return 0;
	const depth = (chain.executions.get(state.id) ?? 0) + 1;
	chain.executions.set(state.id, depth);
	totals.maxRecursiveDepth = Math.max(totals.maxRecursiveDepth, depth);
	if (depth === RECURSION_LIMIT) {
		chain.blockedViews.add(state.id);
		const message =
			`[puzzle perf] ${PERF_SENTINEL}: stopped ${state.name} after ` +
			`${RECURSION_LIMIT} executions in one causal chain`;
		console.error(message);
		emit(
			'loop',
			{
				viewId: state.id,
				viewName: state.name,
				chainId: chain.id,
				depth,
				kind: 'recursive',
				message,
			},
			view ?? null
		);
	}
	return depth;
}

// ---- data / render ---------------------------------------------------------

function prepareDataImpl(view, cause) {
	const state = viewState(view);
	const chain = chainForView(state);
	if (chain.blockedViews.has(state.id)) return null;
	const resolvedCause =
		cause ||
		(state.pendingCauses.size > 0
			? [...state.pendingCauses][state.pendingCauses.size - 1]
			: state.dataRuns === 0
				? 'initial'
				: 'refresh');
	const depth = claimExecution(state, chain, view);
	if (!depth) return null;
	state.pendingChain = chain;
	state.pendingCauses.add(resolvedCause);
	state.dataExecutionChain = chain;
	chain.pendingData++;
	touch(chain);
	let queue = preparedData.get(view);
	if (!queue) {
		queue = [];
		preparedData.set(view, queue);
	}
	queue.push({ view, state, chain, cause: resolvedCause, depth, started: false });
	return true;
}

function runDataImpl(view, params, props) {
	const queue = preparedData.get(view);
	const prepared = queue?.shift();
	if (queue?.length === 0) preparedData.delete(view);
	if (!prepared) return view.data(params, props);
	const { state, chain, cause } = prepared;
	if (!prepared.started) {
		prepared.started = true;
		chain.pendingData = Math.max(0, chain.pendingData - 1);
	}
	state.dataRuns++;
	totals.dataRuns++;
	const startedAt = now();
	const scope = pushScope(chain);
	let result;
	try {
		result = view.data(params, props);
	} catch (error) {
		popScope(scope);
		recordData(prepared, startedAt, false, true);
		throw error;
	}
	popScope(scope);

	if (result && typeof result.then === 'function') {
		totals.asyncDataRuns++;
		chain.pendingAsync++;
		touch(chain);
		state.activeDataChain = chain;
		const finish = (failed) => {
			recordData(prepared, startedAt, true, failed);
			chain.pendingAsync = Math.max(0, chain.pendingAsync - 1);
			if (state.activeDataChain === chain) state.activeDataChain = null;
			touch(chain);
			maybeQuiesce(chain);
		};
		result.then(
			() => finish(false),
			() => finish(true)
		);
	} else {
		recordData(prepared, startedAt, false, false);
	}
	state.pendingCauses.add(cause);
	return result;
}

function recordData(prepared, startedAt, async, failed) {
	emit(
		'data',
		{
			viewId: prepared.state.id,
			viewName: prepared.state.name,
			chainId: prepared.chain.id,
			cause: prepared.cause,
			duration: now() - startedAt,
			async,
			failed,
		},
		prepared.view
	);
	prepared.state.pendingCauses.add(prepared.cause);
}

function renderScheduledImpl(view, cause) {
	const state = viewState(view);
	const chain = chainForView(state);
	state.pendingChain = chain;
	state.pendingCauses.add(cause || 'local-state');
	chain.pendingViews.add(state.id);
	touch(chain);
}

function markCauseImpl(view, cause) {
	const state = viewState(view);
	const chain = chainForView(state);
	state.pendingChain = chain;
	state.pendingCauses.add(cause);
	touch(chain);
}

function canRenderImpl(view) {
	const state = viewState(view);
	const chain = chainForView(state);
	const recursiveBlocked =
		chain.blockedViews.has(state.id) && state.dataExecutionChain !== chain;
	const runawayBlocked = state.runawayUntil > now();
	if (!recursiveBlocked && !runawayBlocked) return true;
	chain.pendingViews.delete(state.id);
	state.pendingCauses.clear();
	touch(chain);
	maybeQuiesce(chain);
	return false;
}

function renderPrepareImpl(view) {
	const state = viewState(view);
	const chain = chainForView(state);
	state.pendingChain = chain;
	chain.pendingViews.delete(state.id);
	const causes = state.pendingCauses.size > 0 ? [...state.pendingCauses] : ['render'];
	state.pendingCauses.clear();
	touch(chain);
	const mark = {
		view,
		state,
		chain,
		causes,
		scope: null,
		treeStartedAt: now(),
		treeDuration: 0,
		patchStartedAt: 0,
		mutations: 0,
		depth: chain.executions.get(state.id) ?? 0,
		entered: false,
		ended: false,
	};
	mark.scope = pushScope(chain, mark);
	activeRenders.set(view, mark);
}

function renderTreeBuiltImpl(view) {
	const mark = activeRenders.get(view);
	if (!mark || mark.ended) return;
	mark.treeDuration = now() - mark.treeStartedAt;
}

function renderStartImpl(view) {
	const mark = activeRenders.get(view);
	if (!mark || mark.ended) return;
	mark.entered = true;
	if (mark.state.dataExecutionChain === mark.chain) {
		mark.state.dataExecutionChain = null;
		mark.depth = mark.chain.executions.get(mark.state.id) ?? 1;
	} else {
		mark.depth = claimExecution(mark.state, mark.chain, mark.view);
	}
	mark.patchStartedAt = now();
}

function renderEndImpl(view) {
	const mark = activeRenders.get(view);
	if (!mark || mark.ended) return;
	mark.ended = true;
	activeRenders.delete(view);
	const timestamp = now();
	const patchDuration = mark.patchStartedAt ? timestamp - mark.patchStartedAt : 0;
	if (mark.entered) {
		const wasted = mark.mutations === 0;
		totals.renders++;
		totals.domMutations += mark.mutations;
		if (wasted) totals.wastedRenders++;
		emit(
			'render',
			{
				viewId: mark.state.id,
				viewName: mark.state.name,
				chainId: mark.chain.id,
				causes: Object.freeze([...mark.causes]),
				depth: mark.depth,
				treeDuration: mark.treeDuration,
				patchDuration,
				domMutations: mark.mutations,
				wasted,
				timestamp,
			},
			mark.view
		);
		checkRunaway(mark, timestamp, wasted);
	}
	popScope(mark.scope);
}

function renderCancelImpl(view) {
	renderEndImpl(view);
}

function mutationImpl(count) {
	for (let i = activeScopes.length - 1; i >= 0; i--) {
		const mark = activeScopes[i].render;
		if (!mark || mark.ended) continue;
		mark.mutations += count;
		return;
	}
}

function checkRunaway(mark, timestamp, wasted) {
	const window = mark.state.renderWindow;
	window.push({
		timestamp,
		wasted,
		animated: mark.causes.includes('animation') || mark.causes.includes('morph'),
	});
	while (window.length && timestamp - window[0].timestamp > RUNAWAY_WINDOW_MS) window.shift();
	if (window.length < RUNAWAY_RENDER_LIMIT || mark.state.runawayUntil > timestamp) return;
	const wastedCount = window.reduce((sum, entry) => sum + (entry.wasted ? 1 : 0), 0);
	const hasAnimationCause = window.some((entry) => entry.animated);
	if (hasAnimationCause || wastedCount / window.length < RUNAWAY_WASTED_RATIO) return;
	mark.state.runawayUntil = timestamp + RUNAWAY_WINDOW_MS;
	const message =
		`[puzzle perf] ${PERF_SENTINEL}: stopped ${mark.state.name} after ` +
		`${window.length} renders in one second (${Math.round((wastedCount / window.length) * 100)}% wasted)`;
	console.warn(message);
	emit(
		'loop',
		{
			viewId: mark.state.id,
			viewName: mark.state.name,
			chainId: mark.chain.id,
			depth: mark.depth,
			kind: 'cross-frame',
			message,
		},
		mark.view
	);
}

// ---- secondary view metrics ------------------------------------------------

function componentPatchImpl(view, bailedOut) {
	if (bailedOut) totals.componentPropBailouts++;
	else totals.componentPropReruns++;
	const state = viewState(view);
	emit(
		'component-props',
		{
			viewId: state.id,
			viewName: state.name,
			bailedOut,
		},
		view
	);
}

function slotRenderImpl(view) {
	totals.slotRenders++;
	markCauseImpl(view, 'slots');
	const state = viewState(view);
	emit('slot-render', { viewId: state.id, viewName: state.name }, view);
}

function memoImpl(view, key, hit) {
	if (hit) totals.memoHits++;
	else totals.memoMisses++;
	const state = viewState(view);
	emit(
		'memo',
		{
			viewId: state.id,
			viewName: state.name,
			key,
			hit,
		},
		view
	);
}

// ---- Store metrics / propagation ------------------------------------------

function storeNotifyImpl(store, subscriber) {
	const state = subscriber && typeof subscriber === 'object' ? viewStates.get(subscriber) : null;
	const chain =
		(state?.activeDataChain && !state.activeDataChain.quiescent
			? state.activeDataChain
			: currentChain()) ||
		(storeChains.get(store)?.quiescent ? null : storeChains.get(store)) ||
		newChain();
	storeChains.set(store, chain);
	chain.pendingStores.add(store);
	touch(chain);
}

function storeFlushStartImpl(store) {
	const chain =
		(storeChains.get(store)?.quiescent ? null : storeChains.get(store)) ||
		currentChain() ||
		newChain();
	storeChains.set(store, chain);
	chain.pendingStores.delete(store);
	touch(chain);
	const mark = {
		store,
		chain,
		scope: pushScope(chain),
		startedAt: now(),
		keys: store?._pendingKeys?.size ?? 0,
		notified: 0,
	};
	activeStoreFlushes.set(store, mark);
	return mark;
}

function storeFlushNotificationsImpl(store, keys, notified) {
	const mark = activeStoreFlushes.get(store);
	if (!mark) return;
	mark.keys = keys.length;
	mark.notified = notified.size;
}

function storeFlushEndImpl(store) {
	const mark = activeStoreFlushes.get(store);
	if (!mark) return;
	activeStoreFlushes.delete(store);
	totals.storeFlushes++;
	totals.storeNotifications += mark.notified;
	emit('store-flush', {
		chainId: mark.chain.id,
		duration: now() - mark.startedAt,
		keys: mark.keys,
		notified: mark.notified,
	});
	popScope(mark.scope);
	if (!mark.chain.pendingStores.has(mark.store)) storeChains.delete(mark.store);
	maybeQuiesce(mark.chain);
}

function trackingDeferredImpl(subscriber, pending, retry, kind) {
	const state = subscriber && typeof subscriber === 'object' ? viewState(subscriber) : null;
	const chain = state ? chainForView(state) : currentChain() || newChain();
	const startedAt = now();
	totals.asyncTrackingDeferrals++;
	chain.pendingAsync++;
	touch(chain);
	const resume = () => {
		const duration = now() - startedAt;
		totals.asyncTrackingDeferredMs += duration;
		chain.pendingAsync = Math.max(0, chain.pendingAsync - 1);
		touch(chain);
		emit(
			'tracking-deferral',
			{
				viewId: state?.id ?? null,
				viewName: state?.name ?? 'anonymous',
				chainId: chain.id,
				kind,
				duration,
				count: totals.asyncTrackingDeferrals,
				totalDuration: totals.asyncTrackingDeferredMs,
			},
			state ? subscriber : null
		);
		maybeQuiesce(chain);
		return retry();
	};
	return pending.then(resume, resume);
}

function now() {
	return typeof performance !== 'undefined' && typeof performance.now === 'function'
		? performance.now()
		: Date.now();
}

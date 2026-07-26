/**
 * `window.__STRESS__` — the automation surface a benchmark driver talks to.
 *
 * The contract:
 *
 *   ready      Promise            resolves once the app has mounted
 *   scenarios  string[]           implemented scenario names
 *   select(name, params)          navigate to a scenario, wait for it to mount
 *   reset()                       return the active scenario to its start state
 *   warmup()                      run a throwaway cycle to warm the JIT
 *   run(op)                       run one op; RESOLVES ONLY AFTER THE DOM SETTLED
 *   validate()                    -> { ok, detail } — inspects the real DOM
 *   stats()                       -> { mountedNodes, records, views }
 *
 * `run()` resolving early is the single easiest way to produce garbage numbers,
 * so the settle discipline is layered: each scenario's own `run()` flushes the
 * store, then awaits `afterPaint()` (rAF → setTimeout, i.e. past the commit)
 * plus a frame; `runScenario` then adds two more frames on top.
 *
 * Scenarios REGISTER THEMSELVES on mount (`registerScenario`) rather than being
 * looked up by the controller, so the controller never has to know which
 * component tree the router happens to have built.
 */

import { RC_ENTRY_PATH } from './rc-paths.js';
import { intParam, settleFrames } from './scenario-utils.js';

export const SCENARIO_DEFINITIONS = [
	{
		name: 'keyed-list',
		label: 'Keyed list',
		blurb: 'every row mounted — js-framework-benchmark shapes over real store records',
		ops: [
			'create-1k',
			'create-10k',
			'create-50k',
			'replace-all',
			'update-every-10th',
			'select-row',
			'swap-rows',
			'remove-row',
			// Behaviour gates, not measurements: each dispatches a REAL click at
			// the first rendered row and throws unless it selects / removes. They
			// exist so the handler A/B (?handlers=inline|stable) cannot ship a
			// variant that is faster because it quietly stopped working.
			'click-select',
			'click-remove',
			'append-1k',
			'clear',
		],
	},
	{
		name: 'virtual-list',
		label: 'Virtual list',
		blurb: 'the SAME records and row component, but only a window is mounted',
		ops: [
			'create-1k',
			'create-10k',
			'create-50k',
			'update-every-10th',
			'select-row',
			'swap-rows',
			'append-1k',
			'fast-scroll',
			'clear',
		],
	},
	{
		name: 'subscriptions',
		label: 'Subscriptions',
		blurb: 'per-record (precision) vs whole-collection (fan-out) subscribing',
		ops: ['update-one'],
	},
	{
		name: 'async-waterfall',
		label: 'Async waterfall',
		blurb: 'N independent async data() calls — parallel or serialized?',
		ops: ['remount'],
	},
	{
		name: 'deep-nest',
		label: 'Deep nest',
		blurb: 'N branches x D nested view levels — is a leaf update depth- or forest-proportional?',
		ops: ['update-leaf', 'update-branch-root', 'update-global'],
	},
	{
		name: 'write-storm',
		label: 'Write storm',
		blurb: 'sustained and bursty writes against the rAF-batched flush (and O(store) persistence)',
		// The `-persist` arms are the SAME writes with a storage shim attached, so
		// Store._persistNow() actually runs. Separate ops rather than a mode toggle:
		// the pair is only meaningful measured back to back, and a toggle would make
		// half of every comparison a remount.
		ops: ['sustained', 'burst', 'sustained-persist', 'burst-persist'],
	},
	{
		name: 'islands',
		label: 'Islands',
		blurb: 'island children must stay frozen while the shell churns at 60Hz',
		// Same work, two bounds. `shell-churn` runs for 5 seconds (the scenario as
		// specified); `shell-renders` runs for a fixed 60 renders, which is what the
		// benchmark times — a fixed-duration op's milliseconds are an input, not a
		// measurement. See CHURN_RENDERS in Islands.pzl.
		ops: ['shell-churn', 'shell-renders'],
	},
	{
		name: 'formatters',
		label: 'Formatters',
		blurb: 'date + timeago over 10k rows — what does the built-in registry cost per render?',
		// `rerender-raw` is the control arm and `count-intl` is the instrumented
		// one; only `rerender` and `rerender-raw` produce comparable milliseconds.
		ops: ['rerender', 'rerender-raw', 'count-intl'],
	},
	{
		name: 'listener-churn',
		label: 'Listener churn',
		blurb: 'what does removing and re-adding a DOM listener on every render actually cost?',
		// `rerender` is the uninstrumented TIMING arm and `count-listeners` is the
		// same renders with Element.prototype patched — its counts are exact, its
		// milliseconds carry the probe. Same split as formatters/count-intl, for
		// the same reason. `click-select` is a behaviour gate, not a measurement.
		ops: ['rerender', 'count-listeners', 'micro-listener-cost', 'click-select'],
	},
	{
		name: 'route-churn',
		label: 'Route churn',
		blurb: '5 nested route levels + 50 leaves — how many times does a REUSED ancestor render per navigation?',
		// The ONLY scenario that is not hosted in Home's stage: it needs real route
		// nodes, so it is a sibling subtree at /rc/… (see ../rc-routes.js).
		ops: ['navigate-100', 'navigate-burst-100', 'params-100', 'params-burst-100', 'back-forward-100', 'supersede-50'],
	},
	{
		name: 'form-state',
		label: 'Form state',
		blurb: 'N controlled inputs + N controlled selects — what does a keystroke cost the rest of the form?',
		// `rerender` is the clean arm and `rerender-dirty` is its CONTROL: the
		// zero input writes in the first only mean something because the second
		// proves the write path fires when a value really moves. `type-local` and
		// `type-store` are the A/B on which state layer a keystroke lands in, and
		// `type-event` is a behaviour gate, not a measurement.
		ops: ['rerender', 'rerender-dirty', 'type-local', 'type-store', 'type-event'],
	},
	{
		// LAST on purpose: the two ops here are deliberate pathologies, and the
		// picker reads left to right. Both are behind their own explicit button
		// and both carry a hard iteration cap — see LoopTrap.pzl.
		name: 'loop-trap',
		label: 'Loop trap',
		blurb: 'the D121 loop detector, exercised for real — recursive chain and 60Hz identical re-render',
		ops: ['recursive-loop', 'runaway-rerender', 'stop'],
	},
];

export const SCENARIOS = SCENARIO_DEFINITIONS.map((scenario) => scenario.name);
export const DEFAULT_SCENARIO = 'keyed-list';

export function definitionFor(name) {
	return SCENARIO_DEFINITIONS.find((s) => s.name === name) || SCENARIO_DEFINITIONS[0];
}

let app = null;
let activeScenario = null;

/**
 * Called by a scenario component in `mounted()`. Returns the unregister function
 * its `destroyed()` must call.
 */
export function registerScenario(api) {
	activeScenario = api;
	return () => {
		if (activeScenario === api) activeScenario = null;
	};
}

/**
 * Wait for a scenario to be mounted and registered. With `name`, wait for THAT
 * scenario specifically (used after a navigation); without, any scenario will
 * do — which keeps reset/warmup/run independent of how the URL is spelled and
 * therefore independent of the router mode.
 */
async function waitForScenario(name = null) {
	for (let i = 0; i < 240; i += 1) {
		if (activeScenario && (name === null || activeScenario.name === name)) return activeScenario;
		await settleFrames(1);
	}
	throw new Error(`[stress] scenario "${name ?? 'any'}" did not mount`);
}

function pathFor(name, params = {}) {
	// route-churn is the one scenario that is NOT hosted in Home's stage: it
	// measures the router, so it needs real route nodes and lives at its own
	// sibling subtree. Selecting it navigates out of `/` entirely and Home
	// unmounts — RcLayout registers the scenario API from there, so nothing else
	// in this file has to know. See ../rc-routes.js for why a sibling subtree
	// beat a second PuzzleApp and beat nesting under `/`.
	if (name === 'route-churn') {
		const delay = intParam(params.delay, 0, 0, 2000);
		// `navs` overrides the op's navigation count. It exists so counters can be
		// read below the D121 runaway threshold — see NAV_INTERVAL_MS in RcLayout.
		const navs = intParam(params.navs, 0, 0, 1000);
		const query = [];
		if (delay > 0) query.push(`delay=${delay}`);
		if (navs > 0) query.push(`navs=${navs}`);
		return query.length ? `${RC_ENTRY_PATH}?${query.join('&')}` : RC_ENTRY_PATH;
	}
	const query = new URLSearchParams({ scenario: name });
	for (const [key, value] of Object.entries(params)) {
		if (key === 'scenario') continue;
		if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
	}
	return `/?${query.toString()}`;
}

/**
 * Switch scenarios (or reconfigure the current one) by replacing the URL.
 *
 * Home renders the scenario component with an explicit `key` built from every
 * parameter, so a parameter change swaps the vnode key and the component
 * REMOUNTS — its `created()` rebuilds the dataset from scratch. That is why
 * there is no `configure()` path any more: remount IS the reconfigure.
 */
export async function selectScenario(name, params = {}) {
	if (!SCENARIOS.includes(name)) {
		throw new Error(`[stress] unknown scenario "${name}" (have: ${SCENARIOS.join(', ')})`);
	}
	if (!app) throw new Error('[stress] control surface used before createStressControl()');
	await app.router.replace(pathFor(name, params));
	await settleFrames(2);
	return waitForScenario(name);
}

export async function resetScenario() {
	const current = await waitForScenario();
	const result = await current.reset();
	await settleFrames(2);
	return result ?? null;
}

export async function warmupScenario() {
	const current = await waitForScenario();
	const result = await current.warmup();
	await settleFrames(2);
	return result ?? null;
}

export async function runScenario(op) {
	const current = await waitForScenario();
	const result = await current.run(op);
	// Belt and braces: the scenario already awaited a paint, this adds two more
	// frames so run() never resolves while a render is still queued.
	await settleFrames(2);
	return result ?? { op, detail: 'no result reported' };
}

export function validateScenario() {
	if (!activeScenario) return { ok: false, detail: 'No scenario is mounted.' };
	try {
		return activeScenario.validate();
	} catch (err) {
		return { ok: false, detail: `validate() threw: ${err?.message || err}` };
	}
}

export function scenarioStats() {
	const local = activeScenario?.stats?.() || {};
	const stage = typeof document === 'undefined' ? null : document.getElementById('scenario-stage');
	const stageNodes = stage ? stage.querySelectorAll('*').length : 0;
	return {
		// The headline number for the list A/B: live DOM elements under the LIST
		// container, which the two list scenarios report themselves. Scenarios with
		// no list container fall back to the whole stage.
		mountedNodes: local.mountedNodes ?? stageNodes,
		stageNodes,
		records: local.records || 0,
		views: local.views || 0,
		scenario: activeScenario?.name || null,
		// Scenario-specific extras. Absent for scenarios that do not report them,
		// which is why they are null rather than 0 — see examples/stress/app/row-metrics.js.
		handlers: local.handlers ?? null,
		childDataRuns: local.childDataRuns ?? null,
		perf: local.perf ?? null,
		// The generic structural channel. A scenario returns whatever integers its
		// question is actually about (island mutations, Intl constructions, store
		// flushes) and benchmarks/runner.mjs spreads them into the asserted counter
		// set — so a new scenario can declare `expect: { ... }` without the runner
		// growing a branch per scenario. null, never {}, for the same reason
		// childDataRuns is: a fabricated empty set and a measured empty set mean
		// opposite things.
		counters: local.counters ?? null,
	};
}

export function createStressControl(puzzleApp) {
	app = puzzleApp;
	const control = {
		ready: null,
		scenarios: [...SCENARIOS],
		definitions: SCENARIO_DEFINITIONS.map((s) => ({ ...s, ops: [...s.ops] })),
		select: selectScenario,
		reset: resetScenario,
		warmup: warmupScenario,
		run: runScenario,
		validate: validateScenario,
		stats: scenarioStats,
		app: puzzleApp,
	};
	control.ready = Promise.resolve()
		.then(() => app.mount())
		.then(() => settleFrames(2))
		.then(() => waitForScenario())
		.then(() => control);
	return control;
}

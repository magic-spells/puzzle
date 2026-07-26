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

import { settleFrames } from './scenario-utils.js';

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

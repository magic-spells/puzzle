// @vitest-environment jsdom
//
// The dev-only DevTools bridge (D100): protocol-v1 events out through the
// injected hook's emit(), requests in through the handler the bridge registers
// with onRequest(). Every case drives a REAL memory-mode PuzzleApp so the
// payloads come from the live router/store/view registry, never a stub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Puzzle, PuzzleModel, PuzzleView, ViewNode } from '../client-runtime/index.js';
import { createTestApp, settled } from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const HOOK_KEY = '__PUZZLE_DEVTOOLS_HOOK__';
const OVERLAY_SELECTOR = '[data-puzzle-devtools="highlight"]';

/**
 * The extension's half of the contract: emit() collects the outbound stream,
 * onRequest() captures the handler so a test can call it the way the extension
 * would. Installed on `window` BEFORE mount — document_start in the real thing.
 */
function installHook() {
	const events = [];
	let handler = null;
	window[HOOK_KEY] = {
		emit: (message) => events.push(message),
		onRequest: (fn) => {
			handler = fn;
		},
	};
	return {
		events,
		of: (type) => events.filter((event) => event.type === type),
		request: (type, payload = {}) => handler({ puzzle: 1, v: 1, type, payload }),
		get handler() {
			return handler;
		},
	};
}

// ---- fixtures ---------------------------------------------------------------

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		done: Puzzle.boolean().default(false),
	};
}

class Badge extends PuzzleView {
	render() {
		return h('span', { class: 'badge' }, [text('badge')]);
	}
}
Badge.__pzlModule = 'components/Badge.pzl';

class Home extends PuzzleView {
	created() {
		this.setData('draft', 'local-value');
	}

	data() {
		// findMany() inside data() auto-subscribes this view to the 'todo'
		// collection key, which is what the flush event reports.
		return { count: this.ctx.store.findMany('todo').length, tag: 'model-value' };
	}

	render() {
		return h('puzzle-view', { class: 'home' }, [
			h(Badge, {}),
			h('span', { class: 'count' }, [text(String(this.getData().count))]),
		]);
	}
}
Home.__pzlModule = 'views/Home.pzl';

class Detail extends PuzzleView {
	data(params) {
		return { id: params.id };
	}

	render() {
		return h('puzzle-view', { class: 'detail' }, [text(this.getData().id)]);
	}
}
Detail.__pzlModule = 'views/Detail.pzl';

/**
 * Renders the same output no matter what local state says, which is exactly what
 * devperf's runaway detector looks for: a burst of renders that mutate nothing.
 * The instance publishes itself because driving the detector needs synchronous
 * flushUpdates() calls, and the app handle exposes DOM, not view instances.
 */
let runaway = null;
class Runaway extends PuzzleView {
	created() {
		runaway = this;
	}

	render() {
		return h('puzzle-view', { class: 'runaway' }, [text('constant')]);
	}
}
Runaway.__pzlModule = 'views/Runaway.pzl';

const routes = [
	{ path: '/', name: 'home', view: Home },
	{ path: '/detail/:id', name: 'detail', view: Detail },
	{ path: '/runaway', name: 'runaway', view: Runaway },
];

const handles = [];

async function bootApp() {
	const app = await createTestApp({ routes, models: { todo: Todo } });
	handles.push(app);
	return app;
}

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	runaway = null;
	delete window[HOOK_KEY];
	delete window.$p;
	for (const node of document.querySelectorAll(OVERLAY_SELECTOR)) node.remove();
	document.title = '';
	vi.restoreAllMocks();
});

// ---- runtime → extension events --------------------------------------------

describe('devtools bridge — events', () => {
	it('emits hello then app-mounted when the hook is present at mount', async () => {
		const hook = installHook();
		await bootApp();

		expect(hook.events[0]).toEqual({
			puzzle: 1,
			v: 1,
			type: 'hello',
			payload: { protocolVersion: 1, frameworkVersion: expect.any(String) },
		});
		expect(hook.events[0].payload.frameworkVersion).toMatch(/^\d+\.\d+\.\d+/);
		expect(hook.events[1]).toEqual({ puzzle: 1, v: 1, type: 'app-mounted', payload: {} });
		expect(typeof hook.handler).toBe('function');
	});

	it('emits view-mounted with id, name and the codegen module stamp', async () => {
		const hook = installHook();
		await bootApp();

		const mounted = hook.of('view-mounted').map((event) => event.payload);
		const home = mounted.find((payload) => payload.name === 'Home');
		const badge = mounted.find((payload) => payload.name === 'Badge');

		expect(home).toMatchObject({ name: 'Home', module: 'views/Home.pzl' });
		expect(badge).toMatchObject({ name: 'Badge', module: 'components/Badge.pzl' });
		expect(typeof home.id).toBe('number');
		expect(home.id).not.toBe(badge.id);
	});

	it('emits view-destroyed when a routed view leaves the chain', async () => {
		const hook = installHook();
		const app = await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;

		await app.visit('/detail/7');

		expect(hook.of('view-destroyed').map((e) => e.payload.id)).toContain(homeId);
		expect(hook.of('view-mounted').some((e) => e.payload.name === 'Detail')).toBe(true);
	});

	it('emits one flush per delivered batch with the changed keys and notified view ids', async () => {
		const hook = installHook();
		const app = await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;

		const before = hook.of('flush').length;
		app.store.createRecord('todo', { id: 't1', text: 'write the bridge' });
		await settled();

		const flushes = hook.of('flush').slice(before);
		expect(flushes.length).toBeGreaterThan(0);
		const batch = flushes[0].payload;
		expect(batch.keys).toContain('todo');
		expect(batch.notified).toContain(homeId);
		expect(app.find('.count').textContent).toBe('1');
	});

	it('emits route-commit on navigation #0 and on every later commit', async () => {
		const hook = installHook();
		const app = await bootApp();

		const initial = hook.of('route-commit').at(-1).payload;
		expect(initial).toMatchObject({ pathname: '/', params: {}, chain: ['Home'] });
		expect(initial.query).toEqual({});

		// #commitLocation (and its head sync) runs immediately before #commitState,
		// so the event reports the title the tab already carries. Memory mode
		// deliberately no-ops the head sync (D42/D84), hence the manual title here.
		document.title = 'Detail page';
		await app.visit('/detail/7?tab=notes');

		const committed = hook.of('route-commit').at(-1).payload;
		expect(committed).toMatchObject({
			pathname: '/detail/7',
			params: { id: '7' },
			chain: ['Detail'],
			title: 'Detail page',
		});
		expect(committed.query).toEqual({ tab: 'notes' });
	});

	it('emits app-unmounted and stops emitting once the app tears down', async () => {
		const hook = installHook();
		const app = await bootApp();

		app.app.unmount();
		await settled();

		expect(hook.of('app-unmounted')).toHaveLength(1);
		const after = hook.events.length;
		app.app.unmount();
		expect(hook.events).toHaveLength(after);
	});
});

// ---- extension → runtime requests ------------------------------------------

describe('devtools bridge — requests', () => {
	it('snapshot:views returns the live forest with nested components', async () => {
		const hook = installHook();
		await bootApp();

		const { roots } = hook.request('snapshot:views');
		expect(roots).toHaveLength(1);
		expect(roots[0]).toMatchObject({ name: 'Home', module: 'views/Home.pzl' });
		expect(roots[0].children).toHaveLength(1);
		expect(roots[0].children[0]).toMatchObject({
			name: 'Badge',
			module: 'components/Badge.pzl',
			children: [],
		});
	});

	it('inspect:view separates the model layer from the local layer', async () => {
		const hook = installHook();
		await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;

		const inspected = hook.request('inspect:view', { id: homeId });
		expect(inspected).toMatchObject({
			name: 'Home',
			module: 'views/Home.pzl',
			params: {},
			props: {},
			// data()'s committed result …
			model: { count: 0, tag: 'model-value' },
			// … and the setData layer, never merged into one another.
			local: { draft: 'local-value' },
		});
		expect(inspected.model.draft).toBeUndefined();
		expect(inspected.local.tag).toBeUndefined();
	});

	it('inspect:view reports a missing id as an error payload', async () => {
		const hook = installHook();
		await bootApp();

		expect(hook.request('inspect:view', { id: 9999 })).toEqual({
			error: 'no live view with id 9999',
		});
	});

	it('snapshot:records serializes every type, or one, with the _synced flag', async () => {
		const hook = installHook();
		const app = await bootApp();
		app.store.createRecord('todo', { id: 't1', text: 'alpha' });
		app.store.createRecord('todo', { id: 't2', text: 'beta', done: true });
		await settled();

		const all = hook.request('snapshot:records');
		expect(Object.keys(all.types)).toEqual(['todo']);
		expect(all.types.todo).toEqual([
			{ id: 't1', text: 'alpha', done: false, _synced: false },
			{ id: 't2', text: 'beta', done: true, _synced: false },
		]);

		expect(hook.request('snapshot:records', { type: 'todo' }).types.todo).toHaveLength(2);
		expect(hook.request('snapshot:records', { type: 'nope' }).types).toEqual({});
	});

	it('snapshot:subscriptions reports the graph both ways', async () => {
		const hook = installHook();
		const app = await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;
		// A plain FUNCTION subscriber has no stable cross-wire identity — it reports
		// as the literal 'fn'.
		app.store.withTracking(() => {}, () => app.store.findMany('todo'));

		const { byKey, byView } = hook.request('snapshot:subscriptions');
		expect(byKey.todo).toContain(homeId);
		expect(byKey.todo).toContain('fn');
		expect(byView[homeId]).toContain('todo');
	});

	it('snapshot:route returns a JSON-safe current plus the chain view names', async () => {
		const hook = installHook();
		const app = await bootApp();
		document.title = 'Detail page';
		await app.visit('/detail/7?tab=notes');

		const route = hook.request('snapshot:route');
		expect(route).toMatchObject({
			path: '/detail/7?tab=notes',
			pathname: '/detail/7',
			params: { id: '7' },
			route: '/detail/:id',
			routes: ['/detail/:id'],
			chain: ['Detail'],
			title: 'Detail page',
		});
		expect(route.query).toEqual({ tab: 'notes' });
		expect(JSON.stringify(route)).toBeTypeOf('string');
	});

	it('edit:record applies the real record.update() and reports validation failures', async () => {
		const hook = installHook();
		const app = await bootApp();
		app.store.createRecord('todo', { id: 't1', text: 'alpha' });
		await settled();

		expect(hook.request('edit:record', { type: 'todo', id: 't1', patch: { text: 'omega' } }))
			.toEqual({ ok: true });
		expect(app.store.findOne('todo', 't1').text).toBe('omega');

		expect(
			hook.request('edit:record', { type: 'todo', id: 't1', patch: { text: '' } })
		).toEqual({ error: '"text" is required' });
		// The failed update left the record untouched.
		expect(app.store.findOne('todo', 't1').text).toBe('omega');

		expect(hook.request('edit:record', { type: 'todo', id: 'missing', patch: { text: 'x' } }))
			.toEqual({ error: 'no todo record with id "missing"' });
	});

	it('highlight:view adds one reusable overlay and removes it when turned off', async () => {
		const hook = installHook();
		await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;

		expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();

		expect(hook.request('highlight:view', { id: homeId, on: true })).toEqual({ ok: true });
		const overlay = document.querySelector(OVERLAY_SELECTOR);
		expect(overlay).not.toBeNull();
		expect(overlay.style.position).toBe('fixed');
		expect(overlay.style.pointerEvents).toBe('none');

		// A second highlight reuses the SAME element rather than stacking.
		hook.request('highlight:view', { id: homeId, on: true });
		expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);

		expect(hook.request('highlight:view', { id: homeId, on: false })).toEqual({ ok: true });
		expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
	});

	it('log:view and log:record console.log the live object and publish window.$p', async () => {
		const hook = installHook();
		const app = await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;
		app.store.createRecord('todo', { id: 't1', text: 'alpha' });
		await settled();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		expect(hook.request('log:view', { id: homeId })).toEqual({ ok: true });
		expect(window.$p).toBeInstanceOf(Home);
		expect(log).toHaveBeenCalled();

		expect(hook.request('log:record', { type: 'todo', id: 't1' })).toEqual({ ok: true });
		expect(window.$p).toBe(app.store.findOne('todo', 't1'));
	});

	it('answers an unknown request type with an error instead of throwing', async () => {
		const hook = installHook();
		await bootApp();

		expect(hook.request('nope:at:all')).toEqual({
			error: 'unknown devtools request "nope:at:all"',
		});
	});

	it('unregisters the overlay and the handler on app-unmounted', async () => {
		const hook = installHook();
		const app = await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;
		hook.request('highlight:view', { id: homeId, on: true });
		expect(document.querySelector(OVERLAY_SELECTOR)).not.toBeNull();

		app.app.unmount();
		await settled();

		expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
		expect(hook.request('snapshot:records')).toEqual({
			error: 'no store — the app is not mounted',
		});
	});
});

// ---- profiler ----------------------------------------------------------------

describe('devtools bridge — profiler (D121)', () => {
	const ZERO_REPORT = {
		recording: false,
		durationMs: 0,
		totals: {
			renders: 0,
			wastedRenders: 0,
			domMutations: 0,
			dataRuns: 0,
			storeFlushes: 0,
			storeNotifications: 0,
		},
		views: [],
		flushes: [],
		warnings: [],
	};

	it('snapshot:profile answers the zeroed report before the first recording', async () => {
		const hook = installHook();
		const app = await bootApp();
		app.store.createRecord('todo', { id: 't1', text: 'not recorded' });
		await settled();

		// The panel renders the shape unconditionally, so "never recorded" is
		// zeros — never null — and work done before perf:start is not in it.
		expect(hook.request('snapshot:profile')).toEqual(ZERO_REPORT);
	});

	it('perf:start accumulates per-view rows under the bridge’s own view ids', async () => {
		const hook = installHook();
		const app = await bootApp();
		const homeId = hook.of('view-mounted').find((e) => e.payload.name === 'Home').payload.id;

		expect(hook.request('perf:start')).toEqual({ ok: true });
		app.store.createRecord('todo', { id: 't1', text: 'write the seam' });
		await settled();

		const report = hook.request('snapshot:profile');
		expect(report.recording).toBe(true);
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
		expect(report.totals.renders).toBeGreaterThan(0);
		expect(report.totals.dataRuns).toBeGreaterThan(0);
		expect(report.totals.storeFlushes).toBeGreaterThan(0);
		expect(report.totals.storeNotifications).toBeGreaterThan(0);

		// THE cross-link: the row id is the same id view-mounted/snapshot:views
		// report, not devperf's separate internal numbering.
		const row = report.views.find((view) => view.name === 'Home');
		expect(row.id).toBe(homeId);
		expect(row.id).toBe(hook.request('snapshot:views').roots[0].id);
		expect(row.module).toBe('views/Home.pzl');
		expect(row.renders).toBeGreaterThan(0);
		expect(row.domMutations).toBeGreaterThan(0);
		// onStoreChange refreshed it, so the cause lands in the store bucket, and
		// every bucket the panel prints is present even at zero.
		expect(row.causes.store).toBeGreaterThan(0);
		expect(Object.keys(row.causes)).toEqual(
			expect.arrayContaining(['data', 'store', 'parent', 'route', 'manual', 'slot'])
		);
		expect(typeof row.renderMs).toBe('number');
		expect(typeof row.patchMs).toBe('number');
		expect(typeof row.dataMs).toBe('number');
		expect(row).toMatchObject({
			memoHits: expect.any(Number),
			memoMisses: expect.any(Number),
			propsBailouts: expect.any(Number),
			propsReruns: expect.any(Number),
		});

		// The store timeline keeps the changed KEYS (only this side of the bridge
		// has them) and reports `notified` as a count, not the id list the flush
		// EVENT carries.
		const flush = report.flushes.at(-1);
		expect(flush.keys).toContain('todo');
		expect(flush.notified).toBeGreaterThan(0);
		expect(typeof flush.at).toBe('number');
		expect(typeof flush.durationMs).toBe('number');
	});

	it('perf:stop freezes the report and later work does not land in it', async () => {
		const hook = installHook();
		const app = await bootApp();

		hook.request('perf:start');
		app.store.createRecord('todo', { id: 't1', text: 'during' });
		await settled();
		expect(hook.request('perf:stop')).toEqual({ ok: true });

		const stopped = hook.request('snapshot:profile');
		expect(stopped.recording).toBe(false);
		expect(stopped.totals.renders).toBeGreaterThan(0);

		app.store.createRecord('todo', { id: 't2', text: 'after' });
		await settled();

		const later = hook.request('snapshot:profile');
		expect(later.totals).toEqual(stopped.totals);
		expect(later.flushes).toHaveLength(stopped.flushes.length);
		// A stopped recording's duration is fixed at the stop, not still running.
		expect(later.durationMs).toBe(stopped.durationMs);
	});

	it('perf:start restarts a recording rather than resuming the old one', async () => {
		const hook = installHook();
		const app = await bootApp();

		hook.request('perf:start');
		app.store.createRecord('todo', { id: 't1', text: 'first window' });
		await settled();
		expect(hook.request('snapshot:profile').totals.renders).toBeGreaterThan(0);

		hook.request('perf:start');
		expect(hook.request('snapshot:profile')).toMatchObject({
			recording: true,
			totals: ZERO_REPORT.totals,
			views: [],
			flushes: [],
			warnings: [],
		});
	});

	it('pushes one perf-warning per loop detection and folds it into the report', async () => {
		const hook = installHook();
		const app = await bootApp();
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await app.visit('/runaway');
		const runawayId = hook.of('view-mounted').find((e) => e.payload.name === 'Runaway').payload
			.id;
		hook.request('perf:start');

		// 61 renders inside devperf's one-second window, none of them mutating
		// anything — the runaway detector's exact trigger.
		for (let i = 0; i < 61; i++) {
			runaway.setData('tick', i);
			runaway.flushUpdates();
		}

		// LOW VOLUME is the point: 60+ renders produce exactly one event.
		const warnings = hook.of('perf-warning');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ puzzle: 1, v: 1, type: 'perf-warning' });
		expect(warnings[0].payload).toEqual({
			kind: 'runaway-rerender',
			viewId: runawayId,
			name: 'Runaway',
			detail: expect.stringContaining('stopped Runaway after'),
			count: 1,
		});

		// The event reaches an attached panel now; the report entry is what a panel
		// opened later still finds.
		expect(hook.request('snapshot:profile').warnings).toEqual([
			{
				kind: 'runaway-rerender',
				viewId: runawayId,
				name: 'Runaway',
				detail: expect.stringContaining('stopped Runaway after'),
				count: 1,
			},
		]);
	});

	it('answers profiler requests without a recording and unknown ones by error', async () => {
		const hook = installHook();
		await bootApp();

		// Stopping something that never started is not an error — the panel may
		// reconnect to a page mid-session and stop defensively.
		expect(hook.request('perf:stop')).toEqual({ ok: true });
		expect(hook.request('snapshot:profile')).toEqual(ZERO_REPORT);
		expect(hook.request('perf:profile')).toEqual({
			error: 'unknown devtools request "perf:profile"',
		});
	});
});

// ---- no hook ----------------------------------------------------------------

describe('devtools bridge — no extension installed', () => {
	it('is inert: nothing emitted, no devtools globals, no overlay', async () => {
		expect(window[HOOK_KEY]).toBeUndefined();
		const before = new Set(Object.keys(window));

		const app = await bootApp();
		await app.visit('/detail/7');
		app.store.createRecord('todo', { id: 't1', text: 'alpha' });
		await settled();

		const added = Object.keys(window).filter((key) => !before.has(key));
		// The dev HMR publish is the app's own, pre-existing behavior; the bridge
		// must add nothing on top of it.
		expect(added.filter((key) => key !== '__PUZZLE_APP__')).toEqual([]);
		expect(window.$p).toBeUndefined();
		expect(window[HOOK_KEY]).toBeUndefined();
		expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
	});

	it('ignores a hook object that does not implement the protocol members', async () => {
		window[HOOK_KEY] = { emit: 'not-a-function' };

		const app = await bootApp();
		await app.visit('/detail/7');
		await settled();

		expect(window.$p).toBeUndefined();
		expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
	});
});

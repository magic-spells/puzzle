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

const routes = [
	{ path: '/', name: 'home', view: Home },
	{ path: '/detail/:id', name: 'detail', view: Detail },
];

const handles = [];

async function bootApp() {
	const app = await createTestApp({ routes, models: { todo: Todo } });
	handles.push(app);
	return app;
}

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
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

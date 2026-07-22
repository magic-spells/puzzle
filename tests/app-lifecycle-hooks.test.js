// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

// App lifecycle hooks (v1.28, SPEC §30, D60): beforeMount / mounted /
// beforeUnmount on the PuzzleApp config. Conventions copied from tests/app.test.js
// (hand-written render() stand-ins, h/text/slot helpers, container(), the apps[]
// + make() cleanup pattern).
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const tick = () => new Promise((r) => setTimeout(r, 0));

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
	}
}

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

// A view whose data() reads the store — proves records seeded in beforeMount are
// visible in the FIRST render (navigation #0's data() runs against a seeded store).
class TodoListView extends PuzzleView {
	data() {
		return { todos: this.ctx.store.findMany('todo') };
	}
	render() {
		const { todos = [] } = this.getData();
		return h(
			'puzzle-view',
			{ class: 'todos' },
			todos.map((t) => h('div', { class: 'todo' }, [text(t.text)]))
		);
	}
}

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};
	static adapter = { endpoint: '/api/todos' };
}

const container = (id = 'app') => {
	const el = document.createElement('div');
	el.id = id;
	document.body.appendChild(el);
	return el;
};

let apps = [];
function make(config) {
	const app = new PuzzleApp(config);
	apps.push(app);
	return app;
}

const todoRoutes = () => [
	{ path: '/', name: 'home', view: TodoListView, layout: DefaultLayout },
];
const homeRoutes = () => [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }];

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.title = '';
	document.body.innerHTML = '';
});

afterEach(() => {
	apps.forEach((a) => a.unmount());
	apps = [];
	vi.restoreAllMocks();
});

describe('PuzzleApp — beforeMount (SPEC §30, D60)', () => {
	it('seeds the store before navigation #0 — the first render sees the records', async () => {
		const el = container();
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: todoRoutes(),
			beforeMount(a) {
				a.store.createRecord('todo', { text: 'seeded-todo' });
			},
		});

		await app.mount();

		// The very first paint reflects the seed — no post-mount re-render needed.
		expect(el.querySelectorAll('.todo').length).toBe(1);
		expect(el.textContent).toContain('seeded-todo');
	});

	it('is awaited — an async seed lands before the first data() runs', async () => {
		const el = container();
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: todoRoutes(),
			beforeMount(a) {
				// resolve only after a macrotask; mount() must wait for it
				return new Promise((resolve) =>
					setTimeout(() => {
						a.store.createRecord('todo', { text: 'async-seed' });
						resolve();
					}, 0)
				);
			},
		});

		await app.mount();
		expect(el.textContent).toContain('async-seed');
	});

	it('receives the app as its argument, and `this === app` for a function-form hook', async () => {
		container();
		let arg, self;
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			beforeMount: function (a) {
				arg = a;
				self = this;
			},
		});
		await app.mount();
		expect(arg).toBe(app);
		expect(self).toBe(app);
	});

	it('a throw aborts the mount: mount() rejects, app is fully unmounted, beforeUnmount NOT fired, a later mount() succeeds', async () => {
		const el = container();
		let throwOnce = true;
		let beforeUnmountCalls = 0;
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: todoRoutes(),
			beforeMount(a) {
				if (throwOnce) {
					throwOnce = false;
					throw new Error('seed failed');
				}
				a.store.createRecord('todo', { text: 'second-try' });
			},
			beforeUnmount() {
				beforeUnmountCalls++;
			},
		});

		await expect(app.mount()).rejects.toThrow('seed failed');

		// Torn back down to the unmounted state.
		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();
		expect(() => app.store).toThrow(/app\.store is not available/);
		// The abort path pairs with a COMPLETED mount — beforeUnmount must not fire.
		expect(beforeUnmountCalls).toBe(0);

		// Re-mounting the same instance is legal and succeeds.
		await app.mount();
		expect(el.textContent).toContain('second-try');
		expect(beforeUnmountCalls).toBe(0); // still no unmount happened
	});
});

describe('PuzzleApp — mounted (SPEC §30, D60)', () => {
	it('fires after the initial route is in the DOM', async () => {
		const el = container();
		let contentInsideHook = null;
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			mounted() {
				contentInsideHook = el.textContent;
			},
		});
		await app.mount();
		expect(contentInsideHook).toContain('HOME');
	});

	it('an async-rejecting mounted is logged and mount() still resolves', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		container();
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			mounted() {
				return Promise.reject(new Error('async mounted boom'));
			},
		});

		const returned = await app.mount();
		expect(returned).toBe(app); // resolved, not rejected
		await tick(); // let the rejection reach the attached .catch

		expect(spy).toHaveBeenCalled();
		expect(spy.mock.calls[0][0]).toMatch(/\[puzzle\]/);
		expect(spy.mock.calls[0].some((a) => a instanceof Error && /async mounted boom/.test(a.message))).toBe(
			true
		);
	});

	it('a sync-throwing mounted is logged and mount() still resolves', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		container();
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			mounted() {
				throw new Error('sync mounted boom');
			},
		});

		const returned = await app.mount();
		expect(returned).toBe(app);
		expect(spy).toHaveBeenCalled();
		expect(spy.mock.calls[0][0]).toMatch(/\[puzzle\]/);
	});
});

describe('PuzzleApp — beforeUnmount (SPEC §30, D60)', () => {
	it('fires before teardown (store still readable) and a throw is logged while teardown completes', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const el = container();
		let storeReadable = false;
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: homeRoutes(),
			beforeUnmount(a) {
				// Services still live: the store is readable here (persistence flush).
				storeReadable = Array.isArray(a.store.findMany('todo'));
				throw new Error('flush failed');
			},
		});
		await app.mount();

		expect(() => app.unmount()).not.toThrow();
		expect(storeReadable).toBe(true);
		expect(spy).toHaveBeenCalled();
		expect(spy.mock.calls[0][0]).toMatch(/\[puzzle\]/);
		// teardown still completed despite the throw
		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();
		expect(() => app.store).toThrow(/app\.store is not available/);
	});

	it('a returned rejecting promise is logged (not unhandled) and teardown still completes (Change B)', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const el = container();
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			beforeUnmount() {
				// A rejecting thenable — teardown stays synchronous and does not await
				// it, but its rejection must be observed (mirrors the mounted hook).
				return Promise.reject(new Error('async flush boom'));
			},
		});
		await app.mount();

		expect(() => app.unmount()).not.toThrow();
		// Teardown completed synchronously despite the async rejection.
		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();

		await tick(); // let the rejection reach the attached .catch
		expect(spy).toHaveBeenCalled();
		expect(spy.mock.calls[0][0]).toMatch(/\[puzzle\] beforeUnmount hook error:/);
		expect(
			spy.mock.calls[0].some((a) => a instanceof Error && /async flush boom/.test(a.message))
		).toBe(true);
	});

	it('never fires on a never-mounted app, and a double unmount() fires it exactly once', async () => {
		let calls = 0;
		container();
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			beforeUnmount() {
				calls++;
			},
		});

		// never mounted → unmount() is a no-op, hook does not fire
		app.unmount();
		expect(calls).toBe(0);

		await app.mount();
		app.unmount();
		app.unmount(); // idempotent — second call must not re-fire
		expect(calls).toBe(1);
	});
});

describe('PuzzleApp — mount/unmount cycles (SPEC §30, D60)', () => {
	it('re-fires all three hooks on every mount/unmount cycle', async () => {
		container();
		const counts = { beforeMount: 0, mounted: 0, beforeUnmount: 0 };
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			beforeMount() {
				counts.beforeMount++;
			},
			mounted() {
				counts.mounted++;
			},
			beforeUnmount() {
				counts.beforeUnmount++;
			},
		});

		await app.mount();
		app.unmount();
		await app.mount();
		app.unmount();

		expect(counts).toEqual({ beforeMount: 2, mounted: 2, beforeUnmount: 2 });
	});
});

describe('PuzzleApp — hook validation (SPEC §30, D60)', () => {
	it('a non-function hook value rejects mount() with a clear error, before any wiring', async () => {
		const el = container();
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			beforeMount: 42,
		});

		await expect(app.mount()).rejects.toThrow(
			/\[puzzle\] config\.beforeMount must be a function when set/
		);
		// Threw before any wiring: nothing rendered, no store created.
		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();
		expect(() => app.store).toThrow(/app\.store is not available/);
	});
});

describe('PuzzleApp — unmount during in-flight beforeMount (SPEC §30, D60)', () => {
	it('the router never starts, nothing mounts, mount() settles with no render and no unhandled rejection', async () => {
		const el = container();
		let release;
		const app = make({
			target: '#app',
			routes: homeRoutes(),
			beforeMount() {
				return new Promise((r) => {
					release = r;
				});
			},
		});

		const mounting = app.mount();
		await tick(); // now suspended inside the awaited beforeMount
		expect(el.children.length).toBe(0); // navigation #0 has not run

		// Tear down while beforeMount is still pending.
		expect(() => app.unmount()).not.toThrow();

		// Let the hook resolve late — the post-hook guard must keep the router off.
		release();
		await expect(mounting).resolves.toBe(app);
		await tick();

		expect(el.children.length).toBe(0); // still nothing mounted
		expect(app.router).toBeNull();
	});
});

describe('PuzzleApp — no hooks (SPEC §30, D60)', () => {
	it('mounts and renders exactly as before when no hooks are configured', async () => {
		const el = container();
		const app = make({ target: '#app', routes: homeRoutes() });
		const returned = await app.mount();
		expect(returned).toBe(app);
		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(el.textContent).toContain('HOME');
	});
});

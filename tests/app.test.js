// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { Store } from '../client-runtime/datastore/store.js';
import { installFakeAnimate } from './helpers/fake-waapi.js';

// Hand-written stand-ins for what the compiler emits (same convention as
// tests/router.test.js): a render() returns a ViewNode tree, views/layouts emit
// a <puzzle-view> root (D20), and <Slot/> is a SLOT_TAG node.
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

// A view that formats a value through ctx.formatters — proves config formatters
// reach the render path (views call this.ctx.formatters.getAll()).
class FormatView extends PuzzleView {
	render() {
		const f = this.ctx.formatters.getAll();
		return h('puzzle-view', { class: 'fmt' }, [
			text(f.shout('hi')), // custom formatter
			text(f.upcase('ab')), // built-in, possibly overridden
		]);
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

describe('PuzzleApp — boot (APP_ANATOMY §3)', () => {
	it('mount() renders the initial route view into the target and returns the app', async () => {
		const el = container();
		const app = make({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
		});

		const returned = await app.mount();
		expect(returned).toBe(app); // chainable

		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(el.textContent).toContain('HOME');
	});

	it('constructor has no side effects — nothing wired until mount()', () => {
		const app = make({ target: '#app', routes: [] });
		expect(app.router).toBeNull();
		expect(app.ctx).toBeNull();
	});

	// transitionMode passthrough (v1.24, D56): the config key reaches the Router
	// — an invalid value surfaces the Router's own constructor throw at mount(),
	// and a valid one mounts cleanly. Overlap SEQUENCING itself is covered in
	// tests/router-overlap.test.js; this guards only the PuzzleApp wiring.
	it("passes transitionMode through to the Router (invalid value → Router's throw)", async () => {
		container();
		const bad = make({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
			transitionMode: 'crossfade',
		});
		await expect(bad.mount()).rejects.toThrow(/unknown transitionMode: "crossfade"/);

		document.body.innerHTML = '';
		container();
		const good = make({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
			transitionMode: 'overlap',
		});
		await good.mount();
		expect(document.querySelector('.home')).not.toBeNull();
	});
});

describe('PuzzleApp — pre-mount store access fails loudly', () => {
	it('throws with a helpful message when app.store is read before mount()', () => {
		const app = make({ target: '#app', routes: [] });
		expect(() => app.store).toThrow(/app\.store is not available until mount\(\) has been called/);
	});

	it('app.store is a Store the moment mount() is CALLED (before its promise resolves) and after it resolves', async () => {
		container();
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
		});

		// The documented interleave idiom: capture the store synchronously after
		// mount() STARTS, before awaiting its returned promise.
		const pending = app.mount();
		const captured = app.store; // must already be wired
		expect(captured).toBeInstanceOf(Store);

		await pending;
		expect(app.store).toBe(captured); // same instance after the boot resolves
		expect(app.store.createRecord('todo', { text: 'x' })).toBeInstanceOf(Todo);
	});
});

describe('PuzzleApp — formatters', () => {
	it('registers config formatters and lets a custom formatter override a built-in of the same name', async () => {
		const el = container();
		const app = make({
			target: '#app',
			routes: [{ path: '/', name: 'fmt', view: FormatView, layout: DefaultLayout }],
			formatters: {
				shout: (s) => String(s).toUpperCase() + '!',
				upcase: () => 'OVERRIDDEN', // shadows the built-in upcase
			},
		});
		await app.mount();

		// registry resolves the custom formatter...
		expect(app.formatters.get('shout')('hi')).toBe('HI!');
		// ...and the override wins over the built-in of the same name
		expect(app.formatters.get('upcase')('ab')).toBe('OVERRIDDEN');

		// and both reach the rendered DOM via ctx.formatters
		expect(el.textContent).toContain('HI!');
		expect(el.textContent).toContain('OVERRIDDEN');
	});
});

describe('PuzzleApp — models & store wiring', () => {
	it('wires the models registry so createRecord applies schema defaults', async () => {
		container();
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
		});
		await app.mount();

		const todo = app.store.createRecord('todo', { text: 'ship v1' });
		expect(todo).toBeInstanceOf(Todo);
		expect(todo.completed).toBe(false); // schema default applied
		expect(typeof todo.id).toBe('string'); // pk generated
	});

	it('passes apiURL to the store so loadAll fetches apiURL + adapter.endpoint', async () => {
		container();
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => [{ id: 't1', text: 'from server' }],
		}));
		vi.stubGlobal('fetch', fetchMock);

		const app = make({
			target: '#app',
			apiURL: 'https://api.example.com',
			models: { todo: Todo },
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
		});
		await app.mount();

		const records = await app.store.loadAll('todo');
		expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/todos');
		expect(records).toHaveLength(1);
		expect(app.store.findOne('todo', 't1').text).toBe('from server');
	});
});

describe('PuzzleApp — target resolution', () => {
	it('throws a helpful error naming the selector when the target is missing', async () => {
		// no matching element in the DOM
		const app = make({ target: '#does-not-exist', routes: [] });
		await expect(app.mount()).rejects.toThrow(/#does-not-exist/);
	});

	it('accepts an Element as the target (not only a selector)', async () => {
		const el = document.createElement('section');
		document.body.appendChild(el);
		const app = make({
			target: el,
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
		});
		await app.mount();
		expect(el.querySelector('.home')).not.toBeNull();
	});
});

describe('PuzzleApp — unmount()', () => {
	it('stops routing and clears the container; idempotent', async () => {
		const el = container();
		const app = make({
			target: '#app',
			routes: [
				{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
				{ path: '/other', name: 'other', view: FormatView, layout: DefaultLayout },
			],
			formatters: { shout: (s) => String(s) },
		});
		await app.mount();
		expect(el.querySelector('.home')).not.toBeNull();

		app.unmount();
		expect(el.children.length).toBe(0); // container cleared
		// store torn down: the getter throws again post-unmount (see the pre-mount
		// access guard test) rather than returning a stale/undefined store
		expect(() => app.store).toThrow(/app\.store is not available/);
		expect(app.router).toBeNull();

		// routing stopped: a link click is no longer intercepted. Suppress the
		// default so jsdom's unimplemented real navigation stays quiet (noise only).
		const suppress = (e) => e.preventDefault();
		document.addEventListener('click', suppress);
		const spy = vi.spyOn(history, 'pushState');
		const link = document.createElement('a');
		link.setAttribute('href', '/other');
		document.body.appendChild(link);
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
		await tick();
		expect(spy).not.toHaveBeenCalled();
		document.removeEventListener('click', suppress);

		// idempotent — a second unmount is a no-op
		expect(() => app.unmount()).not.toThrow();
	});
});

// Full runtime teardown (Router.stop own the view-chain teardown). The layout,
// routed view, and nested components must all fire destroyed() and drop their
// store subscriptions on unmount; an in-flight navigation or out-animation at
// teardown time must leave nothing live and throw nothing.
describe('PuzzleApp — full teardown (unmount destroys the view chain)', () => {
	it('fires destroyed() exactly once for the layout, routed view, and a nested component, and drains store subscriptions', async () => {
		const log = [];

		// A component nested inside the routed view (not itself routed) — proves the
		// teardown cascade reaches ordinary components, not only <Slot/> views.
		class Widget extends PuzzleView {
			data() {
				return { todos: this.ctx.store.findMany('todo') }; // subscribes 'todo'
			}
			render() {
				return h('puzzle-view', { class: 'widget' }, [text('W')]);
			}
			destroyed() {
				log.push('widget');
			}
		}
		class SubView extends PuzzleView {
			data() {
				return { todos: this.ctx.store.findMany('todo') }; // subscribes 'todo'
			}
			render() {
				return h('puzzle-view', { class: 'sub' }, [new ViewNode(Widget, {}, [])]);
			}
			destroyed() {
				log.push('view');
			}
		}
		class LogLayout extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
			}
			destroyed() {
				log.push('layout');
			}
		}

		const el = container();
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: [{ path: '/', name: 'home', view: SubView, layout: LogLayout }],
		});
		await app.mount();
		await tick(); // let the nested Widget finish its async mount + data()

		const store = app.store; // capture before unmount drops the ref
		expect(el.querySelector('.layout main .sub .widget')).not.toBeNull();
		expect(store.subscribersByKey.size).toBeGreaterThan(0); // 'todo' subscribed
		expect(store.keysBySubscriber.size).toBe(2); // SubView + Widget

		app.unmount();

		// destroyed() fired once each (sorted equality rules out any duplicate)
		expect([...log].sort()).toEqual(['layout', 'view', 'widget']);
		// subscription maps fully drained — no leaked store subscriptions
		expect(store.subscribersByKey.size).toBe(0);
		expect(store.keysBySubscriber.size).toBe(0);
		// DOM cleared
		expect(el.children.length).toBe(0);

		// a store change now reaches nobody (indirect proof nothing re-subscribed)
		expect(() => store.createRecord('todo', { text: 'after unmount' })).not.toThrow();
	});

	it('unmount during a pending navigation (slow async data()) mounts nothing, subscribes nothing, throws nothing', async () => {
		let resolveData;
		class SlowView extends PuzzleView {
			async data() {
				await new Promise((r) => {
					resolveData = r;
				});
				return { todos: this.ctx.store.findMany('todo') };
			}
			render() {
				return h('puzzle-view', { class: 'slow' }, [text('S')]);
			}
		}

		const el = container();
		const app = make({
			target: '#app',
			models: { todo: Todo },
			routes: [{ path: '/', name: 'home', view: SlowView, layout: DefaultLayout }],
		});

		const mounting = app.mount(); // hangs pre-commit on SlowView.data()
		await tick();
		const store = app.store;
		expect(el.querySelector('.slow')).toBeNull(); // never committed

		// Tear down while the navigation is still awaiting data().
		expect(() => app.unmount()).not.toThrow();

		// Late data() resolution must NOT mount into the detached container nor
		// resubscribe: the token bump in stop() makes the pending nav stale.
		resolveData();
		await mounting.catch(() => {});
		await tick();

		expect(el.children.length).toBe(0);
		expect(store.subscribersByKey.size).toBe(0);
		expect(store.keysBySubscriber.size).toBe(0);
	});

	it('unmount during an out-animation cancels it and destroys the pending-out view; no live view, throws nothing', async () => {
		const waapi = installFakeAnimate();
		try {
			const log = [];
			class AnimHome extends PuzzleView {
				animations = { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } };
				render() {
					return h('puzzle-view', { class: 'ahome' }, [text('A')]);
				}
				destroyed() {
					log.push('ahome');
				}
			}
			class Other extends PuzzleView {
				render() {
					return h('puzzle-view', { class: 'other' }, [text('O')]);
				}
			}

			const el = container();
			const app = make({
				target: '#app',
				routes: [
					{ path: '/', name: 'home', view: AnimHome, layout: DefaultLayout },
					{ path: '/other', name: 'other', view: Other, layout: DefaultLayout },
				],
			});
			await app.mount();
			const store = app.store;

			const p = app.router.push('/other');
			await tick(); // out-animation now in flight — AnimHome is #pendingOut
			expect(el.querySelector('.ahome')).not.toBeNull(); // still animating out

			expect(() => app.unmount()).not.toThrow();
			expect(log).toContain('ahome'); // the pending-out instance was destroyed
			expect(el.children.length).toBe(0);
			expect(store.subscribersByKey.size).toBe(0);

			// let the superseded swap resume (its await resolves when destroy() cancels
			// the animation) — it must abandon its fresh instances, not remount.
			await p.catch(() => {});
			await tick();
			expect(el.children.length).toBe(0);
		} finally {
			waapi.uninstall();
		}
	});

	it('repeated unmount is a no-op and a fresh PuzzleApp mounts cleanly afterward', async () => {
		const el = container();
		const app = make({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
		});
		await app.mount();
		app.unmount();
		expect(() => app.unmount()).not.toThrow(); // idempotent

		// a brand-new app mounts into the same target with no interference
		const app2 = make({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }],
		});
		await app2.mount();
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.textContent).toContain('HOME');
	});
});

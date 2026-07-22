// @vitest-environment jsdom
//
// Memory-mode routing (v1.11, D42): opt in with `{ mode: 'memory' }` to keep the
// route ENTIRELY in router state — location/history are never read or written.
// For tests (no jsdom history gymnastics) and embedded/iframe apps that must not
// touch the host page's URL. The public API stays PATH-SHAPED and mode-agnostic
// (push('/about'), current.path === '/about'); an in-memory { path } stack + index
// replaces history, and go(n)/back()/forward() move that index. Same jsdom
// conventions as router-hash.test.js: hand-written render() stand-ins, routers
// tracked + stop()ped in afterEach.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { installFakeAnimate } from './helpers/fake-waapi.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const ctx = (store = null) => ({ store, router: null, formatters: null });

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [
			h('header', {}, [text('HEADER')]),
			h('main', {}, [slot()]),
		]);
	}
}

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

class AboutView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
	}
}

class TodosView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'todos' }, [text('TODOS')]);
	}
}

let seenUserId;
class UserView extends PuzzleView {
	data(params) {
		seenUserId = params.id;
		return { id: params.id };
	}
	render() {
		return h('puzzle-view', { class: 'user' }, [text('user ' + this.getData().id)]);
	}
}

// Track live routers so listeners never leak into the next test.
let routers = [];

// Boot in memory mode. `options` (e.g. { initialPath, scrollBehavior }) merge over
// { mode: 'memory' }.
async function bootMemory(routes, options = {}) {
	const el = container();
	const router = new Router(routes, { mode: 'memory', ...options });
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.title = '';
	seenUserId = undefined;
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

describe('Router memory mode — construction (D42)', () => {
	it('accepts mode "memory"', () => {
		expect(() => new Router([], { mode: 'memory' })).not.toThrow();
	});

	it('throws on an unknown mode with the updated message', () => {
		expect(() => new Router([], { mode: 'bogus' })).toThrow(
			/unknown router mode: "bogus" \(expected 'history', 'hash', or 'memory'\)/
		);
	});

	it('throws when initialPath is set with history mode', () => {
		expect(() => new Router([], { mode: 'history', initialPath: '/x' })).toThrow(
			/"initialPath" is only valid in memory mode/
		);
	});

	it('throws when initialPath is set with the default (history) mode', () => {
		expect(() => new Router([], { initialPath: '/x' })).toThrow(
			/"initialPath" is only valid in memory mode/
		);
	});

	it('throws when initialPath is set with hash mode', () => {
		expect(() => new Router([], { mode: 'hash', initialPath: '/x' })).toThrow(
			/"initialPath" is only valid in memory mode/
		);
	});

	it('go()/back()/forward() before start() do not throw (null #stack guard, D42)', () => {
		// Before start() the in-memory stack is null; the guard must degrade silently
		// (previously #index + n read #stack.length → TypeError).
		const router = new Router([], { mode: 'memory' });
		routers.push(router);
		expect(() => router.back()).not.toThrow();
		expect(() => router.forward()).not.toThrow();
		expect(() => router.go(-3)).not.toThrow();
	});
});

describe('Router memory mode — initial navigation (D42)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	];

	it("starts at '/' by default", async () => {
		const { router, el } = await bootMemory(routes);
		expect(el.querySelector('.home')).not.toBeNull();
		expect(router.current.route.name).toBe('home');
		expect(router.current.path).toBe('/');
	});

	it('starts at a supplied initialPath', async () => {
		const { router, el } = await bootMemory(routes, { initialPath: '/about' });
		expect(el.querySelector('.about')).not.toBeNull();
		expect(router.current.route.name).toBe('about');
		expect(router.current.path).toBe('/about');
	});

	it('touches neither location.pathname nor location.hash on init', async () => {
		await bootMemory(routes, { initialPath: '/about' });
		expect(location.pathname).toBe('/');
		expect(location.hash).toBe('');
	});
});

describe('Router memory mode — push pipeline (D42 / D19)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
		{ path: '/todos', name: 'todos', view: TodosView, layout: DefaultLayout },
	];

	it('push swaps the view, delivers params, exposes a path-shaped current, and never touches the URL', async () => {
		const { router, el } = await bootMemory(routes);

		const pushSpy = vi.spyOn(history, 'pushState');
		await router.push('/user/123');

		expect(router.current.path).toBe('/user/123');
		expect(seenUserId).toBe('123');
		expect(el.textContent).toContain('user 123');
		expect(pushSpy).not.toHaveBeenCalled(); // no history writes at all
		expect(location.pathname).toBe('/'); // pathname untouched
		expect(location.hash).toBe(''); // hash untouched
	});

	it('URL (pathname/hash) stays untouched across multiple pushes', async () => {
		const { router } = await bootMemory(routes);
		await router.push('/user/1');
		await router.push('/todos');
		await router.push('/user/2');
		expect(location.pathname).toBe('/');
		expect(location.hash).toBe('');
		expect(router.current.path).toBe('/user/2');
	});

	it('commit is atomic (D19): mid-flight nothing has changed; state moves only after data() resolves', async () => {
		class SlowView extends PuzzleView {
			async data() {
				await delay(15);
				return { msg: 'SLOW' };
			}
			render() {
				return h('puzzle-view', { class: 'slow' }, [text(this.getData().msg ?? '')]);
			}
		}
		const { router, el } = await bootMemory([
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/slow', name: 'slow', view: SlowView, layout: DefaultLayout },
		]);

		const p = router.push('/slow');
		// mid-flight: data() has not resolved, so nothing committed
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.slow')).toBeNull();

		await p;
		expect(router.current.path).toBe('/slow');
		expect(el.querySelector('.slow')).not.toBeNull();
	});

	it('a push byte-identical to the committed path is a no-op (no stack entry, no data() re-run)', async () => {
		let dataRuns = 0;
		class CountView extends PuzzleView {
			data(params) {
				dataRuns++;
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', { class: 'count' }, [text('COUNT')]);
			}
		}
		const { router } = await bootMemory([
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/x', name: 'x', view: CountView, layout: DefaultLayout },
		]);
		await router.push('/x'); // [/, /x] @1 — data() runs once
		expect(dataRuns).toBe(1);

		await router.push('/x'); // byte-identical → no-op: no new entry, no data() re-run
		expect(dataRuns).toBe(1);
		expect(router.current.path).toBe('/x');

		// If a duplicate '/x' entry had been pushed, back() would land on '/x' again;
		// landing on '/' proves the stack did not grow.
		await router.back();
		expect(router.current.path).toBe('/');
	});
});

describe('Router memory mode — no document-level side effects (D42)', () => {
	it('does not set document.title even when meta.title is present', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home Page' } },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout, meta: { title: 'About Page' } },
		];
		const { router } = await bootMemory(routes);
		expect(document.title).toBe(''); // init did not set it
		await router.push('/about');
		expect(document.title).toBe(''); // push did not set it either
	});

	it('registers no popstate listener — a stray popstate is ignored', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		];
		const { router, el } = await bootMemory(routes);
		await router.push('/about');
		expect(router.current.route.name).toBe('about');

		// A popstate the memory router never subscribed to must not disturb it.
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();
		expect(router.current.route.name).toBe('about');
		expect(el.querySelector('.about')).not.toBeNull();
	});
});

describe('Router memory mode — link interception (D42)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	];

	it('intercepts a same-origin pathname <a> and routes in memory, URL untouched', async () => {
		const { router, el } = await bootMemory(routes);
		const pushSpy = vi.spyOn(router, 'push');

		const link = document.createElement('a');
		link.setAttribute('href', '/about');
		document.body.appendChild(link);
		const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(evt);

		expect(evt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/about');

		await tick();
		expect(router.current.route.name).toBe('about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(location.pathname).toBe('/'); // URL never moved
		expect(location.hash).toBe('');

		link.remove();
	});

	it("leaves a bare '#anchor' href alone (falls through as in history mode)", async () => {
		const { router } = await bootMemory(routes);
		const pushSpy = vi.spyOn(router, 'push');

		const anchor = document.createElement('a');
		anchor.setAttribute('href', '#faq');
		document.body.appendChild(anchor);
		const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		anchor.dispatchEvent(evt);

		expect(evt.defaultPrevented).toBe(false);
		expect(pushSpy).not.toHaveBeenCalled();
		anchor.remove();
	});
});

describe('Router memory mode — go / back / forward (D42)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		{ path: '/todos', name: 'todos', view: TodosView, layout: DefaultLayout },
	];

	it('back() and forward() walk the stack, re-rendering views; current.path tracks', async () => {
		const { router, el } = await bootMemory(routes);
		await router.push('/about');
		await router.push('/todos');
		expect(router.current.path).toBe('/todos');

		await router.back();
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();

		await router.back();
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();

		await router.forward();
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
	});

	it('go(n) jumps multiple entries', async () => {
		const { router } = await bootMemory(routes);
		await router.push('/about');
		await router.push('/todos');

		await router.go(-2);
		expect(router.current.path).toBe('/');
		await router.go(2);
		expect(router.current.path).toBe('/todos');
	});

	it('out-of-range go is a silent no-op (view unchanged)', async () => {
		const { router, el } = await bootMemory(routes);
		await router.push('/about');

		await router.forward(); // nothing ahead
		expect(router.current.path).toBe('/about');
		await router.go(-5); // past the start
		// go(-5) is out of range from index 1 (target -4) → no-op
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
	});

	it('push after back() truncates forward entries and lands on the new branch (browser semantics)', async () => {
		// Route set where every pushed path matches.
		const { router } = await bootMemory(routes);
		await router.push('/about'); // [/, /about] @1
		await router.push('/todos'); // [/, /about, /todos] @2
		await router.back(); // @1 (/about)

		await router.push('/todos'); // truncate then append /todos → [/, /about, /todos] @2
		expect(router.current.path).toBe('/todos');

		// forward is out of range now
		await router.forward();
		expect(router.current.path).toBe('/todos');

		// back walks the (rebuilt) stack
		await router.back();
		expect(router.current.path).toBe('/about');
		await router.back();
		expect(router.current.path).toBe('/');
	});
});

// Fix 3 (D42): go(n) bases its target off a PENDING pop when one is in flight, not
// the committed #index (which moves only at commit, D19). Without this, two
// SYNCHRONOUS back() calls both read the same #index and target the same entry,
// collapsing two moves into one. #pendingIndex tracks the latest in-flight pop
// target; a push resets it (supersedes + truncates); every commit clears it.
describe('Router memory mode — synchronous go() chains (#pendingIndex, D42)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		{ path: '/todos', name: 'todos', view: TodosView, layout: DefaultLayout },
	];

	it('two synchronous back() from index 2 land at index 0 (not collapsed into one move)', async () => {
		const { router, el } = await bootMemory(routes);
		await router.push('/about'); // [/, /about] @1
		await router.push('/todos'); // [/, /about, /todos] @2
		expect(router.current.path).toBe('/todos');

		// Fire both WITHOUT awaiting between: both compute their target before either
		// commits. The second must base off the first's pending target (1) → 0.
		const p1 = router.back();
		const p2 = router.back();
		await Promise.all([p1, p2]);

		expect(router.current.path).toBe('/'); // index 0 — both moves landed
		expect(el.querySelector('.home')).not.toBeNull();

		// The stack is intact (history length sane): [/, /about, /todos], now @0.
		// Walking forward proves all three entries survive and a further back is a no-op.
		await router.back();
		expect(router.current.path).toBe('/'); // already at the start → no-op
		await router.forward();
		expect(router.current.path).toBe('/about');
		await router.forward();
		expect(router.current.path).toBe('/todos');
		await router.forward();
		expect(router.current.path).toBe('/todos'); // top → no-op
	});

	it('three synchronous back() from index 2 clamp at index 0 (out-of-range extra pop is a no-op)', async () => {
		const { router } = await bootMemory(routes);
		await router.push('/about');
		await router.push('/todos'); // @2

		const p1 = router.back(); // → pending 1
		const p2 = router.back(); // → pending 0
		const p3 = router.back(); // base 0, target -1 → out of range, no-op (returns undefined)
		expect(p3).toBeUndefined();
		await Promise.all([p1, p2]);

		expect(router.current.path).toBe('/');
	});

	it('synchronous back()+forward() net to the starting entry (forward supersedes the pending back)', async () => {
		const { router, el } = await bootMemory(routes);
		await router.push('/about');
		await router.push('/todos'); // @2

		const pBack = router.back(); // → pending 1
		const pFwd = router.forward(); // base 1, target 2 (undoes the back) → wins
		await Promise.all([pBack, pFwd]);

		expect(router.current.path).toBe('/todos'); // back to where we started @2
		expect(el.querySelector('.todos')).not.toBeNull();
	});

	it('synchronous back()+back()+forward() lands one back from the start', async () => {
		const { router } = await bootMemory(routes);
		await router.push('/about');
		await router.push('/todos'); // @2

		const p1 = router.back(); // pending 1
		const p2 = router.back(); // pending 0
		const p3 = router.forward(); // base 0, target 1 → wins
		await Promise.all([p1, p2, p3]);

		expect(router.current.path).toBe('/about'); // index 1
	});

	it('a synchronous push after back() supersedes the pending pop and resets its target', async () => {
		const { router } = await bootMemory(routes);
		await router.push('/about');
		await router.push('/todos'); // @2

		// back() starts (pending 1). A push arriving before it commits supersedes it
		// and truncates forward entries from #index (still 2, the pop never committed),
		// so the pending target is moot: [/, /about, /todos, /about] @3.
		const pBack = router.back();
		const pPush = router.push('/about');
		await Promise.all([pBack, pPush]);

		expect(router.current.path).toBe('/about');
		// Walk back to prove /todos survived at index 2 (the pop's target 1 never
		// truncated it away): @3(/about) → @2(/todos) → @1(/about) → @0(/).
		await router.back();
		expect(router.current.path).toBe('/todos');
		await router.back();
		expect(router.current.path).toBe('/about');
		await router.back();
		expect(router.current.path).toBe('/');
	});

	it('a failed pop clears its pending target so a later back() bases off the committed #index', async () => {
		let reject = false;
		class Flaky extends PuzzleView {
			async data() {
				if (reject) throw new Error('flaky data');
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'flaky' }, [text('FLAKY')]);
			}
		}
		const r2 = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/flaky', name: 'flaky', view: Flaky, layout: DefaultLayout },
			{ path: '/todos', name: 'todos', view: TodosView, layout: DefaultLayout },
		];
		const { router } = await bootMemory(r2);
		await router.push('/flaky'); // @1
		await router.push('/todos'); // @2

		// A pop back to /flaky fails (its data() rejects) → #index stays at 2 and the
		// pending target must be cleared, or the next back() would base off it (1) → 0.
		reject = true;
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await router.back(); // rejects, stays at /todos @2
		errSpy.mockRestore();
		expect(router.current.path).toBe('/todos');

		// The next back() must base off the committed #index (2) → 1, not the failed
		// target. /flaky now loads fine.
		reject = false;
		await router.back();
		expect(router.current.path).toBe('/flaky'); // index 1, not 0
	});
});

describe('Router memory mode — failed navigation does not move the stack (D42 / D19)', () => {
	it('a rejecting data() leaves current + stack untouched; back afterwards is as if it never happened', async () => {
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
			{ path: '/bad', name: 'bad', view: BadView, layout: DefaultLayout },
		];
		const { router, el } = await bootMemory(routes);
		await router.push('/about'); // [/, /about] @1

		await router.push('/bad'); // rejects → stack unchanged, stays on /about
		expect(router.current.route.name).toBe('about');
		expect(el.querySelector('.bad')).toBeNull();
		expect(errSpy).toHaveBeenCalled();

		// back() must land on '/' (the failed push added no entry).
		await router.back();
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
	});
});

describe('Router memory mode — scroll is a no-op (D42)', () => {
	it('a scrollBehavior function is never called, and sessionStorage is untouched', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		];
		const scrollBehavior = vi.fn(() => ({ x: 0, y: 0 }));
		const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
		const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

		const { router } = await bootMemory(routes, { scrollBehavior });
		await router.push('/about');
		await router.back();
		await router.forward();

		expect(scrollBehavior).not.toHaveBeenCalled();
		expect(setItemSpy).not.toHaveBeenCalled();
		expect(scrollToSpy).not.toHaveBeenCalled();
	});
});

describe('Router go/back/forward — history mode delegates to history.go (D42)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	];

	async function bootHistory() {
		const el = container();
		const router = new Router(routes); // default history mode
		routers.push(router);
		await router.start(el, ctx());
		return { router, el };
	}

	it('back()/forward()/go(n) delegate to history.go with -1 / 1 / n', async () => {
		const { router } = await bootHistory();
		const goSpy = vi.spyOn(history, 'go').mockImplementation(() => {});

		router.back();
		expect(goSpy).toHaveBeenLastCalledWith(-1);
		router.forward();
		expect(goSpy).toHaveBeenLastCalledWith(1);
		router.go(3);
		expect(goSpy).toHaveBeenLastCalledWith(3);
		expect(goSpy).toHaveBeenCalledTimes(3);
	});
});

describe('Router memory mode — nested routes (D42 / D30)', () => {
	function makeShell(name) {
		return class extends PuzzleView {
			render() {
				return h('puzzle-view', { class: name }, [
					h('h1', {}, [text(name.toUpperCase())]),
					h('section', { class: name + '-outlet' }, [slot()]),
				]);
			}
		};
	}
	function makeLeaf(name) {
		return class extends PuzzleView {
			render() {
				return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
			}
		};
	}

	it('renders a nested chain and swaps the leaf on push, reusing the shell', async () => {
		const Shell = makeShell('settings');
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/settings',
				name: 'settings',
				view: Shell,
				layout: DefaultLayout,
				children: [
					{ path: '', name: 'settings-index', view: makeLeaf('s-index') },
					{ path: 'profile', name: 'settings-profile', view: makeLeaf('s-profile') },
				],
			},
		];
		const { router, el } = await bootMemory(routes, { initialPath: '/settings' });
		expect(el.querySelector('.settings .settings-outlet .s-index')).not.toBeNull();
		expect(router.current.path).toBe('/settings');

		await router.push('/settings/profile');
		expect(el.querySelector('.settings .settings-outlet .s-profile')).not.toBeNull();
		expect(el.querySelector('.s-index')).toBeNull();
		expect(router.current.path).toBe('/settings/profile');

		await router.back();
		expect(el.querySelector('.settings .settings-outlet .s-index')).not.toBeNull();
		expect(router.current.path).toBe('/settings');
	});
});

describe('route snapshot (v1.15, D47)', () => {
	// Memory mode carries no URL, so `this.route` is the ONLY route source a
	// gating data() can read; it must reflect the navigation target on push and
	// on back()/forward() pops — with no location reads anywhere.
	it("push + back()/forward() gates each see this.route.path as the correct target (no location reads)", async () => {
		const snaps = [];
		const makeRec = (name) =>
			class extends PuzzleView {
				data() {
					snaps.push({ name, routePath: this.route?.path });
					return {};
				}
				render() {
					return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
				}
			};
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: makeRec('about'), layout: DefaultLayout },
			{ path: '/todos', name: 'todos', view: makeRec('todos'), layout: DefaultLayout },
		];
		const { router } = await bootMemory(routes);

		await router.push('/about');
		expect(snaps.at(-1)).toEqual({ name: 'about', routePath: '/about' });

		await router.push('/todos');
		expect(snaps.at(-1)).toEqual({ name: 'todos', routePath: '/todos' });

		await router.back(); // pop → /about
		expect(snaps.at(-1)).toEqual({ name: 'about', routePath: '/about' });
		expect(router.current.path).toBe('/about');

		await router.forward(); // pop → /todos
		expect(snaps.at(-1)).toEqual({ name: 'todos', routePath: '/todos' });
		expect(router.current.path).toBe('/todos');
	});
});

// D61: the memory stack/index (the memory-mode equivalent of the URL) now commits
// inside #swap's #committing window — after a sequential out settles — instead of
// early in #navigate. A navigation superseded during its out therefore leaves the
// stack untouched (no phantom entry), exactly like the history-mode pushState fix.
// Holding a nav in its out requires animations, so this block installs the fake
// WAAPI; a nav superseded during the DATA gate already never committed (both old
// and new), so animations are what make the D61 window observable.
describe('Router memory mode — superseded navigations never move the stack (D61)', () => {
	let waapi;
	const IN = { from: { opacity: 0 }, to: { opacity: 1 }, duration: 150 };
	const OUT = { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 };
	const animatedView = (name) =>
		class extends PuzzleView {
			animations = { in: IN, out: OUT };
			render() {
				return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
			}
		};
	async function settle(rounds = 4) {
		for (let i = 0; i < rounds; i++) {
			if (waapi) waapi.finishAll();
			await tick();
		}
	}

	beforeEach(() => {
		waapi = installFakeAnimate();
	});
	afterEach(() => {
		if (waapi) {
			waapi.uninstall();
			waapi = null;
		}
	});

	it('a push superseded during its out phase leaves the stack at [/, winner] — no phantom entry', async () => {
		const routes = [
			{ path: '/', name: 'home', view: animatedView('home'), layout: DefaultLayout },
			{ path: '/a', name: 'a', view: animatedView('a'), layout: DefaultLayout },
			{ path: '/b', name: 'b', view: animatedView('b'), layout: DefaultLayout },
		];
		const { router, el } = await bootMemory(routes);
		await settle();

		// Nav A: home animates out (parked). A's memory-stack push must NOT happen yet.
		const pA = router.push('/a');
		await tick();
		expect(router.current.path).toBe('/'); // A has not committed
		expect(el.querySelector('.a')).toBeNull();

		// Nav B supersedes A mid-out and wins.
		const pB = router.push('/b');
		await Promise.all([pA, pB]);
		await settle();
		expect(router.current.path).toBe('/b');
		expect(el.querySelector('.b')).not.toBeNull();

		// The stack must be [/, /b] — A's superseded push left NO phantom '/a' entry,
		// so back() lands on '/' directly (on the old early-commit path it would have
		// landed on the phantom '/a').
		const pBack = router.back();
		await settle();
		await pBack;
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();

		// forward() returns to '/b' — the only forward entry.
		const pFwd = router.forward();
		await settle();
		await pFwd;
		expect(router.current.path).toBe('/b');
		expect(el.querySelector('.b')).not.toBeNull();
	});

	it('a superseded memory go/pop leaves #index untouched (only the winner moves it)', async () => {
		const routes = [
			{ path: '/', name: 'home', view: animatedView('home'), layout: DefaultLayout },
			{ path: '/a', name: 'a', view: animatedView('a'), layout: DefaultLayout },
			{ path: '/b', name: 'b', view: animatedView('b'), layout: DefaultLayout },
			{ path: '/c', name: 'c', view: animatedView('c'), layout: DefaultLayout },
		];
		const { router } = await bootMemory(routes);
		// Build a stack [/, /a, /b] @2 (each push fully settles).
		const settlePush = async (path) => {
			const p = router.push(path);
			await settle();
			await p;
		};
		await settlePush('/a');
		await settlePush('/b');
		expect(router.current.path).toBe('/b');

		// back() to /a starts (out parks). Its #index move to 1 must NOT commit yet.
		const pBack = router.back();
		await tick();
		expect(router.current.path).toBe('/b'); // pop not committed while fading out

		// push('/c') supersedes the in-flight pop and wins. Because the pop never moved
		// #index off 2, the push truncates at 3 (keeping /b) and appends /c → [/, /a,
		// /b, /c] @3. (On the old early-commit path the pop's #index move to 1 would
		// have truncated /b away, giving [/, /a, /c].)
		const pC = router.push('/c');
		await Promise.all([pBack, pC]);
		await settle();
		expect(router.current.path).toBe('/c');

		// Walk back: /b survived the truncation → /c, /b, /a, /.
		for (const expected of ['/b', '/a', '/']) {
			const pb = router.back();
			await settle();
			await pb;
			expect(router.current.path).toBe(expected);
		}
	});
});

describe('PuzzleApp — memory mode pass-through (D42)', () => {
	let apps = [];
	afterEach(() => {
		apps.forEach((a) => a.unmount());
		apps = [];
	});

	it("routerMode: 'memory' + routerInitialPath routes without touching the URL", async () => {
		const el = container();
		const app = new PuzzleApp({
			target: el,
			routes: [
				{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
				{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
			],
			routerMode: 'memory',
			routerInitialPath: '/about',
		});
		apps.push(app);
		await app.mount();

		expect(el.querySelector('.about')).not.toBeNull();
		expect(app.router.current.path).toBe('/about');
		expect(location.pathname).toBe('/');
		expect(location.hash).toBe('');
	});
});

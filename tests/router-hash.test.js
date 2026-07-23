// @vitest-environment jsdom
//
// Hash-based routing (v1.6, D34): opt in with `{ mode: 'hash' }` to carry the
// route in `location.hash` (`/#/user/123`) instead of the pathname. The public
// API stays PATH-SHAPED (push('/user/123'), current.path === '/user/123') — only
// the read/write/interceptor seams change. Same jsdom conventions as
// router.test.js: hand-written render() stand-ins, routers tracked + stop()ped in
// afterEach, back/forward simulated by replaceState to the target URL + a
// PopStateEvent. To boot at a given fragment we replaceState the '#/...' URL
// before router.start() reads it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

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

class NotFound extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'nf' }, [text('404')]);
	}
}

// Track live routers so listeners never leak into the next test.
let routers = [];

// Boot in hash mode. `url` seeds location BEFORE start() reads it (the initial
// fragment); defaults to '/' (no fragment). Extra options merge over { mode }.
async function bootHash(routes, url = '/', options = {}) {
	history.replaceState({}, '', url);
	const el = container();
	const router = new Router(routes, { mode: 'hash', ...options });
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
});

describe('Router hash mode — construction & mode parity (D34)', () => {
	it('throws on an unknown mode', () => {
		expect(() => new Router([], { mode: 'bogus' })).toThrow(
			/unknown router mode: "bogus"/
		);
	});

	it("mode 'history' and an omitted mode both write a plain path URL (hash empty)", async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		];

		// omitted → default history mode
		const el1 = container();
		const rOmitted = new Router(routes);
		routers.push(rOmitted);
		await rOmitted.start(el1, ctx());
		await rOmitted.push('/about');
		expect(location.pathname).toBe('/about');
		expect(location.hash).toBe('');
		expect(el1.querySelector('.about')).not.toBeNull();

		history.replaceState({}, '', '/');

		// explicit history mode → identical
		const el2 = container();
		const rHistory = new Router(routes, { mode: 'history' });
		routers.push(rHistory);
		await rHistory.start(el2, ctx());
		await rHistory.push('/about');
		expect(location.pathname).toBe('/about');
		expect(location.hash).toBe('');
		expect(el2.querySelector('.about')).not.toBeNull();
	});
});

describe('Router hash mode — initial navigation (D34)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	];

	it("routes the fragment when booted at '/#/about'", async () => {
		const { router, el } = await bootHash(routes, '/#/about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(router.current.route.name).toBe('about');
		expect(router.current.path).toBe('/about');
	});

	it("routes '/' when booted with no fragment", async () => {
		const { router, el } = await bootHash(routes, '/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(router.current.route.name).toBe('home');
	});

	it("routes '/' when booted at a non-route fragment ('/#intro')", async () => {
		const { router, el } = await bootHash(routes, '/#intro');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(router.current.route.name).toBe('home');
	});
});

describe('Router hash mode — push (D34)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
		{ path: '/todos', name: 'todos', view: TodosView, layout: DefaultLayout },
	];

	it("push('/user/123') writes the hash, keeps the pathname, exposes a path-shaped current, delivers params", async () => {
		const { router, el } = await bootHash(routes, '/');

		await router.push('/user/123');

		expect(location.hash).toBe('#/user/123');
		expect(location.pathname).toBe('/'); // pathname untouched by hash routing
		expect(router.current.path).toBe('/user/123');
		expect(seenUserId).toBe('123');
		expect(el.textContent).toContain('user 123');
	});

	it('commit ordering (D19): mid-flight the hash is the old one; it moves only after data() resolves', async () => {
		class SlowView extends PuzzleView {
			async data() {
				await delay(15);
				return { msg: 'SLOW' };
			}
			render() {
				return h('puzzle-view', { class: 'slow' }, [text(this.getData().msg ?? '')]);
			}
		}
		const { router, el } = await bootHash(
			[
				{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
				{ path: '/slow', name: 'slow', view: SlowView, layout: DefaultLayout },
			],
			'/'
		);

		const p = router.push('/slow');
		// mid-flight: data() has not resolved, so nothing committed — hash stays put
		expect(location.hash).toBe('');
		expect(el.querySelector('.slow')).toBeNull();

		await p;
		expect(location.hash).toBe('#/slow');
		expect(el.querySelector('.slow')).not.toBeNull();
	});

	it('a rejecting data() leaves the hash and the view untouched', async () => {
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router, el } = await bootHash(
			[
				{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
				{ path: '/bad', name: 'bad', view: BadView, layout: DefaultLayout },
			],
			'/'
		);

		await router.push('/bad');

		expect(location.hash).toBe(''); // never moved
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.bad')).toBeNull();
		expect(router.current.route.name).toBe('home');
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it('keeps a query that lives inside the fragment (matches the route, drops query for matching)', async () => {
		const { router } = await bootHash(routes, '/');
		await router.push('/todos?filter=active');
		expect(router.current.route.name).toBe('todos');
		expect(router.current.path).toBe('/todos?filter=active');
		expect(location.hash).toBe('#/todos?filter=active');
	});

	it("catch-all '*' matches an unknown hash route", async () => {
		const { router, el } = await bootHash(
			[
				{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
				{ path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout },
			],
			'/'
		);
		await router.push('/nope/does/not/exist');
		expect(el.querySelector('.nf')).not.toBeNull();
		expect(router.current.route.name).toBe('not-found');
		expect(location.hash).toBe('#/nope/does/not/exist');
	});

	it('stamps the D33 scroll key into history.state on push', async () => {
		const { router } = await bootHash(routes, '/');
		await router.push('/todos');
		expect(history.state?.__puzzleScrollKey).toBeDefined();
	});
});

describe('Router hash mode — link interception (D34)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	];

	it("intercepts a '#/...' href but leaves a bare '#anchor' href alone", async () => {
		const { router, el } = await bootHash(routes, '/');
		const pushSpy = vi.spyOn(router, 'push');

		// bare in-page anchor — NOT intercepted (browser handles the fragment)
		const anchor = document.createElement('a');
		anchor.setAttribute('href', '#faq');
		document.body.appendChild(anchor);
		const anchorEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		anchor.dispatchEvent(anchorEvt);
		expect(anchorEvt.defaultPrevented).toBe(false);
		expect(pushSpy).not.toHaveBeenCalled();
		expect(el.querySelector('.home')).not.toBeNull(); // view untouched

		// '#/...' route link — intercepted
		const link = document.createElement('a');
		link.setAttribute('href', '#/about');
		document.body.appendChild(link);
		const linkEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(linkEvt);
		expect(linkEvt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/about');

		await tick();
		expect(router.current.route.name).toBe('about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(location.pathname).toBe('/'); // pathname never moved
	});
});

describe('Router hash mode — popstate (D34)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	];

	it('back re-renders the previous view without a pushState', async () => {
		const { router, el } = await bootHash(routes, '/');
		await router.push('/about');
		expect(el.querySelector('.about')).not.toBeNull();

		// simulate back to '/': move the URL (setup), then fire popstate
		history.replaceState({}, '', '/');
		const spy = vi.spyOn(history, 'pushState');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(spy).not.toHaveBeenCalled();
		expect(router.current.route.name).toBe('home');
		expect(el.querySelector('.home')).not.toBeNull();
		spy.mockRestore();
	});

	it('a popstate to a non-route fragment leaves the current view mounted and does not warn', async () => {
		const { router, el } = await bootHash(routes, '/#/about');
		expect(el.querySelector('.about')).not.toBeNull();

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		history.replaceState({}, '', '/#note');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		// #currentPath → null: the handler returns, view untouched
		expect(el.querySelector('.about')).not.toBeNull();
		expect(router.current.route.name).toBe('about');
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

describe('route snapshot (v1.15, D47)', () => {
	it("push('/about') → data() sees this.route.path === '/about'; the pathname never moves in hash mode", async () => {
		let router;
		const snaps = [];
		class AboutRec extends PuzzleView {
			data() {
				snaps.push({ routePath: this.route?.path, pathname: location.pathname });
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutRec, layout: DefaultLayout },
		];
		const booted = await bootHash(routes, '/');
		router = booted.router;

		await router.push('/about');

		expect(snaps).toHaveLength(1);
		expect(snaps[0].routePath).toBe('/about'); // path-shaped target, no '#'
		expect(snaps[0].pathname).toBe('/'); // pathname untouched in hash mode
		expect(router.current.path).toBe('/about');
		expect(location.hash).toBe('#/about');
	});
});

describe('PuzzleApp — routerMode pass-through (D34)', () => {
	let apps = [];
	afterEach(() => {
		apps.forEach((a) => a.unmount());
		apps = [];
	});

	it("routerMode: 'hash' routes from the fragment on mount()", async () => {
		history.replaceState({}, '', '/#/about');
		const el = container();
		const app = new PuzzleApp({
			target: el,
			routes: [
				{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
				{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
			],
			routerMode: 'hash',
		});
		apps.push(app);
		await app.mount();

		expect(el.querySelector('.about')).not.toBeNull();
		expect(app.router.current.route.name).toBe('about');
		expect(app.router.current.path).toBe('/about');
	});
});

// ---- v1.49, D83: replace() writes the '#'-encoded URL in place --------------
describe('router.replace() — hash mode (v1.49, D83)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		{ path: '/todos', name: 'todos', view: TodosView, layout: DefaultLayout },
	];

	it("rewrites location.hash via replaceState (never pushState), history.length constant", async () => {
		const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		const { router, el } = await bootHash(routes);
		await router.push('/about');
		expect(location.hash).toBe('#/about');
		const len = history.length;

		const pushSpy = vi.spyOn(history, 'pushState');
		await router.replace('/todos?f=1');

		expect(location.hash).toBe('#/todos?f=1'); // same '#' + path encoding as push
		expect(history.length).toBe(len);
		expect(pushSpy).not.toHaveBeenCalled();
		expect(el.querySelector('.todos')).not.toBeNull();
		// The snapshot stays path-shaped and '#'-free; the in-fragment query parses.
		expect(router.current.path).toBe('/todos?f=1');
		expect(router.current.pathname).toBe('/todos');
		expect(router.current.query.f).toBe('1');
		pushSpy.mockRestore();
		scrollSpy.mockRestore();
	});
});

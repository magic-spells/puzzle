// @vitest-environment jsdom
//
// Router base path (v1.19, D51): `{ base: '/myapp' }` serves the app under a
// sub-path. The base is applied at the path-shape boundary, mode-agnostically —
// reads strip it after the mode-specific raw read (#currentPath), writes prefix
// it before the mode-specific encoding (the pushState site), and the click
// interceptor takes only URLs under it. The app-facing surface stays base-free:
// push('/user/1'), current.path === '/user/1', params, and this.route never see
// the base — only the URL (and <a href>) carries it. Same jsdom conventions as
// router-hash.test.js: hand-written render() stand-ins, routers tracked +
// stop()ped in afterEach, back/forward simulated by replaceState to the target
// URL + a PopStateEvent. To boot at a given URL we replaceState it before
// router.start() reads it. See constellation/doc/DOC-SPEC.md §23.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

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

class DocsView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'docs' }, [text('DOCS')]);
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

const baseRoutes = [
	{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
	{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	{ path: '/docs', name: 'docs', view: DocsView, layout: DefaultLayout },
	{ path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
	{ path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout },
];

// Track live routers so listeners never leak into the next test.
let routers = [];

// Boot with a base. `url` seeds location BEFORE start() reads it (the deep link);
// `options` merge over { base } (e.g. { mode: 'hash' }).
async function bootBase(routes, url, base = '/myapp', options = {}) {
	history.replaceState({}, '', url);
	const el = container();
	const router = new Router(routes, { base, ...options });
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

describe('Router base — normalization (D51)', () => {
	it("normalizes 'myapp', '/myapp', and '/myapp/' identically (write proves the stored base)", async () => {
		// Each variant writes the SAME '/myapp/about' URL on push → same normalized base.
		for (const base of ['myapp', '/myapp', '/myapp/']) {
			history.replaceState({}, '', '/myapp');
			const el = container();
			const router = new Router(baseRoutes, { base });
			routers.push(router);
			await router.start(el, ctx());
			await router.push('/about');
			expect(location.pathname).toBe('/myapp/about');
			expect(router.current.path).toBe('/about'); // base-free
		}
	});

	it("treats '' and '/' as no base (byte-identical to the base-less router)", async () => {
		for (const base of ['', '/']) {
			history.replaceState({}, '', '/');
			const el = container();
			const router = new Router(baseRoutes, { base });
			routers.push(router);
			await router.start(el, ctx());
			await router.push('/about');
			expect(location.pathname).toBe('/about'); // no base prefix
			expect(router.current.path).toBe('/about');
		}
	});

	it("throws on a base containing '#' or '?'", () => {
		expect(() => new Router([], { base: '/my#app' })).toThrow(/must not contain "#" or "\?"/);
		expect(() => new Router([], { base: '/my?app' })).toThrow(/must not contain "#" or "\?"/);
	});

	it('supports a multi-segment base', async () => {
		const { router } = await bootBase(baseRoutes, '/a/b', '/a/b');
		expect(router.current.path).toBe('/'); // /a/b === base → '/'
		await router.push('/about');
		expect(location.pathname).toBe('/a/b/about');
		expect(router.current.path).toBe('/about');
	});
});

describe('Router base — history mode (D51)', () => {
	it('initial nav at /myapp/user/1 matches /user/:id with a base-free current', async () => {
		const { router, el } = await bootBase(baseRoutes, '/myapp/user/1');
		expect(el.querySelector('.user')).not.toBeNull();
		expect(router.current.route.name).toBe('user');
		expect(router.current.path).toBe('/user/1'); // base-free
		expect(router.current.params.id).toBe('1');
		expect(seenUserId).toBe('1');
		expect(location.pathname).toBe('/myapp/user/1'); // untouched (initial, no push)
	});

	it('initial nav at the bare base /myapp routes to /', async () => {
		const { router, el } = await bootBase(baseRoutes, '/myapp');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(router.current.path).toBe('/');
	});

	it("push('/user/2') writes /myapp/user/2 and keeps current base-free", async () => {
		const { router } = await bootBase(baseRoutes, '/myapp');
		await router.push('/user/2');
		expect(location.pathname).toBe('/myapp/user/2');
		expect(router.current.path).toBe('/user/2');
		expect(seenUserId).toBe('2');
	});

	it('back/forward re-read the base-carrying URL correctly', async () => {
		const { router, el } = await bootBase(baseRoutes, '/myapp');
		await router.push('/about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(location.pathname).toBe('/myapp/about');

		// simulate back to /myapp: move the URL, fire popstate
		history.replaceState({}, '', '/myapp');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();

		// simulate forward to /myapp/about
		history.replaceState({}, '', '/myapp/about');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
	});

	it('loaded outside the base warns ONCE and passes the pathname through un-stripped', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// booted at /elsewhere/deep — outside /myapp → passes through, hits catch-all
		const { router, el } = await bootBase(baseRoutes, '/elsewhere/deep');
		expect(router.current.route.name).toBe('not-found');
		expect(el.querySelector('.nf')).not.toBeNull();
		expect(warnSpy).toHaveBeenCalledTimes(1);

		// a second outside-base read (popstate) must NOT warn again (per-instance guard)
		history.replaceState({}, '', '/other/place');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});

	it('interceptor intercepts an under-base link (pushes stripped) and lets an outside-base link through', async () => {
		const { router } = await bootBase(baseRoutes, '/myapp');
		const pushSpy = vi.spyOn(router, 'push');
		// swallow jsdom's unimplemented navigation for links we leave alone
		const suppress = (e) => e.preventDefault();
		document.addEventListener('click', suppress);

		// under-base link → intercepted, pushed base-stripped
		const inApp = document.createElement('a');
		inApp.setAttribute('href', '/myapp/about');
		document.body.appendChild(inApp);
		const inEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		inApp.dispatchEvent(inEvt);
		expect(inEvt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/about');
		await tick();
		expect(location.pathname).toBe('/myapp/about');

		// outside-base same-origin link → falls through to the browser (not intercepted)
		pushSpy.mockClear();
		const outside = document.createElement('a');
		outside.setAttribute('href', '/other/page');
		document.body.appendChild(outside);
		const outEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		outside.dispatchEvent(outEvt);
		expect(pushSpy).not.toHaveBeenCalled();

		document.removeEventListener('click', suppress);
	});

	it('preserves url.hash (D41 anchor) through the base strip on an intercepted link', async () => {
		const { router } = await bootBase(baseRoutes, '/myapp');
		const pushSpy = vi.spyOn(router, 'push');
		const suppress = (e) => e.preventDefault();
		document.addEventListener('click', suppress);

		const link = document.createElement('a');
		link.setAttribute('href', '/myapp/docs#faq');
		document.body.appendChild(link);
		const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(evt);
		expect(evt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/docs#faq'); // base stripped, anchor kept

		await tick();
		expect(location.pathname).toBe('/myapp/docs');
		expect(location.hash).toBe('#faq'); // base rides ahead of the anchor
		expect(router.current.path).toBe('/docs#faq');

		document.removeEventListener('click', suppress);
	});
});

describe('Router base — hash mode (D51)', () => {
	it('initial nav at #/myapp/user/1 matches with a base-free current', async () => {
		const { router, el } = await bootBase(baseRoutes, '/#/myapp/user/1', '/myapp', {
			mode: 'hash',
		});
		expect(el.querySelector('.user')).not.toBeNull();
		expect(router.current.path).toBe('/user/1');
		expect(seenUserId).toBe('1');
		expect(location.pathname).toBe('/'); // pathname untouched in hash mode
	});

	it("push writes '#/myapp/...' and keeps current base-free", async () => {
		const { router } = await bootBase(baseRoutes, '/', '/myapp', { mode: 'hash' });
		await router.push('/about');
		expect(location.hash).toBe('#/myapp/about');
		expect(location.pathname).toBe('/');
		expect(router.current.path).toBe('/about');
	});

	it("composes the D41 anchor in-fragment ('#/myapp/docs#faq' → path '/docs#faq')", async () => {
		const { router, el } = await bootBase(baseRoutes, '/', '/myapp', { mode: 'hash' });
		await router.push('/docs#faq');
		expect(location.hash).toBe('#/myapp/docs#faq');
		expect(router.current.path).toBe('/docs#faq');
		expect(el.querySelector('.docs')).not.toBeNull();
	});

	it("treats a non-base '#/other' fragment as a non-route (routes '/')", async () => {
		const { router, el } = await bootBase(baseRoutes, '/#/other', '/myapp', { mode: 'hash' });
		// #currentPath → null for an out-of-base fragment → start falls back to '/'
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it("intercepts a '#/myapp/...' link but leaves a bare '#anchor' and a non-base '#/other' alone", async () => {
		const { router, el } = await bootBase(baseRoutes, '/', '/myapp', { mode: 'hash' });
		const pushSpy = vi.spyOn(router, 'push');

		// bare in-page anchor — not intercepted
		const bare = document.createElement('a');
		bare.setAttribute('href', '#faq');
		document.body.appendChild(bare);
		const bareEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		bare.dispatchEvent(bareEvt);
		expect(bareEvt.defaultPrevented).toBe(false);
		expect(pushSpy).not.toHaveBeenCalled();

		// non-base route fragment — not intercepted (falls through to the browser)
		const other = document.createElement('a');
		other.setAttribute('href', '#/other');
		document.body.appendChild(other);
		const otherEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		other.dispatchEvent(otherEvt);
		expect(otherEvt.defaultPrevented).toBe(false);
		expect(pushSpy).not.toHaveBeenCalled();

		// under-base fragment — intercepted, pushed base-stripped
		const inApp = document.createElement('a');
		inApp.setAttribute('href', '#/myapp/about');
		document.body.appendChild(inApp);
		const inEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		inApp.dispatchEvent(inEvt);
		expect(inEvt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/about');
		await tick();
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
	});

	it("intercepts the EXACT-base '#/myapp' link and routes to '/' (symmetric with #currentPath)", async () => {
		const { router, el } = await bootBase(baseRoutes, '/#/myapp/about', '/myapp', {
			mode: 'hash',
		});
		expect(el.querySelector('.about')).not.toBeNull();
		const pushSpy = vi.spyOn(router, 'push');

		// raw-fragment branch: exact base '#/myapp' (nothing after) → intercepted, '/'
		const root = document.createElement('a');
		root.setAttribute('href', '#/myapp');
		document.body.appendChild(root);
		const rootEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		root.dispatchEvent(rootEvt);
		expect(rootEvt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/');
		await tick();
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();

		// under-base fragment still routes normally
		pushSpy.mockClear();
		const about = document.createElement('a');
		about.setAttribute('href', '#/myapp/about');
		document.body.appendChild(about);
		const aboutEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		about.dispatchEvent(aboutEvt);
		expect(aboutEvt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/about');
		await tick();
		expect(router.current.path).toBe('/about');

		// URL-form branch (href not starting with '#'): a same-pathname '/#/myapp'
		// carries the exact-base fragment too → intercepted, '/'
		pushSpy.mockClear();
		const urlForm = document.createElement('a');
		urlForm.setAttribute('href', '/#/myapp');
		document.body.appendChild(urlForm);
		const urlEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		urlForm.dispatchEvent(urlEvt);
		expect(urlEvt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/');
		await tick();
		expect(router.current.path).toBe('/');

		// an outside-base fragment still falls through to the browser
		pushSpy.mockClear();
		const other = document.createElement('a');
		other.setAttribute('href', '#/other');
		document.body.appendChild(other);
		const otherEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		other.dispatchEvent(otherEvt);
		expect(otherEvt.defaultPrevented).toBe(false);
		expect(pushSpy).not.toHaveBeenCalled();
	});
});

describe('Router base — memory mode (D51: base inert)', () => {
	it('accepts a base without throwing and navigates normally', async () => {
		const el = container();
		const router = new Router(baseRoutes, { mode: 'memory', base: '/myapp' });
		routers.push(router);
		await router.start(el, ctx());
		expect(router.current.path).toBe('/'); // initialPath default, base inert
		expect(el.querySelector('.home')).not.toBeNull();

		await router.push('/user/2');
		expect(router.current.path).toBe('/user/2'); // path-shaped, no base
		expect(seenUserId).toBe('2');

		await router.back();
		expect(router.current.path).toBe('/');
	});
});

describe('Router base — no-base regression (D51)', () => {
	it('a base-less router writes plain URLs (history) identical to today', async () => {
		const el = container();
		const router = new Router(baseRoutes);
		routers.push(router);
		await router.start(el, ctx());
		await router.push('/about');
		expect(location.pathname).toBe('/about');
		expect(location.hash).toBe('');
		expect(router.current.path).toBe('/about');
	});

	it('a base-less hash router writes plain fragments identical to today', async () => {
		history.replaceState({}, '', '/');
		const el = container();
		const router = new Router(baseRoutes, { mode: 'hash' });
		routers.push(router);
		await router.start(el, ctx());
		await router.push('/about');
		expect(location.hash).toBe('#/about');
		expect(router.current.path).toBe('/about');
	});
});

describe('PuzzleApp — routerBase pass-through (D51)', () => {
	let apps = [];
	afterEach(() => {
		apps.forEach((a) => a.unmount());
		apps = [];
	});

	it("routerBase serves the app under a sub-path on mount()", async () => {
		history.replaceState({}, '', '/myapp/about');
		const el = container();
		const app = new PuzzleApp({
			target: el,
			routes: baseRoutes,
			routerBase: '/myapp',
		});
		apps.push(app);
		await app.mount();
		expect(el.querySelector('.about')).not.toBeNull();
		expect(app.router.current.path).toBe('/about');
		expect(location.pathname).toBe('/myapp/about');
	});
});

// ---- v1.49, D83: replace() + parsed query compose with a base (D51) ---------
describe('router.replace() + query snapshot under a base (v1.49, D83)', () => {
	it('replace writes base + path (no new entry); the snapshot stays base-free, query parsed', async () => {
		const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		const { router } = await bootBase(baseRoutes, '/myapp');
		await router.push('/about');
		const len = history.length;

		await router.replace('/docs?x=1');
		expect(history.length).toBe(len); // replaced in place
		expect(location.pathname).toBe('/myapp/docs'); // URL carries the base (write seam)
		expect(location.search).toBe('?x=1');
		// The app-facing snapshot never sees the base (D51) — pathname included.
		expect(router.current.path).toBe('/docs?x=1');
		expect(router.current.pathname).toBe('/docs');
		expect(router.current.query.x).toBe('1');
		expect(router.current.hash).toBe('');
		scrollSpy.mockRestore();
	});

	it('a base-URL deep link with query lands base-stripped in pathname/query', async () => {
		const { router } = await bootBase(baseRoutes, '/myapp/docs?page=3');
		expect(router.current.route.name).toBe('docs');
		expect(router.current.path).toBe('/docs?page=3');
		expect(router.current.pathname).toBe('/docs');
		expect(router.current.query.page).toBe('3');
	});
});

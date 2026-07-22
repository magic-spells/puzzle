// @vitest-environment jsdom
//
// Router scroll behavior (v1.5, D33): the router owns window scroll across
// navigations — top on push, saved-position restore on back/forward, nothing on
// the initial navigation. `scrollBehavior: false` opts out entirely; a function
// customizes the landing per navigation. jsdom neither scrolls nor implements
// window.scrollTo, so these tests stub scrollTo to mutate scrollX/scrollY the
// way a real browser would, and simulate back/forward the same way
// router.test.js does: replaceState to the target entry, then PopStateEvent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};
const ctx = () => ({ store: null, router: null, formatters: null });

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
class UserView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'user' }, [text('USER')]);
	}
}
// A view that renders an element with id="faq" so anchor targets (D41) resolve
// against a real node in the committed DOM.
class DocsView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'docs' }, [h('div', { id: 'faq' }, [text('FAQ')])]);
	}
}

const ROUTES = [
	{ path: '/', name: 'home', view: HomeView },
	{ path: '/about', name: 'about', view: AboutView },
	{ path: '/user/:id', name: 'user', view: UserView },
	{ path: '/docs', name: 'docs', view: DocsView },
];

// Make window scroll state writable and wire a browser-faithful scrollTo stub.
function setScroll(x, y) {
	Object.defineProperty(window, 'scrollX', { configurable: true, writable: true, value: x });
	Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: y });
}
let scrollToSpy;

let routers = [];
async function boot(routes, options) {
	const el = container();
	const router = new Router(routes, options);
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	setScroll(0, 0);
	try {
		sessionStorage.clear();
	} catch {
		/* jsdom always provides it; guard anyway */
	}
	scrollToSpy = vi.fn((x, y) => setScroll(x, y));
	Object.defineProperty(window, 'scrollTo', {
		configurable: true,
		writable: true,
		value: scrollToSpy,
	});
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
});

describe('Router scroll — defaults (D33)', () => {
	it('does not touch scroll on the initial navigation', async () => {
		await boot(ROUTES);
		expect(scrollToSpy).not.toHaveBeenCalled();
	});

	it('scrolls to the top on push()', async () => {
		const { router } = await boot(ROUTES);
		setScroll(0, 900);
		await router.push('/about');
		expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
		expect(window.scrollY).toBe(0);
	});

	it('scrolls to the top on a params-only navigation (same chain, new params)', async () => {
		const { router } = await boot(ROUTES);
		await router.push('/user/1');
		setScroll(0, 640);
		await router.push('/user/2');
		expect(window.scrollY).toBe(0);
	});

	it('restores the saved position on back (popstate)', async () => {
		const { router } = await boot(ROUTES);
		const homeState = history.state; // carries the initial entry's key

		setScroll(0, 750);
		await router.push('/about'); // saves 750 under the home entry, lands at top
		expect(window.scrollY).toBe(0);

		// simulate back: the browser moves URL + state, then fires popstate
		history.replaceState(homeState, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(router.current.route.name).toBe('home');
		expect(scrollToSpy).toHaveBeenLastCalledWith(0, 750);
		expect(window.scrollY).toBe(750);
	});

	it('restores across forward too (position saved when backing away)', async () => {
		const { router } = await boot(ROUTES);
		const homeState = history.state;

		await router.push('/about');
		const aboutState = history.state;
		setScroll(0, 420); // reading /about, scrolled

		// back to home — /about's 420 is saved as we leave it
		history.replaceState(homeState, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		// forward to /about — 420 comes back
		history.replaceState(aboutState, '', '/about');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(router.current.route.name).toBe('about');
		expect(window.scrollY).toBe(420);
	});

	it('falls back to the top on back when no position was saved for the entry', async () => {
		const { router } = await boot(ROUTES);
		await router.push('/about');
		setScroll(0, 300);

		// a foreign entry the router never saw (no saved position, no key)
		history.replaceState({}, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(router.current.route.name).toBe('home');
		expect(window.scrollY).toBe(0);
	});

	it('a failed navigation moves neither URL nor scroll', async () => {
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', {}, []);
			}
		}
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router } = await boot([...ROUTES, { path: '/bad', name: 'bad', view: BadView }]);
		setScroll(0, 500);
		await router.push('/bad');
		expect(location.pathname).toBe('/');
		expect(window.scrollY).toBe(500);
		expect(scrollToSpy).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it('switches the browser to manual scroll restoration between start() and stop()', async () => {
		// jsdom has no scrollRestoration — install one so the guard path runs.
		Object.defineProperty(history, 'scrollRestoration', {
			configurable: true,
			writable: true,
			value: 'auto',
		});
		const { router } = await boot(ROUTES);
		expect(history.scrollRestoration).toBe('manual');
		router.stop();
		expect(history.scrollRestoration).toBe('auto');
		delete history.scrollRestoration;
	});
});

describe('Router scroll — configuration (D33)', () => {
	it('scrollBehavior: false leaves scroll and history.state alone', async () => {
		const { router } = await boot(ROUTES, { scrollBehavior: false });
		setScroll(0, 800);
		await router.push('/about');
		expect(scrollToSpy).not.toHaveBeenCalled();
		expect(window.scrollY).toBe(800);
		expect(history.state?.__puzzleScrollKey).toBeUndefined();
	});

	it('a custom function receives (to, from, savedPosition) and its return is applied', async () => {
		const fn = vi.fn(() => ({ x: 0, y: 123 }));
		const { router } = await boot(ROUTES, { scrollBehavior: fn });
		await router.push('/about');

		expect(fn).toHaveBeenCalledTimes(1);
		const [to, from, saved] = fn.mock.calls[0];
		expect(to.path).toBe('/about');
		expect(to.route.name).toBe('about');
		expect(from.route.name).toBe('home');
		expect(saved).toBeNull(); // push, not pop
		expect(window.scrollY).toBe(123);
	});

	it('a custom function returning false leaves scroll alone', async () => {
		const { router } = await boot(ROUTES, { scrollBehavior: () => false });
		setScroll(0, 200);
		await router.push('/about');
		expect(scrollToSpy).not.toHaveBeenCalled();
		expect(window.scrollY).toBe(200);
	});

	it('a custom function gets savedPosition on pop and can pass it through', async () => {
		const fn = vi.fn((to, from, saved) => saved || { x: 0, y: 0 });
		const { router } = await boot(ROUTES, { scrollBehavior: fn });
		const homeState = history.state;

		setScroll(0, 555);
		await router.push('/about');

		history.replaceState(homeState, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(router.current.route.name).toBe('home');
		const lastCall = fn.mock.calls[fn.mock.calls.length - 1];
		expect(lastCall[2]).toEqual({ x: 0, y: 555 });
		expect(window.scrollY).toBe(555);
	});

	it('a throwing custom function is logged and leaves scroll alone', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router } = await boot(ROUTES, {
			scrollBehavior: () => {
				throw new Error('bad behavior');
			},
		});
		setScroll(0, 340);
		await router.push('/about');
		expect(location.pathname).toBe('/about'); // navigation itself unaffected
		expect(window.scrollY).toBe(340);
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});
});

describe('Router scroll — anchor targets (v1.10, D41)', () => {
	// jsdom's getBoundingClientRect returns zeros; stub the prototype so an
	// anchored element reports a fixed viewport rect the router can land on.
	function stubRect(top, left = 0) {
		return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			top,
			left,
			right: left,
			bottom: top,
			width: 0,
			height: 0,
			x: left,
			y: top,
			toJSON() {},
		});
	}

	it('the history-mode interceptor preserves a #fragment in the pushed path', async () => {
		const { router } = await boot(ROUTES);
		const pushSpy = vi.spyOn(router, 'push');

		const link = document.createElement('a');
		link.setAttribute('href', '/about#faq');
		document.body.appendChild(link);
		const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(evt);

		expect(evt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/about#faq');
		await tick();
	});

	it('a bare #anchor href still falls through to the browser (history mode)', async () => {
		const { router } = await boot(ROUTES);
		const pushSpy = vi.spyOn(router, 'push');

		const link = document.createElement('a');
		link.setAttribute('href', '#faq');
		document.body.appendChild(link);
		const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(evt);

		expect(evt.defaultPrevented).toBe(false);
		expect(pushSpy).not.toHaveBeenCalled();
	});

	it('a push to /path#id lands at the element position (rect + current scroll)', async () => {
		const rectSpy = stubRect(500);
		const { router } = await boot(ROUTES);
		await router.push('/docs#faq');

		// rect.top (500) + window.scrollY (0) → y 500; rect.left (0) → x 0
		expect(scrollToSpy).toHaveBeenLastCalledWith(0, 500);
		expect(window.scrollY).toBe(500);
		expect(router.current.route.name).toBe('docs');
		rectSpy.mockRestore();
	});

	it('adds the current scroll offset to the rect (rect is viewport-relative)', async () => {
		const rectSpy = stubRect(120);
		const { router } = await boot(ROUTES);
		setScroll(0, 400); // window already scrolled when the anchor resolves
		await router.push('/docs#faq');
		// 120 (rect top) + 400 (current scrollY) = 520
		expect(scrollToSpy).toHaveBeenLastCalledWith(0, 520);
		rectSpy.mockRestore();
	});

	it('falls back to the top when the anchor element is absent from the committed DOM', async () => {
		const rectSpy = stubRect(500);
		const { router } = await boot(ROUTES);
		setScroll(0, 300);
		await router.push('/about#ghost'); // AboutView has no #ghost
		expect(scrollToSpy).toHaveBeenLastCalledWith(0, 0);
		expect(window.scrollY).toBe(0);
		rectSpy.mockRestore();
	});

	it('a saved position wins over an anchor on pop', async () => {
		const rectSpy = stubRect(500); // #faq would land at 500 if the anchor applied
		const { router } = await boot(ROUTES);
		const homeState = history.state;

		await router.push('/docs'); // now on /docs, which has a #faq element
		const docsState = history.state;
		setScroll(0, 275); // reading /docs, scrolled down

		// back to home — /docs's 275 is saved under its key as we leave it
		history.replaceState(homeState, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		// forward-pop to /docs#faq: the history-mode pop path drops the fragment
		// (#currentPath is pathname+search), and even if it carried one, a saved
		// position beats the anchor — 275 restored, NOT the element's 500.
		history.replaceState(docsState, '', '/docs#faq');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(router.current.route.name).toBe('docs');
		expect(window.scrollY).toBe(275);
		rectSpy.mockRestore();
	});

	it('a custom scrollBehavior still wins; to.path carries the anchor verbatim', async () => {
		const rectSpy = stubRect(500);
		const fn = vi.fn(() => ({ x: 0, y: 42 }));
		const { router } = await boot(ROUTES, { scrollBehavior: fn });
		await router.push('/docs#faq');

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn.mock.calls[0][0].path).toBe('/docs#faq'); // to.path
		expect(window.scrollY).toBe(42); // custom return, not the element's 500
		rectSpy.mockRestore();
	});
});

describe('Router scroll — sessionStorage persistence (v1.10, D41)', () => {
	it('mirrors saved positions to sessionStorage on save', async () => {
		const { router } = await boot(ROUTES);
		const homeKey = history.state.__puzzleScrollKey;
		setScroll(0, 750);
		await router.push('/about'); // saves home@750

		const stored = JSON.parse(sessionStorage.getItem('__puzzleScroll'));
		expect(stored[homeKey]).toEqual({ x: 0, y: 750 });
	});

	it('hydrates positions from sessionStorage on start (survives a reload)', async () => {
		const { router } = await boot(ROUTES);
		const homeState = history.state;
		setScroll(0, 750);
		await router.push('/about'); // persists home@750; URL is now /about

		// simulate a full reload: stop the router, spin up a fresh instance that
		// hydrates from the SAME sessionStorage. history.state (and its key) rode
		// the reload, so #currentPath boots at /about again.
		router.stop();
		const { router: r2 } = await boot(ROUTES);

		// back to home — the pre-reload 750 restores from the hydrated map
		setScroll(0, 0);
		history.replaceState(homeState, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(r2.current.route.name).toBe('home');
		expect(window.scrollY).toBe(750);
	});

	it('caps the persisted map at 50 entries, evicting the oldest', async () => {
		const { router } = await boot(ROUTES);
		for (let i = 1; i <= 60; i++) {
			setScroll(0, i);
			await router.push('/user/' + i); // each push saves the outgoing entry
		}
		const stored = JSON.parse(sessionStorage.getItem('__puzzleScroll'));
		expect(Object.keys(stored).length).toBe(50);
	});

	it('degrades silently when sessionStorage.setItem throws (in-memory still works)', async () => {
		const setItemSpy = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new Error('quota exceeded');
			});
		const { router } = await boot(ROUTES);
		const homeState = history.state;
		setScroll(0, 750);
		await router.push('/about'); // persist throws internally, swallowed

		// the in-memory map is untouched by the storage failure — back still restores
		setScroll(0, 0);
		history.replaceState(homeState, '', '/');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(router.current.route.name).toBe('home');
		expect(window.scrollY).toBe(750);
		setItemSpy.mockRestore();
	});

	it('scrollBehavior: false touches no sessionStorage', async () => {
		const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
		const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
		const { router } = await boot(ROUTES, { scrollBehavior: false });
		setScroll(0, 800);
		await router.push('/about');

		expect(setItemSpy).not.toHaveBeenCalledWith('__puzzleScroll', expect.anything());
		expect(getItemSpy).not.toHaveBeenCalledWith('__puzzleScroll');
		setItemSpy.mockRestore();
		getItemSpy.mockRestore();
	});
});

describe('Router scroll — hash mode anchors (v1.10, D41)', () => {
	function stubRect(top, left = 0) {
		return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
			top,
			left,
			right: left,
			bottom: top,
			width: 0,
			height: 0,
			x: left,
			y: top,
			toJSON() {},
		});
	}

	it('push writes the double-hash URL and scrolls to the in-fragment anchor', async () => {
		const rectSpy = stubRect(500);
		const { router } = await boot(ROUTES, { mode: 'hash' });
		await router.push('/docs#faq');

		expect(location.hash).toBe('#/docs#faq');
		expect(router.current.path).toBe('/docs#faq');
		expect(router.current.route.name).toBe('docs');
		expect(scrollToSpy).toHaveBeenLastCalledWith(0, 500);
		rectSpy.mockRestore();
	});

	it("a '#/...#anchor' link is intercepted; a bare '#faq' href falls through", async () => {
		const rectSpy = stubRect(500);
		const { router } = await boot(ROUTES, { mode: 'hash' });
		const pushSpy = vi.spyOn(router, 'push');

		// bare in-page anchor — native, not intercepted
		const bare = document.createElement('a');
		bare.setAttribute('href', '#faq');
		document.body.appendChild(bare);
		const bareEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		bare.dispatchEvent(bareEvt);
		expect(bareEvt.defaultPrevented).toBe(false);
		expect(pushSpy).not.toHaveBeenCalled();

		// '#/docs#faq' route link — intercepted, anchor rides in
		const link = document.createElement('a');
		link.setAttribute('href', '#/docs#faq');
		document.body.appendChild(link);
		const linkEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(linkEvt);
		expect(linkEvt.defaultPrevented).toBe(true);
		expect(pushSpy).toHaveBeenCalledWith('/docs#faq');
		await tick();
		expect(router.current.route.name).toBe('docs');
		rectSpy.mockRestore();
	});
});

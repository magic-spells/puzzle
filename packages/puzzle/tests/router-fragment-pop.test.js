// @vitest-environment jsdom
//
// Same-document fragment pops (D41 — "native in-page anchors are not the
// router's business"). Every engine — Chromium, Firefox and WebKit alike —
// routes an in-page fragment move through POPSTATE (verified in a real browser
// by tests-browser/anchor-fragment.spec.js; popstate fires, then hashchange).
// Two things arrive that way:
//
//   • a bare `<a href="#faq">` click, which #handleClick deliberately hands to
//     the browser: the browser pushes a NEW history entry whose `history.state`
//     is null, then fires popstate. That is exactly what the "fresh fragment
//     navigation" tests below emulate — pushState(null, …) + PopStateEvent, the
//     same "replaceState/pushState the entry, then dispatch popstate" idiom
//     router.test.js and router-scroll.test.js use for back/forward.
//   • ordinary back/forward traversal across a `/docs` ⇄ `/docs#faq` pair.
//
// Hash routing has honored D41 on pop since D34 (a non-route fragment makes
// #currentPath return null and the handler returns before touching anything).
// Path routing is the DEFAULT and had no equivalent guard, so an anchor jump
// re-ran the whole navigation pipeline for a URL whose route, params and query
// never moved. These tests pin the guard: no load, no refresh, no focus move,
// no route announcement, and no scroll of the router's own — while
// `current.path` / `current.hash` still track the address bar so push()'s
// same-path no-op keeps telling the truth.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { hashRouter } from '../client-runtime/router/modes.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};
const ctx = () => ({ store: null, router: null, formatters: null });

const liveRegion = () => document.querySelector('[data-puzzle-live-region]');

// data() run counters, reset per test.
let runs;

class HomeView extends PuzzleView {
	data() {
		runs.home++;
		return {};
	}
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}
class AboutView extends PuzzleView {
	data() {
		runs.about++;
		return {};
	}
	render() {
		return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
	}
}
// The parent SHELL of the nested /docs chain — the ancestor whose data() must
// NOT re-run on a fragment pop.
class DocsShell extends PuzzleView {
	data() {
		runs.shell++;
		return {};
	}
	render() {
		return h('puzzle-view', { class: 'docs-shell' }, [h('section', {}, [slot()])]);
	}
}
// The leaf, carrying an id="faq" so an anchor target exists in the committed DOM.
class DocsIndex extends PuzzleView {
	data() {
		runs.docs++;
		return {};
	}
	render() {
		return h('puzzle-view', { class: 'docs' }, [
			h('div', { id: 'faq' }, [text('FAQ')]),
			h('div', { id: 'api' }, [text('API')]),
		]);
	}
}

const ROUTES = [
	{ path: '/', name: 'home', view: HomeView, meta: { title: 'Home Page' } },
	{ path: '/about', name: 'about', view: AboutView, meta: { title: 'About Page' } },
	{
		path: '/docs',
		name: 'docs-shell',
		view: DocsShell,
		meta: { title: 'Docs Page' },
		children: [{ path: '', name: 'docs', view: DocsIndex }],
	},
];

function setScroll(x, y) {
	Object.defineProperty(window, 'scrollX', { configurable: true, writable: true, value: x });
	Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: y });
}

let scrollToSpy;
let focusSpy;
let routers = [];

async function boot(routes = ROUTES, options, startPath = '/') {
	history.replaceState({}, '', startPath);
	const el = container();
	const router = new Router(routes, options);
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

/**
 * Emulate what a browser does for a bare-anchor click it handled itself: a NEW
 * history entry carrying NO state, then popstate. (Verified against Chromium,
 * Firefox and WebKit — see the header note.)
 */
function browserFragmentNav(url) {
	history.pushState(null, '', url);
	window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Emulate a back/forward traversal ONTO an entry the router already stamped. */
function traverseTo(state, url) {
	history.replaceState(state, '', url);
	window.dispatchEvent(new PopStateEvent('popstate'));
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
	document.title = '';
	runs = { home: 0, about: 0, shell: 0, docs: 0 };
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
	focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

// ---- fresh fragment navigation (the bare-anchor click) ----------------------

describe('Router fragment pop — a browser-handled anchor click (D41)', () => {
	it('does not re-run any data() in the committed chain', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs');
		expect(router.current.route.name).toBe('docs');
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });

		browserFragmentNav('/docs#faq');
		await tick();

		// Neither the leaf nor the ancestor shell reloads: the route did not move.
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });
	});

	it('leaves the mounted views in place (no remount, no re-render churn)', async () => {
		const { router, el } = await boot(ROUTES, undefined, '/docs');
		const faqBefore = el.querySelector('#faq');

		browserFragmentNav('/docs#faq');
		await tick();

		// Same DOM nodes, still mounted — nothing was torn down and rebuilt.
		expect(el.querySelector('#faq')).toBe(faqBefore);
		expect(el.querySelector('.docs-shell')).toBeTruthy();
	});

	it('leaves scroll entirely to the browser (no scrollTo of our own)', async () => {
		await boot(ROUTES, undefined, '/docs');
		scrollToSpy.mockClear();
		setScroll(0, 640); // the browser has already jumped to the anchor

		browserFragmentNav('/docs#faq');
		await tick();

		// The brand-new entry has no saved position, so the browser's anchor
		// landing stands. The old bug scrolled the window back to {0,0} here.
		expect(scrollToSpy).not.toHaveBeenCalled();
		expect(window.scrollY).toBe(640);
	});

	it('does not move focus and does not announce the route', async () => {
		await boot(ROUTES, undefined, '/docs');
		const announcedBefore = liveRegion()?.textContent ?? '';
		focusSpy.mockClear();

		browserFragmentNav('/docs#faq');
		await tick();

		expect(focusSpy).not.toHaveBeenCalled();
		expect(liveRegion()?.textContent ?? '').toBe(announcedBefore);
	});

	it('tracks the fragment in current.path / current.hash', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs');

		browserFragmentNav('/docs#faq');
		await tick();

		expect(router.current.path).toBe('/docs#faq');
		expect(router.current.hash).toBe('#faq');
		expect(router.current.pathname).toBe('/docs');
		expect(router.current.route.name).toBe('docs');
	});

	it('keeps the push() same-path no-op truthful in both directions', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs');
		browserFragmentNav('/docs#faq');
		await tick();
		const depth = history.length;

		// A nav link back to the anchor we are already at is a no-op, not a
		// duplicate entry — and not a dead link either: current.path names it.
		await router.push('/docs#faq');
		expect(history.length).toBe(depth);
		expect(runs.docs).toBe(1);

		// Dropping the fragment IS a move, so it still navigates.
		await router.push('/docs');
		expect(router.current.path).toBe('/docs');
		expect(router.current.hash).toBe('');
	});

	it('handles a fragment-to-fragment move (#faq → #api)', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs');
		browserFragmentNav('/docs#faq');
		await tick();
		browserFragmentNav('/docs#api');
		await tick();

		expect(router.current.hash).toBe('#api');
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });
	});

	it('still stamps a scroll key on the entry the browser created', async () => {
		await boot(ROUTES, undefined, '/docs');

		browserFragmentNav('/docs#faq');
		await tick();

		// The browser's entry carried history.state === null; #adoptEntryKey must
		// have replaceState'd a key onto it, or back/forward could never restore.
		expect(history.state?.__puzzleScrollKey).toBeTruthy();
	});
});

// ---- back/forward traversal across the pair --------------------------------

describe('Router fragment pop — back/forward traversal (D41)', () => {
	it('restores the saved position going back from /docs#faq to /docs', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs');
		const docsState = history.state; // the /docs entry's key

		setScroll(0, 220); // where the reader was before clicking the anchor
		browserFragmentNav('/docs#faq'); // saves 220 under the /docs entry
		await tick();
		setScroll(0, 640); // the browser jumped to #faq
		scrollToSpy.mockClear();

		traverseTo(docsState, '/docs');
		await tick();

		// A genuine traversal onto a known entry restores, exactly like any pop.
		expect(scrollToSpy).toHaveBeenCalledWith(0, 220);
		expect(window.scrollY).toBe(220);
		expect(router.current.hash).toBe('');
		expect(router.current.path).toBe('/docs');
		// …and still without reloading the route.
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });
	});

	it('restores again going forward to /docs#faq', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs');
		const docsState = history.state;

		setScroll(0, 220);
		browserFragmentNav('/docs#faq');
		await tick();
		const anchorState = history.state; // the key just stamped on the new entry
		setScroll(0, 640);

		traverseTo(docsState, '/docs'); // back — saves 640 under the anchor entry
		await tick();
		scrollToSpy.mockClear();

		traverseTo(anchorState, '/docs#faq'); // forward
		await tick();

		expect(scrollToSpy).toHaveBeenCalledWith(0, 640);
		expect(window.scrollY).toBe(640);
		expect(router.current.path).toBe('/docs#faq');
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });
	});

	it('does not move focus or announce on a traversal either', async () => {
		await boot(ROUTES, undefined, '/docs');
		const docsState = history.state;
		browserFragmentNav('/docs#faq');
		await tick();
		const announcedBefore = liveRegion()?.textContent ?? '';
		focusSpy.mockClear();

		traverseTo(docsState, '/docs');
		await tick();

		expect(focusSpy).not.toHaveBeenCalled();
		expect(liveRegion()?.textContent ?? '').toBe(announcedBefore);
	});

	it('agrees with #match about an insignificant trailing slash', async () => {
		// '/docs/' is the SSG directory URL for the same route; a fragment move
		// off it must not be mistaken for a real navigation.
		const { router } = await boot(ROUTES, undefined, '/docs/');
		expect(router.current.route.name).toBe('docs');

		browserFragmentNav('/docs/#faq');
		await tick();

		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });
		expect(router.current.hash).toBe('#faq');
	});
});

// ---- the guard must not swallow real navigations ---------------------------

describe('Router fragment pop — what still navigates', () => {
	it('a pop to a DIFFERENT route runs the full pipeline', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs');
		browserFragmentNav('/docs#faq');
		await tick();

		traverseTo({}, '/about');
		await tick();

		expect(router.current.route.name).toBe('about');
		expect(runs.about).toBe(1);
		expect(scrollToSpy).toHaveBeenCalled();
	});

	it('a pop that changes the QUERY is a real navigation, not a fragment move', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs?q=1');
		expect(runs.docs).toBe(1);

		traverseTo({}, '/docs?q=2#faq');
		await tick();

		// Same pathname, but ?q moved — the route's query snapshot must be
		// rebuilt, so this is NOT the same document in the guard's sense.
		expect(router.current.query.q).toBe('2');
		expect(runs.docs).toBe(2);
	});

	it('a pop from a fragment URL to a different route with the same fragment navigates', async () => {
		const { router } = await boot(ROUTES, undefined, '/docs#faq');

		traverseTo({}, '/about#faq');
		await tick();

		expect(router.current.route.name).toBe('about');
		expect(router.current.hash).toBe('#faq');
		expect(runs.about).toBe(1);
	});
});

// ---- hash routing keeps its own D34/D41 behavior ---------------------------

describe('Router fragment pop — hash routing (D34/D41)', () => {
	it('treats the in-fragment double-hash anchor as a same-document move', async () => {
		history.replaceState({}, '', '/#/docs');
		const { router } = await boot(ROUTES, { mode: hashRouter() }, '/#/docs');
		expect(router.current.route.name).toBe('docs');
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });

		// D41's hash-mode convention: push('/docs#faq') writes '#/docs#faq'.
		browserFragmentNav('/#/docs#faq');
		await tick();

		expect(router.current.path).toBe('/docs#faq');
		expect(router.current.hash).toBe('#faq');
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });
	});

	it('still ignores a NON-route bare fragment outright (readPath → null)', async () => {
		const { router } = await boot(ROUTES, { mode: hashRouter() }, '/#/docs');

		browserFragmentNav('/#faq');
		await tick();

		// Unchanged view, unchanged state — the handler returned before any
		// bookkeeping, which is the pre-existing D34 behavior this guard leaves be.
		expect(router.current.path).toBe('/docs');
		expect(runs).toEqual({ home: 0, about: 0, shell: 1, docs: 1 });
	});
});

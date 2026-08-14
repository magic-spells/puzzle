// @vitest-environment jsdom
//
// Non-ASCII literal route paths use the browser's percent-encoded pathname as
// their canonical internal form. These are deliberately history-mode tests:
// memory mode has no URL, while push-only coverage would hide cold-load, link,
// and popstate mismatches.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const view = (label) =>
	class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: label }, [text(label)]);
		}
	};

const Home = view('home');
const Cafe = view('cafe');
const Japanese = view('japanese');
const NotFound = view('notfound');

const routes = [
	{ path: '/', name: 'home', view: Home },
	{ path: '/café', name: 'cafe', view: Cafe },
	{ path: '/日本語', name: 'japanese', view: Japanese },
	{ path: '*', name: 'notfound', view: NotFound },
];

const ctx = () => ({ store: null, router: null, formatters: null });
let routers = [];

async function boot(url = '/', options = {}, routeTable = routes) {
	history.replaceState({}, '', url);
	const el = document.createElement('div');
	document.body.appendChild(el);
	const router = new Router(routeTable, { ...options });
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
});

afterEach(() => {
	routers.forEach((router) => router.stop());
	routers = [];
});

describe('Router — non-ASCII literal paths use encoded pathname form', () => {
	it('cold load matches a raw-declared non-ASCII literal against location.pathname', async () => {
		const { router, el } = await boot('/café');

		expect(location.pathname).toBe('/caf%C3%A9');
		expect(router.current.path).toBe('/caf%C3%A9');
		expect(router.current.route.name).toBe('cafe');
		expect(el.querySelector('.cafe')).not.toBeNull();
		expect(el.querySelector('.notfound')).toBeNull();
	});

	it('push() normalizes a raw non-ASCII path before matching and history commit', async () => {
		const { router, el } = await boot();
		await router.push('/café');

		expect(location.pathname).toBe('/caf%C3%A9');
		expect(router.current.path).toBe('/caf%C3%A9');
		expect(el.querySelector('.cafe')).not.toBeNull();
	});

	it('replace() normalizes a raw non-ASCII path before matching and history commit', async () => {
		const { router, el } = await boot();
		await router.replace('/日本語');

		expect(location.pathname).toBe('/%E6%97%A5%E6%9C%AC%E8%AA%9E');
		expect(router.current.path).toBe('/%E6%97%A5%E6%9C%AC%E8%AA%9E');
		expect(el.querySelector('.japanese')).not.toBeNull();
	});

	it('router.url() emits an encoded href that survives an in-app anchor click', async () => {
		const { router, el } = await boot();
		const link = document.createElement('a');
		link.href = router.url('/café');
		link.textContent = 'Café';
		document.body.appendChild(link);

		expect(link.getAttribute('href')).toBe('/caf%C3%A9');
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
		await delay(20);

		expect(location.pathname).toBe('/caf%C3%A9');
		expect(router.current.route.name).toBe('cafe');
		expect(el.querySelector('.cafe')).not.toBeNull();
	});

	it('back navigation re-matches the encoded browser pathname', async () => {
		const { router, el } = await boot();
		await router.push('/café');
		await router.push('/');

		history.back();
		await delay(20);

		expect(location.pathname).toBe('/caf%C3%A9');
		expect(router.current.path).toBe('/caf%C3%A9');
		expect(router.current.route.name).toBe('cafe');
		expect(el.querySelector('.cafe')).not.toBeNull();
		expect(el.querySelector('.notfound')).toBeNull();
	});

	it('normalization is idempotent for an already percent-encoded route and path', async () => {
		const encodedRoutes = [
			{ path: '/', name: 'home', view: Home },
			{ path: '/caf%C3%A9', name: 'cafe-encoded', view: Cafe },
			{ path: '*', name: 'notfound', view: NotFound },
		];
		const { router, el } = await boot('/', {}, encodedRoutes);

		expect(router.url('/caf%C3%A9')).toBe('/caf%C3%A9');
		await router.push('/caf%C3%A9');

		expect(location.pathname).toBe('/caf%C3%A9');
		expect(location.pathname).not.toContain('%25');
		expect(router.current.route.name).toBe('cafe-encoded');
		expect(el.querySelector('.cafe')).not.toBeNull();
	});

	it('routerBase stays URL-prefixed while the normalized route path stays base-free', async () => {
		const { router, el } = await boot('/app/café', { base: '/app' });

		expect(location.pathname).toBe('/app/caf%C3%A9');
		expect(router.current.path).toBe('/caf%C3%A9');
		expect(router.url('/café')).toBe('/app/caf%C3%A9');
		expect(router.current.route.name).toBe('cafe');
		expect(el.querySelector('.cafe')).not.toBeNull();
	});

	// The WHATWG path percent-encode set also escapes four ASCII characters that
	// encodeURIComponent would leave alone in a path. A space is the only one that
	// turns up in a real route, and it fails identically to a non-ASCII literal:
	// location.pathname reports '/my%20page' while a raw-declared regex expects
	// '/my page', so the route falls through to the catch-all.
	it('cold load matches a literal segment containing a space', async () => {
		const spaced = [
			{ path: '/', name: 'home', view: Home },
			{ path: '/my page', name: 'spaced', view: Cafe },
			{ path: '*', name: 'notfound', view: NotFound },
		];
		const { router } = await boot('/my page', {}, spaced);

		expect(location.pathname).toBe('/my%20page');
		expect(router.current.route.name).toBe('spaced');
		expect(router.url('/my page')).toBe('/my%20page');
	});

	// '{', '}' and '^' are in the same WHATWG path percent-encode set as the space,
	// and browsers escape them in location.pathname just as jsdom's URL parser does
	// here. '|' is NOT in that set — the browser leaves it verbatim — so the
	// normalizer must leave it alone too, or a route declared '/a|b' would stop
	// matching the pathname the browser reports.
	it('matches literal braces and a caret, and leaves a pipe verbatim', async () => {
		const punctuated = [
			{ path: '/', name: 'home', view: Home },
			{ path: '/a{b}', name: 'braced', view: Cafe },
			{ path: '/x^y', name: 'caret', view: Japanese },
			{ path: '/p|q', name: 'piped', view: Home },
			{ path: '*', name: 'notfound', view: NotFound },
		];
		expect(new URL('/a{b}', 'http://x').pathname).toBe('/a%7Bb%7D');
		expect(new URL('/p|q', 'http://x').pathname).toBe('/p|q');

		const { router } = await boot('/a{b}', {}, punctuated);
		expect(location.pathname).toBe('/a%7Bb%7D');
		expect(router.current.route.name).toBe('braced');
		expect(router.url('/a{b}')).toBe('/a%7Bb%7D');

		await router.push('/x^y');
		expect(location.pathname).toBe('/x%5Ey');
		expect(router.current.route.name).toBe('caret');

		await router.push('/p|q');
		expect(location.pathname).toBe('/p|q');
		expect(router.current.route.name).toBe('piped');
	});

	it('leaves ? and # unencoded so query and fragment stay structural', async () => {
		const { router } = await boot();

		expect(router.url('/café?q=1#top')).toBe('/caf%C3%A9?q=1#top');
	});
});

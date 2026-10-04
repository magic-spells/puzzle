// @vitest-environment jsdom
//
// Locale prefix routing (D177) in the Router: `{ locale, defaultLocale, locales }`
// compose the page's locale prefix into the path-mode base, exactly where D51's
// routerBase applies — reads strip it (#currentPath), writes add it (the
// pushState/replaceState site), url() encodes under it, and the click interceptor
// takes only links under it. Route matching, push('/about'), current.path and
// this.route stay locale-free, as they stay base-free. A link into another
// locale's pages is a real page load. Same jsdom conventions as
// router-base.test.js: boot at a URL by replaceState before start().
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { localizeRouterStub, makeRouterStub } from '../client-runtime/ssg/assemble.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const tick = () => new Promise((r) => setTimeout(r, 0));
// Await a condition, not a fixed delay: each turn yields one macrotask.
async function until(condition, what) {
	for (let i = 0; i < 200; i++) {
		if (condition()) return;
		await tick();
	}
	throw new Error(`${what} never happened`);
}

const view = (cls) =>
	class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: cls }, [text(cls)]);
		}
	};

const routes = [
	{ path: '/', name: 'home', view: view('home') },
	{ path: '/about', name: 'about', view: view('about') },
	{ path: '/user/:id', name: 'user', view: view('user') },
	{ path: '*', name: 'not-found', view: view('nf') },
];

const LOCALES = ['en', 'es', 'pt-BR'];

let routers = [];

/** Boot a router at `url` for `locale` (the page's locale, as app.js reads it). */
async function boot(url, locale, { base = '', ...options } = {}) {
	history.replaceState({}, '', url);
	const el = document.createElement('div');
	document.body.appendChild(el);
	const router = new Router(routes, { base, locale, defaultLocale: 'en', locales: LOCALES, ...options });
	routers.push(router);
	await router.start(el, { store: null, router: null, formatters: null });
	return { router, el };
}

/**
 * Click a link and report whether the router took it. A window listener runs
 * after the router's document listener: it records the verdict, then stops
 * jsdom's (unimplemented) page navigation for the links the router left alone.
 */
function click(href) {
	const a = document.createElement('a');
	a.setAttribute('href', href);
	document.body.appendChild(a);
	let intercepted;
	const record = (e) => {
		intercepted = e.defaultPrevented;
		e.preventDefault();
	};
	window.addEventListener('click', record);
	a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
	window.removeEventListener('click', record);
	a.remove();
	return intercepted;
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

describe('Router locale prefix — reading the URL (D177)', () => {
	it.each([
		// [url, routerBase, locale, current.path, view]
		['/es/about', '', 'es', '/about', 'about'],
		['/es/user/7?tab=2#bio', '', 'es', '/user/7?tab=2#bio', 'user'],
		['/es', '', 'es', '/', 'home'],
		['/es/', '', 'es', '/', 'home'],
		['/pt-BR/about', '', 'pt-BR', '/about', 'about'],
		['/about', '', 'en', '/about', 'about'],
		['/docs/es/about', '/docs', 'es', '/about', 'about'],
		['/docs/es', '/docs', 'es', '/', 'home'],
		['/docs/es/', '/docs', 'es', '/', 'home'],
		['/docs/about', '/docs', 'en', '/about', 'about'],
	])('%s under base %j for %s reads %s', async (url, base, locale, path, cls) => {
		const { router, el } = await boot(url, locale, { base });
		expect(router.current.path).toBe(path);
		expect(el.querySelector('.' + cls)).not.toBeNull();
		expect(location.pathname + location.search + location.hash).toBe(url); // untouched
	});

	it('pops re-read the prefixed URL', async () => {
		const { router, el } = await boot('/es/about', 'es');
		history.replaceState({}, '', '/es/user/3');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await until(() => router.current.path === '/user/3', 'the pop');
		expect(el.querySelector('.user')).not.toBeNull();
	});
});

describe('Router locale prefix — writing the URL (D177)', () => {
	it('push and replace write under the prefix; current stays locale-free', async () => {
		const { router } = await boot('/docs/es', 'es', { base: '/docs' });
		await router.push('/about?x=1#top');
		expect(location.pathname + location.search + location.hash).toBe('/docs/es/about?x=1#top');
		expect(router.current.path).toBe('/about?x=1#top');
		await router.replace('/user/2');
		expect(location.pathname).toBe('/docs/es/user/2');
		expect(router.current.route.name).toBe('user');
	});

	it('the default locale writes unprefixed URLs', async () => {
		const { router } = await boot('/', 'en');
		await router.push('/about');
		expect(location.pathname).toBe('/about');
	});

	it('back() returns to the prefixed entry', async () => {
		const { router, el } = await boot('/es', 'es');
		await router.push('/about');
		expect(location.pathname).toBe('/es/about');
		const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
		router.back();
		await popped;
		expect(location.pathname).toBe('/es');
		await until(() => router.current.path === '/', 'the back navigation');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('a pushed path that carries a locale prefix routes as written (catch-all) and warns in development', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { router } = await boot('/', 'en');
		await router.push('/es/about');
		expect(router.current.route.name).toBe('not-found');
		expect(location.pathname).toBe('/es/about');
		expect(warn.mock.calls.some(([msg]) => /starts with a locale prefix/.test(msg))).toBe(true);
	});
});

describe('Router locale prefix — url() (D177)', () => {
	const make = (locale, base = '') => new Router(routes, { base, locale, defaultLocale: 'en', locales: LOCALES });

	it('encodes under the active locale; the default locale is unprefixed', () => {
		expect(make('es').url('/about')).toBe('/es/about');
		expect(make('es', '/docs/').url('/about?x=1#y')).toBe('/docs/es/about?x=1#y');
		expect(make('en').url('/about')).toBe('/about');
		expect(make('en', '/docs').url('/')).toBe('/docs/');
	});

	it('{ locale } forces a locale (case-insensitively, spelled as configured); an unknown tag throws', () => {
		const router = make('es', '/docs');
		expect(router.url('/about', { locale: 'pt-br' })).toBe('/docs/pt-BR/about');
		expect(router.url('/about', { locale: 'en' })).toBe('/docs/about');
		expect(router.url('/about', null)).toBe('/docs/es/about');
		expect(() => router.url('/about', { locale: 'fr' })).toThrow(RangeError);
	});

	it('{ locale: false } skips the prefix and keeps the base', () => {
		expect(make('es', '/docs').url('/files/cv.pdf', { locale: false })).toBe('/docs/files/cv.pdf');
		expect(make('es').url('/files/cv.pdf', { locale: false })).toBe('/files/cv.pdf');
	});

	it('passes non-path strings through', () => {
		expect(make('es').url('https://example.com/x')).toBe('https://example.com/x');
		expect(make('es').url('#top')).toBe('#top');
	});

	it('without locales the options are ignored (no prefix routing)', () => {
		expect(new Router(routes, { base: '/docs' }).url('/about', { locale: 'es' })).toBe('/docs/about');
	});
});

describe('Router locale prefix — click interception (D177)', () => {
	it('takes same-locale links and pushes them locale-free', async () => {
		const { router } = await boot('/es', 'es');
		const push = vi.spyOn(router, 'push');
		expect(click('/es/about?x=1')).toBe(true);
		expect(push).toHaveBeenCalledWith('/about?x=1');
		expect(click('/es')).toBe(true);
		expect(push).toHaveBeenLastCalledWith('/');
	});

	it("leaves another locale's links to the browser, from a default-locale page", async () => {
		const { router } = await boot('/', 'en');
		const push = vi.spyOn(router, 'push');
		expect(click('/es/about')).toBe(false);
		expect(click('/es')).toBe(false);
		expect(click('/pt-BR/')).toBe(false);
		expect(push).not.toHaveBeenCalled();
		// Not a locale: `/esp` and `/ES` are ordinary app paths.
		expect(click('/esp')).toBe(true);
		expect(push).toHaveBeenCalledWith('/esp');
	});

	it('leaves the default locale and other prefixes to the browser, from a prefixed page', async () => {
		const { router } = await boot('/docs/es/about', 'es', { base: '/docs' });
		const push = vi.spyOn(router, 'push');
		expect(click('/docs/about')).toBe(false);
		expect(click('/docs/')).toBe(false);
		expect(click('/docs/pt-BR/about')).toBe(false);
		expect(click('/docs/es/user/1')).toBe(true);
		expect(push).toHaveBeenCalledTimes(1);
		expect(push).toHaveBeenCalledWith('/user/1');
	});

	it('leaves external links and { locale: false } file links on a prefixed page to the browser', async () => {
		const { router } = await boot('/es/about', 'es');
		const push = vi.spyOn(router, 'push');
		expect(click('https://example.com/es/about')).toBe(false);
		expect(click(router.url('/files/cv.pdf', { locale: false }))).toBe(false);
		expect(push).not.toHaveBeenCalled();
	});
});

describe('Router locale prefix — route collision (D177)', () => {
	it('throws when a route starts with a non-default locale tag, naming both', () => {
		const opts = { locale: 'en', defaultLocale: 'en', locales: LOCALES };
		expect(() => new Router([{ path: '/es/about', view: view('x') }], opts)).toThrow(
			/route "\/es\/about" collides with the locale prefix "es"/
		);
		expect(() =>
			new Router([{ path: '/pt-BR', view: view('x'), children: [{ path: 'faq', view: view('y') }] }], opts)
		).toThrow(/route "\/pt-BR\/faq" collides with the locale prefix "pt-BR"/);
	});

	it('allows the default tag, look-alikes and every route without locales', () => {
		const opts = { locale: 'en', defaultLocale: 'en', locales: LOCALES };
		expect(() => new Router([{ path: '/en/about', view: view('x') }], opts)).not.toThrow();
		expect(() => new Router([{ path: '/esp', view: view('x') }], opts)).not.toThrow();
		expect(() => new Router([{ path: '/es/about', view: view('x') }])).not.toThrow();
	});
});

// The four encoders D177 names — Router.url, the router's write side, the static
// router stub (localizeRouterStub) and the hybrid prerender's url shadow — all go
// through localeBase. This pins the first three against each other per locale;
// the hybrid shadow joins when the per-locale prerender lands.
describe('Router locale prefix — encoder parity (D177)', () => {
	const PATH = '/user/9?tab=2#bio';
	for (const base of ['', '/docs']) {
		for (const locale of LOCALES) {
			it(`${locale} under base ${JSON.stringify(base)}`, async () => {
				const stub = localizeRouterStub(makeRouterStub({ path: '/' }, { base }), {
					base,
					locale,
					defaultLocale: 'en',
					locales: LOCALES,
				});
				const root = base + (locale === 'en' ? '' : '/' + locale) + '/';
				const { router } = await boot(root, locale, { base });
				await router.push(PATH);
				const written = location.pathname + location.search + location.hash;
				expect(router.url(PATH)).toBe(written);
				expect(stub.url(PATH)).toBe(written);
				for (const options of [{ locale: 'es' }, { locale: 'en' }, { locale: 'pt-BR' }, { locale: false }]) {
					expect(router.url(PATH, options)).toBe(stub.url(PATH, options));
				}
			});
		}
	}
});

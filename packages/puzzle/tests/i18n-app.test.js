// @vitest-environment jsdom
// D175 — PuzzleApp wiring: the strings load before navigation #0, ctx.i18n and
// app.i18n, the service-bound `t` formatter, and setLocale's same-location
// rebuild through the router (keep = 0, replace mode, no animation, scroll or
// focus change).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { hashRouter, memoryRouter } from '../client-runtime/router/modes.js';
import { createTestApp, mountView } from '../client-runtime/testing/index.js';
import { installFakeAnimate } from './helpers/fake-waapi.js';
import { back } from './helpers/history.js';
import { formatLocale } from '../client-runtime/formatters/locale.js';
import { REDIRECT_CASES, REDIRECT_MANIFEST, SAME_ORIGIN } from './fixtures/locale-redirect-cases.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
	for (let i = 0; i < 20; i++) await tick();
};
// Rejects instead of hanging, so a deadlock fails the test by name.
const within = (p, what) =>
	Promise.race([
		p,
		new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} never settled`)), 500)),
	]);

const EN = { title: 'Home', greeting: 'Hello, {name}!', 'layout.brand': 'Shop', about: 'About' };
const ES = { title: 'Inicio', greeting: '¡Hola, {name}!', 'layout.brand': 'Tienda', about: 'Acerca de' };
const MANIFEST = {
	defaultLocale: 'en',
	locales: { en: 'locales/en.AAAA.json', es: 'locales/es.BBBB.json' },
};

let constructed;
let dataRuns;

class Layout extends PuzzleView {
	constructor(ctx) {
		super(ctx);
		constructed.push('layout');
	}
	render() {
		// Through the formatter map, exactly as a compiled `{ t('layout.brand') }`.
		const f = this.ctx.formatters.getAll();
		return h('puzzle-view', { class: 'layout' }, [
			h('header', {}, [text(f.t('layout.brand'))]),
			h('main', {}, [slot()]),
		]);
	}
}

class Home extends PuzzleView {
	constructor(ctx) {
		super(ctx);
		constructed.push('home');
	}
	data() {
		dataRuns++;
		return { heading: this.ctx.i18n.t('title') };
	}
	render() {
		const { heading } = this.getData();
		return h('puzzle-view', { class: 'home' }, [
			h('h1', {}, [text(heading)]),
			h('p', {}, [text(this.ctx.i18n.t('greeting', { name: 'Ada' }))]),
			h('button', { id: 'focus-me' }, [text('x')]),
		]);
	}
}

class About extends PuzzleView {
	render() {
		return h('puzzle-view', {}, [h('h1', {}, [text(this.ctx.i18n.t('about'))])]);
	}
}

const routes = () => [
	{ path: '/', view: Home, layout: Layout },
	{ path: '/about', view: About, layout: Layout },
];

function stubFetch(byPath, { fail = [], gates = {} } = {}) {
	const fetch = vi.fn(async (url) => {
		const hit = Object.keys(byPath).find((p) => url.endsWith(p));
		if (gates[hit]) await gates[hit];
		if (!hit || fail.includes(hit)) return { ok: false, status: 404, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => byPath[hit] };
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

function memoryStorage() {
	const map = new Map();
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		clear: () => map.clear(),
	};
}

const apps = [];
function make(config = {}) {
	const el = document.createElement('div');
	el.id = 'app';
	document.body.appendChild(el);
	const app = new PuzzleApp({
		target: el,
		routes: routes(),
		__i18n: { manifest: MANIFEST, locale: 'en' },
		...config,
	});
	apps.push(app);
	return { app, el };
}

beforeEach(() => {
	constructed = [];
	dataRuns = 0;
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
	document.documentElement.removeAttribute('lang');
	vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
	for (const app of apps.splice(0)) app.unmount();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PuzzleApp + i18n', () => {
	it('renders nothing — and runs no data() — before the strings arrive', async () => {
		let release;
		const gate = new Promise((r) => (release = r));
		stubFetch({ 'locales/en.AAAA.json': EN }, { gates: { 'locales/en.AAAA.json': gate } });
		const { app, el } = make();
		const mounted = app.mount();
		await tick();
		expect(el.innerHTML).toBe('');
		expect(dataRuns).toBe(0);
		release();
		await mounted;
		expect(el.querySelector('h1').textContent).toBe('Home');
		expect(el.querySelector('p').textContent).toBe('Hello, Ada!');
		expect(el.querySelector('header').textContent).toBe('Shop');
		expect(document.documentElement.lang).toBe('en');
	});

	it('wires ctx.i18n, app.i18n and the t formatter; the path mode resolves under routerBase', async () => {
		const fetch = stubFetch({ 'locales/en.AAAA.json': EN });
		const { app } = make({ routerBase: '/shop' });
		history.replaceState({}, '', '/shop/');
		await app.mount();
		expect(app.i18n).toBeTruthy();
		expect(app.ctx.i18n).toBe(app.i18n);
		// The switcher list (D177): config order, own-language names, the committed
		// page (under routerBase) for every entry without prefix routing.
		expect(app.i18n.locales).toEqual([
			{ locale: 'en', label: 'English', href: '/shop/', active: true },
			{ locale: 'es', label: 'Español', href: '/shop/', active: false },
		]);
		expect(app.i18n.defaultLocale).toBe('en');
		expect(typeof app.formatters.getAll().t).toBe('function');
		expect(fetch.mock.calls[0][0]).toBe('/shop/locales/en.AAAA.json');
		app.unmount();
		expect(app.i18n).toBe(null);
	});

	it('under prefix routing, locales hrefs swap the prefix after routerBase (D177)', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN });
		const { app } = make({
			routerBase: '/docs/',
			__i18n: { manifest: { ...MANIFEST, routing: 'prefix' }, locale: 'en' },
		});
		history.replaceState({}, '', '/docs/about?tab=2');
		await app.mount();
		expect(app.i18n.locales.map((entry) => entry.href)).toEqual(['/docs/about?tab=2', '/docs/es/about?tab=2']);
	});

	it('hash and memory modes resolve manifest paths next to the entry module', async () => {
		// The build's manifest carries `base`, the folder app.js was served from.
		const fetch = stubFetch({ 'locales/en.AAAA.json': EN });
		const { app } = make({
			routerMode: hashRouter(),
			__i18n: { manifest: { ...MANIFEST, base: 'https://example.test/shop/' }, locale: 'en' },
		});
		await app.mount();
		expect(fetch.mock.calls[0][0]).toBe('https://example.test/shop/locales/en.AAAA.json');
	});

	it('a script embed fetches its locale files from the app folder, not the host page', async () => {
		history.replaceState({}, '', '/blog/post/1');
		const fetch = stubFetch({ 'locales/en.AAAA.json': EN });
		const { app, el } = make({
			routerMode: memoryRouter(),
			__i18n: { manifest: { ...MANIFEST, base: 'https://widget.cdn/app/' }, locale: 'en' },
		});
		await app.mount();
		expect(fetch.mock.calls[0][0]).toBe('https://widget.cdn/app/locales/en.AAAA.json');
		expect(el.querySelector('h1').textContent).toBe('Home');
	});

	it('memory mode leaves <html lang> alone, on load and on a switch', async () => {
		document.documentElement.lang = 'fr';
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el } = make({ routerMode: memoryRouter() });
		await app.mount();
		expect(document.documentElement.lang).toBe('fr');
		await app.i18n.setLocale('es');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(document.documentElement.lang).toBe('fr');
	});

	it('setLocale in beforeMount replaces the startup load and refreshes nothing', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el } = make({
			beforeMount(a) {
				return a.i18n.setLocale('es');
			},
		});
		await app.mount();
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(constructed).toEqual(['home', 'layout']);
	});

	it('a failed load of the active AND default locale rejects mount and tears down', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch({});
		const { app, el } = make({ __i18n: { manifest: MANIFEST, locale: 'es' } });
		await expect(app.mount()).rejects.toThrow(/failed to load/);
		expect(app._mounted).toBe(false);
		expect(el.innerHTML).toBe('');
	});

	it('setLocale rebuilds every level at the same location in one quiet swap', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const scrollBehavior = vi.fn(() => ({ x: 0, y: 0 }));
		const { app, el } = make({ scrollBehavior });
		await app.mount();
		const oldHome = el.querySelector('.home');
		const oldLayout = el.querySelector('.layout');
		const before = history.length;
		const button = el.querySelector('#focus-me');
		button.focus();
		const focused = document.activeElement;
		const runs = dataRuns;
		constructed = [];

		await app.i18n.setLocale('es');

		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelector('p').textContent).toBe('¡Hola, Ada!');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(document.documentElement.lang).toBe('es');
		// Every level is fresh: layout and view constructed again, data() re-ran.
		expect(constructed.sort()).toEqual(['home', 'layout']);
		expect(dataRuns).toBe(runs + 1);
		expect(el.querySelector('.home')).not.toBe(oldHome);
		expect(el.querySelector('.layout')).not.toBe(oldLayout);
		expect(el.querySelectorAll('.home')).toHaveLength(1);
		// Replace mode at the same location: no history entry, no scroll landing.
		expect(history.length).toBe(before);
		expect(location.pathname).toBe('/');
		expect(scrollBehavior).not.toHaveBeenCalled();
		// Focus is not moved by the router (the old button left with its view).
		expect(document.activeElement === focused || document.activeElement === document.body).toBe(true);
		expect(document.querySelector('[aria-live]')?.textContent ?? '').toBe('');
	});

	it('a rejected switch changes nothing', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN }, {});
		const { app, el } = make();
		await app.mount();
		const home = el.querySelector('.home');
		constructed = [];
		await expect(app.i18n.setLocale('es')).rejects.toThrow(/failed to load/);
		expect(el.querySelector('.home')).toBe(home);
		expect(el.querySelector('h1').textContent).toBe('Home');
		expect(app.i18n.locale).toBe('en');
		expect(constructed).toEqual([]);
	});

	it('overlapping switches are last-wins; landing back on the active locale rebuilds nothing', async () => {
		let releaseEs;
		const esGate = new Promise((r) => (releaseEs = r));
		stubFetch(
			{ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES },
			{ gates: { 'locales/es.BBBB.json': esGate } }
		);
		const { app, el } = make();
		await app.mount();
		constructed = [];
		const first = app.i18n.setLocale('es');
		const second = app.i18n.setLocale('en');
		await second;
		releaseEs();
		await first;
		expect(app.i18n.locale).toBe('en');
		expect(el.querySelector('h1').textContent).toBe('Home');
		expect(constructed).toEqual([]);
	});

	it('the next navigation after a rebuild keeps working, in the new locale', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el } = make();
		await app.mount();
		await app.i18n.setLocale('es');
		await app.router.push('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(el.querySelector('header').textContent).toBe('Tienda');
	});

	// A push still loading when the switch lands owns where the app is going: the
	// rebuild waits for it, then rebuilds the page the push committed.
	function gatedAbout() {
		let release;
		const gate = new Promise((r) => (release = r));
		class SlowAbout extends PuzzleView {
			async data() {
				await gate;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'about' }, [h('h1', {}, [text(this.ctx.i18n.t('about'))])]);
			}
		}
		return {
			release,
			routes: [
				{ path: '/', view: Home, layout: Layout },
				{ path: '/about', view: SlowAbout, layout: Layout },
			],
		};
	}

	it('a switch landing while a push loads waits for it, then rebuilds the new page', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const slow = gatedAbout();
		const { app, el } = make({ routes: slow.routes });
		await app.mount();
		const before = history.length;
		const push = app.router.push('/about');
		await tick();
		const switched = app.i18n.setLocale('es');
		await tick();
		slow.release();
		await push;
		await switched;
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(el.querySelectorAll('.about')).toHaveLength(1);
		expect(history.length).toBe(before + 1);
	});

	it('setLocale then push (a login flow) ends on the pushed page in the new locale', async () => {
		let releaseEs;
		const esGate = new Promise((r) => (releaseEs = r));
		stubFetch(
			{ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES },
			{ gates: { 'locales/es.BBBB.json': esGate } }
		);
		const slow = gatedAbout();
		const { app, el } = make({ routes: slow.routes });
		await app.mount();
		const before = history.length;
		const switched = app.i18n.setLocale('es');
		const push = app.router.push('/about');
		releaseEs();
		await tick();
		slow.release();
		await Promise.all([switched, push]);
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(history.length).toBe(before + 1);
	});

	it('setLocale then replace ends on the replaced page in the new locale', async () => {
		let releaseEs;
		const esGate = new Promise((r) => (releaseEs = r));
		stubFetch(
			{ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES },
			{ gates: { 'locales/es.BBBB.json': esGate } }
		);
		const slow = gatedAbout();
		const { app, el } = make({ routes: slow.routes });
		await app.mount();
		const before = history.length;
		const switched = app.i18n.setLocale('es');
		const replaced = app.router.replace('/about');
		releaseEs();
		await tick();
		slow.release();
		await Promise.all([switched, replaced]);
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(history.length).toBe(before);
	});

	// A Back pop still loading when the switch lands: the rebuild waits for it, so
	// the pop commits and the rebuild runs there — never over the entry it left.
	function gatedHome() {
		let gate = Promise.resolve();
		const state = { loading: false };
		class SlowHome extends Home {
			async data() {
				state.loading = true;
				await gate;
				return super.data();
			}
		}
		return {
			state,
			hold() {
				let release;
				gate = new Promise((r) => (release = r));
				state.loading = false;
				return release;
			},
			routes: [
				{ path: '/', view: SlowHome, layout: Layout },
				{ path: '/about', view: About, layout: Layout },
			],
		};
	}

	it('a switch landing while a Back pop loads lets it land, then rebuilds that page', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const slow = gatedHome();
		const { app, el } = make({ routes: slow.routes });
		await app.mount();
		await app.router.push('/about');
		const release = slow.hold();
		await back(() => slow.state.loading); // the pop is loading, held by the gate
		// Resolves once the strings are active — before the pop lands.
		await app.i18n.setLocale('es');
		expect(location.pathname).toBe('/');
		expect(el.querySelector('h1').textContent).toBe('About');
		release();
		await settle();
		expect(location.pathname).toBe('/');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelector('header').textContent).toBe('Tienda');
	});

	it('setLocale then a Back pop ends on the popped page in the new locale', async () => {
		let releaseEs;
		const esGate = new Promise((r) => (releaseEs = r));
		stubFetch(
			{ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES },
			{ gates: { 'locales/es.BBBB.json': esGate } }
		);
		const slow = gatedHome();
		const { app, el } = make({ routes: slow.routes });
		await app.mount();
		await app.router.push('/about');
		const release = slow.hold();
		const switched = app.i18n.setLocale('es');
		await back(() => slow.state.loading); // the pop is loading, held by the gate
		releaseEs();
		await tick();
		release();
		await within(switched, 'setLocale');
		await settle();
		expect(location.pathname).toBe('/');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(el.querySelectorAll('.home')).toHaveLength(1);
	});

	it('memory mode: a switch landing while back() loads waits for it, then rebuilds that page', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const slow = gatedHome();
		const { app, el } = make({ routes: slow.routes, routerMode: memoryRouter() });
		await app.mount();
		await app.router.push('/about');
		const release = slow.hold();
		const back = app.router.back();
		await tick();
		const switched = app.i18n.setLocale('es');
		await tick();
		release();
		await Promise.all([back, switched]);
		expect(app.router.current.path).toBe('/');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelector('header').textContent).toBe('Tienda');
	});

	// `await ctx.i18n.setLocale(...)` from INSIDE a loading navigation — a root
	// layout's data() applying the signed-in user's locale, a guard, a child view's
	// data(). setLocale resolves once the new strings are active; it must not wait
	// on the navigation that is awaiting it. That navigation lands, then the page
	// is rebuilt once in the new locale (the rebuild's own data() re-asks for the
	// active locale, which changes nothing and rebuilds nothing).
	it('await setLocale inside a root layout data() lets the navigation land, in the new locale', async () => {
		const fetch = stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		class UserLayout extends Layout {
			async data() {
				await this.ctx.i18n.setLocale('es'); // the signed-in user's locale
				return {};
			}
		}
		class Login extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'login' }, [text('login')]);
			}
		}
		history.replaceState({}, '', '/login');
		const { app, el } = make({
			routes: [
				{ path: '/login', view: Login },
				{ path: '/', view: Home, layout: UserLayout },
			],
		});
		await app.mount();
		constructed = [];
		await within(app.router.push('/'), 'push');
		await settle();
		expect(location.pathname).toBe('/');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelectorAll('.home')).toHaveLength(1);
		// The push, then one rebuild — no rebuild storm, and es fetched once.
		expect(constructed.filter((c) => c === 'layout')).toHaveLength(2);
		expect(fetch.mock.calls.filter(([url]) => url.endsWith('es.BBBB.json'))).toHaveLength(1);
	});

	// The same switch during navigation zero: nothing is committed yet, so the
	// rebuild waits for the first navigation to land, then re-runs the page's
	// data() — whose t() strings were computed in the old locale.
	for (const mode of ['path', 'memory']) {
		it(`await setLocale inside a root layout data() on the first load rebuilds the page in the new locale (${mode} mode)`, async () => {
			stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
			class UserLayout extends Layout {
				async data() {
					await this.ctx.i18n.setLocale('es');
					return {};
				}
			}
			const histLen = history.length;
			const { app, el } = make({
				routes: [{ path: '/', view: Home, layout: UserLayout }],
				...(mode === 'memory' ? { routerMode: memoryRouter() } : {}),
			});
			await within(app.mount(), 'mount');
			await settle();
			expect(app.i18n.locale).toBe('es');
			expect(el.querySelector('h1').textContent).toBe('Inicio');
			expect(el.querySelector('header').textContent).toBe('Tienda');
			expect(el.querySelectorAll('.home')).toHaveLength(1);
			// Navigation zero, then the one rebuild.
			expect(dataRuns).toBe(2);
			expect(history.length).toBe(histLen);
			expect(app.router.current.path).toBe('/');
		});
	}

	it('await setLocale inside a route guard lets the navigation land, in the new locale', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const guard = vi.fn(async ({ ctx }) => {
			await ctx.i18n.setLocale('es');
			return true;
		});
		const { app, el } = make({
			routes: [
				{ path: '/', view: Home, layout: Layout },
				{ path: '/about', view: About, layout: Layout, guard },
			],
		});
		await app.mount();
		constructed = [];
		await within(app.router.push('/about'), 'push');
		await settle();
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		// The guard ran before the push chose what to keep, so the push rebuilt the
		// layout already; then the one scheduled rebuild. The rebuild's guard re-asks
		// for the active locale, which rebuilds nothing more.
		expect(constructed.filter((c) => c === 'layout')).toHaveLength(2);
		expect(guard).toHaveBeenCalledTimes(2);
	});

	// A child view whose data() switches the locale, reachable by push, replace or Back.
	function switchingRoutes() {
		const flag = { on: false };
		class SwitchingHome extends Home {
			async data() {
				if (flag.on) await this.ctx.i18n.setLocale('es');
				return super.data();
			}
		}
		class SwitchingAbout extends PuzzleView {
			async data() {
				await this.ctx.i18n.setLocale('es');
				return { heading: this.ctx.i18n.t('about') };
			}
			render() {
				return h('puzzle-view', { class: 'about' }, [h('h1', {}, [text(this.getData().heading)])]);
			}
		}
		return {
			flag,
			routes: [
				{ path: '/', view: SwitchingHome, layout: Layout },
				{ path: '/about', view: SwitchingAbout, layout: Layout },
			],
		};
	}

	it('await setLocale inside a child data() during a push lands on the page in the new locale', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el } = make({ routes: switchingRoutes().routes });
		await app.mount();
		const before = history.length;
		await within(app.router.push('/about'), 'push');
		await settle();
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(el.querySelectorAll('.about')).toHaveLength(1);
		expect(history.length).toBe(before + 1);
	});

	it('await setLocale inside a child data() during a replace lands on the page in the new locale', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el } = make({ routes: switchingRoutes().routes });
		await app.mount();
		const before = history.length;
		await within(app.router.replace('/about'), 'replace');
		await settle();
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(history.length).toBe(before);
	});

	it('await setLocale inside a child data() during a Back pop lands on that page in the new locale', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const sw = switchingRoutes();
		const { app, el } = make({ routes: [sw.routes[0], { path: '/about', view: About, layout: Layout }] });
		await app.mount();
		await app.router.push('/about');
		sw.flag.on = true;
		history.back();
		await within(
			(async () => {
				while (location.pathname !== '/' || el.querySelector('.home') == null) await tick();
			})(),
			'pop'
		);
		await settle();
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelector('header').textContent).toBe('Tienda');
		expect(el.querySelectorAll('.home')).toHaveLength(1);
	});

	it('a switch plays no enter or out animation on the rebuilt chain', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const waapi = installFakeAnimate();
		try {
			const fade = { from: { opacity: 0 }, to: { opacity: 1 }, duration: 150 };
			class AnimHome extends Home {
				animations = { in: fade, out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } };
			}
			class AnimLayout extends Layout {
				animations = { in: fade, out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } };
			}
			const { app, el } = make({ routes: [{ path: '/', view: AnimHome, layout: AnimLayout }] });
			await app.mount();
			waapi.finishAll();
			await tick();
			const calls = waapi.animations.length;
			expect(calls).toBeGreaterThan(0); // the initial mount did animate
			await app.i18n.setLocale('es');
			expect(waapi.animations.length).toBe(calls);
			expect(el.querySelector('h1').textContent).toBe('Inicio');
			expect(el.querySelectorAll('.home')).toHaveLength(1);
			expect(el.querySelectorAll('.layout')).toHaveLength(1);
		} finally {
			waapi.uninstall();
		}
	});

	it('a switch never flashes a skeleton: the old page stays until the new one is ready', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		let gate = Promise.resolve();
		class SkeletonHome extends PuzzleView {
			async data() {
				await gate;
				return { heading: this.ctx.i18n.t('title') };
			}
			render() {
				return h('puzzle-view', { class: 'home' }, [h('h1', {}, [text(this.getData().heading)])]);
			}
			renderSkeleton() {
				return h('puzzle-view', { class: 'home is-loading' }, []);
			}
		}
		const { app, el } = make({ routes: [{ path: '/', view: SkeletonHome, layout: Layout }] });
		await app.mount();
		await tick();
		expect(el.querySelector('h1').textContent).toBe('Home');
		let release;
		gate = new Promise((r) => (release = r));
		const switched = app.i18n.setLocale('es');
		await tick();
		await tick();
		expect(el.querySelector('.is-loading')).toBeNull();
		expect(el.querySelector('h1').textContent).toBe('Home');
		release();
		await switched;
		expect(el.querySelector('.is-loading')).toBeNull();
		expect(el.querySelector('h1').textContent).toBe('Inicio');
	});

	it('a rebuild whose data() fails rejects setLocale and keeps the old page', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const onError = vi.fn();
		let fail = false;
		class Fragile extends Home {
			data() {
				if (fail) throw new Error('boom');
				return super.data();
			}
		}
		const { app, el } = make({
			onError,
			routes: [
				{ path: '/', view: Fragile, layout: Layout },
				{ path: '/about', view: About, layout: Layout },
			],
		});
		await app.mount();
		fail = true;
		await expect(app.i18n.setLocale('es')).rejects.toThrow(/could not be rebuilt/);
		expect(el.querySelector('h1').textContent).toBe('Home');
		expect(onError).toHaveBeenCalled();
		// The next successful navigation rebuilds every level in the new locale.
		fail = false;
		await app.router.push('/about');
		expect(el.querySelector('header').textContent).toBe('Tienda');
	});

	// After a failed rebuild the new locale is active but the page is not in it,
	// so asking for that locale again is a retry, never the same-locale no-op —
	// even when a same-locale call landed during the failed rebuild (the layout's
	// data() re-asking for the user's locale, or a second click) and so overtook it.
	function fragileApp({ layoutReasks = false } = {}) {
		const onError = vi.fn();
		const state = { fail: false, gate: null };
		class ReaskLayout extends Layout {
			async data() {
				if (layoutReasks) await this.ctx.i18n.setLocale(this.ctx.i18n.locale);
				return {};
			}
		}
		class Fragile extends Home {
			async data() {
				if (state.gate) await state.gate;
				if (state.fail) throw new Error('boom');
				return super.data();
			}
		}
		return {
			state,
			onError,
			...make({ onError, routes: [{ path: '/', view: Fragile, layout: ReaskLayout }] }),
		};
	}

	it('setLocale retries after a failed rebuild', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el, state } = fragileApp();
		await app.mount();
		state.fail = true;
		await expect(app.i18n.setLocale('es')).rejects.toThrow(/could not be rebuilt/);
		expect(el.querySelector('h1').textContent).toBe('Home');
		state.fail = false;
		await within(app.i18n.setLocale('es'), 'retry');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelector('header').textContent).toBe('Tienda');
	});

	it('setLocale retries after a failed rebuild whose layout data() re-asked for the locale', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el, state } = fragileApp({ layoutReasks: true });
		await app.mount();
		state.fail = true;
		await expect(within(app.i18n.setLocale('es'), 'switch')).rejects.toThrow(/could not be rebuilt/);
		expect(el.querySelector('h1').textContent).toBe('Home');
		state.fail = false;
		await within(app.i18n.setLocale('es'), 'retry');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
		expect(el.querySelector('header').textContent).toBe('Tienda');
	});

	it('setLocale retries after a failed rebuild that a second click landed in', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		const { app, el, state } = fragileApp();
		await app.mount();
		let release;
		state.gate = new Promise((r) => (release = r));
		state.fail = true;
		const first = app.i18n.setLocale('es');
		while (app.i18n.locale !== 'es') await tick();
		// The double-click: the strings are active, the rebuild is still loading.
		await within(app.i18n.setLocale('es'), 'second click');
		release();
		await expect(first).rejects.toThrow(/could not be rebuilt/);
		expect(el.querySelector('h1').textContent).toBe('Home');
		state.gate = null;
		state.fail = false;
		await within(app.i18n.setLocale('es'), 'retry');
		expect(el.querySelector('h1').textContent).toBe('Inicio');
	});

	it('a switch while the layout data() re-asks for the user locale settles without freezing the router', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		// The signed-in user's locale is en; the layout applies it on every build.
		class UserLayout extends Layout {
			async data() {
				await this.ctx.i18n.setLocale('en');
				return {};
			}
		}
		const { app, el } = make({
			routes: [
				{ path: '/', view: Home, layout: UserLayout },
				{ path: '/about', view: About, layout: UserLayout },
			],
		});
		await app.mount();
		// A switcher asks for es: its rebuild re-runs the layout, which switches
		// back to the user's en while that rebuild is loading. The en rebuild waits
		// for the es one instead of racing it, so neither waits on the other.
		await within(app.i18n.setLocale('es'), 'switch');
		await settle();
		expect(app.i18n.locale).toBe('en');
		expect(el.querySelector('h1').textContent).toBe('Home');
		expect(el.querySelector('header').textContent).toBe('Shop');
		await within(app.router.push('/about'), 'push');
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('About');
		expect(el.querySelectorAll('.home')).toHaveLength(0);
	});

	// Unmount retires the i18n service: a locale file still in flight from the
	// old mount must not switch the remounted app's language when it lands.
	it('a startup load still in flight at unmount never applies after a remount', async () => {
		let release;
		const gate = new Promise((r) => (release = r));
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES }, { gates: { 'locales/es.BBBB.json': gate } });
		localStorage.setItem('__puzzleLocale', 'es');
		const { app, el } = make({ __i18n: { manifest: MANIFEST } });
		const first = app.mount();
		app.unmount();
		localStorage.setItem('__puzzleLocale', 'en');
		await within(app.mount(), 'remount');
		expect(app.i18n.locale).toBe('en');
		release();
		await first.catch(() => {});
		await settle();
		expect(document.documentElement.lang).toBe('en');
		expect(formatLocale).toBe('en');
		expect(app.i18n.locale).toBe('en');
		expect(el.querySelector('h1').textContent).toBe('Home');
	});

	it('a setLocale still in flight at unmount never applies after a remount', async () => {
		let release;
		const gate = new Promise((r) => (release = r));
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES }, { gates: { 'locales/es.BBBB.json': gate } });
		const { app, el } = make();
		await app.mount();
		const switched = app.i18n.setLocale('es');
		app.unmount();
		await within(app.mount(), 'remount');
		const runs = dataRuns;
		release();
		await switched.catch(() => {});
		await settle();
		expect(document.documentElement.lang).toBe('en');
		expect(formatLocale).toBe('en');
		expect(app.i18n.locale).toBe('en');
		expect(localStorage.getItem('__puzzleLocale')).not.toBe('es');
		expect(el.querySelector('h1').textContent).toBe('Home');
		expect(dataRuns).toBe(runs);
	});

	it('an app without translations has no i18n on ctx or app', async () => {
		const el = document.createElement('div');
		document.body.appendChild(el);
		class Plain extends PuzzleView {
			render() {
				return h('puzzle-view', {}, [text('plain')]);
			}
		}
		const app = new PuzzleApp({ target: el, routes: [{ path: '/', view: Plain }] });
		apps.push(app);
		await app.mount();
		expect(el.textContent).toBe('plain');
		expect(app.i18n ?? null).toBe(null);
		expect('i18n' in (app.ctx ?? {})).toBe(false);
	});
});

// D177 — the SPA under locale prefix routing: the URL picks the locale, the
// router reads and writes under its prefix, link()/router.url() take options,
// setLocale is a page load, mount() redirects a first visit, and hash/memory
// routing is refused.
describe('PuzzleApp + locale prefix routing (D177)', () => {
	const ROUTED = { ...MANIFEST, routing: 'prefix' };
	const STORE_KEY = '__puzzleLocale';

	// `location` with assign/replace spied: everything else reads the real one,
	// so the router still sees replaceState/pushState.
	function spyLocation() {
		const calls = { assign: vi.fn(), replace: vi.fn() };
		const real = window.location;
		// A plain target: Location's own assign/replace are non-configurable, so a
		// proxy over it may not report anything else for them.
		vi.stubGlobal('location', new Proxy({}, { get: (_, k) => (k in calls ? calls[k] : real[k]) }));
		return calls;
	}
	const setReferrer = (value) => Object.defineProperty(document, 'referrer', { value, configurable: true });
	const setLanguages = (value) => Object.defineProperty(navigator, 'languages', { value, configurable: true });

	afterEach(() => {
		delete document.referrer;
		delete navigator.languages;
	});

	it('the URL locale beats the stored choice; the router reads under the prefix', async () => {
		localStorage.setItem(STORE_KEY, 'en');
		const fetch = stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		history.replaceState({}, '', '/shop/es/about');
		const { app, el } = make({ routerBase: '/shop', __i18n: { manifest: ROUTED, locale: 'en' } });
		await app.mount();
		expect(app.i18n.locale).toBe('es');
		expect(app.router.current.path).toBe('/about');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		expect(document.documentElement.lang).toBe('es');
		// Locale files stay on the bare routerBase, never under the prefix.
		expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/shop/locales/es.BBBB.json']);
	});

	it('an unprefixed URL is the default locale, whatever was stored', async () => {
		localStorage.setItem(STORE_KEY, 'es');
		setReferrer(location.origin + '/es/'); // same-origin: no first-visit redirect
		stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		history.replaceState({}, '', '/about');
		const { app, el } = make({ __i18n: { manifest: ROUTED } });
		await app.mount();
		expect(app.i18n.locale).toBe('en');
		expect(el.querySelector('h1').textContent).toBe('About');
	});

	it('push writes under the prefix; link() and router.url() carry it and take options', async () => {
		stubFetch({ 'locales/es.BBBB.json': ES });
		history.replaceState({}, '', '/es/about');
		const { app } = make({ __i18n: { manifest: ROUTED } });
		await app.mount();
		await app.router.push('/?q=1');
		expect(location.pathname + location.search).toBe('/es/?q=1');
		expect(app.router.current.path).toBe('/?q=1');
		const link = app.formatters.getAll().link;
		expect(link('/about')).toBe('/es/about');
		expect(link('/about', { locale: 'en' })).toBe('/about');
		expect(link('/files/cv.pdf', { locale: false })).toBe('/files/cv.pdf');
		expect(app.router.url('/about', { locale: 'en' })).toBe('/about');
		expect(app.i18n.locales.map((entry) => entry.href)).toEqual(['/?q=1', '/es/?q=1']);
	});

	it('setLocale stores the choice and loads the same page under the other prefix', async () => {
		const fetch = stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
		history.replaceState({}, '', '/es/about?x=1#team');
		const { app, el } = make({ __i18n: { manifest: ROUTED } });
		await app.mount();
		const loc = spyLocation();
		await app.i18n.setLocale('en');
		expect(loc.assign).toHaveBeenCalledWith(location.origin + '/about?x=1#team');
		expect(localStorage.getItem(STORE_KEY)).toBe('en');
		// No fetch and no in-place rebuild: the page load does the switch.
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(app.i18n.locale).toBe('es');
		expect(el.querySelector('h1').textContent).toBe('Acerca de');
		// The active locale again navigates nowhere, and is still remembered.
		await app.i18n.setLocale('es');
		expect(loc.assign).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem(STORE_KEY)).toBe('es');
	});

	it('setLocale in beforeMount navigates from the URL, before navigation #0', async () => {
		stubFetch({ 'locales/es.BBBB.json': ES });
		history.replaceState({}, '', '/es/about?x=1');
		const loc = spyLocation();
		const { app } = make({
			__i18n: { manifest: ROUTED },
			beforeMount: (a) => a.i18n.setLocale('en'),
		});
		await app.mount();
		expect(loc.assign).toHaveBeenCalledWith(location.origin + '/about?x=1');
	});

	// setLocale from a guard or data() (D175) runs while the address bar still
	// shows the page being left: it must reload the page being navigated TO.
	describe('setLocale during a navigation', () => {
		class Switching extends PuzzleView {
			data() {
				this.ctx.i18n.setLocale('es');
				return {};
			}
			render() {
				return h('puzzle-view', {}, [text('switching')]);
			}
		}
		const switchGuard = (app) => () => {
			app.i18n.setLocale('es');
			return true;
		};

		function boot(extraRoutes, url = '/about') {
			stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
			history.replaceState({}, '', url);
			const navigate = vi.fn();
			const holder = {};
			const { app, el } = make({
				routes: [...routes(), ...extraRoutes(holder)],
				__i18n: { manifest: ROUTED, navigate },
			});
			holder.app = app;
			return { app, el, navigate };
		}

		it('from a guard: the pushed page, query and fragment included', async () => {
			const { app, navigate } = boot((h) => [{ path: '/account', view: About, guard: () => switchGuard(h.app)() }]);
			await app.mount();
			await app.router.push('/account?tab=2#plan');
			expect(navigate).toHaveBeenCalledExactlyOnceWith('/es/account?tab=2#plan');
		});

		it('from data(): the pushed page, and the replaced one', async () => {
			const { app, navigate } = boot(() => [{ path: '/account', view: Switching }]);
			await app.mount();
			await app.router.push('/account?x=1');
			expect(navigate).toHaveBeenLastCalledWith('/es/account?x=1');
			await app.router.push('/');
			await app.router.replace('/account?y=2');
			expect(navigate).toHaveBeenLastCalledWith('/es/account?y=2');
		});

		it('from a superseded navigation: the page that superseded it', async () => {
			let releaseSlow;
			const slowGate = new Promise((r) => (releaseSlow = r));
			let releaseNext;
			const nextGate = new Promise((r) => (releaseNext = r));
			class Slow extends PuzzleView {
				async data() {
					await slowGate;
					this.ctx.i18n.setLocale('es');
					return {};
				}
				render() {
					return h('puzzle-view', {}, [text('slow')]);
				}
			}
			class Next extends PuzzleView {
				async data() {
					await nextGate;
					return {};
				}
				render() {
					return h('puzzle-view', {}, [text('next')]);
				}
			}
			const { app, navigate } = boot(() => [
				{ path: '/slow', view: Slow },
				{ path: '/next', view: Next },
			]);
			await app.mount();
			const slow = app.router.push('/slow');
			const next = app.router.push('/next?n=1');
			releaseSlow();
			await slow;
			expect(navigate).toHaveBeenCalledExactlyOnceWith('/es/next?n=1');
			releaseNext();
			await next;
		});

		it('after a blocked navigation: the committed page again', async () => {
			const { app, navigate } = boot(() => [{ path: '/account', view: About, guard: () => false }]);
			await app.mount();
			await app.router.push('/account');
			expect(app.router.current.path).toBe('/about');
			await app.i18n.setLocale('es');
			expect(navigate).toHaveBeenCalledExactlyOnceWith('/es/about');
		});

		it('on navigation #0: the page being loaded', async () => {
			const { app, navigate } = boot(
				(h) => [{ path: '/account', view: About, guard: () => switchGuard(h.app)() }],
				'/account?x=1#top'
			);
			await app.mount();
			expect(navigate).toHaveBeenCalledExactlyOnceWith('/es/account?x=1#top');
		});
	});

	// The shared decision table (tests/fixtures/locale-redirect-cases.js), which
	// the prerendered pages' inline script runs too, plus `detect: false`.
	describe('first-visit redirect', () => {
		const ORIGIN = 'http://localhost:3000'; // jsdom's test origin; asserted below
		it.each([
			...REDIRECT_CASES,
			{ name: 'detect: false', url: '/about', languages: ['es'], detect: false, expected: null },
		])('$name', async ({ url, routerBase, stored, languages, referrer, detect, expected }) => {
			expect(location.origin).toBe(ORIGIN);
			vi.spyOn(console, 'warn').mockImplementation(() => {}); // outside routerBase warns
			if (stored) localStorage.setItem(STORE_KEY, stored);
			setLanguages(languages);
			setReferrer(referrer === SAME_ORIGIN ? ORIGIN + '/es/' : (referrer ?? ''));
			history.replaceState({}, '', url);
			const fetch = stubFetch({ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES });
			const loc = spyLocation();
			const manifest = detect === false ? { ...REDIRECT_MANIFEST, detect } : REDIRECT_MANIFEST;
			const { app, el } = make({ routerBase, __i18n: { manifest } });
			const mounted = app.mount();
			if (expected) {
				expect(loc.replace).toHaveBeenCalledExactlyOnceWith(ORIGIN + expected);
				// Nothing boots behind the redirect, and mount() never settles.
				expect(await outcome(mounted)).toBe('pending');
				expect(app._mounted).toBe(false);
				expect(fetch).not.toHaveBeenCalled();
				expect(el.innerHTML).toBe('');
			} else {
				await mounted;
				expect(loc.replace).not.toHaveBeenCalled();
				expect(app._mounted).toBe(true);
			}
		});

		// The decision runs synchronously inside mount(), so one macrotask is
		// enough for a settled promise to have reported.
		const outcome = (p) =>
			Promise.race([
				p.then(
					() => 'resolved',
					() => 'rejected'
				),
				new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
			]);

		it('a redirect leaves mount() pending, so code after `await app.mount()` never runs', async () => {
			setLanguages(['es']);
			history.replaceState({}, '', '/about');
			stubFetch({});
			const loc = spyLocation();
			const { app } = make({ __i18n: { manifest: ROUTED } });
			let after = false;
			const boot = (async () => {
				await app.mount();
				after = true;
				app.router.push('/'); // would throw: nothing was wired
			})();
			expect(await outcome(boot)).toBe('pending');
			expect(after).toBe(false);
			expect(loc.replace).toHaveBeenCalledTimes(1);
			expect(app.router).toBe(null);
			// A second mount() shares the same pending promise rather than booting.
			expect(await outcome(app.mount())).toBe('pending');
			expect(loc.replace).toHaveBeenCalledTimes(1);
		});

		it('a prerendered page skips it: its inline script already decided', async () => {
			setLanguages(['es']);
			history.replaceState({}, '', '/about');
			stubFetch({ 'locales/en.AAAA.json': EN });
			const loc = spyLocation();
			const { app, el } = make({ __i18n: { manifest: ROUTED } });
			el.setAttribute('data-puzzle-ssg', '');
			await app.mount();
			expect(loc.replace).not.toHaveBeenCalled();
			expect(app.i18n.locale).toBe('en');
			expect(el.querySelector('h1').textContent).toBe('About');
		});
	});

	it('hash and memory routing are refused at mount', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN });
		for (const routerMode of [hashRouter(), memoryRouter()]) {
			const { app, el } = make({ routerMode, __i18n: { manifest: ROUTED } });
			await expect(app.mount()).rejects.toThrow(/i18n\.routing: 'prefix' needs path routing/);
			expect(el.innerHTML).toBe('');
		}
	});

	it('a route on a locale prefix is refused at mount', async () => {
		stubFetch({ 'locales/en.AAAA.json': EN });
		const { app } = make({
			routes: [...routes(), { path: '/es/promo', view: About }],
			__i18n: { manifest: ROUTED },
		});
		await expect(app.mount()).rejects.toThrow(/route "\/es\/promo" collides with the locale prefix "es"/);
	});
});

describe('/testing with i18n', () => {
	it('mountView renders a translated view from { locale, strings } with no fetch', async () => {
		const fetch = stubFetch({});
		constructed = [];
		const view = await mountView(Home, { i18n: { locale: 'es', strings: ES } });
		expect(view.find('h1').textContent).toBe('Inicio');
		expect(view.ctx.i18n.locale).toBe('es');
		expect(fetch).not.toHaveBeenCalled();
		view.destroy();
	});

	it('createTestApp wires the real app service from { locale, strings }', async () => {
		const fetch = stubFetch({});
		const app = await createTestApp({ routes: routes(), i18n: { locale: 'en', strings: EN } });
		expect(app.find('header').textContent).toBe('Shop');
		expect(app.ctx.i18n.t('greeting', { name: 'Bo' })).toBe('Hello, Bo!');
		expect(fetch).not.toHaveBeenCalled();
		app.destroy();
	});
});

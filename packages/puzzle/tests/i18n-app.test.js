// @vitest-environment jsdom
// D175 — PuzzleApp wiring: the strings load before navigation #0, ctx.i18n and
// app.i18n, the service-bound `t` formatter, and setLocale's same-location
// rebuild through the router (keep = 0, replace mode, no animation, scroll or
// focus change).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { memoryRouter } from '../client-runtime/router/modes.js';
import { createTestApp, mountView } from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

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
		// Through the formatter map, exactly as a compiled `{ 'layout.brand' | t }`.
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
		expect(app.i18n.locales).toEqual(['en', 'es']);
		expect(app.i18n.defaultLocale).toBe('en');
		expect(typeof app.formatters.getAll().t).toBe('function');
		expect(fetch.mock.calls[0][0]).toBe('/shop/locales/en.AAAA.json');
		app.unmount();
		expect(app.i18n).toBe(null);
	});

	it('hash and memory modes resolve manifest paths against the document', async () => {
		const fetch = stubFetch({ 'locales/en.AAAA.json': EN });
		const { app } = make({ routerMode: memoryRouter() });
		await app.mount();
		expect(fetch.mock.calls[0][0]).toBe(new URL('locales/en.AAAA.json', document.baseURI).href);
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

	it('overlapping switches are last-wins and rebuild once', async () => {
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
		expect(constructed.filter((c) => c === 'home')).toHaveLength(1);
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

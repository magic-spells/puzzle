// @vitest-environment jsdom
//
// D177 end to end: locale prefix routing in a REAL build, hybrid and plain SPA.
// `npm run build:locale-prefix` (pretest) builds tests/fixtures/locale-prefix-hybrid
// and its SPA twin tests/fixtures/locale-prefix-spa with the compiler. Each test
// loads the HTML file a host would serve for a URL into jsdom, runs the page's
// inline first-visit redirect script the way the browser would (in the head,
// before the app), then imports the built dist/app.js — which mounts itself —
// with fetch reading the built locale files.
//
// How the two redirects coexist: the prerendered default-locale pages carry the
// inline script, which decides in the head; the app's own runtime redirect runs
// only on a page that was not prerendered (its container has no
// `data-puzzle-ssg`), so a hybrid page never redirects twice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HYBRID = path.join(FIXTURES, 'locale-prefix-hybrid/dist');
const SPA = path.join(FIXTURES, 'locale-prefix-spa/dist');
const INLINE_RE = /<script>(\(function\([\s\S]*?)<\/script>/;

let runs = 0;
let apps = [];
let loc;
let fetch;

function memoryStorage() {
	const map = new Map();
	return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

// `location` with assign/replace spied; every other read goes to the real one,
// so the router still sees pushState/replaceState.
function spyLocation() {
	const calls = { assign: vi.fn(), replace: vi.fn() };
	const real = window.location;
	vi.stubGlobal('location', new Proxy({}, { get: (_, k) => (k in calls ? calls[k] : real[k]) }));
	return calls;
}

// fetch served from the build's dist folder.
function serveDist(dist) {
	return vi.fn(async (url) => {
		const file = path.join(dist, new URL(url, location.origin).pathname);
		if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
		const body = fs.readFileSync(file, 'utf8');
		return { ok: true, status: 200, json: async () => JSON.parse(body) };
	});
}

/**
 * Open `url` the way a browser would when the host serves `file` for it: the
 * document is that file, its inline redirect script runs first, then the app
 * module boots. Returns the app (its mount() promise is the app's own).
 */
async function open(dist, file, url, { referrer = '', languages, stored } = {}) {
	history.replaceState({}, '', url);
	const html = fs.readFileSync(path.join(dist, file), 'utf8');
	const doc = new DOMParser().parseFromString(html, 'text/html');
	document.documentElement.lang = doc.documentElement.lang;
	document.head.innerHTML = doc.head.innerHTML;
	document.body.innerHTML = doc.body.innerHTML;
	Object.defineProperty(document, 'referrer', { value: referrer, configurable: true });
	if (languages) Object.defineProperty(navigator, 'languages', { value: languages, configurable: true });
	if (stored) localStorage.setItem('__puzzleLocale', stored);
	fetch = serveDist(dist);
	vi.stubGlobal('fetch', fetch);
	loc = spyLocation();
	const inline = INLINE_RE.exec(html);
	if (inline) new Function('window', inline[1])({ location, document, localStorage, navigator });
	const { default: app } = await import(pathToFileURL(path.join(dist, 'app.js')).href + '?run=' + ++runs);
	apps.push(app);
	return app;
}

const hrefs = (selector) => [...document.querySelectorAll(selector)].map((a) => a.getAttribute('href'));

// mount() decides the redirect synchronously, so one macrotask is enough for a
// settled promise to have reported.
const outcome = (p) =>
	Promise.race([
		p.then(
			() => 'resolved',
			() => 'rejected'
		),
		new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
	]);

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
	for (const app of apps.splice(0)) app.unmount();
	vi.unstubAllGlobals();
	delete document.referrer;
	delete navigator.languages;
	history.replaceState({}, '', '/');
});

describe('hybrid output under prefix routing (D177)', () => {
	it('/es/about takes over the Spanish page from its island: no fetch, same links', async () => {
		const html = fs.readFileSync(path.join(HYBRID, 'es/about/index.html'), 'utf8');
		expect(html).toContain('data-puzzle-locale="es"');
		expect(INLINE_RE.test(html)).toBe(false); // prefixed pages carry no redirect
		const app = await open(HYBRID, 'es/about/index.html', '/es/about');
		const prerendered = hrefs('#app a');
		expect(prerendered).toEqual(['/es/about', '/cv.pdf', '/about', '/es/about', '/pt-BR/about']);
		await app.mount();
		expect(fetch).not.toHaveBeenCalled();
		expect(app.i18n.locale).toBe('es');
		expect(app.router.current.path).toBe('/about');
		const el = document.querySelector('#app');
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
		expect(el.querySelectorAll('h1')).toHaveLength(1);
		expect(el.querySelector('h1').textContent).toBe('Bienvenido');
		expect(hrefs('#app a')).toEqual(prerendered);
		expect(app.i18n.locales.map((entry) => entry.href)).toEqual(['/about', '/es/about', '/pt-BR/about']);
		expect(loc.replace).not.toHaveBeenCalled();
		// The app runs under the prefix from here on.
		await app.router.push('/product/3?x=1');
		expect(location.pathname + location.search).toBe('/es/product/3?x=1');
		expect(el.querySelector('h1').textContent).toBe('Producto 3');
	});

	it('the SPA fallback: /es/product/1 on the default shell fetches Spanish and renders the route', async () => {
		// A dynamic route is not prerendered, so the host serves the root page —
		// English markup, English island, and the inline redirect script.
		const html = fs.readFileSync(path.join(HYBRID, 'index.html'), 'utf8');
		expect(html).toContain('data-puzzle-locale="en"');
		expect(INLINE_RE.test(html)).toBe(true);
		const app = await open(HYBRID, 'index.html', '/es/product/1', {
			referrer: 'https://search.example/',
			languages: ['pt-BR'],
		});
		await app.mount();
		// The script saw the prefix and stood down; so did the app.
		expect(loc.replace).not.toHaveBeenCalled();
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			expect.stringMatching(/^\/locales\/es\.[A-Z0-9]{8}\.json$/),
		]);
		expect(app.i18n.locale).toBe('es');
		expect(app.router.current.path).toBe('/product/1');
		expect(document.documentElement.lang).toBe('es');
		expect(document.querySelector('#app h1').textContent).toBe('Producto 1');
		expect(hrefs('#app a')).toEqual(['/es/about']);
	});

	it('an unprefixed first visit redirects once, by the inline script; the app does not redirect again', async () => {
		const app = await open(HYBRID, 'about/index.html', '/about?x=1', {
			referrer: 'https://search.example/',
			stored: 'es',
		});
		expect(loc.replace).toHaveBeenCalledExactlyOnceWith('/es/about?x=1');
		// The module still runs while the browser fetches the Spanish page: it takes
		// over the English one and leaves the redirect alone.
		await app.mount();
		expect(loc.replace).toHaveBeenCalledTimes(1);
		expect(app.i18n.locale).toBe('en');
	});

	it('a same-origin visit to an unprefixed page stays put', async () => {
		const app = await open(HYBRID, 'about/index.html', '/about', {
			referrer: 'http://localhost:3000/es/about',
			stored: 'es',
		});
		await app.mount();
		expect(loc.replace).not.toHaveBeenCalled();
		expect(document.querySelector('#app h1').textContent).toBe('Welcome');
	});
});

// examples/i18n as built by `npm run build:i18n` (its last build is --hybrid):
// the layout's language switcher must follow a client-side navigation, or a
// ctrl-click, a new tab or a copied link lands on the page the app started on.
describe('examples/i18n language switcher (D177)', () => {
	const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../examples/i18n/dist');
	const switcher = () => document.querySelector('#app nav[aria-label]');

	it('re-points every link at the new page after a client navigation', async () => {
		const app = await open(EXAMPLE, 'es/index.html', '/es/');
		await app.mount();
		expect(hrefs('#app nav[aria-label] a')).toEqual(['/', '/es/', '/pl/']);
		const nav = [...document.querySelectorAll('#app header nav:not([aria-label]) a')];
		const about = nav.find((a) => a.getAttribute('href') === '/es/about');
		about.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
		for (let i = 0; i < 200 && app.router.current.path !== '/about'; i++) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		expect(location.pathname).toBe('/es/about');
		expect(hrefs('#app nav[aria-label] a')).toEqual(['/about', '/es/about', '/pl/about']);
		const current = switcher().querySelector('[aria-current]');
		expect(current.getAttribute('href')).toBe('/es/about');
		expect(switcher().querySelectorAll('[aria-current]')).toHaveLength(1);
	});
});

describe('plain SPA under prefix routing (D177)', () => {
	it('/es/about on the index.html shell boots in Spanish under the prefix', async () => {
		const app = await open(SPA, 'index.html', '/es/about');
		await app.mount();
		expect(fetch.mock.calls.map(([url]) => url)).toEqual([
			expect.stringMatching(/^\/locales\/es\.[A-Z0-9]{8}\.json$/),
		]);
		expect(app.router.current.path).toBe('/about');
		expect(document.documentElement.lang).toBe('es');
		expect(document.querySelector('#app h1').textContent).toBe('Bienvenido');
		expect(hrefs('#app a')).toEqual(['/es/about', '/cv.pdf', '/about', '/es/about', '/pt-BR/about']);
		await app.router.push('/product/7');
		expect(location.pathname).toBe('/es/product/7');
		expect(document.querySelector('#app h1').textContent).toBe('Producto 7');
	});

	it('an unprefixed first visit redirects at mount, and mount() never settles', async () => {
		const app = await open(SPA, 'index.html', '/about?q=1#top', {
			referrer: 'https://search.example/',
			languages: ['es-MX', 'en'],
		});
		expect(loc.replace).toHaveBeenCalledExactlyOnceWith(location.origin + '/es/about?q=1#top');
		expect(await outcome(app.mount())).toBe('pending');
		expect(fetch).not.toHaveBeenCalled();
		expect(document.querySelector('#app').innerHTML).toBe('');
	});

	it('setLocale stores the choice and loads the same page under the new prefix', async () => {
		const app = await open(SPA, 'index.html', '/es/about?tab=2');
		await app.mount();
		await app.i18n.setLocale('pt-BR');
		expect(loc.assign).toHaveBeenCalledExactlyOnceWith(location.origin + '/pt-BR/about?tab=2');
		expect(localStorage.getItem('__puzzleLocale')).toBe('pt-BR');
		await app.i18n.setLocale('en');
		expect(loc.assign).toHaveBeenLastCalledWith(location.origin + '/about?tab=2');
	});
});

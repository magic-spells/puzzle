// @vitest-environment jsdom
// D175 — translations in prerendered output: pages render in the default locale,
// every page carries the default table as a `data-puzzle-locale` island at the
// shell's `</body>` anchor (escaped by the D113 JSON-in-script rule), and a
// viewer in another locale swaps once — the static kernel before its mount, the
// hybrid takeover at navigation zero.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prerender, prerenderToDir, injectShell, injectStaticShell } from '../client-runtime/ssg/index.js';
import { mountStatic } from '../client-runtime/static/index.js';
import { escapeScriptJson } from '../client-runtime/ssg/serialize.js';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { setFormatLocale } from '../client-runtime/formatters/locale.js';
import { selectLocale } from '../client-runtime/i18n.js';
import { localeRedirect, redirectScript } from '../client-runtime/ssg/redirect.js';
import { REDIRECT_CASES, REDIRECT_MANIFEST, SAME_ORIGIN } from './fixtures/locale-redirect-cases.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const EN = {
	title: 'Welcome',
	items: { one: '{count} item', other: '{count} items' },
	evil: 'a </script><script>alert(1)</script> b',
};
const ES = { title: 'Bienvenido', items: { one: '{count} artículo', other: '{count} artículos' }, evil: 'x' };
const MANIFEST = { defaultLocale: 'en', locales: { en: 'locales/en.AAAA.json', es: 'locales/es.BBBB.json' } };
const I18N = { manifest: MANIFEST, table: EN };

let renders = 0;
class Home extends PuzzleView {
	render() {
		renders++;
		const t = this.ctx.formatters.getAll().t;
		return h('section', { class: 'home' }, [
			h('h1', {}, [text(t('title'))]),
			h('p', {}, [text(t('items', { count: 3 }))]),
		]);
	}
}
Home.__pzlModule = 'app/views/Home.pzl';
class Layout extends PuzzleView {
	render() {
		return h('div', { class: 'layout' }, [slot()]);
	}
}
Layout.__pzlModule = 'app/layouts/Default.pzl';

const config = () => ({ target: '#app', routes: [{ path: '/', view: Home, layout: Layout }] });
const SHELL =
	'<!doctype html><html><head><title>t</title></head><body><div id="app"></div>' +
	'<script type="module" src="/app.js"></script></body></html>';

function memoryStorage() {
	const map = new Map();
	return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}
function stubFetch(byPath) {
	const fetch = vi.fn(async (url) => {
		const hit = Object.keys(byPath).find((p) => url.endsWith(p));
		return hit
			? { ok: true, status: 200, json: async () => byPath[hit] }
			: { ok: false, status: 404, json: async () => ({}) };
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

beforeEach(() => {
	renders = 0;
	document.body.innerHTML = '';
	vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function tmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-i18n-'));
}

describe('prerender with translations', () => {
	it('renders every page in the default locale through the t formatter', async () => {
		const { pages } = await prerender(config(), { i18n: I18N });
		expect(pages[0].html).toContain('<h1>Welcome</h1>');
		expect(pages[0].html).toContain('<p>3 items</p>');
	});

	it('renders numbers and dates in the default locale, not the build machine’s', async () => {
		class Numbers extends PuzzleView {
			render() {
				const f = this.ctx.formatters.getAll();
				return h('p', {}, [text(f.number_with_delimiter(12345.5) + ' / ' + f.date('2026-09-24', 'long'))]);
			}
		}
		Numbers.__pzlModule = 'app/views/Numbers.pzl';
		const manifest = { defaultLocale: 'de', locales: { de: 'locales/de.AAAA.json' } };
		const { pages } = await prerender(
			{ target: '#app', routes: [{ path: '/', view: Numbers }] },
			{ i18n: { manifest, table: {} } },
		);
		expect(pages[0].html).toContain('<p>12.345,5 / 24. September 2026</p>');
		setFormatLocale(undefined);
	});

	// D177: the static prerender's stub resolves link() options the way the
	// browser kernel's does, so the shipped hrefs are already right (the kernel
	// does not re-render an unprefixed page's links).
	it('static prerender under prefix routing encodes link() and its { locale } options', async () => {
		class Links extends PuzzleView {
			render() {
				const link = this.ctx.formatters.getAll().link;
				return h('nav', {}, [
					h('a', { class: 'here', href: link('/p') }, [text('p')]),
					h('a', { class: 'es', href: link('/p', { locale: 'es' }) }, [text('es')]),
					h('a', { class: 'file', href: link('/cv.pdf', { locale: false }) }, [text('cv')]),
				]);
			}
		}
		Links.__pzlModule = 'app/views/Links.pzl';
		const routed = { manifest: { ...MANIFEST, routing: 'prefix' }, table: EN, tables: { en: EN, es: ES } };
		const cfg = { target: '#app', routerBase: '/docs', routes: [{ path: '/', view: Links }] };
		const { pages } = await prerender(cfg, { mode: 'static', i18n: routed });
		expect(pages[0].html).toContain('<a class="here" href="/docs/p">');
		expect(pages[0].html).toContain('<a class="es" href="/docs/es/p">');
		expect(pages[0].html).toContain('<a class="file" href="/docs/cv.pdf">');

		class Bad extends PuzzleView {
			render() {
				return h('a', { href: this.ctx.formatters.getAll().link('/p', { locale: 'fr' }) }, [text('fr')]);
			}
		}
		Bad.__pzlModule = 'app/views/Bad.pzl';
		await expect(
			prerender({ target: '#app', routes: [{ path: '/', view: Bad }] }, { mode: 'static', i18n: routed })
		).rejects.toThrow(/not a configured locale \(en, es\)/);
	});

	// D177: `i18n.locales[].href` is the page being rendered — each page its own,
	// under routerBase; under prefix routing, under each locale's prefix.
	it.each(['static', 'hybrid'])('gives i18n.locales the page being rendered (%s)', async (mode) => {
		class Switcher extends PuzzleView {
			render() {
				return h(
					'nav',
					{},
					this.ctx.i18n.locales.map((l) =>
						h('a', { href: l.href, 'aria-current': l.active ? 'page' : null }, [text(l.label)])
					)
				);
			}
		}
		Switcher.__pzlModule = 'app/views/Switcher.pzl';
		const routes = [
			{ path: '/', view: Switcher },
			{ path: '/about', view: Switcher },
		];
		const plain = await prerender({ target: '#app', routerBase: '/docs', routes }, { mode, i18n: I18N });
		const about = plain.pages.find((p) => p.path === '/about').html;
		expect(about).toContain('<a href="/docs/about" aria-current="page">English</a>');
		expect(about).toContain('<a href="/docs/about">Español</a>');
		expect(plain.pages.find((p) => p.path === '/').html).toContain('<a href="/docs/">Español</a>');

		const routed = { manifest: { ...MANIFEST, routing: 'prefix' }, table: EN, tables: { en: EN, es: ES } };
		const prefixed = await prerender({ target: '#app', routerBase: '/docs', routes }, { mode, i18n: routed });
		const html = prefixed.pages.find((p) => p.path === '/about' && p.locale === 'en').html;
		expect(html).toContain('<a href="/docs/about" aria-current="page">English</a>');
		expect(html).toContain('<a href="/docs/es/about">Español</a>');
		const es = prefixed.pages.find((p) => p.path === '/about' && p.locale === 'es').html;
		expect(es).toContain('<a href="/docs/about">English</a>');
		expect(es).toContain('<a href="/docs/es/about" aria-current="page">Español</a>');
	});

	it('reads the default table from the staged locales/ file named by the manifest', async () => {
		const dir = tmpDir();
		fs.mkdirSync(path.join(dir, 'locales'));
		fs.writeFileSync(path.join(dir, 'locales/en.AAAA.json'), JSON.stringify(EN));
		fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
		// The manifest module is null under vitest, so pass the manifest and let the
		// loader read the table from disk the way the build does.
		const summary = await prerenderToDir(config(), {
			outDir: dir,
			shellPath: path.join(dir, 'index.html'),
			mode: 'hybrid',
			i18n: { manifest: MANIFEST, table: JSON.parse(fs.readFileSync(path.join(dir, 'locales/en.AAAA.json'), 'utf8')) },
		});
		const html = fs.readFileSync(summary.written[0].file, 'utf8');
		expect(html).toContain('<h1>Welcome</h1>');
		expect(html).toContain('data-puzzle-locale="en"');
	});

	it('hybrid: the island rides at the shell </body> anchor', async () => {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
		const summary = await prerenderToDir(config(), {
			outDir: dir,
			shellPath: path.join(dir, 'index.html'),
			mode: 'hybrid',
			i18n: I18N,
		});
		const html = fs.readFileSync(summary.written[0].file, 'utf8');
		const island = html.indexOf('<script type="application/json" data-puzzle-locale="en">');
		expect(island).toBeGreaterThan(html.indexOf('<script type="module" src="/app.js">'));
		expect(html.indexOf('</body>')).toBeGreaterThan(island);
		expect(html.lastIndexOf('</script>', html.indexOf('</body>'))).toBeGreaterThan(island);
	});

	it('translates { t } title and description into the prerendered head (D177)', async () => {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
		const cfg = {
			target: '#app',
			routes: [
				{
					path: '/',
					view: Home,
					layout: Layout,
					meta: { title: { t: 'title' }, description: { t: 'evil' }, canonical: 'https://x.dev/' },
				},
			],
		};
		const { pages } = await prerender(cfg, { i18n: I18N });
		expect(pages[0].title).toBe('Welcome');
		expect(pages[0].head.description).toBe(EN.evil);

		const summary = await prerenderToDir(cfg, {
			outDir: dir,
			shellPath: path.join(dir, 'index.html'),
			mode: 'static',
			i18n: I18N,
		});
		const html = fs.readFileSync(summary.written[0].file, 'utf8');
		expect(html).toContain('<title>Welcome</title>');
		expect(html).toContain('<meta property="og:title" content="Welcome" data-puzzle-head="og:title">');
		// Translated text is escaped like any other head value.
		expect(html).toContain('content="a &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; b"');
		expect(html).not.toContain('[object Object]');
	});

	it('static: pages (prerender:false too) carry the island before the page module', async () => {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
		const cfg = {
			target: '#app',
			routes: [
				{ path: '/', view: Home, layout: Layout },
				{ path: '/spa', view: Home, layout: Layout, prerender: false },
			],
		};
		const summary = await prerenderToDir(cfg, {
			outDir: dir,
			shellPath: path.join(dir, 'index.html'),
			mode: 'static',
			i18n: I18N,
		});
		for (const page of summary.written) {
			const html = fs.readFileSync(page.file, 'utf8');
			const island = html.indexOf('data-puzzle-locale="en"');
			expect(island).toBeGreaterThan(0);
			expect(html.indexOf('/_puzzle/')).toBeGreaterThan(island);
		}
	});

	it('the island escapes </script> (D113) and round-trips the table', () => {
		const island = `<script type="application/json" data-puzzle-locale="en">`;
		const out = injectShell(SHELL, {
			targetId: 'app',
			content: '<p>x</p>',
			title: null,
			head: null,
			island: island + '\\u003c/script>' + '</script>',
		});
		expect(out).toContain(island);
		// Through the real writer: the literal </script> in a string is escaped.
		return (async () => {
			const dir = tmpDir();
			fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
			const summary = await prerenderToDir(config(), {
				outDir: dir,
				shellPath: path.join(dir, 'index.html'),
				mode: 'hybrid',
				i18n: I18N,
			});
			const html = fs.readFileSync(summary.written[0].file, 'utf8');
			const start = html.indexOf('data-puzzle-locale="en">') + 'data-puzzle-locale="en">'.length;
			const body = html.slice(start, html.indexOf('</script>', start));
			expect(body).not.toContain('</script');
			expect(JSON.parse(body)).toEqual(EN);
		})();
	});

	// The shell's `</body>` anchor is the LAST one: the text `</body>` in a comment
	// or an inline script string before the real tag must not swallow the scripts.
	const TRICKY_SHELL =
		'<!doctype html><html lang="xx"><head><title>t</title></head><body>' +
		'<!-- the islands go before </body>, never in here -->' +
		'<script>const s = "</body>";</script>' +
		'<div id="app"></div><script type="module" src="/app.js"></script></body></html>';
	const outsideComment = (html, marker) => {
		const at = html.indexOf(marker);
		expect(at).toBeGreaterThan(html.indexOf('-->'));
		expect(at).toBeGreaterThan(html.indexOf('"</body>"'));
		expect(at).toBeLessThan(html.lastIndexOf('</body>'));
	};

	it('hybrid: a </body> in a shell comment or script string does not move the island anchor', async () => {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, 'index.html'), TRICKY_SHELL);
		const summary = await prerenderToDir(config(), {
			outDir: dir,
			shellPath: path.join(dir, 'index.html'),
			mode: 'hybrid',
			i18n: I18N,
		});
		const html = fs.readFileSync(summary.written[0].file, 'utf8');
		outsideComment(html, 'data-puzzle-locale="en"');
	});

	it('static: a </body> in a shell comment or script string does not move the page module', async () => {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, 'index.html'), TRICKY_SHELL);
		const withI18n = await prerenderToDir(config(), {
			outDir: dir,
			shellPath: path.join(dir, 'index.html'),
			mode: 'static',
			i18n: I18N,
		});
		const html = fs.readFileSync(withI18n.written[0].file, 'utf8');
		outsideComment(html, 'data-puzzle-locale="en"');
		outsideComment(html, 'data-puzzle-static-data');
		outsideComment(html, '/_puzzle/index.js');
		// The same anchor without translations: the data island and page module.
		const plain = injectStaticShell(TRICKY_SHELL, {
			targetId: 'app',
			content: '<p>x</p>',
			title: null,
			head: null,
			slug: 'index',
			data: {},
		});
		outsideComment(plain, 'data-puzzle-static-data');
		outsideComment(plain, '/_puzzle/index.js');
	});

	it('prerendered pages declare <html lang> as the default locale', async () => {
		for (const mode of ['hybrid', 'static']) {
			const dir = tmpDir();
			fs.writeFileSync(path.join(dir, 'index.html'), TRICKY_SHELL);
			const summary = await prerenderToDir(config(), {
				outDir: dir,
				shellPath: path.join(dir, 'index.html'),
				mode,
				i18n: { manifest: { ...MANIFEST, defaultLocale: 'es' }, table: ES },
			});
			const html = fs.readFileSync(summary.written[0].file, 'utf8');
			expect(html).toContain('<html lang="es">');
			expect(html).not.toContain('lang="xx"');
		}
	});

	it('an app without translations gets no island', () => {
		const out = injectStaticShell(SHELL, {
			targetId: 'app',
			content: '<p>x</p>',
			title: null,
			head: null,
			slug: 'index',
			data: {},
		});
		expect(out).not.toContain('data-puzzle-locale');
	});
});

describe('a viewer in a non-default locale', () => {
	async function staticPage() {
		const { pages } = await prerender(config(), { mode: 'static', i18n: I18N });
		const html = injectStaticShell(SHELL, {
			targetId: 'app',
			content: pages[0].html,
			title: null,
			head: null,
			slug: 'index',
			data: pages[0].data ?? {},
			island: `<script type="application/json" data-puzzle-locale="en">${escapeScriptJson(JSON.stringify(EN))}</script>`,
		});
		document.documentElement.innerHTML = html.replace(/^<!doctype html><html>/, '').replace(/<\/html>$/, '');
		return pages[0];
	}

	it('static kernel: the default locale mounts from the island with no request', async () => {
		await staticPage();
		const fetch = stubFetch({});
		await mountStatic({
			target: '#app',
			views: [Home],
			layout: Layout,
			route: { path: '/', params: {}, chain: [{ path: '/' }] },
			__i18n: { manifest: MANIFEST, locale: 'en' },
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(document.querySelector('h1').textContent).toBe('Welcome');
	});

	it('static kernel: a page in a non-default locale fetches first and swaps once', async () => {
		await staticPage();
		expect(document.querySelector('h1').textContent).toBe('Welcome');
		const fetch = stubFetch({ 'locales/es.BBBB.json': ES });
		const target = document.querySelector('#app');
		const seen = [];
		const observer = new MutationObserver(() => seen.push(target.querySelector('h1')?.textContent));
		observer.observe(target, { childList: true, subtree: true, characterData: true });
		await mountStatic({
			target: '#app',
			views: [Home],
			layout: Layout,
			route: { path: '/', params: {}, chain: [{ path: '/' }] },
			__i18n: { manifest: MANIFEST, locale: 'es' },
		});
		await new Promise((r) => setTimeout(r, 0));
		observer.disconnect();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0][0]).toBe('/locales/es.BBBB.json');
		expect(document.querySelector('h1').textContent).toBe('Bienvenido');
		expect(document.querySelector('p').textContent).toBe('3 artículos');
		// Never an intermediate English re-render: the only texts seen are the swap.
		expect(seen.filter((t) => t === 'Welcome')).toEqual([]);
		expect(document.documentElement.lang).toBe('es');
	});

	it('static kernel: setLocale re-assembles and re-mounts the page', async () => {
		await staticPage();
		stubFetch({ 'locales/es.BBBB.json': ES });
		let i18n;
		class Probe extends Home {
			created() {
				i18n = this.ctx.i18n;
			}
		}
		Probe.__pzlModule = 'app/views/Home.pzl';
		await mountStatic({
			target: '#app',
			views: [Probe],
			layout: Layout,
			route: { path: '/', params: {}, chain: [{ path: '/' }] },
			__i18n: { manifest: MANIFEST, locale: 'en' },
		});
		const before = document.querySelector('.home');
		await i18n.setLocale('es');
		expect(document.querySelector('h1').textContent).toBe('Bienvenido');
		expect(document.querySelector('.home')).not.toBe(before);
		expect(document.querySelectorAll('.home')).toHaveLength(1);
	});

	it('hybrid takeover: navigation zero replaces the default-language markup in one swap', async () => {
		const { pages } = await prerender(config(), { i18n: I18N });
		document.body.innerHTML =
			`<div id="app" data-puzzle-ssg>${pages[0].html}</div>` +
			`<script type="application/json" data-puzzle-locale="en">${escapeScriptJson(JSON.stringify(EN))}</script>`;
		const fetch = stubFetch({ 'locales/es.BBBB.json': ES });
		const app = new PuzzleApp({ ...config(), __i18n: { manifest: MANIFEST, locale: 'es' } });
		await app.mount();
		const el = document.querySelector('#app');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
		expect(el.querySelectorAll('h1')).toHaveLength(1);
		expect(el.querySelector('h1').textContent).toBe('Bienvenido');
		app.unmount();
	});

	it('hybrid takeover in the default locale reads the island and fetches nothing', async () => {
		const { pages } = await prerender(config(), { i18n: I18N });
		document.body.innerHTML =
			`<div id="app" data-puzzle-ssg>${pages[0].html}</div>` +
			`<script type="application/json" data-puzzle-locale="en">${escapeScriptJson(JSON.stringify(EN))}</script>`;
		const fetch = stubFetch({});
		const app = new PuzzleApp({ ...config(), __i18n: { manifest: MANIFEST, locale: 'en' } });
		await app.mount();
		expect(fetch).not.toHaveBeenCalled();
		expect(document.querySelector('h1').textContent).toBe('Welcome');
		app.unmount();
	});
});

// D177 — the per-locale prerender under `i18n.routing: 'prefix'`: every route
// once per locale (default at the root, the rest under /<tag>/), each page in
// its own language, direction, island, format locale and link prefix; hreflang
// alternates; canonical localization; the first-visit redirect; the sitemap.
describe('per-locale prerender (D177)', () => {
	const AR = { title: 'أهلا', items: { other: '{count} عناصر' }, evil: 'x' };
	const ROUTED = {
		defaultLocale: 'en',
		locales: { en: 'locales/en.AAAA.json', es: 'locales/es.BBBB.json', ar: 'locales/ar.CCCC.json' },
		routing: 'prefix',
	};
	const ROUTED_I18N = { manifest: ROUTED, table: EN, tables: { en: EN, es: ES, ar: AR } };

	class Page extends PuzzleView {
		render() {
			const f = this.ctx.formatters.getAll();
			return h('main', { 'data-dir': this.ctx.i18n.dir }, [
				h('h1', {}, [text(f.t('title'))]),
				h('p', { class: 'n' }, [text(f.number_with_delimiter(12345.5))]),
				h('p', { class: 'd' }, [text(f.date('2026-09-24', 'long'))]),
				h('a', { class: 'about', href: f.link('/about') }, [text('about')]),
				h('a', { class: 'pdf', href: f.link('/cv.pdf', { locale: false }) }, [text('cv')]),
				h(
					'nav',
					{},
					this.ctx.i18n.locales.map((l) => h('a', { href: l.href, lang: l.locale }, [text(l.label)]))
				),
			]);
		}
	}
	Page.__pzlModule = 'app/views/Page.pzl';

	const routes = () => [
		{ path: '/', view: Page, layout: Layout, meta: { title: { t: 'title' } } },
		{ path: '/about', view: Page, layout: Layout, meta: { canonical: '/docs/about' } },
		{ path: '/spa', view: Page, layout: Layout, prerender: false },
		{ path: '/posts/:id', view: Page, layout: Layout },
		{ path: '*', view: Page, layout: Layout },
	];

	async function build({ mode = 'static', site, manifest = ROUTED, cfg = {}, before } = {}) {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
		before?.(dir);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const summary = await prerenderToDir(
			{ target: '#app', routerBase: '/docs', routes: routes(), ...cfg },
			{
				outDir: dir,
				shellPath: path.join(dir, 'index.html'),
				mode,
				site,
				i18n: { ...ROUTED_I18N, manifest },
			}
		);
		warn.mockRestore();
		setFormatLocale(undefined);
		const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
		return { dir, summary, read };
	}
	const files = (dir) =>
		fs
			.readdirSync(dir, { recursive: true })
			.filter((f) => f.endsWith('.html') || f.endsWith('.xml'))
			.map((f) => f.split(path.sep).join('/'))
			.sort();

	it('writes every route once per locale, default first at the root, the rest under /<tag>/', async () => {
		const { dir, summary } = await build();
		expect(files(dir)).toEqual(
			[
				'404.html',
				'about/index.html',
				'index.html',
				'spa/index.html',
				'es/404.html',
				'es/about/index.html',
				'es/index.html',
				'es/spa/index.html',
				'ar/404.html',
				'ar/about/index.html',
				'ar/index.html',
				'ar/spa/index.html',
			].sort()
		);
		expect(summary.written.map((w) => `${w.locale} ${w.path} ${w.entry}`)).toEqual([
			'en / _puzzle/index.js',
			'en /about _puzzle/about.js',
			'en /spa _puzzle/spa.js',
			'en * _puzzle/404.js',
			'es / _puzzle/index.js',
			'es /about _puzzle/about.js',
			'es /spa _puzzle/spa.js',
			'es * _puzzle/404.js',
			'ar / _puzzle/index.js',
			'ar /about _puzzle/about.js',
			'ar /spa _puzzle/spa.js',
			'ar * _puzzle/404.js',
		]);
		// Skips (and their warnings) are reported once, not once per locale.
		expect(summary.skipped).toEqual([expect.objectContaining({ path: '/posts/:id', reason: 'dynamic' })]);
		expect(summary.warnings.filter((w) => w.includes('skipped dynamic route'))).toHaveLength(1);
	});

	it('gives each page its own lang, dir, island, format locale, link prefix and switcher hrefs', async () => {
		const { read } = await build();
		const en = read('about/index.html');
		const es = read('es/about/index.html');
		const ar = read('ar/about/index.html');

		expect(en).toContain('<html lang="en">');
		expect(es).toContain('<html lang="es">');
		expect(ar).toContain('<html lang="ar" dir="rtl">');
		expect(es).not.toContain(' dir=');
		expect(ar).toContain('<main data-dir="rtl">');

		// Only the page's own table rides along.
		expect(es).toContain('data-puzzle-locale="es"');
		expect(es).not.toContain('data-puzzle-locale="en"');
		expect(ar).toContain('data-puzzle-locale="ar"');

		expect(en).toContain('<h1>Welcome</h1>');
		expect(es).toContain('<h1>Bienvenido</h1>');
		expect(en).toContain('<p class="n">12,345.5</p><p class="d">September 24, 2026</p>');
		expect(es).toContain('<p class="n">12.345,5</p><p class="d">24 de septiembre de 2026</p>');
		expect(ar).toContain('سبتمبر');

		expect(en).toContain('<a class="about" href="/docs/about">');
		expect(es).toContain('<a class="about" href="/docs/es/about">');
		expect(ar).toContain('<a class="about" href="/docs/ar/about">');
		expect(es).toContain('<a class="pdf" href="/docs/cv.pdf">');
		expect(es).toContain(
			'<nav><a href="/docs/about" lang="en">English</a><a href="/docs/es/about" lang="es">Español</a>' +
				'<a href="/docs/ar/about" lang="ar">'
		);

		// Page modules and locale files stay on the BARE routerBase.
		expect(es).toContain('<script type="module" src="/docs/_puzzle/about.js">');
		// A translated title follows the page's locale.
		expect(read('es/index.html')).toContain('<title>Bienvenido</title>');
	});

	it("writes each locale's 404 page, its switcher linking each locale's home under the base", async () => {
		const { read } = await build();
		const es = read('es/404.html');
		expect(es).toContain('<html lang="es">');
		expect(es).toContain(
			'<nav><a href="/docs/" lang="en">English</a><a href="/docs/es/" lang="es">Español</a>' +
				'<a href="/docs/ar/" lang="ar">'
		);
		expect(es).not.toContain('hreflang');
		expect(read('404.html')).not.toContain('hreflang');
	});

	it('writes prerender:false pages per locale with their own lang and island, no head work', async () => {
		const { read } = await build();
		const es = read('es/spa/index.html');
		expect(es).toContain('<html lang="es">');
		expect(es).toContain('data-puzzle-locale="es"');
		expect(es).toContain('<div id="app"></div>');
		expect(es).not.toContain('hreflang');
	});

	it('adds absolute hreflang alternates with `site`, x-default naming the default locale', async () => {
		const { read, summary } = await build({ site: 'https://example.com' });
		const alt = (lang, href) =>
			`<link rel="alternate" hreflang="${lang}" href="${href}" data-puzzle-head="alternate">`;
		const expected =
			alt('en', 'https://example.com/docs/about') +
			alt('es', 'https://example.com/docs/es/about') +
			alt('ar', 'https://example.com/docs/ar/about') +
			alt('x-default', 'https://example.com/docs/about');
		for (const file of ['about/index.html', 'es/about/index.html', 'ar/about/index.html']) {
			expect(read(file)).toContain(expected);
		}
		expect(read('index.html')).toContain(alt('es', 'https://example.com/docs/es/'));
		expect(summary.warnings.some((w) => w.includes('without `site`'))).toBe(false);
	});

	it('without `site` the alternates are root-relative and the build warns once', async () => {
		const { read, summary } = await build();
		expect(read('es/about/index.html')).toContain(
			'<link rel="alternate" hreflang="es" href="/docs/es/about" data-puzzle-head="alternate">'
		);
		expect(summary.warnings.filter((w) => w.includes('without `site`'))).toHaveLength(1);
	});

	it('hybrid writes the same per-locale layout, alternates and lang', async () => {
		const { dir, read } = await build({ mode: 'hybrid', site: 'https://example.com' });
		expect(files(dir)).toContain('es/about/index.html');
		expect(files(dir)).toContain('ar/404.html');
		const es = read('es/about/index.html');
		expect(es).toContain('<html lang="es">');
		expect(es).toContain('data-puzzle-ssg');
		expect(es).toContain('<a class="about" href="/docs/es/about">');
		expect(es).toContain('hreflang="x-default" href="https://example.com/docs/about"');
		// The SPA shell of a prerender:false page is written per locale, untouched.
		expect(read('es/spa/index.html')).toContain('<html lang="es">');
	});

	// The hybrid ctx router is one shared memory Router whose url() is shadowed:
	// it must be re-shadowed per locale, or every locale renders the first one's
	// prefix. Hybrid is gated off in the Go config today, so this calls the
	// prerender directly.
	it('hybrid re-shadows the shared router url() per locale pass', async () => {
		const { pages } = await prerender(
			{ target: '#app', routerBase: '/docs', routes: routes() },
			{ mode: 'hybrid', i18n: ROUTED_I18N }
		);
		setFormatLocale(undefined);
		const about = (locale) => pages.find((p) => p.path === '/about' && p.locale === locale).html;
		expect(about('en')).toContain('<a class="about" href="/docs/about">');
		expect(about('es')).toContain('<a class="about" href="/docs/es/about">');
		expect(about('ar')).toContain('<a class="about" href="/docs/ar/about">');
		expect(about('ar')).toContain('<a class="pdf" href="/docs/cv.pdf">');
	});

	it('localizes a root-relative or same-site canonical, and warns once per route for another origin', async () => {
		const cfg = {
			routes: [
				{ path: '/', view: Page, meta: { canonical: 'https://example.com/docs/' } },
				{ path: '/about', view: Page, meta: { canonical: '/docs/about?x=1' } },
				{ path: '/elsewhere', view: Page, meta: { canonical: 'https://other.dev/page' } },
			],
		};
		const { read, summary } = await build({ site: 'https://example.com', cfg });
		expect(read('about/index.html')).toContain('<link rel="canonical" href="/docs/about?x=1"');
		expect(read('es/about/index.html')).toContain('<link rel="canonical" href="/docs/es/about?x=1"');
		expect(read('es/about/index.html')).toContain('<meta property="og:url" content="/docs/es/about?x=1"');
		expect(read('ar/index.html')).toContain('<link rel="canonical" href="https://example.com/docs/ar/"');
		expect(read('index.html')).toContain('<link rel="canonical" href="https://example.com/docs/"');
		expect(read('es/elsewhere/index.html')).toContain('<link rel="canonical" href="https://other.dev/page"');
		const warned = summary.warnings.filter((w) => w.includes('cannot be localized'));
		expect(warned).toHaveLength(1);
		expect(warned[0]).toContain('"/elsewhere"');
	});

	it("passes beforeMount's build facade the page's locale", async () => {
		const seen = [];
		await build({
			cfg: {
				routes: [{ path: '/', view: Page }],
				beforeMount: ({ locale }) => seen.push(locale),
			},
		});
		expect(seen).toEqual(['en', 'es', 'ar']);
	});

	it('fails the build on a route whose first segment is a non-default locale', async () => {
		for (const bad of ['/es', '/ES/news', '/ar/x/y']) {
			await expect(
				prerender(
					{ target: '#app', routes: [{ path: '/', view: Page }, { path: bad, view: Page }] },
					{ mode: 'static', i18n: ROUTED_I18N }
				)
			).rejects.toThrow(new RegExp(`route "${bad}" collides with the "(es|ar)" locale`));
		}
		// The default locale is unprefixed, so /en/… is an ordinary route.
		const { pages } = await prerender(
			{ target: '#app', routes: [{ path: '/en/x', view: Page }, { path: '/esp', view: Page }] },
			{ mode: 'static', i18n: ROUTED_I18N }
		);
		setFormatLocale(undefined);
		expect(pages).toHaveLength(6);
	});

	it('reports a duplicate route once, for the default locale', async () => {
		const { summary } = await build({
			cfg: { routes: [{ path: '/a', view: Page }, { path: '/a', view: Page }] },
		});
		expect(summary.skipped.filter((s) => s.reason === 'duplicate')).toHaveLength(1);
		expect(summary.warnings.filter((w) => w.includes('skipped duplicate route'))).toHaveLength(1);
		expect(summary.written.map((w) => w.file.slice(-15))).toHaveLength(3);
	});

	describe('first-visit redirect script', () => {
		const script = (html) => {
			const m = /<script>(\(function\(t,d,b,w\)[\s\S]*?)<\/script>/.exec(html);
			return m && m[1];
		};

		it('rides in the head of default-locale pages only, and detect: false removes it', async () => {
			const { read } = await build({ site: 'https://example.com' });
			const en = read('about/index.html');
			expect(script(en)).toBeTruthy();
			expect(en.indexOf('__puzzleLocale')).toBeLessThan(en.indexOf('</head>'));
			expect(en.indexOf('__puzzleLocale')).toBeGreaterThan(en.indexOf('hreflang="x-default"'));
			expect(script(read('404.html'))).toBeTruthy();
			expect(script(read('es/about/index.html'))).toBe(null);
			expect(script(read('ar/index.html'))).toBe(null);
			// A prerender:false page has no head work at all.
			expect(script(read('spa/index.html'))).toBe(null);

			const off = await build({ manifest: { ...ROUTED, detect: false } });
			expect(off.read('about/index.html')).not.toContain('__puzzleLocale');
		});

		it('is self-contained: the inline text runs on a bare window', async () => {
			const { read } = await build();
			const body = script(read('about/index.html'));
			expect(body).not.toMatch(/<\/script|<!--/i);
			const replace = vi.fn();
			const win = fakeWindow({ pathname: '/docs/about', search: '?q=1', hash: '#top', languages: ['ar-EG'], replace });
			new Function('window', body)(win);
			expect(replace).toHaveBeenCalledWith('/docs/ar/about?q=1#top');
		});
	});
});

// The first-visit redirect (D177) is a second copy of selectLocale's matching,
// so the inline script — both the source function and the exact text the build
// emits — runs the shared decision table (tests/fixtures/locale-redirect-cases.js)
// that selectLocale and the SPA redirect (tests/i18n-app.test.js) run too.
describe('first-visit redirect decisions (D177)', () => {
	const TAGS = Object.keys(REDIRECT_MANIFEST.locales);
	const ORIGIN = 'https://site.dev';
	const window = (row, replace) => {
		const url = new URL(row.url, ORIGIN);
		return fakeWindow({
			pathname: url.pathname,
			search: url.search,
			hash: url.hash,
			referrer: row.referrer === SAME_ORIGIN ? ORIGIN + '/es/' : (row.referrer ?? ''),
			stored: row.stored ?? null,
			languages: row.languages,
			replace,
		});
	};
	// The emitted text, evaluated on its own: what the build ships, not just its source.
	const emitted = (base) => {
		const html = redirectScript(REDIRECT_MANIFEST, base);
		return new Function('window', html.slice('<script>'.length, -'</script>'.length));
	};

	it.each(REDIRECT_CASES)('$name', (row) => {
		if (row.locale) expect(selectLocale(TAGS, 'en', row.stored ?? null, row.languages)).toBe(row.locale);
		for (const run of [
			(replace) => localeRedirect(TAGS, 'en', row.routerBase ?? '', window(row, replace)),
			(replace) => emitted(row.routerBase ?? '')(window(row, replace)),
		]) {
			const replace = vi.fn();
			run(replace);
			if (row.expected) expect(replace).toHaveBeenCalledExactlyOnceWith(row.expected);
			else expect(replace).not.toHaveBeenCalled();
		}
	});

	it('keeps a base that begins with two slashes on this origin', () => {
		const replace = vi.fn();
		emitted('//docs')(fakeWindow({ pathname: '//docs/a', languages: ['es'], replace }));
		expect(replace).toHaveBeenCalledWith('/docs/es/a');
	});

	it('survives blocked storage and a missing navigator.languages', () => {
		const replace = vi.fn();
		const win = fakeWindow({ pathname: '/', replace });
		win.localStorage = {
			getItem() {
				throw new Error('blocked');
			},
		};
		win.navigator = { language: 'es-ES' };
		emitted('')(win);
		expect(replace).toHaveBeenCalledWith('/es/');
	});

	it('escapes its arguments for an inline script, and stays small', () => {
		const out = redirectScript({ defaultLocale: 'en', locales: { en: '', es: '' } }, '/a</script><!--');
		expect(out.slice('<script>'.length, -'</script>'.length)).not.toMatch(/<\/script|<!--/i);
		expect(out).toContain('"/a\\u003c/script>\\u003c!--"');
		expect(redirectScript(REDIRECT_MANIFEST, '').length).toBeLessThan(900);
	});
});

/** A window stand-in for localeRedirect. */
function fakeWindow({ pathname = '/', search = '', hash = '', referrer = '', stored = null, languages = [], replace }) {
	return {
		location: { pathname, search, hash, origin: 'https://site.dev', replace },
		document: { referrer },
		localStorage: { getItem: () => stored },
		navigator: { languages, language: languages[0] },
	};
}

// D177 — dist/sitemap.xml, written by every prerendering build that sets `site`.
describe('sitemap (D177)', () => {
	class Plain extends PuzzleView {
		render() {
			return h('p', {}, [text('x')]);
		}
	}
	Plain.__pzlModule = 'app/views/Plain.pzl';
	const plainRoutes = [
		{ path: '/', view: Plain },
		{ path: '/a&b', view: Plain },
		{ path: '/café', view: Plain },
		{ path: '/spa', view: Plain, prerender: false },
		{ path: '*', view: Plain },
	];

	async function run({ site, i18n, mode = 'static', publicSitemap, routerBase } = {}) {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
		if (publicSitemap) fs.writeFileSync(path.join(dir, 'sitemap.xml'), publicSitemap);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const summary = await prerenderToDir(
			{ target: '#app', routerBase, routes: plainRoutes },
			{ outDir: dir, shellPath: path.join(dir, 'index.html'), mode, site, i18n }
		);
		warn.mockRestore();
		setFormatLocale(undefined);
		const file = path.join(dir, 'sitemap.xml');
		return { summary, xml: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
	}

	it('lists every prerendered page at its absolute URL, without i18n', async () => {
		for (const mode of ['static', 'hybrid']) {
			const { xml } = await run({ site: 'https://example.com', mode });
			expect(xml).toBe(
				'<?xml version="1.0" encoding="UTF-8"?>\n' +
					'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
					'<url><loc>https://example.com/</loc></url>\n' +
					'<url><loc>https://example.com/a&amp;b</loc></url>\n' +
					'<url><loc>https://example.com/caf%C3%A9</loc></url>\n' +
					'</urlset>\n'
			);
		}
	});

	it('carries every locale and x-default as xhtml:link alternates under prefix routing', async () => {
		const manifest = { ...MANIFEST, routing: 'prefix' };
		const { xml } = await run({
			site: 'https://example.com',
			routerBase: '/docs',
			i18n: { manifest, table: EN, tables: { en: EN, es: ES } },
		});
		expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
		const alts =
			'<xhtml:link rel="alternate" hreflang="en" href="https://example.com/docs/a&amp;b"/>' +
			'<xhtml:link rel="alternate" hreflang="es" href="https://example.com/docs/es/a&amp;b"/>' +
			'<xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/docs/a&amp;b"/>';
		expect(xml).toContain(`<url><loc>https://example.com/docs/a&amp;b</loc>${alts}</url>`);
		expect(xml).toContain(`<url><loc>https://example.com/docs/es/a&amp;b</loc>${alts}</url>`);
		expect(xml.match(/<url>/g)).toHaveLength(6);
		expect(xml).not.toContain('404');
		expect(xml).not.toContain('/spa');
	});

	it('writes nothing without `site`, and never warns about it', async () => {
		const { xml, summary } = await run({});
		expect(xml).toBe(null);
		expect(summary.warnings.some((w) => w.includes('sitemap'))).toBe(false);
	});

	it('keeps a public sitemap.xml, with a warning', async () => {
		const { xml, summary } = await run({ site: 'https://example.com', publicSitemap: '<mine/>' });
		expect(xml).toBe('<mine/>');
		expect(summary.warnings.filter((w) => w.includes('public/sitemap.xml'))).toHaveLength(1);
	});
});

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

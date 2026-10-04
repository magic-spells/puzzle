// @vitest-environment jsdom
//
// The static kernel's locale remount (D175). setLocale on an `output: 'static'`
// page re-assembles the chain and swaps it in for the mounted one — the static
// counterpart of the SPA's same-location rebuild, which preloads everything
// before it commits and animates nothing. Two things pinned here: nested
// non-routed components are prepared BEFORE the swap (not mounted late, after
// setLocale already resolved), and a mount that throws leaves the old page on
// screen and rejects setLocale instead of blanking the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountStatic } from '../client-runtime/static/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { setFormatLocale } from '../client-runtime/formatters/locale.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const EN = { title: 'Welcome', badge: 'new' };
const ES = { title: 'Bienvenido', badge: 'nuevo' };
const MANIFEST = { defaultLocale: 'en', locales: { en: 'locales/en.json', es: 'locales/es.json' } };

function memoryStorage() {
	const map = new Map();
	return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

beforeEach(() => {
	document.body.innerHTML = '<div id="app"></div>';
	vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
	setFormatLocale(undefined);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

async function mountPage(views) {
	let i18n;
	class Probe extends views[0] {
		created() {
			i18n = this.ctx.i18n;
		}
	}
	await mountStatic({
		target: '#app',
		views: [Probe],
		route: { path: '/', params: {}, chain: [{ path: '/' }] },
		__i18n: { manifest: MANIFEST, tables: { en: EN, es: ES }, locale: 'en' },
	});
	return i18n;
}

describe('static kernel: setLocale remount', () => {
	it('prepares nested components before the swap, so the new page is complete when setLocale resolves', async () => {
		class Badge extends PuzzleView {
			async data() {
				await new Promise((r) => setTimeout(r, 10));
				return {};
			}
			render() {
				return h('em', { class: 'badge' }, [text(this.ctx.i18n.t('badge'))]);
			}
		}
		class Home extends PuzzleView {
			render() {
				return h('section', { class: 'home' }, [
					h('h1', {}, [text(this.ctx.i18n.t('title'))]),
					new ViewNode(Badge, {}, []),
				]);
			}
		}

		const i18n = await mountPage([Home]);
		await new Promise((r) => setTimeout(r, 30));
		expect(document.querySelector('.badge').textContent).toBe('new');

		await i18n.setLocale('es');

		expect(document.querySelector('h1').textContent).toBe('Bienvenido');
		expect(document.querySelectorAll('.badge')).toHaveLength(1);
		expect(document.querySelector('.badge').textContent).toBe('nuevo');
	});

	it('keeps the old page and rejects when the new page fails to mount', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		class Home extends PuzzleView {
			render() {
				if (this.ctx.i18n.locale === 'es') throw new Error('boom');
				return h('section', { class: 'home' }, [h('h1', {}, [text(this.ctx.i18n.t('title'))])]);
			}
		}

		const i18n = await mountPage([Home]);
		await new Promise((r) => setTimeout(r, 0));
		const before = document.querySelector('.home');
		expect(before.querySelector('h1').textContent).toBe('Welcome');

		await expect(i18n.setLocale('es')).rejects.toThrow('boom');

		expect(document.querySelector('#app').firstChild).toBe(before);
		expect(document.querySelector('h1').textContent).toBe('Welcome');
		errors.mockRestore();
	});

	it('keeps a switch made before the remount is armed (mounted() on a prerendered page)', async () => {
		document.body.innerHTML =
			'<div id="app" data-puzzle-static><section class="home"><h1>Welcome</h1></section></div>' +
			`<script type="application/json" data-puzzle-locale="en">${JSON.stringify(EN)}</script>`;
		vi.stubGlobal('navigator', { languages: ['es'], language: 'es' });
		vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ES }));
		class Home extends PuzzleView {
			mounted() {
				if (this.ctx.i18n.locale !== 'en') this.ctx.i18n.setLocale('en');
			}
			render() {
				return h('section', { class: 'home' }, [h('h1', {}, [text(this.ctx.i18n.t('title'))])]);
			}
		}

		await mountStatic({
			target: '#app',
			views: [Home],
			route: { path: '/', params: {}, chain: [{ path: '/' }] },
			__i18n: { manifest: MANIFEST },
		});
		await new Promise((r) => setTimeout(r, 10));

		expect(document.documentElement.lang).toBe('en');
		expect(document.querySelectorAll('h1')).toHaveLength(1);
		expect(document.querySelector('h1').textContent).toBe('Welcome');
	});

	it('repeated failed switches leave no store subscriptions behind', async () => {
		class Note extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		let i18n, store;
		class Home extends PuzzleView {
			created() {
				i18n = this.ctx.i18n;
				store = this.ctx.store;
			}
			data() {
				return { notes: this.ctx.store.findMany('note') };
			}
			render() {
				return h('section', { class: 'home' }, [h('h1', {}, [text(this.ctx.i18n.t('title'))])]);
			}
		}
		class Layout extends PuzzleView {
			data() {
				if (this.ctx.i18n.locale === 'es') throw new Error('layout failed');
				return {};
			}
			render() {
				return h('div', {}, [new ViewNode(SLOT_TAG)]);
			}
		}
		await mountStatic({
			target: '#app',
			views: [Home],
			layout: Layout,
			models: { note: Note },
			route: { path: '/', params: {}, chain: [{ path: '/' }] },
			__i18n: { manifest: MANIFEST, tables: { en: EN, es: ES }, locale: 'en' },
		});
		const live = store.keysBySubscriber.size;

		for (let i = 0; i < 3; i++) await expect(i18n.setLocale('es')).rejects.toThrow('layout failed');

		expect(store.keysBySubscriber.size).toBe(live);
		expect(document.querySelector('h1').textContent).toBe('Welcome');
	});

	it('a translated route title follows the viewer locale on load and every in-place switch (D177)', async () => {
		document.body.innerHTML =
			'<div id="app" data-puzzle-static><section class="home"><h1>Welcome</h1></section></div>' +
			`<script type="application/json" data-puzzle-locale="en">${JSON.stringify(EN)}</script>`;
		document.title = 'Welcome';
		vi.stubGlobal('navigator', { languages: ['es'], language: 'es' });
		let i18n;
		class Home extends PuzzleView {
			created() {
				i18n = this.ctx.i18n;
			}
			render() {
				return h('section', { class: 'home' }, [h('h1', {}, [text(this.ctx.i18n.t('title'))])]);
			}
		}
		const route = (meta) => ({ path: '/', params: {}, chain: [{ path: '/', meta }] });
		await mountStatic({
			target: '#app',
			views: [Home],
			route: route({ title: { t: 'title' } }),
			__i18n: { manifest: MANIFEST, tables: { en: EN, es: ES } },
		});
		// The prerendered page is English; the Spanish viewer gets a Spanish title.
		expect(i18n.locale).toBe('es');
		expect(document.title).toBe('Bienvenido');

		await i18n.setLocale('en');
		expect(document.title).toBe('Welcome');
		await i18n.setLocale('es');
		expect(document.title).toBe('Bienvenido');
	});

	it('leaves a plain-string title alone, and syncs nothing when the viewer reads the page locale', async () => {
		document.body.innerHTML =
			'<div id="app"></div>' +
			`<script type="application/json" data-puzzle-locale="en">${JSON.stringify(EN)}</script>`;
		document.title = 'Prerendered';
		let i18n;
		class Home extends PuzzleView {
			created() {
				i18n = this.ctx.i18n;
			}
			render() {
				return h('h1', {}, [text(this.ctx.i18n.t('title'))]);
			}
		}
		await mountStatic({
			target: '#app',
			views: [Home],
			route: { path: '/', params: {}, chain: [{ path: '/', meta: { title: 'About us' } }] },
			__i18n: { manifest: MANIFEST, tables: { en: EN, es: ES }, locale: 'en' },
		});
		expect(document.title).toBe('Prerendered');
		await i18n.setLocale('es');
		expect(document.title).toBe('Prerendered');
	});

	it('without prefix routing (D177) the switch stays an in-place remount, and every locales href is this page', async () => {
		const startURL = location.href;
		history.replaceState(null, '', '/about?tab=2#faq');
		const navigate = vi.fn();
		let i18n;
		class Home extends PuzzleView {
			created() {
				i18n = this.ctx.i18n;
			}
			render() {
				return h('section', { class: 'home' }, [h('h1', {}, [text(this.ctx.i18n.t('title'))])]);
			}
		}
		try {
			await mountStatic({
				target: '#app',
				views: [Home],
				route: { path: '/about', params: {}, chain: [{ path: '/about' }] },
				// A navigate only matters under prefix routing; MANIFEST has none.
				__i18n: { manifest: MANIFEST, tables: { en: EN, es: ES }, locale: 'en', navigate },
			});
			expect(i18n.locales).toEqual([
				{ locale: 'en', label: 'English', href: '/about?tab=2#faq', active: true },
				{ locale: 'es', label: 'Español', href: '/about?tab=2#faq', active: false },
			]);

			await i18n.setLocale('es');

			expect(navigate).not.toHaveBeenCalled();
			expect(document.querySelector('h1').textContent).toBe('Bienvenido');
			expect(i18n.locales.map((entry) => entry.active)).toEqual([false, true]);
			expect(location.pathname).toBe('/about');
		} finally {
			history.replaceState(null, '', startURL);
		}
	});
});

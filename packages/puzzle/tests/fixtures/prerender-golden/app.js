// The apps tests/locale-prerender-bytes.test.js prerenders to pin that the D177
// per-locale prerender leaves every build WITHOUT `i18n.routing` byte-identical:
// an i18n app (no routing) and an app with no i18n, in both output modes. The
// expected bytes in golden.json were produced by the pre-D177 prerenderer.
//
// A factory over the runtime classes, so the views share their runtime's
// PuzzleView/ViewNode.

export const SHELL =
	'<!doctype html><html lang="xx"><head><meta charset="utf-8"><title>Shell</title>' +
	'<link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div>' +
	'<script type="module" src="/app.js"></script></body></html>';

export const EN = { title: 'Welcome', items: { one: '{count} item', other: '{count} items' }, about: 'About us' };
export const ES = { title: 'Bienvenido', items: { one: '{count} artículo', other: '{count} artículos' }, about: 'Sobre nosotros' };
export const MANIFEST = { defaultLocale: 'en', locales: { en: 'locales/en.AAAA.json', es: 'locales/es.BBBB.json' } };

/**
 * @param {{ PuzzleView: any, ViewNode: any, SLOT_TAG: any }} runtime
 * @param {{ i18n: boolean }} options
 */
export function goldenConfig({ PuzzleView, ViewNode, SLOT_TAG }, { i18n }) {
	const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
	const text = (value) => new ViewNode('text', { value });

	class Page extends PuzzleView {
		render() {
			const f = this.ctx.formatters.getAll();
			const children = [
				h('a', { class: 'home', href: f.link('/') }, [text('home')]),
				h('a', { class: 'about', href: f.link('/about') }, [text('about')]),
				h('p', { class: 'n' }, [text(f.number_with_delimiter(12345.5))]),
			];
			if (this.ctx.i18n) {
				children.push(h('h1', {}, [text(f.t('title'))]));
				children.push(h('p', {}, [text(f.t('items', { count: 3 }))]));
				children.push(
					h(
						'nav',
						{},
						this.ctx.i18n.locales.map((l) => h('a', { href: l.href, lang: l.locale }, [text(l.label)]))
					)
				);
			}
			return h('main', {}, children);
		}
	}
	Page.__pzlModule = 'app/views/Page.pzl';
	class Layout extends PuzzleView {
		render() {
			return h('div', { class: 'layout' }, [new ViewNode(SLOT_TAG)]);
		}
	}
	Layout.__pzlModule = 'app/layouts/Default.pzl';

	return {
		target: '#app',
		routerBase: '/docs',
		routes: [
			{ path: '/', view: Page, layout: Layout, meta: { title: 'Home', description: 'The home page' } },
			{
				path: '/about',
				view: Page,
				layout: Layout,
				meta: {
					title: i18n ? { t: 'about' } : 'About',
					canonical: 'https://example.com/docs/about',
					socialImage: '/og.png',
				},
			},
			{ path: '/app', view: Page, layout: Layout, prerender: false },
			{ path: '/posts/:id', view: Page, layout: Layout },
			{ path: '*', view: Page, layout: Layout, meta: { title: 'Not found' } },
		],
	};
}

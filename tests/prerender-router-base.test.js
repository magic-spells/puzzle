// Prerender × router base/mode URL encoding (D51/D79).
//
// A prerendered page's hrefs must be byte-identical to the ones the live app
// renders: the `link` formatter is bound to the ctx router's url(), so a hybrid
// build under `routerBase: '/docs'` has to emit `/docs/about`, not `/about` —
// crawlers, no-JS visitors, and anyone clicking before SPA takeover only ever see
// the prerendered markup. Hybrid's ctx router is an unstarted MEMORY Router (it
// must keep real `current`/route-table semantics for the SPA takeover), and memory
// mode carries no URL, so its url() alone is shadowed with the app's real
// mode/base through the shared encodeURL — the same function Router.url() and the
// static router stub (ssg/assemble.js) call.
//
// Hash apps cannot reach hybrid at all (the history-only guard rejects them — a
// hash router boots at '/' and would render home over every page), so the hash
// encoding is asserted through static output and the encodeURL parity table below.
import { describe, it, expect } from 'vitest';
import { prerender } from '../client-runtime/ssg/index.js';
import { Router, encodeURL, normalizeBase } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

// Renders hrefs the way compiled render code does: through the formatter map, so
// the built-in `link` formatter (bound to router.url) is the thing under test.
class Nav extends PuzzleView {
	render() {
		const __f = this.ctx.formatters.getAll();
		return h('nav', {}, [
			h('a', { href: __f.link('/about') }, [text('About')]),
			h('a', { href: __f.link('https://example.com') }, [text('External')]),
		]);
	}
}
Nav.__pzlModule = 'app/views/Nav.pzl'; // static output requires the codegen stamp

// Reads the ctx router directly (a view may call router.url() itself) and records
// what the hybrid facade looks like beyond url().
class Direct extends PuzzleView {
	render() {
		const { router } = this.ctx;
		return h(
			'a',
			{
				href: router.url('/contact'),
				'data-current': String(router.current),
				'data-push': typeof router.push,
			},
			[text('Contact')]
		);
	}
}
Direct.__pzlModule = 'app/views/Direct.pzl';

const config = (extra = {}) => ({
	target: '#app',
	routes: [{ path: '/', name: 'home', view: Nav }],
	...extra,
});

const homeHtml = async (cfg, opts) => (await prerender(cfg, opts)).pages[0].html;

describe('hybrid prerender — routerBase (D51/D79)', () => {
	it("routerBase '/docs' prefixes every path-shaped link href", async () => {
		expect(await homeHtml(config({ routerBase: '/docs' }))).toContain('href="/docs/about"');
	});

	it('normalizes the base exactly like the Router does', async () => {
		const html = await homeHtml(config({ routerBase: 'docs/' }));
		expect(html).toContain(`href="${new Router([], { mode: 'history', base: 'docs/' }).url('/about')}"`);
		expect(html).toContain('href="/docs/about"');
	});

	it('a view calling router.url() directly gets the same prefix', async () => {
		const cfg = config({ routerBase: '/docs', routes: [{ path: '/', view: Direct }] });
		expect(await homeHtml(cfg)).toContain('href="/docs/contact"');
	});

	it('leaves non-path strings (external URLs) alone', async () => {
		expect(await homeHtml(config({ routerBase: '/docs' }))).toContain(
			'href="https://example.com"'
		);
	});

	it('a base containing "#" or "?" fails the build', async () => {
		await expect(prerender(config({ routerBase: '/docs?x' }))).rejects.toThrow(
			/base must not contain/
		);
	});
});

describe('hybrid prerender — default (no base, history) is unchanged', () => {
	it('emits root-absolute hrefs', async () => {
		expect(await homeHtml(config())).toContain('href="/about"');
	});

	it("an explicit routerMode 'history' encodes identically", async () => {
		expect(await homeHtml(config({ routerMode: 'history' }))).toContain('href="/about"');
	});

	it('keeps the real memory Router beyond url() (null current, navigable API)', async () => {
		const html = await homeHtml(config({ routes: [{ path: '/', view: Direct }] }));
		expect(html).toContain('data-current="null"'); // unstarted — the SPA fills it in
		expect(html).toContain('data-push="function"'); // a Router, not the throwing static stub
	});
});

describe('hash apps: rejected by hybrid, encoded by static output', () => {
	it('hybrid + hash is rejected before any page renders', async () => {
		await expect(prerender(config({ routerMode: 'hash' }))).rejects.toThrow(
			/hybrid prerender output requires history routing/
		);
	});

	it("static output of a hash app emits '#/'-prefixed hrefs", async () => {
		const html = await homeHtml(config({ routerMode: 'hash' }), { mode: 'static' });
		expect(html).toContain('href="#/about"');
	});

	it('static output of a based hash app carries the base ahead of the fragment', async () => {
		const cfg = config({ routerMode: 'hash', routerBase: '/docs' });
		expect(await homeHtml(cfg, { mode: 'static' })).toContain('href="#/docs/about"');
	});

	it('static output of a based history app prefixes the base', async () => {
		const cfg = config({ routerBase: '/docs' });
		expect(await homeHtml(cfg, { mode: 'static' })).toContain('href="/docs/about"');
	});
});

describe('encodeURL parity with Router.url()', () => {
	const paths = ['/', '/a', '/a/b', '/a?x=1', '/docs#faq', 'https://example.com', 'mailto:a@b.com', '#anchor', '#/x', ''];

	for (const mode of ['history', 'hash', 'memory']) {
		for (const base of ['', '/', '/app', 'app/']) {
			it(`agrees with Router.url() in ${mode} mode with base ${JSON.stringify(base)}`, () => {
				const router = new Router([], { mode, base });
				for (const path of paths) {
					expect(encodeURL(path, mode, normalizeBase(base))).toBe(router.url(path));
				}
			});
		}
	}

	it('throws on a non-string path exactly as Router.url() does', () => {
		const router = new Router([], { mode: 'history' });
		for (const bad of [5, null, undefined, {}, [], true, () => {}]) {
			expect(() => encodeURL(bad, 'history', '')).toThrow(/\[puzzle\]/);
			expect(() => router.url(bad)).toThrow(/\[puzzle\]/);
		}
	});
});

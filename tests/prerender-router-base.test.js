// Prerender × router base/mode URL encoding (D51/D79).
//
// A prerendered page's hrefs must be byte-identical to the ones the live app
// renders: the `link` formatter is bound to the ctx router's url(), so a hybrid
// build under `routerBase: '/docs'` has to emit `/docs/about`, not `/about` —
// crawlers, no-JS visitors, and anyone clicking before SPA takeover only ever see
// the prerendered markup. Hybrid's ctx router is an unstarted MEMORY Router (it
// must keep the real route table and navigable API for SPA takeover), with two
// instance shadows for prerender parity: current is the page snapshot, and url()
// uses the app's real mode/base through the shared encodeURL — the same function
// Router.url() and the static router stub (ssg/assemble.js) call.
//
// Hash apps cannot reach hybrid at all (the history-only guard rejects them — a
// hash router boots at '/' and would render home over every page). They CAN reach
// static output, but static output ignores `routerMode` entirely: a static page has
// no router and no click interception, so a prerendered `#/about` on a page living
// at /about/index.html would be a dead link (P2.1). Static therefore forces
// history-style hrefs on both sides — prerender and kernel — and warns; the hash
// encoding itself is asserted through the encodeURL parity table below.
import { describe, it, expect } from 'vitest';
import { prerender } from '../client-runtime/ssg/index.js';
import { Router, encodeURL, normalizeBase } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { hashRouter, memoryRouter } from '../client-runtime/router/modes.js';

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
				'data-current': router.current?.path ?? 'null',
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
		expect(html).toContain(`href="${new Router([], { base: 'docs/' }).url('/about')}"`);
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
		expect(await homeHtml(config({}))).toContain('href="/about"');
	});

	it('keeps the real memory Router beyond its snapshot current (navigable API)', async () => {
		const html = await homeHtml(config({ routes: [{ path: '/', view: Direct }] }));
		expect(html).toContain('data-current="/"');
		expect(html).toContain('data-push="function"'); // a Router, not the throwing static stub
	});
});

describe('hash apps: rejected by hybrid, flattened to history by static output (P2.1)', () => {
	it('hybrid + hash is rejected before any page renders', async () => {
		await expect(prerender(config({ routerMode: hashRouter() }))).rejects.toThrow(
			/hybrid prerender output requires history routing/
		);
	});

	it('hybrid + memory is rejected the same way', async () => {
		await expect(prerender(config({ routerMode: memoryRouter() }))).rejects.toThrow(
			/hybrid prerender output requires history routing/
		);
	});

	it('static output of a hash app emits PATH-shaped hrefs, never "#/"', async () => {
		const html = await homeHtml(config({ routerMode: hashRouter() }), { mode: 'static' });
		expect(html).toContain('href="/about"');
		expect(html).not.toContain('href="#/about"');
		expect(html).not.toContain('#/');
	});

	it('static output of a hash app warns that routerMode is ignored', async () => {
		const { warnings } = await prerender(config({ routerMode: hashRouter() }), { mode: 'static' });
		expect(warnings.some((w) => w.includes('ignores routerMode (hash routing)'))).toBe(true);
		expect(warnings.some((w) => w.includes('links are emitted history-style'))).toBe(true);
	});

	it("static output of a memory app is flattened + warned identically", async () => {
		const cfg = config({ routerMode: memoryRouter() });
		const { pages, warnings } = await prerender(cfg, { mode: 'static' });
		expect(pages[0].html).toContain('href="/about"');
		expect(warnings.some((w) => w.includes('ignores routerMode (memory routing)'))).toBe(true);
	});

	it('a leftover mode STRING is still named in the warning (mid-migration apps)', async () => {
		const { warnings } = await prerender(config({ routerMode: 'hash' }), { mode: 'static' });
		expect(warnings.some((w) => w.includes('ignores routerMode (the string "hash")'))).toBe(true);
	});

	it('static output of a based hash app keeps the base and stays path-shaped', async () => {
		const cfg = config({ routerMode: hashRouter(), routerBase: '/docs' });
		const html = await homeHtml(cfg, { mode: 'static' });
		expect(html).toContain('href="/docs/about"');
		expect(html).not.toContain('#/docs/about');
	});

	it('static output of a based history app prefixes the base', async () => {
		const cfg = config({ routerBase: '/docs' });
		expect(await homeHtml(cfg, { mode: 'static' })).toContain('href="/docs/about"');
	});

	it("static output with routerMode 'history' (or unset) warns about nothing new", async () => {
		for (const cfg of [config({}), config()]) {
			const { warnings } = await prerender(cfg, { mode: 'static' });
			expect(warnings.some((w) => w.includes('routerMode'))).toBe(false);
		}
	});

	it('a hash app renders the SAME href in static prerender and in the SPA it is not', async () => {
		// The regression in one line: the live hash SPA renders '#/about', the static
		// build renders '/about' — because a static page is a document, not an SPA.
		const cfg = config({ routerMode: hashRouter() });
		expect(new Router([], { mode: hashRouter() }).url('/about')).toBe('#/about');
		expect(await homeHtml(cfg, { mode: 'static' })).toContain('href="/about"');
	});
});

describe('encodeURL parity with Router.url()', () => {
	const paths = ['/', '/a', '/a/b', '/a?x=1', '/docs#faq', 'https://example.com', 'mailto:a@b.com', '#anchor', '#/x', ''];

	// encodeURL takes the same mode object the Router holds (null = history, D159),
	// so the prerender-side encoder and the live router can never drift.
	for (const [name, makeMode] of [
		['history', () => undefined],
		['hash', hashRouter],
		['memory', memoryRouter],
	]) {
		for (const base of ['', '/', '/app', 'app/']) {
			it(`agrees with Router.url() in ${name} mode with base ${JSON.stringify(base)}`, () => {
				const router = new Router([], { mode: makeMode(), base });
				// The Router instantiates its own mode instance; encodeURL needs one too.
				const descriptor = makeMode();
				const instance = descriptor ? descriptor.create() : null;
				for (const path of paths) {
					expect(encodeURL(path, instance, normalizeBase(base))).toBe(router.url(path));
				}
			});
		}
	}

	it('throws on a non-string path exactly as Router.url() does', () => {
		const router = new Router([]);
		for (const bad of [5, null, undefined, {}, [], true, () => {}]) {
			expect(() => encodeURL(bad, null, '')).toThrow(/\[puzzle\]/);
			expect(() => router.url(bad)).toThrow(/\[puzzle\]/);
		}
	});
});

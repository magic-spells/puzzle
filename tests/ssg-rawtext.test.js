// @vitest-environment jsdom
// SSG RAWTEXT serialization (D113) — prerendered `<script>`/`<style>` content must
// reach the page the way the HTML parser reads it back: RAWTEXT is never
// entity-decoded, so entity-escaping it ships `&amp;`/`&lt;` garbage to crawlers and
// dead CSS. Raw emission is guarded: JSON-typed scripts take the data-island escape,
// and content that would end (or refuse to end) the element is a build error.
//
// Node env: serialize is DOM-free. Hand-written ViewNode trees stand in for compiler
// output (same convention as ssg-serialize.test.js); the shape mirrors what
// compiler/cmd/pzlc emits for a nested script/style element — ONE text vnode child
// whose value concatenates the literal text and any interpolations.
import { describe, it, expect } from 'vitest';
import { serialize, escapeScriptJson } from '../client-runtime/ssg/serialize.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { mount, patch } from '../client-runtime/views/viewManager.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

/** The content between an element's open and close tags (attrs never contain `>`). */
const inner = (html, tag) => html.slice(html.indexOf('>') + 1, html.lastIndexOf(`</${tag}>`));

const count = (s, re) => (s.match(re) || []).length;

describe('SSG RAWTEXT elements (D113)', () => {
	describe('{#raw} text round-trip (D150)', () => {
		const value = {
			compare: 'a < b',
			breakout: '</script><script>alert(1)</script>',
			ampersand: 'bright & clear',
		};
		const json = JSON.stringify(value);

		for (const [tag, attrs] of [
			['div', {}],
			['script', { type: 'application/json' }],
		]) {
			it(`JSON containing < round-trips through client and prerendered <${tag}> textContent`, async () => {
				const prerendered = await serialize(h(tag, attrs, [text(json)]));
				const parsedHost = document.createElement('div');
				parsedHost.innerHTML = prerendered;
				const parsed = parsedHost.firstElementChild;
				expect(JSON.parse(parsed.textContent)).toEqual(value);

				const clientHost = document.createElement('div');
				mount(h(tag, attrs, [text(json)]), clientHost, null, {});
				expect(JSON.parse(clientHost.firstElementChild.textContent)).toEqual(value);
			});
		}

		it('keeps a raw @event-shaped attribute literal in both paths', async () => {
			const tree = h('button', { '@@click': '{ handler }' }, [text('x')]);
			expect(await serialize(tree)).toBe('<button @click="{ handler }">x</button>');

			const host = document.createElement('div');
			const oldTree = h('button', { '@@click': '{ handler }' }, [text('x')]);
			mount(oldTree, host, null, {});
			expect(host.firstElementChild.getAttribute('@click')).toBe('{ handler }');

			const updatedTree = h('button', { '@@click': '{ next }' }, [text('x')]);
			patch(oldTree, updatedTree, host, {});
			expect(host.firstElementChild.getAttribute('@click')).toBe('{ next }');

			patch(updatedTree, h('button', {}, [text('x')]), host, {});
			expect(host.firstElementChild.hasAttribute('@click')).toBe(false);
		});
	});

	describe('JSON-typed scripts', () => {
		const payload = {
			'@context': 'https://schema.org',
			'@type': 'Article',
			headline: 'Tom & "Jerry" <b>bold</b>',
			about: 'a > b',
		};

		it('emits JSON-LD with no HTML entities and a \\u003c for every <', async () => {
			const json = JSON.stringify(payload);
			const html = await serialize(h('script', { type: 'application/ld+json' }, [text(json)]));
			const body = inner(html, 'script');
			expect(body).not.toMatch(/&amp;|&lt;|&gt;|&quot;|&#39;/);
			expect(body).not.toContain('<');
			expect(count(json, /</g)).toBeGreaterThan(0);
			expect(count(body, /\\u003c/g)).toBe(count(json, /</g));
			expect(JSON.parse(body)).toEqual(payload);
		});

		it('escapes application/json and any +json subtype, trimmed and case-insensitively', async () => {
			for (const type of ['application/json', ' Application/LD+JSON ', 'application/geo+json']) {
				const html = await serialize(h('script', { type }, [text('{"a":"<b>"}')]));
				expect(inner(html, 'script')).toBe('{"a":"\\u003cb>"}');
			}
		});

		it('neutralizes a </script> breakout inside a JSON value, round-tripping the string', async () => {
			const attack = { body: '</script><script>alert(1)</script>' };
			const html = await serialize(
				h('script', { type: 'application/ld+json' }, [text(JSON.stringify(attack))])
			);
			const body = inner(html, 'script');
			expect(body).not.toMatch(/<\/script/i);
			expect(count(html, /<\/script>/gi)).toBe(1); // only the real closer
			expect(JSON.parse(body)).toEqual(attack);
		});

		it('exports the escape rule the static data island shares', async () => {
			expect(escapeScriptJson('a < b </script>')).toBe('a \\u003c b \\u003c/script>');
		});
	});

	describe('plain scripts', () => {
		it('emits JavaScript byte-raw', async () => {
			const src = 'if (a < b && c > d) { go("x & y"); }';
			expect(await serialize(h('script', {}, [text(src)]))).toBe(`<script>${src}</script>`);
		});

		it('concatenates multiple text children raw', async () => {
			const tree = h('script', {}, [text('var a = 1 < 2;'), text(' var b = 3 > 2;')]);
			expect(await serialize(tree)).toBe('<script>var a = 1 < 2; var b = 3 > 2;</script>');
		});

		it('throws on a </script> that would end the element, naming the remedy', async () => {
			const tree = h('script', {}, [text('var s = "</script>";')]);
			await expect(serialize(tree)).rejects.toThrow(/\[puzzle\] prerender: <script> content/);
			await expect(serialize(tree)).rejects.toThrow(/application\/ld\+json/);
		});

		it('throws case-insensitively and on an unclosed end tag', async () => {
			await expect(serialize(h('script', {}, [text('x = "</ScRiPt >"')]))).rejects.toThrow(
				/\[puzzle\] prerender: <script> content/
			);
			await expect(serialize(h('script', {}, [text('x = "</script bogus')]))).rejects.toThrow(
				/\[puzzle\] prerender: <script> content/
			);
		});

		it('throws when content holds both <!-- and <script> (double-escaped state)', async () => {
			const tree = h('script', {}, [text('/* <!-- */ var tpl = "<script>";')]);
			await expect(serialize(tree)).rejects.toThrow(/script-data-double-escaped/);
		});

		it('allows <!-- with no <script> after it', async () => {
			const src = 'var legacy = 1; <!-- vintage guard';
			expect(await serialize(h('script', {}, [text(src)]))).toBe(`<script>${src}</script>`);
		});
	});

	describe('style', () => {
		it('emits CSS byte-raw, keeping combinators alive', async () => {
			const css = '.a > .b { color: red } /* a & b */ .c[data-x="1"] { content: "<" }';
			expect(await serialize(h('style', {}, [text(css)]))).toBe(`<style>${css}</style>`);
		});

		it('throws on a </style> that would end the element', async () => {
			const tree = h('style', {}, [text('a::after { content: "</style>" }')]);
			await expect(serialize(tree)).rejects.toThrow(/\[puzzle\] prerender: <style> content/);
			await expect(serialize(h('style', {}, [text('x { a: "</StYlE>" }')]))).rejects.toThrow(
				/\[puzzle\] prerender: <style> content/
			);
		});
	});

	describe('the rest of the tree is unaffected', () => {
		it('still entity-escapes ordinary element text', async () => {
			expect(await serialize(h('div', {}, [text('a < b & c > d')]))).toBe(
				'<div>a &lt; b &amp; c &gt; d</div>'
			);
		});

		it('serializes a nested script alongside escaped siblings, keeping its attrs', async () => {
			const tree = h('div', { class: 'page' }, [
				h('h1', {}, [text('A & B')]),
				h('script', { type: 'application/ld+json' }, [text('{"n":"a<b"}')]),
				h('style', { media: 'print' }, [text('.a > .b { color: red }')]),
				h('p', {}, [text('c > d')]),
			]);
			expect(await serialize(tree)).toBe(
				'<div class="page"><h1>A &amp; B</h1>' +
					'<script type="application/ld+json">{"n":"a\\u003cb"}</script>' +
					'<style media="print">.a > .b { color: red }</style>' +
					'<p>c &gt; d</p></div>'
			);
		});
	});
});

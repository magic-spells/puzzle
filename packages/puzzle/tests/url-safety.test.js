// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Links from './fixtures/url-safety/Links.compiled.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { prerender } from '../client-runtime/ssg/index.js';

let view;
afterEach(() => {
	view?.destroy();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

const unsafe = [
	'javascript:run()', 'JaVaScRiPt:run()', '\tjavascript:run()',
	'java\nscript:run()', '\u0001 \rjava\tscript:run()', 'vbscript:run()',
	'jav&#97;script&colon;run()', '&#x6a;avascript:run()',
	'java&NewLine;script:run()', 'java&#10script:run()',
	'javascript&#58run()', '\u0000javascript:run()',
	'\ufeffjavascript:run()', '\u007fjavascript:run()',
	'data:text/html,<script>run()</script>',
];

function tree(url, candidates = '/safe.png 1x') {
	view = new Links();
	view.setData({ url, candidates });
	return view.render();
}

describe('dynamic URL bindings (D186)', () => {
	it.each(unsafe)('blocks %j in browser and serialized HTML', async (url) => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		tree(url);
		const container = document.createElement('div');
		document.body.append(container);
		await view.mount(container);
		for (const [selector, attr] of [
			['.dynamic', 'href'], ['.mixed', 'href'], ['img', 'src'],
			['form', 'action'], ['button', 'formaction'], ['iframe', 'src'],
			['object', 'data'], ['svg a', 'xlink:href'],
		]) expect(container.querySelector(selector).hasAttribute(attr)).toBe(selector === 'img' && url.startsWith('data:'));
		expect(container.querySelector('p').getAttribute('title')).toBe(url);
		expect(container.querySelector('.static').getAttribute('href')).toBe('javascript:author()');
		const html = await serialize(view.render());
		expect(html).toContain('<a class="dynamic">');
		expect(html).toContain('<a class="mixed">');
		expect(html).toContain('<iframe></iframe>');
		expect(html).toContain('<object></object>');
		expect(warn.mock.calls.some(([message]) => /blocked.*URL/i.test(message))).toBe(true);
	});

	it('blocks a mixed-case unsafe candidate and retains image data URLs only for images', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const url = 'data:image/png;base64,AAAA';
		const html = await serialize(tree(url, '/safe.png 1x, JaVaScRiPt:run() 2x'));
		expect(html).toContain(`<img src="${url}">`);
		expect(html).toContain('<a class="dynamic">');
		expect(html).toContain('<iframe></iframe>');
		expect(html).toContain('<object></object>');
	});

	it('retains SVG data in image src without allowing it in a document or link', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const url = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E';
		const html = await serialize(tree(url));
		expect(html).toContain(`src="${url}"`);
		expect(html).toContain('<a class="dynamic">');
		expect(html).toContain('<iframe></iframe>');
	});

	it.each([
		'/safe.png 1x, \u0001javascript:run() 2x',
		'/safe.png 1x, java\nscript:run() 2x',
		'/safe.png 1x, jav&#97;script&colon;run() 2x',
	])('drops an unsafe candidate list %j in browser and prerender', async (candidates) => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		tree('/safe', candidates);
		const container = document.createElement('div');
		await view.mount(container);
		expect(container.querySelector('img').hasAttribute('srcset')).toBe(false);
		expect(await serialize(view.render())).not.toContain('srcset=');
	});

	it('keeps the attribute omission and token-list rules', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		for (const value of [null, undefined, false, {}]) {
			const html = await serialize(tree(value));
			expect(html).toContain('<a class="dynamic">');
			view.destroy();
		}
		expect(await serialize(tree(['/safe', false, null]))).toContain('href="/safe"');
		view.destroy();
		expect(await serialize(tree(['javascript:run()']))).toContain('<a class="dynamic">');
	});

	it.each(['/docs?a=1&b=2', 'https://example.test', 'mailto:a@example.test', '#part', '//example.test'])('preserves safe URL %j', async (url) => {
		const html = await serialize(tree(url));
		expect(html).toContain(`href="${url.replaceAll('&', '&amp;')}"`);
	});

	it('removes a URL on safe-to-unsafe patch, then restores a safe URL', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		tree('/safe');
		const container = document.createElement('div');
		await view.mount(container);
		view.setData({ url: 'javascript:run()' });
		view.flushUpdates();
		expect(container.querySelector('.dynamic').hasAttribute('href')).toBe(false);
		view.setData({ url: '/again' });
		view.flushUpdates();
		expect(container.querySelector('.dynamic').getAttribute('href')).toBe('/again');
	});

	it('applies the guard in the prerender route pipeline', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		class Page extends Links {
			data() { return { url: 'java\nscript:run()', candidates: '/safe.png' }; }
		}
		const result = await prerender({ target: '#app', routes: [{ path: '/', view: Page }] });
		expect(result.pages[0].html).toContain('<a class="dynamic">');
		expect(result.pages[0].html).toContain('<form>');
	});

	it('guards SVG animation values per `;` entry and to/from/by whatever attributeName says', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		view = new Links();
		view.setData({ url: 'javascript:run()', candidates: '', frames: '/a; JaVa\tScRiPt:run()' });
		let html = await serialize(view.render());
		expect(html).not.toMatch(/<set[^>]* to=/);
		expect(html).not.toMatch(/<animate[^>]* values=/);
		view.setData({ url: '/next', frames: '/a; /b' });
		html = await serialize(view.render());
		expect(html).toMatch(/<set[^>]* to="\/next"/);
		expect(html).toMatch(/<animate[^>]* values="\/a; \/b"/);
	});
});

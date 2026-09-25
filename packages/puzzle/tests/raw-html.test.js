// @vitest-environment jsdom
//
// The live-HTML node (D174 group e): what a text interpolation ending in `raw`
// or `newline_to_br` renders as. The first block drives the ViewManager with
// hand-built vnodes to pin the node's DOM contract — mount, replace on change,
// nothing on an unchanged value, clean removal, and a correct position as an
// indexed or keyed sibling. The second mounts the real compiler output
// (tests/fixtures/raw-html, built by the build:raw-html pretest script), with the
// node inside {#if} branches and D170 list-block rows. The last block proves the
// static/hybrid prerender emits the same sanitized markup and that hybrid
// takeover mounts over it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { prerender } from '../client-runtime/ssg/index.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { FormatterRegistry } from '../client-runtime/formatters.js';
import { memoryRouter } from '../client-runtime/router/modes.js';
import { HTML_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import RawHost from './fixtures/raw-html/RawHost.compiled.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const html = (value) => new ViewNode(HTML_TAG, { value });
const brText = (value) => new ViewNode(HTML_TAG, { value, br: true });

// The markup a container shows, without the position comments.
const markup = (el) => el.innerHTML.replace(/<!--.*?-->/g, '');

function container() {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}

const apps = [];
let mounted = null;

afterEach(() => {
	mounted?.destroy();
	mounted = null;
	while (apps.length) apps.pop().unmount();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('live-HTML node — ViewManager contract', () => {
	it('mounts sanitized markup in position between text siblings', () => {
		const el = container();
		new ViewManager(el).render(
			h('div', {}, [text('a '), html('<b>bold</b><img src=x onerror="alert(1)"><script>alert(2)</script>'), text(' c')])
		);
		expect(markup(el)).toBe('<div>a <b>bold</b><img src="x"> c</div>');
		expect(el.querySelector('img').hasAttribute('onerror')).toBe(false);
		expect(el.querySelector('script')).toBe(null);
	});

	it('replaces its nodes when the value changes and touches nothing when it does not', () => {
		const el = container();
		const vm = new ViewManager(el);
		vm.render(h('div', {}, [text('a'), html('<b>one</b>'), text('c')]));
		const b = el.querySelector('b');

		vm.render(h('div', {}, [text('a'), html('<b>one</b>'), text('c')]));
		expect(el.querySelector('b')).toBe(b); // unchanged value: same node

		vm.render(h('div', {}, [text('a'), html('<i>two</i> and more'), text('c')]));
		expect(markup(el)).toBe('<div>a<i>two</i> and morec</div>');
		expect(b.isConnected).toBe(false);

		vm.render(h('div', {}, [text('a'), html(''), text('c')]));
		expect(markup(el)).toBe('<div>ac</div>');

		vm.render(h('div', {}, [text('a'), html('<em>back</em>'), text('c')]));
		expect(markup(el)).toBe('<div>a<em>back</em>c</div>');
	});

	it('switches between raw and newline_to_br on the same position', () => {
		const el = container();
		const vm = new ViewManager(el);
		vm.render(h('p', {}, [brText('one\n<b>two</b>')]));
		expect(markup(el)).toBe('<p>one<br>&lt;b&gt;two&lt;/b&gt;</p>');
		vm.render(h('p', {}, [html('one\n<b>two</b>')]));
		expect(markup(el)).toBe('<p>one\n<b>two</b></p>');
	});

	it('removes every node it owns when it leaves, and keeps its siblings in order when it arrives', () => {
		const el = container();
		const vm = new ViewManager(el);
		vm.render(h('div', {}, [text('a'), html('<b>x</b><i>y</i>'), text('c')]));
		// Replaced by an element (a conditional flip): the range goes, the new node
		// lands exactly where it was.
		vm.render(h('div', {}, [text('a'), h('span', {}, [text('mid')]), text('c')]));
		expect(el.innerHTML).toBe('<div>a<span>mid</span>c</div>');
		// And back.
		vm.render(h('div', {}, [text('a'), html('<b>x</b><i>y</i>'), text('c')]));
		expect(markup(el)).toBe('<div>a<b>x</b><i>y</i>c</div>');
		// Dropped from the end of an unkeyed list.
		vm.render(h('div', {}, [text('a')]));
		expect(el.innerHTML).toBe('<div>a</div>');
		// A view teardown leaves nothing behind.
		vm.render(h('div', {}, [html('<b>x</b>'), text('c')]));
		vm.clear();
		expect(el.innerHTML).toBe('');
	});

	it('moves its whole range as an unkeyed sibling among keyed rows', () => {
		const el = container();
		const vm = new ViewManager(el);
		const row = (id) => h('span', { key: id }, [text(String(id))]);
		vm.render(h('div', {}, [row(1), html('<b>h1</b><b>h2</b>'), row(2), row(3)]));
		expect(markup(el)).toBe('<div><span>1</span><b>h1</b><b>h2</b><span>2</span><span>3</span></div>');

		vm.render(h('div', {}, [row(3), html('<b>h1</b><b>h2</b>'), row(1), row(2)]));
		expect(markup(el)).toBe('<div><span>3</span><b>h1</b><b>h2</b><span>1</span><span>2</span></div>');
		// The comment still opens the range.
		const comment = [...el.firstChild.childNodes].find((n) => n.nodeType === Node.COMMENT_NODE);
		expect(comment.nextSibling.textContent).toBe('h1');

		vm.render(h('div', {}, [html('<b>new</b>'), row(2)]));
		expect(markup(el)).toBe('<div><b>new</b><span>2</span></div>');
	});

	it('serializes to the same markup it mounts', async () => {
		const tree = () =>
			h('div', {}, [text('a < b '), html('<p title="t">x &amp; y</p><a href="javascript:alert(1)">l</a>'), brText('1\n2')]);
		const el = container();
		new ViewManager(el).render(tree());
		expect(await serialize(tree())).toBe(markup(el));
	});
});

describe('live-HTML node — compiled output', () => {
	const rows = [
		{ id: 1, label: 'one', html: '<b>1</b>' },
		{ id: 2, label: 'two', html: '<i>2</i><script>alert(2)</script>' },
		{ id: 3, label: 'three', html: '<u>3</u>' },
	];
	const base = {
		intro: '<h2>Hi</h2><p>Welcome <a href="https://example.com" onclick="x()">home</a></p>',
		lead: 'lead',
		body: '<em>body</em> text',
		note: 'line one\nline <two>',
		flag: true,
		extra: '<strong>extra</strong>',
		rows,
		header: '<b>head</b>',
	};

	async function mountHost(fixture) {
		const el = container();
		mounted = new RawHost({ formatters: new FormatterRegistry() });
		mounted.fixture = fixture;
		await mounted.mount(el);
		return el;
	}

	const inner = (el, sel) => markup(el.querySelector(sel));

	it('renders each placement', async () => {
		const el = await mountHost(base);
		expect(inner(el, '.intro')).toBe('<h2>Hi</h2><p>Welcome <a href="https://example.com">home</a></p>');
		expect(inner(el, '.mix')).toBe('Before lead <em>body</em> text after');
		expect(inner(el, '.note')).toBe('line one<br>line &lt;two&gt;');
		expect(inner(el, '.cond')).toBe('<strong>extra</strong> tail');
		expect(inner(el, '.rows')).toBe('<li>one: <b>1</b></li><li>two: <i>2</i></li><li>three: <u>3</u></li>');
		expect(inner(el, '.keyed')).toBe('<b>head</b><span>one</span><span>two</span><span>three</span>');
		expect(el.querySelector('script')).toBe(null);
		expect(el.querySelector('[onclick]')).toBe(null);
	});

	it('keeps position through {#if} flips, list reorders and cached rows', async () => {
		const el = await mountHost(base);
		const cachedRowB = el.querySelector('.rows b');

		mounted.fixture = { ...base, flag: false, rows: [rows[2], rows[0], rows[1]], header: '<i>head2</i>' };
		await mounted.refresh();
		expect(inner(el, '.cond')).toBe('plain tail');
		expect(inner(el, '.rows')).toBe('<li>three: <u>3</u></li><li>one: <b>1</b></li><li>two: <i>2</i></li>');
		expect(inner(el, '.keyed')).toBe('<i>head2</i><span>three</span><span>one</span><span>two</span>');
		// Row 1's record did not change: its cached row (and its markup) moved as-is.
		expect(el.querySelector('.rows b')).toBe(cachedRowB);

		mounted.fixture = {
			...base,
			flag: true,
			extra: '<em>again</em>',
			rows: [rows[0], { ...rows[1], html: '<s>edited</s>' }],
		};
		await mounted.refresh();
		expect(inner(el, '.cond')).toBe('<em>again</em> tail');
		expect(inner(el, '.rows')).toBe('<li>one: <b>1</b></li><li>two: <s>edited</s></li>');
		expect(inner(el, '.keyed')).toBe('<b>head</b><span>one</span><span>two</span>');
	});
});

describe('live-HTML node — prerender and hybrid takeover', () => {
	class Page extends RawHost {
		data() {
			return {
				intro: '<p>Rich <b>text</b><img src="/a.png" onerror="alert(1)"></p><script>alert(1)</script>',
				lead: 'lead',
				body: 'body',
				note: 'a\nb',
				flag: true,
				extra: '<i>x</i>',
				rows: [{ id: 1, label: 'one', html: '<a href="javascript:alert(1)">bad</a>' }],
				header: '<b>h</b>',
			};
		}
	}
	const config = () => ({ target: '#app', routes: [{ path: '/', view: Page }] });

	it('prerenders the sanitized markup, and takeover mounts the same markup over it', async () => {
		const { pages } = await prerender(config());
		const prerendered = pages[0].html;
		expect(prerendered).toContain('<div class="intro"><p>Rich <b>text</b><img src="/a.png"></p></div>');
		expect(prerendered).toContain('<p class="note">a<br>b</p>');
		expect(prerendered).toContain('<li>one: <a>bad</a></li>');
		expect(prerendered).not.toMatch(/script|onerror|javascript:/);

		const el = document.createElement('div');
		el.id = 'app';
		el.setAttribute('data-puzzle-ssg', '');
		el.innerHTML = prerendered;
		document.body.appendChild(el);
		const app = new PuzzleApp({ ...config(), routerMode: memoryRouter() });
		apps.push(app);
		await app.mount();

		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
		expect(el.querySelectorAll('.intro').length).toBe(1); // replaced, not duplicated
		expect(markup(el)).toBe(prerendered);
	});
});

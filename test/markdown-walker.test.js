import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Lexer } from 'marked';
import {
	MARKDOWN_CLASSES as C,
	isEmpty,
	decodeEntities,
	safeUrl,
	safeImageUrl,
	safeLang,
} from '../registry/lib/markdown-doc.js';

// Lift the real walker out of the piece and supply only the browser primitives
// it uses. This keeps the test on the shipped source rather than a copied
// implementation.
const markdownFile = new URL('../registry/ui/markdown/Markdown.pzl', import.meta.url);
const markdownSource = await readFile(markdownFile, 'utf8');
const script = markdownSource.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

assert.ok(script, 'Markdown.pzl contains a script block');

globalThis.__markdownWalkerDeps = {
	Lexer,
	C,
	isEmpty,
	decodeEntities,
	safeUrl,
	safeImageUrl,
	safeLang,
};
const moduleSource = script
	.replace("import { PuzzleView } from '@magic-spells/puzzle';", 'class PuzzleView {}')
	.replace(
		"import { Lexer } from 'marked';",
		'const { Lexer } = globalThis.__markdownWalkerDeps;'
	)
	.replace(
		"import { MARKDOWN_CLASSES as C, isEmpty, decodeEntities, safeUrl, safeImageUrl, safeLang } from '../../lib/markdown-doc.js';",
		'const { C, isEmpty, decodeEntities, safeUrl, safeImageUrl, safeLang } = globalThis.__markdownWalkerDeps;'
	)
	.concat('\nexport { blockDom, inlineDom };');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
const { default: Markdown, blockDom, inlineDom } = await import(moduleUrl);
delete globalThis.__markdownWalkerDeps;

const escapeText = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttr = (value) => escapeText(value).replaceAll('"', '&quot;');

class StubNode {
	constructor(kind, tagName = '', value = '') {
		this.kind = kind;
		this.tagName = tagName;
		this.value = value;
		this.childNodes = [];
		this.attributes = {};
		this.className = '';
		this._text = null;
	}

	appendChild(node) {
		this._text = null;
		if (node.kind === 'fragment') {
			this.childNodes.push(...node.childNodes);
			node.childNodes = [];
		} else {
			this.childNodes.push(node);
		}
		return node;
	}

	set textContent(value) {
		this.childNodes = [];
		this._text = String(value ?? '');
	}

	get textContent() {
		if (this.kind === 'text') return this.value;
		if (this._text !== null) return this._text;
		return this.childNodes.map((child) => child.textContent).join('');
	}

	setAttribute(name, value) {
		this.attributes[name] = String(value);
	}

	toHtml() {
		if (this.kind === 'text') return escapeText(this.value);
		if (this.kind === 'fragment') return this.childNodes.map((n) => n.toHtml()).join('');
		const attrs = { ...this.attributes };
		if (this.className) attrs.class = this.className;
		for (const name of ['href', 'src', 'alt', 'title', 'target', 'rel', 'type', 'loading', 'decoding', 'scope', 'start']) {
			if (this[name] !== undefined && this[name] !== '') attrs[name] = this[name];
		}
		if (this.disabled) attrs.disabled = null;
		if (this.checked) attrs.checked = null;
		const attrText = Object.entries(attrs)
			.map(([name, value]) => (value === null ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`))
			.join('');
		if (['br', 'hr', 'img', 'input'].includes(this.tagName)) return `<${this.tagName}${attrText}>`;
		const body = this._text !== null
			? escapeText(this._text)
			: this.childNodes.map((node) => node.toHtml()).join('');
		return `<${this.tagName}${attrText}>${body}</${this.tagName}>`;
	}
}

const documentStub = {
	createElement: (tag) => new StubNode('element', tag),
	createTextNode: (value) => new StubNode('text', '', String(value ?? '')),
	createDocumentFragment: () => new StubNode('fragment'),
};
globalThis.document = documentStub;

function render(markdown, newTab = false) {
	const frag = document.createDocumentFragment();
	for (const token of Lexer.lex(markdown, { gfm: true, breaks: false })) {
		frag.appendChild(blockDom(token, newTab));
	}
	return frag;
}

function findAll(node, tagName) {
	const found = node.tagName === tagName ? [node] : [];
	for (const child of node.childNodes || []) found.push(...findAll(child, tagName));
	return found;
}

test('changing newTab re-renders an unchanged markdown value', () => {
	const view = new Markdown();
	const host = document.createElement('div');
	view.refs = { host };
	view.props = { value: '[external](https://example.com)', newTab: false };
	view._render();
	assert.equal(findAll(host, 'a')[0].target, undefined);

	view.props.newTab = true;
	view._render();
	assert.equal(findAll(host, 'a')[0].target, '_blank');
});

test('heading depths 1 and 6 render the matching semantic tag and class', () => {
	const headings = render('# One\n\n###### Six').childNodes;

	assert.equal(headings[0].tagName, 'h1');
	assert.equal(headings[0].className, C.heading1);
	assert.equal(headings[1].tagName, 'h6');
	assert.equal(headings[1].className, C.heading6);
});

test('prose entities decode while code-span entities stay literal', () => {
	const rendered = render('prose &amp; `&amp;`');
	const code = findAll(rendered, 'code')[0];

	assert.equal(rendered.textContent, 'prose & &amp;');
	assert.equal(code.textContent, '&amp;');
});

test('tight lists keep inline content bare while loose lists keep paragraphs', () => {
	const tightItem = findAll(render('- one\n- two'), 'li')[0];
	const looseItem = findAll(render('- one\n\n- two'), 'li')[0];

	assert.equal(findAll(tightItem, 'p').length, 0);
	assert.equal(tightItem.textContent, 'one');
	assert.equal(findAll(looseItem, 'p').length, 1);
	assert.equal(looseItem.textContent, 'one');
});

test('nested lists preserve text then list interleaving inside the parent item', () => {
	const item = findAll(render('- before\n  - nested'), 'li')[0];

	assert.equal(item.childNodes[0].kind, 'text');
	assert.equal(item.childNodes[0].textContent, 'before');
	assert.equal(item.childNodes[1].tagName, 'ul');
	assert.equal(item.childNodes[1].textContent, 'nested');
});

test('task lists render owned disabled checkboxes without literal task prefixes', () => {
	const rendered = render('- [x] done\n- [ ] todo');
	const list = findAll(rendered, 'ul')[0];
	const inputs = findAll(rendered, 'input');

	assert.equal(list.className, C.taskList);
	assert.equal(inputs.length, 2);
	assert.equal(inputs[0].type, 'checkbox');
	assert.equal(inputs[0].disabled, true);
	assert.equal(inputs[0].checked, true);
	assert.equal(inputs[1].checked, false);
	assert.doesNotMatch(rendered.textContent, /\[[ xX]\]/);
	assert.match(rendered.toHtml(), /<input[^>]*type="checkbox"[^>]*disabled/);
});

test('tables apply column alignment to headers and cells and pad short rows', () => {
	const token = Lexer.lex('|a|b|\n|:-:|--:|\n|1|2|', { gfm: true, breaks: false })[0];
	token.rows[0].pop();
	const table = blockDom(token);
	const headers = findAll(table, 'th');
	const cells = findAll(table, 'td');

	assert.equal(headers[0].className, `${C.tableHead} ${C.alignCenter}`);
	assert.equal(headers[1].className, `${C.tableHead} ${C.alignRight}`);
	assert.equal(cells[0].className, `${C.tableCell} ${C.alignCenter}`);
	assert.equal(cells[1].className, `${C.tableCell} ${C.alignRight}`);
	assert.equal(cells.length, 2);
	assert.equal(cells[1].textContent, '');
});

test('unsafe link schemes are neutralized', () => {
	const link = findAll(render('[click](javascript:alert(1))'), 'a')[0];

	assert.equal(link.href, '#');
	assert.equal(link.target, undefined);
});

test('unsafe image schemes emit no <img> at all', () => {
	// A rejected src used to become '#', which resolves to the current document
	// URL — the browser would GET the page as an image. Emit nothing instead.
	assert.equal(findAll(render('![A &amp; B](javascript:alert(1) "T &copy;")'), 'img').length, 0);
});

test('an empty image source emits no <img> at all', () => {
	assert.equal(findAll(render('![x]()'), 'img').length, 0);
});

test('a valid image source still renders with alt and title decoded', () => {
	const image = findAll(render('![A &amp; B](/img/a.png "T &copy;")'), 'img')[0];

	assert.ok(image, 'valid image renders an <img>');
	assert.equal(image.src, '/img/a.png');
	assert.equal(image.alt, 'A & B');
	assert.equal(image.title, 'T ©');
});

test('newTab applies only to external scheme-bearing links', () => {
	const links = findAll(
		render('[external](https://example.com "A &amp; B") [local](/docs)', true),
		'a'
	);

	assert.equal(links[0].target, '_blank');
	assert.equal(links[0].rel, 'noopener noreferrer');
	assert.equal(links[0].title, 'A & B');
	assert.equal(links[1].target, undefined);
});

test('newTab excludes neutralized and relative links', () => {
	const links = findAll(
		render(
			'[external](https://example.com) [unsafe](javascript:alert(1)) [relative](/path)',
			true
		),
		'a'
	);

	assert.equal(links[0].href, 'https://example.com');
	assert.equal(links[0].target, '_blank');
	assert.equal(links[0].rel, 'noopener noreferrer');
	assert.equal(links[1].href, '#');
	assert.equal(links[1].target, undefined);
	assert.equal(links[1].rel, undefined);
	assert.equal(links[2].href, '/path');
	assert.equal(links[2].target, undefined);
	assert.equal(links[2].rel, undefined);
});

test('code fences use only the first info-string word as the language class', () => {
	const code = findAll(render('```js title="x"\nconst x = 1;\n```'), 'code')[0];

	assert.equal(code.className, 'language-js');
	assert.equal(code.textContent, 'const x = 1;');
});

test('raw HTML is visible literal text and never becomes an element', () => {
	const rendered = render('<script>alert(1)</script>');

	assert.equal(findAll(rendered, 'script').length, 0);
	assert.equal(rendered.textContent, '<script>alert(1)</script>');
	assert.match(rendered.toHtml(), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.doesNotMatch(rendered.toHtml(), /<script[ >]/i);
});

test('space and unknown tokens render nothing', () => {
	assert.equal(blockDom({ type: 'space' }).toHtml(), '');
	assert.equal(blockDom({ type: 'mystery' }).toHtml(), '');
	assert.equal(inlineDom([{ type: 'mystery', raw: '<b>x</b>' }]).toHtml(), '');
});

test('block-level text tokens render their inline content', () => {
	assert.equal(
		blockDom({ type: 'text', text: '&amp;', tokens: [{ type: 'text', text: '&amp;' }] }).textContent,
		'&'
	);
});

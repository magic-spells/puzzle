import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// The Code piece's `.pzl` highlighter (lib/puzzle-lang.js). highlight.js is a
// demo dependency, not a package one, so the grammar is loaded through the demo
// copy and these tests skip when demo/node_modules hasn't been installed. The
// registry copy is pinned byte-identical to it below, so both are covered.

const registryCopy = new URL('../registry/lib/puzzle-lang.js', import.meta.url);
const demoCopy = new URL('../demo/app/lib/puzzle-lang.js', import.meta.url);
const hljsDir = new URL('../demo/node_modules/highlight.js/lib/', import.meta.url);

const hljsInstalled = await access(new URL('core.js', hljsDir)).then(
	() => true,
	() => false
);
const skip = hljsInstalled ? false : 'demo/node_modules/highlight.js not installed';

let highlight;
if (hljsInstalled) {
	const { default: hljs } = await import(new URL('core.js', hljsDir));
	const { default: css } = await import(new URL('languages/css.js', hljsDir));
	const { default: puzzleLang, puzzleJavascript } = await import(demoCopy);
	hljs.registerLanguage('javascript', puzzleJavascript);
	hljs.registerLanguage('css', css);
	hljs.registerLanguage('puzzle', puzzleLang);
	highlight = (src) => hljs.highlight(src, { language: 'puzzle' }).value;
}

// `<span class="hljs-built_in">currency</span>` for scope `built_in`, etc.
const span = (scope, text) => {
	const [head, ...rest] = scope.split('.');
	const cls = [`hljs-${head}`, ...rest.map((r) => `${r}_`)].join(' ');
	return `<span class="${cls}">${text}</span>`;
};

test('registry and demo puzzle-lang.js stay byte-identical', async () => {
	const [a, b] = await Promise.all([readFile(registryCopy), readFile(demoCopy)]);
	assert.equal(Buffer.compare(a, b), 0, 'puzzle-lang.js copy drifted');
});

test('a bare library call is a built-in; app functions and methods are functions', { skip }, () => {
	const out = highlight('<p>{ currency(cart.total) } { shout(name) } { title.trim().toUpperCase() }</p>');
	assert.ok(out.includes(span('built_in', 'currency')));
	assert.ok(out.includes(span('title.function', 'shout')));
	assert.ok(out.includes(span('title.function', 'trim')));
	assert.ok(out.includes(span('title.function', 'toUpperCase')));
	assert.ok(out.includes(span('property', 'total')));
});

test('nested library calls and t() with an object literal', { skip }, () => {
	const out = highlight("<p>{ truncate(strip_html(post.body), 120) } { t('cart.count', { count: n }) }</p>");
	assert.ok(out.includes(span('built_in', 'truncate')));
	assert.ok(out.includes(span('built_in', 'strip_html')));
	assert.ok(out.includes(span('built_in', 't')));
	assert.ok(out.includes(span('attr', 'count')));
	assert.ok(out.includes(span('number', '120')));
	// The object literal's `}` doesn't close the interpolation early.
	assert.match(out, /n \}\) \}<\/span>/);
});

test('a method named like a library function is still a method', { skip }, () => {
	const out = highlight('<p>{ post.date(x) } { items.join(", ") }</p>');
	assert.ok(!out.includes(span('built_in', 'date')));
	assert.ok(out.includes(span('title.function', 'date')));
	assert.ok(out.includes(span('title.function', 'join')));
});

test('arrows, ?. and ?? are operators', { skip }, () => {
	const out = highlight('<p>{ items.filter(i => !i.done).length } { user?.name ?? "anon" }</p>');
	assert.ok(out.includes(span('operator', '=&gt;')));
	assert.ok(out.includes(span('operator', '?.')));
	assert.ok(out.includes(span('operator', '??')));
	assert.ok(out.includes(span('property', 'length')));
	assert.ok(out.includes(span('string', '&quot;anon&quot;')));
});

test('template literals are strings whose ${ } is an expression again', { skip }, () => {
	const out = highlight('<p>{ `Hi ${name.toUpperCase()}!` }</p>');
	assert.match(out, /<span class="hljs-string">`Hi <span class="hljs-template-variable">\$\{name\./);
	assert.ok(out.includes(span('title.function', 'toUpperCase')));
});

test('globals are built-ins', { skip }, () => {
	const out = highlight('<p>{ Math.max(a, 1e3) } { Object.keys(o).length }</p>');
	assert.ok(out.includes(span('built_in', 'Math')));
	assert.ok(out.includes(span('built_in', 'Object')));
	assert.ok(out.includes(span('title.function', 'max')));
	assert.ok(out.includes(span('number', '1e3')));
});

test('@event handlers: bare calls are handlers, event is a language name', { skip }, () => {
	const out = highlight('<button @click={ date(event.target.value) } :title={ date(d) }>x</button>');
	assert.ok(out.includes(span('attr.directive', '@click')));
	assert.ok(out.includes(span('variable.language', 'event')));
	// Same name: the handler's `date(` is a plain function, the prop's is the library.
	assert.ok(out.includes(`{ ${span('title.function', 'date')}(`));
	assert.ok(out.includes(`{ ${span('built_in', 'date')}(d) }`));
});

test('event outside a handler is an ordinary name', { skip }, () => {
	const out = highlight('<p>{ event.title }</p>');
	assert.ok(!out.includes('hljs-variable'));
});

test('block tags, {#raw}, dotted tags and brace escapes', { skip }, () => {
	const out = highlight(
		'{#for t in todos.filter(t => !t.done)}<Ui.Item />{/for}{#raw}<b>x</b>{/raw} \\{ literal \\}'
	);
	assert.ok(out.includes(span('keyword', '#for')));
	assert.ok(out.includes(span('keyword', 'in')));
	assert.ok(out.includes(span('title.function', 'filter')));
	assert.ok(out.includes(span('keyword', '#raw')));
	assert.ok(out.includes(span('keyword', '/raw')));
	assert.ok(out.includes(span('name', 'Ui.Item')));
	assert.ok(out.includes(span('char.escape', '\\{')));
	assert.ok(out.includes(span('char.escape', '\\}')));
	assert.ok(!out.includes('literal \\}</span>'), 'an escaped brace opened an interpolation');
});

test('a pipe tail is no longer a formatter', { skip }, () => {
	const out = highlight('<p>{ price | currency } { a || b }</p>');
	assert.ok(!out.includes('hljs-built_in'), 'pipe tail colored as a library function');
	assert.ok(out.includes(span('operator', '|')));
	assert.ok(out.includes(span('operator', '||')));
});

test('a <script> block and a JS tail still hand off to JavaScript', { skip }, () => {
	const out = highlight('<p>{ n }</p>\n\nevents = {\n  save() { this.n++; },\n};');
	assert.ok(out.includes(span('built_in', 'events')));
	assert.ok(out.includes(span('variable.language', 'this')));
});

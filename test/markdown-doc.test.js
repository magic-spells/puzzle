import test from 'node:test';
import assert from 'node:assert/strict';
import {
	isEmpty,
	safeUrl,
	safeImageUrl,
	safeLang,
	MARKDOWN_CLASSES,
} from '../registry/lib/markdown-doc.js';

// ---- emptiness ------------------------------------------------------------

test('isEmpty is whitespace-only, null and undefined', () => {
	assert.equal(isEmpty(''), true);
	assert.equal(isEmpty('   '), true);
	assert.equal(isEmpty('\n\n'), true);
	assert.equal(isEmpty(null), true);
	assert.equal(isEmpty(undefined), true);
	assert.equal(isEmpty('#'), false);
	assert.equal(isEmpty('a'), false);
});

// ---- safeUrl --------------------------------------------------------------

test('safeUrl passes navigational schemes, relative and scheme-less URLs', () => {
	for (const url of [
		'https://x',
		'http://x',
		'mailto:a@b',
		'tel:+1',
		'/rel',
		'#hash',
		'?q',
		'./rel',
		'example.com/x',
	]) {
		assert.equal(safeUrl(url), url, url);
	}
});

test('safeUrl neutralizes script and data URLs', () => {
	for (const url of ['javascript:alert(1)', 'JaVaScRiPt:x', 'data:text/html,x', 'vbscript:x']) {
		assert.equal(safeUrl(url), '#', url);
	}
});

// A URL parser strips tabs and newlines before parsing, so `java<TAB>script:`
// navigates as javascript: — the guard must test a normalized copy, not the raw
// string. Pin both separators.
test('safeUrl normalizes tabs and newlines before testing the scheme', () => {
	assert.equal(safeUrl('java\tscript:x'), '#');
	assert.equal(safeUrl('java\nscript:x'), '#');
	assert.equal(safeUrl('java\rscript:x'), '#');
});

// ---- safeImageUrl ---------------------------------------------------------

test('safeImageUrl allows http(s), relative and data:image sources', () => {
	for (const url of ['https://x', 'data:image/png;base64,AAAA', '/rel']) {
		assert.equal(safeImageUrl(url), url, url);
	}
});

test('safeImageUrl rejects non-image data, script and navigational schemes', () => {
	for (const url of ['data:text/html,x', 'javascript:x', 'mailto:a@b']) {
		assert.equal(safeImageUrl(url), '#', url);
	}
});

// ---- safeLang -------------------------------------------------------------

test('safeLang passes identifiers and drops anything that could break out', () => {
	assert.equal(safeLang('js'), 'js');
	assert.equal(safeLang('c++'), 'c++');
	assert.equal(safeLang('objective-c'), 'objective-c');
	assert.equal(safeLang('js" onload="x'), '');
	assert.equal(safeLang(''), '');
	assert.equal(safeLang(undefined), '');
});

// ---- classes map ----------------------------------------------------------

// The key set is exact on purpose: a walker branch added without a map entry
// (or a map entry left behind by a removed branch) fails here rather than
// rendering unstyled in the browser.
test('MARKDOWN_CLASSES exposes exactly the documented keys', () => {
	assert.deepEqual(Object.keys(MARKDOWN_CLASSES).sort(), [
		'alignCenter',
		'alignLeft',
		'alignRight',
		'blockquote',
		'bulletList',
		'codeBlock',
		'heading1',
		'heading2',
		'heading3',
		'heading4',
		'heading5',
		'heading6',
		'htmlLiteral',
		'image',
		'inlineCode',
		'link',
		'list',
		'listItem',
		'orderedList',
		'paragraph',
		'rule',
		'table',
		'tableCell',
		'tableHead',
		'tableHeadRow',
		'tableRow',
		'tableWrap',
		'taskBody',
		'taskCheckbox',
		'taskItem',
		'taskList',
	]);
	for (const [key, value] of Object.entries(MARKDOWN_CLASSES)) {
		assert.equal(typeof value, 'string', key);
		assert.ok(value.length > 0, key);
	}
});

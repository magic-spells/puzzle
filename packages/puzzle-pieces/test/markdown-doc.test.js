import test from 'node:test';
import assert from 'node:assert/strict';
import {
	isEmpty,
	decodeEntities,
	isSafeUrl,
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

// ---- entities -------------------------------------------------------------

test('decodeEntities handles supported named and numeric references safely', () => {
	assert.equal(decodeEntities('&amp;'), '&');
	assert.equal(decodeEntities('&#8212;'), '—');
	assert.equal(decodeEntities('&#x2014;'), '—');
	assert.equal(decodeEntities('&nbsp;'), '\u00a0');
	assert.equal(decodeEntities('&bogus;'), '&bogus;');
	assert.equal(decodeEntities('&#xFFFFFFFF;'), '&#xFFFFFFFF;');
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
	// A leading colon leaves an empty scheme, which matches no allowlist entry.
	assert.equal(safeUrl(':foo'), '#');
});

// A URL parser strips tabs and newlines before parsing, so `java<TAB>script:`
// navigates as javascript: — the guard must test a normalized copy, not the raw
// string. Pin both separators.
test('safeUrl normalizes tabs and newlines before testing the scheme', () => {
	assert.equal(safeUrl('java\tscript:x'), '#');
	assert.equal(safeUrl('java\nscript:x'), '#');
	assert.equal(safeUrl('java\rscript:x'), '#');
});

// isSafeUrl is the boolean face of the same policy, handed to Tiptap's Link
// `isAllowedUri` so MarkdownEditor can't create a link Markdown would collapse.
// It exists BECAUSE safeUrl's return is ambiguous: a bare '#' is a legal href
// that comes back looking exactly like the neutralized sentinel.
test('isSafeUrl agrees with safeUrl and still accepts a bare #', () => {
	for (const url of ['https://x', 'mailto:a@b', '/rel', '#hash', 'example.com/x']) {
		assert.equal(isSafeUrl(url), true, url);
	}
	for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'sms:+1', ':foo']) {
		assert.equal(isSafeUrl(url), false, url);
	}
	assert.equal(isSafeUrl('#'), true);
	assert.equal(safeUrl('#'), '#');
});

// ---- safeImageUrl ---------------------------------------------------------

test('safeImageUrl allows http(s), relative and data:image sources', () => {
	for (const url of ['https://x', 'data:image/png;base64,AAAA', '/rel']) {
		assert.equal(safeImageUrl(url), url, url);
	}
	assert.equal(safeImageUrl('img/a.png'), 'img/a.png');
	assert.equal(safeImageUrl('./a.png'), './a.png');
	assert.equal(safeImageUrl('/a.png'), '/a.png');
	assert.equal(safeImageUrl('https://x/y.png'), 'https://x/y.png');
	assert.equal(safeImageUrl('data:image/png;base64,AA'), 'data:image/png;base64,AA');
});

// Rejected sources return null, not a '#' tombstone: '#', '?…' and '' all
// resolve to the current document URL, so an <img> built from them makes the
// browser GET the page itself. null tells the walker to emit no element.
test('safeImageUrl rejects non-image data, script and navigational schemes', () => {
	for (const url of ['data:text/html,x', 'javascript:x', 'mailto:a@b']) {
		assert.equal(safeImageUrl(url), null, url);
	}
	assert.equal(safeImageUrl(''), null);
	assert.equal(safeImageUrl('#foo'), null);
	assert.equal(safeImageUrl('?q=1'), null);
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
		'taskBodyDone',
		'taskCheckbox',
		'taskItem',
		'taskList',
	]);
	for (const [key, value] of Object.entries(MARKDOWN_CLASSES)) {
		assert.equal(typeof value, 'string', key);
		assert.ok(value.length > 0, key);
	}
});

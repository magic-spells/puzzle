import test from 'node:test';
import assert from 'node:assert/strict';
import {
	emptyDoc,
	isEmpty,
	fromTiptap,
	toTiptap,
	safeLinkUrl,
	safePreviewUrl,
	plainText,
	imageRefs,
	docLimits,
	validateDoc,
	RICH_TEXT_CLASSES,
	RICH_TEXT_COMPACT,
	richTextClasses,
} from '../registry/lib/rich-text-doc.js';

// ---- emptiness ------------------------------------------------------------

test('emptyDoc() is empty; content is not', () => {
	assert.equal(isEmpty(emptyDoc()), true);
	assert.equal(isEmpty(null), true);
	assert.equal(
		isEmpty({ type: 'root', children: [{ type: 'paragraph', children: [] }] }),
		true
	);
	assert.equal(
		isEmpty({
			type: 'root',
			children: [
				{ type: 'paragraph', children: [{ type: 'text', value: '   ' }] },
			],
		}),
		true
	);
	assert.equal(
		isEmpty({
			type: 'root',
			children: [
				{ type: 'paragraph', children: [{ type: 'text', value: 'hi' }] },
			],
		}),
		false
	);
	// A non-paragraph block counts as content even with no text yet.
	assert.equal(
		isEmpty({
			type: 'root',
			children: [{ type: 'list', listType: 'unordered', children: [] }],
		}),
		false
	);
});

// ---- fromTiptap -----------------------------------------------------------

test('fromTiptap maps marks to boolean flags', () => {
	const doc = fromTiptap({
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'plain ' },
					{ type: 'text', text: 'bi', marks: [{ type: 'bold' }, { type: 'italic' }] },
					{ type: 'text', text: 'us', marks: [{ type: 'underline' }, { type: 'strike' }] },
				],
			},
		],
	});
	assert.deepEqual(doc, {
		type: 'root',
		children: [
			{
				type: 'paragraph',
				children: [
					{ type: 'text', value: 'plain ' },
					{ type: 'text', value: 'bi', bold: true, italic: true },
					{ type: 'text', value: 'us', underline: true, strike: true },
				],
			},
		],
	});
});

test('fromTiptap groups adjacent same-link texts into one link node', () => {
	const doc = fromTiptap({
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: 'see ',
						marks: [{ type: 'link', attrs: { href: '/docs' } }],
					},
					{
						type: 'text',
						text: 'this',
						marks: [{ type: 'bold' }, { type: 'link', attrs: { href: '/docs' } }],
					},
					{
						type: 'text',
						text: 'other',
						marks: [{ type: 'link', attrs: { href: '/other' } }],
					},
				],
			},
		],
	});
	const inline = doc.children[0].children;
	assert.equal(inline.length, 2);
	assert.deepEqual(inline[0], {
		type: 'link',
		url: '/docs',
		children: [
			{ type: 'text', value: 'see ' },
			{ type: 'text', value: 'this', bold: true },
		],
	});
	assert.deepEqual(inline[1], {
		type: 'link',
		url: '/other',
		children: [{ type: 'text', value: 'other' }],
	});
});

test('fromTiptap keeps center/right align, omits left', () => {
	const doc = fromTiptap({
		type: 'doc',
		content: [
			{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'c' }] },
			{ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'l' }] },
			{ type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [{ type: 'text', text: 'h' }] },
		],
	});
	assert.equal(doc.children[0].align, 'center');
	assert.equal('align' in doc.children[1], false);
	assert.deepEqual(doc.children[2], {
		type: 'heading',
		level: 2,
		align: 'right',
		children: [{ type: 'text', value: 'h' }],
	});
});

test('fromTiptap turns hardBreak into a newline text node', () => {
	const doc = fromTiptap({
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'a' },
					{ type: 'hardBreak' },
					{ type: 'text', text: 'b' },
				],
			},
		],
	});
	assert.deepEqual(doc.children[0].children, [
		{ type: 'text', value: 'a' },
		{ type: 'text', value: '\n' },
		{ type: 'text', value: 'b' },
	]);
});

test('fromTiptap maps lists, nested lists, blockquote, codeBlock', () => {
	const doc = fromTiptap({
		type: 'doc',
		content: [
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [
							{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
							{
								type: 'orderedList',
								content: [
									{
										type: 'listItem',
										content: [
											{ type: 'paragraph', content: [{ type: 'text', text: 'sub' }] },
										],
									},
								],
							},
						],
					},
				],
			},
			{
				type: 'blockquote',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }],
			},
			{ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
		],
	});
	assert.deepEqual(doc.children[0], {
		type: 'list',
		listType: 'unordered',
		children: [
			{
				type: 'list-item',
				children: [
					{ type: 'text', value: 'one' },
					{
						type: 'list',
						listType: 'ordered',
						children: [
							{ type: 'list-item', children: [{ type: 'text', value: 'sub' }] },
						],
					},
				],
			},
		],
	});
	assert.deepEqual(doc.children[1], {
		type: 'blockquote',
		children: [
			{ type: 'paragraph', children: [{ type: 'text', value: 'q' }] },
		],
	});
	assert.deepEqual(doc.children[2], {
		type: 'code-block',
		children: [{ type: 'text', value: 'const x = 1;' }],
	});
});

// ---- toTiptap -------------------------------------------------------------

test('toTiptap: empty root becomes a doc with one empty paragraph', () => {
	assert.deepEqual(toTiptap(emptyDoc()), {
		type: 'doc',
		content: [{ type: 'paragraph' }],
	});
});

test('toTiptap maps flags to marks and link nodes to link marks', () => {
	const pm = toTiptap({
		type: 'root',
		children: [
			{
				type: 'paragraph',
				children: [
					{ type: 'text', value: 'x', bold: true },
					{
						type: 'link',
						url: '/d',
						title: 't',
						children: [{ type: 'text', value: 'go', italic: true }],
					},
				],
			},
		],
	});
	assert.deepEqual(pm.content[0].content, [
		{ type: 'text', text: 'x', marks: [{ type: 'bold' }] },
		{
			type: 'text',
			text: 'go',
			marks: [
				{ type: 'italic' },
				{ type: 'link', attrs: { href: '/d', title: 't' } },
			],
		},
	]);
});

test('toTiptap splits newline text into hardBreaks', () => {
	const pm = toTiptap({
		type: 'root',
		children: [
			{ type: 'paragraph', children: [{ type: 'text', value: 'a\nb' }] },
		],
	});
	assert.deepEqual(pm.content[0].content, [
		{ type: 'text', text: 'a' },
		{ type: 'hardBreak' },
		{ type: 'text', text: 'b' },
	]);
});

test('toTiptap writes heading level and align attrs', () => {
	const pm = toTiptap({
		type: 'root',
		children: [
			{ type: 'heading', level: 3, align: 'center', children: [{ type: 'text', value: 'h' }] },
		],
	});
	assert.deepEqual(pm.content[0].attrs, { level: 3, textAlign: 'center' });
});

// ---- round-trip -----------------------------------------------------------

// The block-style dropdown offers levels 1-4, so the outer levels must survive
// the conversion both ways, not just the 2/3 the old toolbar produced.
test('round-trip: heading levels 1 and 4 survive fromTiptap(toTiptap(doc))', () => {
	const doc = {
		type: 'root',
		children: [
			{ type: 'heading', level: 1, children: [{ type: 'text', value: 'Top' }] },
			{ type: 'heading', level: 4, children: [{ type: 'text', value: 'Deep' }] },
		],
	};
	const pm = toTiptap(doc);
	assert.deepEqual(pm.content.map((n) => n.attrs.level), [1, 4]);
	assert.deepEqual(fromTiptap(pm), doc);
});

test('round-trip: fromTiptap(toTiptap(doc)) is identity on a rich doc', () => {
	const doc = {
		type: 'root',
		children: [
			{ type: 'heading', level: 2, children: [{ type: 'text', value: 'Title' }] },
			{
				type: 'paragraph',
				align: 'center',
				children: [
					{ type: 'text', value: 'Hello ' },
					{ type: 'text', value: 'bold', bold: true },
					{ type: 'text', value: ' and ' },
					{
						type: 'link',
						url: 'https://example.com',
						target: '_blank',
						children: [{ type: 'text', value: 'a link', underline: true }],
					},
				],
			},
			{
				type: 'list',
				listType: 'ordered',
				children: [
					{ type: 'list-item', children: [{ type: 'text', value: 'one' }] },
					{
						type: 'list-item',
						children: [
							{ type: 'text', value: 'two' },
							{
								type: 'list',
								listType: 'unordered',
								children: [
									{ type: 'list-item', children: [{ type: 'text', value: 'sub', strike: true }] },
								],
							},
						],
					},
				],
			},
			{
				type: 'blockquote',
				children: [
					{ type: 'paragraph', children: [{ type: 'text', value: 'quoted text' }] },
				],
			},
			{ type: 'code-block', children: [{ type: 'text', value: 'let a = 1;\nlet b = 2;' }] },
		],
	};
	assert.deepEqual(fromTiptap(toTiptap(doc)), doc);
});

// A soft break is the one shape round-tripping NORMALIZES rather than
// preserves: 'a\nb' becomes three text nodes (hardBreak → '\n' text). That is
// the documented normalization, so the guarantee here is stability — the
// second pass changes nothing, so an editor round-trip can't churn the value.
test('round-trip: a soft break normalizes once, then is stable', () => {
	const doc = {
		type: 'root',
		children: [
			{ type: 'paragraph', children: [{ type: 'text', value: 'quoted\ntext' }] },
		],
	};
	const once = fromTiptap(toTiptap(doc));
	assert.deepEqual(once.children[0].children, [
		{ type: 'text', value: 'quoted' },
		{ type: 'text', value: '\n' },
		{ type: 'text', value: 'text' },
	]);
	assert.deepEqual(fromTiptap(toTiptap(once)), once);
});

// Regression: a list item with content AFTER a nested list used to accumulate
// one '\n' text per round-trip, because the paragraph separator was re-emitted
// on every pass while toTiptap folded the previous one into the paragraph.
test('a list item with a paragraph after a nested list is stable', () => {
	const pm = {
		type: 'doc',
		content: [
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [
							{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
							{
								type: 'bulletList',
								content: [
									{
										type: 'listItem',
										content: [
											{ type: 'paragraph', content: [{ type: 'text', text: 'n' }] },
										],
									},
								],
							},
							{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
						],
					},
				],
			},
		],
	};
	const item = (d) => d.children[0].children[0].children;
	const pass1 = fromTiptap(pm);
	// The nested list is its own block boundary — no '\n' separator after it.
	assert.deepEqual(item(pass1), [
		{ type: 'text', value: 'A' },
		{
			type: 'list',
			listType: 'unordered',
			children: [{ type: 'list-item', children: [{ type: 'text', value: 'n' }] }],
		},
		{ type: 'text', value: 'B' },
	]);
	const pass2 = fromTiptap(toTiptap(pass1));
	assert.deepEqual(pass2, pass1);
	assert.deepEqual(fromTiptap(toTiptap(pass2)), pass1);
});

// A doc already stored in the older shape (explicit '\n' after the nested list)
// must also be a fixed point, so existing content can't drift on an edit pass.
test('a legacy newline after a nested list neither grows nor vanishes', () => {
	const doc = {
		type: 'root',
		children: [
			{
				type: 'list',
				listType: 'unordered',
				children: [
					{
						type: 'list-item',
						children: [
							{ type: 'text', value: 'A' },
							{
								type: 'list',
								listType: 'unordered',
								children: [
									{ type: 'list-item', children: [{ type: 'text', value: 'n' }] },
								],
							},
							{ type: 'text', value: '\n' },
							{ type: 'text', value: 'B' },
						],
					},
				],
			},
		],
	};
	const once = fromTiptap(toTiptap(doc));
	assert.deepEqual(once, doc);
	assert.deepEqual(fromTiptap(toTiptap(once)), doc);
});

// ---- safeLinkUrl ----------------------------------------------------------
//
// One security predicate, two callers: RichText runs it before assigning an
// href and RichTextEditor hands it to Tiptap's Link `isAllowedUri`. Rejection
// is a null return, not a '#' rewrite — the caller decides what to do with it.

test('safeLinkUrl returns navigational, relative and scheme-less URLs unchanged', () => {
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
		assert.equal(safeLinkUrl(url), url, url);
	}
});

test('safeLinkUrl rejects script and data URLs', () => {
	for (const url of [
		'javascript:alert(1)',
		'JaVaScRiPt:x',
		'data:text/html,x',
		'vbscript:x',
		// A leading colon leaves an empty scheme, which matches no allowlist entry.
		':foo',
	]) {
		assert.equal(safeLinkUrl(url), null, url);
	}
});

// A URL parser strips tabs and newlines before parsing, so `java<TAB>script:`
// navigates as javascript: — the guard must test a normalized copy, not the raw
// string. Pin both separators.
test('safeLinkUrl normalizes tabs and newlines before testing the scheme', () => {
	assert.equal(safeLinkUrl('java\tscript:x'), null);
	assert.equal(safeLinkUrl('java\nscript:x'), null);
	assert.equal(safeLinkUrl('java\rscript:x'), null);
});

// ---- classes map ----------------------------------------------------------

test('RICH_TEXT_CLASSES exposes a class string per node kind', () => {
	for (const key of [
		'paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'list', 'bulletList',
		'orderedList', 'listItem', 'blockquote', 'codeBlock', 'link', 'figure', 'image',
		'imagePlaceholder', 'caption', 'preview', 'previewBody', 'previewSite', 'previewTitle',
		'previewDescription', 'previewImage',
	]) {
		assert.equal(typeof RICH_TEXT_CLASSES[key], 'string', key);
		assert.ok(RICH_TEXT_CLASSES[key].length > 0, key);
	}
});

// The atoms' classes are a styling contract: tokens only, no arbitrary values
// and no left-edge accent bar on the card.
test('atom classes use scale utilities only, no left-edge bars', () => {
	for (const key of ['figure', 'image', 'imagePlaceholder', 'caption', 'preview', 'previewBody',
		'previewSite', 'previewTitle', 'previewDescription', 'previewImage']) {
		const cls = RICH_TEXT_CLASSES[key];
		assert.doesNotMatch(cls, /\[/, `${key} has an arbitrary value`);
		assert.doesNotMatch(cls, /\bborder-(l|s)\b|\bborder-(l|s)-/, `${key} has a left-edge border`);
	}
});

// ---- image + link-preview atoms -------------------------------------------

const IMG = { type: 'image', ref: 'img-1', alt: 'A chart', caption: 'Q3 numbers', width: 800, height: 600 };
const PREVIEW = {
	type: 'link-preview',
	url: 'https://example.com/post',
	title: 'A post',
	description: 'About things',
	siteName: 'Example',
	imageRef: 'img-2',
};

test('toTiptap maps the atoms to image / linkPreview nodes with attrs', () => {
	const pm = toTiptap({ type: 'root', children: [IMG, PREVIEW] });
	assert.deepEqual(pm.content, [
		{ type: 'image', attrs: { ref: 'img-1', alt: 'A chart', caption: 'Q3 numbers', width: 800, height: 600 } },
		{
			type: 'linkPreview',
			attrs: {
				url: 'https://example.com/post',
				title: 'A post',
				description: 'About things',
				siteName: 'Example',
				imageRef: 'img-2',
			},
		},
	]);
});

test('round-trip: the atoms survive fromTiptap(toTiptap(doc)) between blocks', () => {
	const doc = {
		type: 'root',
		children: [
			{ type: 'paragraph', children: [{ type: 'text', value: 'before' }] },
			IMG,
			{ type: 'image', ref: 'img-3' },
			PREVIEW,
			{ type: 'link-preview', url: 'https://example.com/x' },
			{ type: 'paragraph', children: [{ type: 'text', value: 'after' }] },
		],
	};
	assert.deepEqual(fromTiptap(toTiptap(doc)), doc);
});

test('fromTiptap drops null / empty / non-integer atom attrs and editor-only attrs', () => {
	const doc = fromTiptap({
		type: 'doc',
		content: [
			{ type: 'image', attrs: { ref: 'r', alt: '', caption: null, width: 1.5, height: -2 } },
			{
				type: 'linkPreview',
				attrs: { url: 'https://a.b', title: null, description: '', siteName: null, imageRef: null, pendingId: 'p-1' },
			},
		],
	});
	assert.deepEqual(doc.children, [
		{ type: 'image', ref: 'r' },
		{ type: 'link-preview', url: 'https://a.b' },
	]);
});

test('atoms without their required field are dropped both ways', () => {
	assert.deepEqual(
		fromTiptap({ type: 'doc', content: [{ type: 'image', attrs: {} }, { type: 'linkPreview', attrs: { url: '' } }] })
			.children,
		[]
	);
	assert.deepEqual(toTiptap({ type: 'root', children: [{ type: 'image' }, { type: 'link-preview' }] }), {
		type: 'doc',
		content: [{ type: 'paragraph' }],
	});
});

test('atoms are root-level only: nested ones are dropped both ways', () => {
	const nestedPm = {
		type: 'doc',
		content: [{ type: 'blockquote', content: [{ type: 'image', attrs: { ref: 'r' } }, { type: 'paragraph' }] }],
	};
	assert.deepEqual(fromTiptap(nestedPm).children[0], {
		type: 'blockquote',
		children: [{ type: 'paragraph', children: [] }],
	});
	const pm = toTiptap({
		type: 'root',
		children: [{ type: 'blockquote', children: [PREVIEW, { type: 'paragraph', children: [] }] }],
	});
	assert.deepEqual(pm.content[0], { type: 'blockquote', content: [{ type: 'paragraph' }] });
});

test('an image-only doc is not empty', () => {
	assert.equal(isEmpty({ type: 'root', children: [IMG] }), false);
});

// ---- safePreviewUrl -------------------------------------------------------

test('safePreviewUrl accepts absolute http(s) urls unchanged', () => {
	for (const url of [
		'https://example.com',
		'http://example.com/a?b=c#d',
		'HTTPS://Example.com/path',
		'https://example.com:8443/x',
		'https://bücher.example/straße',
	]) {
		assert.equal(safePreviewUrl(url), url, url);
	}
});

test('safePreviewUrl rejects relative, other schemes, userinfo, whitespace and oversize', () => {
	for (const url of [
		'',
		null,
		undefined,
		42,
		'/relative',
		'example.com',
		'//example.com',
		'mailto:a@b.c',
		'javascript:alert(1)',
		'ftp://example.com',
		'data:text/html,x',
		'https://user@example.com',
		'https://user:pw@example.com',
		'https://@example.com',
		'https://',
		'https:///path',
		'https://exa mple.com',
		' https://example.com',
		'https://example.com/\n',
		'ht\ttps://example.com',
		'https:\\\\example.com',
		'https://example.com\\@evil.com',
		`https://example.com/${'a'.repeat(2048)}`,
	]) {
		assert.equal(safePreviewUrl(url), null, String(url));
	}
	assert.equal(safePreviewUrl(`https://e.co/${'a'.repeat(2048 - 13)}`).length, 2048);
});

// ---- plainText / imageRefs ------------------------------------------------

test('plainText joins block lines and includes atom text, skipping blanks', () => {
	const doc = {
		type: 'root',
		children: [
			{ type: 'heading', level: 2, children: [{ type: 'text', value: 'Title' }] },
			{
				type: 'paragraph',
				children: [
					{ type: 'text', value: 'See ' },
					{ type: 'link', url: 'https://x.y', children: [{ type: 'text', value: 'this', bold: true }] },
					{ type: 'text', value: '\nnext' },
				],
			},
			{ type: 'paragraph', children: [{ type: 'text', value: '   ' }] },
			{
				type: 'list',
				listType: 'unordered',
				children: [
					{
						type: 'list-item',
						children: [
							{ type: 'text', value: 'one' },
							{
								type: 'list',
								listType: 'ordered',
								children: [{ type: 'list-item', children: [{ type: 'text', value: 'sub' }] }],
							},
							{ type: 'text', value: 'tail' },
						],
					},
				],
			},
			{ type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'q\u0000' }] }] },
			{ type: 'code-block', children: [{ type: 'text', value: 'x = 1' }] },
			IMG,
			{ type: 'image', ref: 'bare' },
			PREVIEW,
			{ type: 'mystery', children: [{ type: 'text', value: 'ignored' }] },
		],
	};
	assert.equal(
		plainText(doc),
		[
			'Title',
			'See this\nnext',
			'one',
			'sub',
			'tail',
			'q',
			'x = 1',
			'A chart',
			'Q3 numbers',
			'A post',
			'About things',
			'https://example.com/post',
		].join('\n')
	);
	assert.equal(plainText(null), '');
	assert.equal(plainText(emptyDoc()), '');
});

test('imageRefs lists image refs and preview imageRefs once, in order', () => {
	const doc = {
		type: 'root',
		children: [PREVIEW, IMG, { type: 'image', ref: 'img-2' }, { type: 'link-preview', url: 'https://a.b' }],
	};
	assert.deepEqual(imageRefs(doc), ['img-2', 'img-1']);
	assert.deepEqual(imageRefs(null), []);
});

// ---- validateDoc ----------------------------------------------------------

const para = (value) => ({ type: 'paragraph', children: [{ type: 'text', value }] });
const root = (...children) => ({ type: 'root', children });

function nestLists(depth) {
	let node = { type: 'list-item', children: [{ type: 'text', value: 'deep' }] };
	for (let i = 0; i < depth; i++) {
		const list = { type: 'list', listType: 'unordered', children: [node] };
		node = i === depth - 1 ? list : { type: 'list-item', children: [list] };
	}
	return node;
}

function nestQuotes(depth) {
	let node = para('deep');
	for (let i = 0; i < depth; i++) node = { type: 'blockquote', children: [node] };
	return node;
}

test('validateDoc accepts a full valid doc', () => {
	const doc = root(
		{ type: 'heading', level: 1, align: 'center', children: [{ type: 'text', value: 'H', bold: true }] },
		{
			type: 'paragraph',
			align: 'right',
			children: [
				{ type: 'text', value: 'a', italic: false, underline: true, strike: true },
				{ type: 'link', url: '/rel', title: 't', target: '_blank', children: [{ type: 'text', value: 'l' }] },
			],
		},
		nestLists(6),
		nestQuotes(11),
		{ type: 'code-block', children: [{ type: 'text', value: 'code' }] },
		IMG,
		PREVIEW,
		{ type: 'paragraph', children: [] }
	);
	assert.deepEqual(validateDoc(doc), { ok: true });
	assert.deepEqual(validateDoc(emptyDoc()), { ok: true });
	// The editor's own output is always valid.
	assert.deepEqual(validateDoc(fromTiptap(toTiptap(doc))), { ok: true });
});

function rejects(doc, code, path, limits) {
	const r = validateDoc(doc, limits);
	assert.equal(r.ok, false, JSON.stringify(doc).slice(0, 120));
	assert.equal(r.code, code, r.message);
	if (path !== undefined) assert.equal(r.path, path, r.message);
	assert.equal(typeof r.message, 'string');
}

test('validateDoc rejects a non-root body', () => {
	rejects(null, 'invalid', '');
	rejects([], 'invalid', '');
	rejects({ type: 'paragraph', children: [] }, 'invalid', '');
	rejects({ type: 'root' }, 'invalid', '');
	rejects({ type: 'root', children: [], extra: 1 }, 'unknown_key', '');
});

test('validateDoc enforces the byte, node and text limits', () => {
	rejects(root(para('x'.repeat(262144))), 'too_large', '');
	rejects(root(para('é'.repeat(16385))), 'text_too_long', 'children[0].children[0]');
	assert.equal(validateDoc(root(para('é'.repeat(16384)))).ok, true);
	const many = root(...Array.from({ length: 2500 }, () => para('a')));
	rejects(many, 'too_many_nodes');
	assert.equal(validateDoc(root(...Array.from({ length: 2499 }, () => para('a')))).ok, true);
	rejects(root(para('a'), para('b')), 'too_many_nodes', undefined, { maxNodes: 4 });
});

test('validateDoc enforces nesting and list depth', () => {
	rejects(root(nestQuotes(12)), 'too_deep');
	rejects(root(nestLists(7)), 'list_too_deep');
	assert.equal(validateDoc(root(nestLists(6))).ok, true);
});

test('validateDoc caps images and link previews at 50 each', () => {
	const imgs = (n) => Array.from({ length: n }, (_, i) => ({ type: 'image', ref: `r${i}` }));
	const pvs = (n) => Array.from({ length: n }, (_, i) => ({ type: 'link-preview', url: `https://e.co/${i}` }));
	assert.equal(validateDoc(root(...imgs(50), ...pvs(50))).ok, true);
	rejects(root(...imgs(51)), 'too_many_images', 'children[50]');
	rejects(root(...pvs(51)), 'too_many_link_previews', 'children[50]');
});

test('validateDoc rejects unknown types, misplaced nodes and unknown keys with a path', () => {
	rejects(root({ type: 'video', src: 'x' }), 'unknown_type', 'children[0]');
	rejects(root({ type: 'root', children: [] }), 'unknown_type', 'children[0]');
	rejects(root('text'), 'invalid', 'children[0]');
	rejects(root({ type: 'blockquote', children: [IMG] }), 'not_allowed', 'children[0].children[0]');
	rejects(
		root({ type: 'list', listType: 'ordered', children: [{ type: 'list-item', children: [PREVIEW] }] }),
		'not_allowed',
		'children[0].children[0].children[0]'
	);
	rejects(root({ type: 'text', value: 'loose' }), 'not_allowed', 'children[0]');
	rejects(root({ type: 'paragraph', children: [para('x')] }), 'not_allowed', 'children[0].children[0]');
	rejects(root({ ...para('x'), id: 1 }), 'unknown_key', 'children[0]');
	rejects(root({ ...IMG, src: 'https://x' }), 'unknown_key', 'children[0]');
	rejects(root({ ...PREVIEW, image: 'x' }), 'unknown_key', 'children[0]');
	rejects(root({ type: 'paragraph', children: [{ type: 'text', value: 'x', code: true }] }), 'unknown_key');
});

test('validateDoc checks field values', () => {
	const bad = [
		{ type: 'heading', level: 5, children: [] },
		{ type: 'heading', level: 0, children: [] },
		{ type: 'heading', level: '2', children: [] },
		{ type: 'paragraph', align: 'left', children: [] },
		{ type: 'paragraph' },
		{ type: 'list', listType: 'dotted', children: [] },
		{ type: 'paragraph', children: [{ type: 'text', value: 'x', bold: 'yes' }] },
		{ type: 'paragraph', children: [{ type: 'text' }] },
		{ type: 'paragraph', children: [{ type: 'link', url: 'javascript:alert(1)', children: [] }] },
		{ type: 'paragraph', children: [{ type: 'link', url: 'java\nscript:alert(1)', children: [] }] },
		{ type: 'paragraph', children: [{ type: 'link', url: 'data:text/html,x', children: [] }] },
		{ type: 'paragraph', children: [{ type: 'link', url: `/${'a'.repeat(2048)}`, children: [] }] },
		{ type: 'paragraph', children: [{ type: 'link', url: '/a', target: '_self', children: [] }] },
		{ type: 'image', ref: '' },
		{ type: 'image', ref: 'r', alt: null },
		{ type: 'image', ref: 'r', alt: 'a'.repeat(501) },
		{ type: 'image', ref: 'r', caption: 'a'.repeat(501) },
		{ type: 'image', ref: 'r', width: 0 },
		{ type: 'image', ref: 'r', height: 2.5 },
		{ type: 'link-preview', url: '/relative' },
		{ type: 'link-preview', url: 'https://user@example.com' },
		{ type: 'link-preview', url: 'https://e.co', title: 'a'.repeat(301) },
		{ type: 'link-preview', url: 'https://e.co', description: 'a'.repeat(1001) },
		{ type: 'link-preview', url: 'https://e.co', siteName: 'a'.repeat(201) },
		{ type: 'link-preview', url: 'https://e.co', imageRef: '' },
	];
	for (const node of bad) rejects(root(node), 'invalid');
	// Caps count code points, not UTF-16 units.
	assert.equal(validateDoc(root({ type: 'image', ref: 'r', alt: '😀'.repeat(500) })).ok, true);
	assert.equal(validateDoc(root({ type: 'heading', level: 6, children: [] }), { maxHeadingLevel: 6 }).ok, true);
});

test('docLimits holds the documented defaults and is frozen', () => {
	assert.equal(docLimits.maxBytes, 256 * 1024);
	assert.equal(docLimits.maxNodes, 5000);
	assert.equal(docLimits.maxDepth, 12);
	assert.equal(docLimits.maxListDepth, 6);
	assert.equal(docLimits.maxImages, 50);
	assert.equal(docLimits.maxLinkPreviews, 50);
	assert.equal(docLimits.maxTextBytes, 32 * 1024);
	assert.equal(Object.isFrozen(docLimits), true);
});

test('compact classes: overrides only known keys, tokens only, no left-edge bar', () => {
	for (const [key, cls] of Object.entries(RICH_TEXT_COMPACT)) {
		assert.ok(key in RICH_TEXT_CLASSES, key);
		assert.doesNotMatch(cls, /\[/, `${key} has an arbitrary value`);
		assert.doesNotMatch(cls, /\bborder-(l|s)\b|\bborder-(l|s)-/, `${key} has a left-edge border`);
	}
	assert.equal(richTextClasses(false), RICH_TEXT_CLASSES);
	const compact = richTextClasses(true);
	assert.equal(compact.paragraph, RICH_TEXT_COMPACT.paragraph);
	assert.equal(compact.heading1, RICH_TEXT_CLASSES.heading1);
});

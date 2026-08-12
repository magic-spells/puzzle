import test from 'node:test';
import assert from 'node:assert/strict';
import {
	emptyDoc,
	isEmpty,
	fromTiptap,
	toTiptap,
	RICH_TEXT_CLASSES,
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

// ---- classes map ----------------------------------------------------------

test('RICH_TEXT_CLASSES exposes a class string per node kind', () => {
	for (const key of [
		'paragraph', 'heading2', 'heading3', 'list', 'bulletList',
		'orderedList', 'listItem', 'blockquote', 'codeBlock', 'link',
	]) {
		assert.equal(typeof RICH_TEXT_CLASSES[key], 'string', key);
		assert.ok(RICH_TEXT_CLASSES[key].length > 0, key);
	}
});

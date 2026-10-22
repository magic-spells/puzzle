import test from 'node:test';
import assert from 'node:assert/strict';
import {
	BLOCK_KINDS,
	INSERT_COMMANDS,
	DELETE_COMMAND,
	slashCommands,
	blockMenuCommands,
	filterCommands,
	slashQueryAt,
	lineKind,
	styleMenuCommands,
	styleLabel,
} from '../registry/lib/rich-text-blocks.js';

const ids = (cmds) => cmds.map((c) => c.id);

// ---- command lists --------------------------------------------------------

test('slashCommands: every kind plus Link by default; Image only with an upload handler', () => {
	assert.deepEqual(ids(slashCommands()), [...ids(BLOCK_KINDS), 'link']);
	assert.deepEqual(ids(slashCommands({ canUpload: true })), [...ids(BLOCK_KINDS), 'image', 'link']);
});

test('slashCommands follows `tools`; Text is always offered', () => {
	const notes = ['style', 'marks', 'lists', 'quote', 'link', 'image'];
	assert.deepEqual(ids(slashCommands({ tools: notes, canUpload: true })), [
		'paragraph', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'blockquote', 'image', 'link',
	]);
	assert.deepEqual(ids(slashCommands({ tools: [], canUpload: true })), ['paragraph']);
	assert.deepEqual(ids(slashCommands({ tools: ['codeBlock', 'image'] })), ['paragraph', 'codeBlock']);
});

test('blockMenuCommands: enabled kinds, current flagged, Delete last', () => {
	const cmds = blockMenuCommands({ tools: ['style', 'lists'], kind: 'heading2' });
	assert.deepEqual(ids(cmds), [
		'paragraph', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'delete',
	]);
	assert.deepEqual(cmds.filter((c) => c.current).map((c) => c.id), ['heading2']);
	assert.equal(cmds[cmds.length - 1], DELETE_COMMAND);
	// The shared table is never mutated by the flag.
	assert.equal(BLOCK_KINDS.some((c) => c.current), false);
});

test('blockMenuCommands: an atom line only offers Delete; insert rows never appear', () => {
	assert.deepEqual(ids(blockMenuCommands({ kind: 'image' })), ['delete']);
	assert.deepEqual(ids(blockMenuCommands({ kind: 'linkPreview' })), ['delete']);
	assert.equal(ids(blockMenuCommands({ kind: 'paragraph' })).some((id) => INSERT_COMMANDS.some((c) => c.id === id)), false);
});

// ---- filtering ------------------------------------------------------------

test('filterCommands matches label or keywords, case-insensitively, trimmed', () => {
	const all = slashCommands({ canUpload: true });
	assert.deepEqual(ids(filterCommands(all, '')), ids(all));
	assert.deepEqual(ids(filterCommands(all, '  ')), ids(all));
	assert.deepEqual(ids(filterCommands(all, 'head')), ['heading1', 'heading2', 'heading3']);
	assert.deepEqual(ids(filterCommands(all, 'H2')), ['heading2']);
	assert.deepEqual(ids(filterCommands(all, 'list')), ['bulletList', 'orderedList']);
	assert.deepEqual(ids(filterCommands(all, 'ul')), ['bulletList']);
	assert.deepEqual(ids(filterCommands(all, 'photo')), ['image']);
	assert.deepEqual(ids(filterCommands(all, 'zzz')), []);
	assert.deepEqual(ids(filterCommands(all, null)), ids(all));
});

// ---- the "/" trigger ------------------------------------------------------

test('slashQueryAt: "/" at line start or after whitespace opens a query', () => {
	assert.deepEqual(slashQueryAt('/'), { offset: 0, query: '' });
	assert.deepEqual(slashQueryAt('/hea'), { offset: 0, query: 'hea' });
	assert.deepEqual(slashQueryAt('notes /'), { offset: 6, query: '' });
	assert.deepEqual(slashQueryAt('notes\t/li'), { offset: 6, query: 'li' });
	assert.deepEqual(slashQueryAt('a/b /x'), { offset: 4, query: 'x' });
});

test('slashQueryAt: no trigger mid-word, after a space in the query, or without "/"', () => {
	assert.equal(slashQueryAt(''), null);
	assert.equal(slashQueryAt('plain text'), null);
	assert.equal(slashQueryAt('and/or'), null);
	assert.equal(slashQueryAt('https://x'), null);
	assert.equal(slashQueryAt('/heading two'), null);
	assert.equal(slashQueryAt('/ '), null);
	assert.equal(slashQueryAt(undefined), null);
});

// ---- line kinds -----------------------------------------------------------

test('lineKind maps an ancestor path to a block kind', () => {
	const p = (...types) => types.map((t) => (typeof t === 'string' ? { type: t } : t));
	assert.equal(lineKind(p('paragraph')), 'paragraph');
	assert.equal(lineKind(p({ type: 'heading', level: 2 })), 'heading2');
	assert.equal(lineKind(p({ type: 'heading', level: 4 })), 'heading4');
	assert.equal(lineKind(p('bulletList', 'listItem', 'paragraph')), 'bulletList');
	assert.equal(lineKind(p('orderedList', 'listItem', 'paragraph')), 'orderedList');
	// The nearest list wins over an outer list or quote.
	assert.equal(lineKind(p('bulletList', 'listItem', 'orderedList', 'listItem', 'paragraph')), 'orderedList');
	assert.equal(lineKind(p('blockquote', 'bulletList', 'listItem', 'paragraph')), 'bulletList');
	assert.equal(lineKind(p('blockquote', 'paragraph')), 'blockquote');
	// A heading or code line keeps its own kind inside a container.
	assert.equal(lineKind(p('blockquote', { type: 'heading', level: 1 })), 'heading1');
	assert.equal(lineKind(p('codeBlock')), 'codeBlock');
	assert.equal(lineKind(p('image')), 'image');
	assert.equal(lineKind(p('linkPreview')), 'linkPreview');
	assert.equal(lineKind([]), 'paragraph');
	assert.equal(lineKind(null), 'paragraph');
});

// ---- the selection bar's style picker -------------------------------------

test('styleMenuCommands: Text plus Heading 1–3, current flagged, following `tools`', () => {
	const cmds = styleMenuCommands({ kind: 'heading3' });
	assert.deepEqual(ids(cmds), ['paragraph', 'heading1', 'heading2', 'heading3']);
	assert.deepEqual(cmds.filter((c) => c.current).map((c) => c.id), ['heading3']);
	assert.deepEqual(ids(styleMenuCommands({ tools: ['marks'] })), ['paragraph']);
	// A list line is not a style; nothing is flagged.
	assert.equal(styleMenuCommands({ kind: 'bulletList' }).some((c) => c.current), false);
});

test('styleLabel names the picker for a line kind', () => {
	assert.equal(styleLabel('paragraph'), 'Text');
	assert.equal(styleLabel('heading2'), 'Heading 2');
	assert.equal(styleLabel('heading4'), 'Text');
	assert.equal(styleLabel('bulletList'), 'Text');
	assert.equal(styleLabel(undefined), 'Text');
});

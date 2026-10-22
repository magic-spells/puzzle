// Block-mode command model for RichTextEditor's chrome="blocks" (the
// Notion-style editor: gutter handle, "/" menu, selection bubble).
//
// Pure JS, no DOM, no Tiptap — the editor maps these ids onto Tiptap commands.
// The command table, its keyword filter and the "/" trigger rule follow the
// Grimoire example's block editor (packages/puzzle/examples/grimoire): the same
// labels, glyph badges and keywords, the same "label or keyword contains the
// query" match, and the same trigger — a "/" at the start of a line or after a
// space, with a query that ends at the first whitespace.
//
// Registry lib file: copied to app/lib/rich-text-blocks.js; unit-tested DOM-free.

// Turn-into kinds, in menu order. `tool` is the RichTextEditor `tools` group
// that enables the row (null = always offered).
export const BLOCK_KINDS = [
	{ id: 'paragraph', label: 'Text', glyph: '¶', keywords: 'text plain paragraph body', tool: null },
	{ id: 'heading1', label: 'Heading 1', glyph: 'H1', keywords: 'heading title big h1', tool: 'style' },
	{ id: 'heading2', label: 'Heading 2', glyph: 'H2', keywords: 'heading subtitle h2', tool: 'style' },
	{ id: 'heading3', label: 'Heading 3', glyph: 'H3', keywords: 'heading subheading h3', tool: 'style' },
	{ id: 'bulletList', label: 'Bulleted list', glyph: '•', keywords: 'bullet unordered ul list point', tool: 'lists' },
	{ id: 'orderedList', label: 'Numbered list', glyph: '1.', keywords: 'numbered ordered ol list', tool: 'lists' },
	{ id: 'blockquote', label: 'Quote', glyph: '❝', keywords: 'quote blockquote citation', tool: 'quote' },
	{ id: 'codeBlock', label: 'Code', glyph: '</>', keywords: 'code snippet monospace pre', tool: 'codeBlock' },
];

// Insert-only rows, offered by the "/" menu after the kinds. Image also needs
// an uploadImage handler.
export const INSERT_COMMANDS = [
	{ id: 'image', label: 'Image', glyph: '▣', keywords: 'image picture photo upload media', tool: 'image', insert: true },
	{ id: 'link', label: 'Link', glyph: '↗', keywords: 'link url href web', tool: 'link', insert: true },
];

export const DELETE_COMMAND = {
	id: 'delete',
	label: 'Delete',
	glyph: '×',
	keywords: 'delete remove trash',
	danger: true,
};

const ATOM_KINDS = new Set(['image', 'linkPreview']);

function toolSet(tools) {
	return Array.isArray(tools) ? new Set(tools) : null; // null = every tool
}

function enabled(cmd, set) {
	return cmd.tool == null || set == null || set.has(cmd.tool);
}

// The "/" menu: the enabled kinds, then Image (only with an upload handler)
// and Link.
export function slashCommands({ tools, canUpload = false } = {}) {
	const set = toolSet(tools);
	return [
		...BLOCK_KINDS.filter((c) => enabled(c, set)),
		...INSERT_COMMANDS.filter((c) => enabled(c, set) && (c.id !== 'image' || canUpload)),
	];
}

// The handle's block menu for a line of `kind`: the enabled kinds (the current
// one flagged `current`), then Delete. An atom line (image, link preview) has
// nothing to turn into, so it gets Delete alone.
export function blockMenuCommands({ tools, kind } = {}) {
	if (ATOM_KINDS.has(kind)) return [DELETE_COMMAND];
	const set = toolSet(tools);
	return [
		...BLOCK_KINDS.filter((c) => enabled(c, set)).map((c) =>
			c.id === kind ? { ...c, current: true } : c
		),
		DELETE_COMMAND,
	];
}

// The selection bar's text-style picker: Text, then Heading 1–3 when the
// 'style' group is on, the line's current kind flagged.
export function styleMenuCommands({ tools, kind } = {}) {
	const set = toolSet(tools);
	return BLOCK_KINDS.filter(
		(c) => c.id === 'paragraph' || (c.tool === 'style' && enabled(c, set))
	).map((c) => (c.id === kind ? { ...c, current: true } : c));
}

// The picker button's label for a line kind: the matching style's label,
// "Text" for anything else (a list line, a quote line).
export function styleLabel(kind) {
	const hit = BLOCK_KINDS.find((c) => c.id === kind && (c.id === 'paragraph' || c.tool === 'style'));
	return hit ? hit.label : 'Text';
}

// Case-insensitive: a row matches when its label or its keywords contain the
// trimmed query. An empty query keeps every row.
export function filterCommands(commands, query) {
	const q = String(query ?? '').trim().toLowerCase();
	if (!q) return commands.slice();
	return commands.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.includes(q));
}

// Given the text of a line BEFORE the caret, find an active "/" command:
// returns { offset, query } where offset is the index of the "/", or null.
// The "/" must start the line or follow whitespace, and the query (everything
// after it up to the caret) must hold no whitespace.
export function slashQueryAt(textBefore) {
	const text = String(textBefore ?? '');
	const at = text.lastIndexOf('/');
	if (at === -1) return null;
	if (at > 0 && !/\s/.test(text[at - 1])) return null;
	const query = text.slice(at + 1);
	if (/\s/.test(query)) return null;
	return { offset: at, query };
}

// The block kind of a line, from its ancestor path: an array of
// { type, level? } from the outermost block down to the line itself, using
// Tiptap node names (paragraph, heading, bulletList, orderedList, listItem,
// blockquote, codeBlock, image, linkPreview). The line's own type wins for
// headings, code and atoms; otherwise the nearest list decides, then a quote,
// then it is plain text.
export function lineKind(path) {
	const nodes = Array.isArray(path) ? path : [];
	const line = nodes[nodes.length - 1];
	if (!line) return 'paragraph';
	if (line.type === 'heading') return `heading${line.level || 1}`;
	if (line.type === 'codeBlock' || ATOM_KINDS.has(line.type)) return line.type;
	for (let i = nodes.length - 2; i >= 0; i--) {
		const t = nodes[i].type;
		if (t === 'bulletList' || t === 'orderedList') return t;
		if (t === 'blockquote') return 'blockquote';
	}
	return 'paragraph';
}

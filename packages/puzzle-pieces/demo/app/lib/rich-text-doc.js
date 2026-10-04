// Rich text document contract shared by the RichTextEditor and RichText pieces.
//
// THE FORMAT IS THE CONTRACT, THE EDITOR IS AN IMPLEMENTATION DETAIL. What
// consumers store — and what RichTextEditor's @change emits / `value` accepts —
// is this node tree, a superset of Shopify's rich-text metafield format:
//
//   { type: 'root',       children: [block…] }
//   { type: 'paragraph',  align?: 'center'|'right', children: [inline…] }
//   { type: 'heading',    level: 1–6, align?, children: [inline…] }
//   { type: 'list',       listType: 'ordered'|'unordered', children: [list-item…] }
//   { type: 'list-item',  children: [inline… | nested list…] }
//   { type: 'blockquote', children: [block…] }                    (ours)
//   { type: 'code-block', children: [{ type:'text', value }] }    (ours)
//   { type: 'link',       url, title?, target?, children: [text…] }
//   { type: 'text',       value, bold?, italic?, underline?, strike? }
//
// Two atom blocks, allowed ONLY as direct children of root (never inside a
// blockquote or a list item):
//
//   { type: 'image',        ref, alt?, caption?, width?, height? }
//   { type: 'link-preview', url, title?, description?, siteName?, imageRef? }
//
// An image never carries a URL: `ref` is an opaque id the HOST app resolves to
// a src (the pieces' `resolveImage(ref, node)` prop), so signed or expiring
// URLs never get baked into stored content. A link preview is a snapshot taken
// when the link was pasted — its text fields render as text only, `url` goes
// through safePreviewUrl() (absolute http/https), and `imageRef` resolves the
// same way an image's `ref` does. width/height are positive integers (layout
// hints, so the box is reserved before the image loads).
//
// `align` omitted means left. underline/strike flags, blockquote, code-block,
// align, image and link-preview are our extensions — a doc that avoids them is
// byte-compatible with Shopify's format. Newlines inside a text `value` are
// soft line breaks.
//
// fromTiptap()/toTiptap() convert against Tiptap's ProseMirror JSON so the
// editor engine stays swappable. Three deliberate normalizations (stable after
// one editor pass): Tiptap link MARKS group into link NODES, a list item
// with several paragraphs flattens to newline-separated inline content, and an
// empty text node ({ value: '' }) is dropped rather than written out. Empty
// optional fields on the two atoms (alt: '', a width that isn't a positive
// integer) are dropped the same way, and an atom found anywhere but root
// level is dropped, as unknown nodes are.
//
// A STORED DOC IS UNTRUSTED INPUT — specifically every `link.url` in it. Docs
// arrive from databases, APIs, imports and pastes, and a `javascript:` URL that
// reaches an href is script execution in your page. Never assign `link.url` to
// an href yourself; run it through safeLinkUrl() below, which is the one policy
// both the RichText renderer and the RichTextEditor enforce. A link preview's
// `url` takes the stricter safePreviewUrl().
//
// validateDoc(doc, limits) checks a doc against the strict shape above plus the
// size limits in `docLimits` (a server should enforce the same rules; this is
// the client-side pre-check). plainText(doc) flattens a doc for search and
// previews; imageRefs(doc) lists every image id a doc references.
//
// Registry lib file: copied to app/lib/rich-text-doc.js. Pure JS, no DOM —
// unit-tested DOM-free in the repo's test/ suite.

export function emptyDoc() {
	return { type: 'root', children: [] };
}

function textOf(node) {
	if (node.type === 'text') return node.value || '';
	return (node.children || []).map(textOf).join('');
}

// Empty = nothing but (possibly whitespace-only) paragraphs. Any other block
// type counts as content even before it has text (an empty list still renders).
export function isEmpty(doc) {
	if (!doc || !Array.isArray(doc.children) || doc.children.length === 0) return true;
	return doc.children.every(
		(n) => n.type === 'paragraph' && textOf(n).trim() === ''
	);
}

// The single URL policy for `link.url`, applied at BOTH ends: RichText runs it
// before setting an href, and RichTextEditor hands it to Tiptap's Link
// `isAllowedUri` so the editor refuses to create what the renderer would refuse
// to link. Returns the url unchanged when allowed, or null when rejected.
//
// Allowed: relative forms (leading /, #, ?, . — or no scheme at all before the
// first /?# boundary) and the https, http, mailto and tel schemes. Everything
// else is rejected, `javascript:` and `data:` being the ones that matter.
export function safeLinkUrl(url) {
	const raw = String(url ?? '');
	// URL parsers strip tab and newline characters BEFORE parsing (WHATWG), so
	// "java\nscript:alert(1)" reaches the browser as "javascript:alert(1)" and a
	// naive test on the raw string sees a harmless scheme-less path. Test a
	// stripped copy, but return the ORIGINAL — stripping is for the check only.
	const test = raw.replace(/[\t\n\r]/g, '');
	const colon = test.indexOf(':');
	const boundary = test.search(/[/?#]/);
	const relative = /^[/#?.]/.test(test);
	const noScheme = colon === -1 || (boundary !== -1 && boundary < colon);
	const allowedScheme = colon > 0 && /^(https?|mailto|tel)$/i.test(test.slice(0, colon));
	return relative || noScheme || allowedScheme ? raw : null;
}

// The URL policy for `link-preview.url` — stricter than safeLinkUrl because a
// preview is always an outbound card to another site: an ABSOLUTE http or https
// URL with a host, no userinfo (`https://user@host`), at most `maxLength` code
// points, and no whitespace, control characters or backslashes anywhere (so
// there is nothing for a URL parser to strip or reinterpret). Returns the url
// unchanged when allowed, or null. The editor only turns a paste into a
// preview when this passes, so it never creates a card the renderer refuses.
export function safePreviewUrl(url, maxLength = 2048) {
	if (typeof url !== 'string' || url === '') return null;
	if (codePoints(url) > maxLength) return null;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000- \u007f\\]/.test(url)) return null;
	const m = /^https?:\/\/([^/?#]*)/i.exec(url);
	if (!m) return null;
	const authority = m[1];
	if (authority === '' || authority.includes('@')) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		if (!parsed.hostname) return null;
	} catch {
		return null;
	}
	return url;
}

function codePoints(s) {
	let n = 0;
	for (const _ of s) n++;
	return n;
}

function utf8Length(s) {
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 0x80) n += 1;
		else if (c < 0x800) n += 2;
		else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
			const d = s.charCodeAt(i + 1);
			if (d >= 0xdc00 && d <= 0xdfff) {
				n += 4;
				i++;
			} else n += 3;
		} else n += 3;
	}
	return n;
}

// One source of truth for content typography — the editor feeds these to
// Tiptap as per-node HTMLAttributes and the RichText renderer applies them
// while walking the tree, so WYSIWYG parity is by construction. This file is
// copied into app/lib/, inside Tailwind's scan, so the utilities compile.
// (heading1–heading4 are ALSO mirrored as arbitrary variants in
// RichTextEditor.pzl's content class — Tiptap HTMLAttributes can't vary by
// heading level. Keep the two in sync.)
export const RICH_TEXT_CLASSES = {
	paragraph: 'mt-3 first:mt-0 leading-7 text-body',
	heading1: 'mt-8 first:mt-0 text-3xl font-semibold tracking-tight text-ink',
	heading2: 'mt-6 first:mt-0 text-2xl font-semibold tracking-tight text-ink',
	heading3: 'mt-5 first:mt-0 text-lg font-semibold tracking-tight text-ink',
	heading4: 'mt-4 first:mt-0 text-base font-semibold tracking-tight text-ink',
	list: 'mt-3 first:mt-0 space-y-1 pl-6 text-body',
	bulletList: 'list-disc',
	orderedList: 'list-decimal',
	listItem: 'leading-7',
	blockquote: 'mt-4 first:mt-0 border-l-2 border-border pl-4 italic text-muted',
	codeBlock:
		'mt-4 first:mt-0 overflow-x-auto rounded-lg bg-surface-sunken p-4 font-mono text-[13px]/relaxed text-body whitespace-pre',
	link: 'text-brand underline underline-offset-2 hover:opacity-80',
	// image + link-preview atoms (root level only)
	figure: 'mt-4 first:mt-0',
	image: 'block h-auto max-w-full rounded-lg border border-border',
	imagePlaceholder:
		'flex min-h-32 w-full items-center justify-center rounded-lg border border-dashed ' +
		'border-border-dashed bg-surface-sunken px-4 text-center text-sm text-muted',
	caption: 'mt-2 text-sm leading-6 text-muted',
	preview:
		'mt-4 first:mt-0 flex overflow-hidden rounded-lg border border-border bg-surface ' +
		'no-underline transition-colors hover:bg-surface-sunken',
	previewBody: 'flex min-w-0 flex-1 flex-col gap-1 px-4 py-3',
	previewSite: 'truncate text-xs text-muted',
	previewTitle: 'line-clamp-2 text-sm font-medium leading-6 text-ink',
	previewDescription: 'line-clamp-2 text-sm leading-6 text-body',
	previewImage: 'w-28 shrink-0 bg-surface-sunken object-cover sm:w-40',
};

// ---- Tiptap (ProseMirror JSON) → doc tree ---------------------------------

function markFlags(pmText) {
	const t = { type: 'text', value: pmText.text || '' };
	for (const m of pmText.marks || []) {
		if (m.type === 'bold') t.bold = true;
		else if (m.type === 'italic') t.italic = true;
		else if (m.type === 'underline') t.underline = true;
		else if (m.type === 'strike') t.strike = true;
	}
	return t;
}

// Tiptap models links as marks on text runs; the contract models them as
// nodes wrapping their texts. Adjacent runs sharing identical link attrs
// group into one link node.
function inlineFromPm(nodes) {
	const out = [];
	let link = null;
	let linkKey = null;
	for (const n of nodes || []) {
		if (n.type === 'hardBreak') {
			link = null;
			out.push({ type: 'text', value: '\n' });
			continue;
		}
		if (n.type !== 'text') continue;
		const mark = (n.marks || []).find((m) => m.type === 'link');
		if (!mark) {
			link = null;
			out.push(markFlags(n));
			continue;
		}
		const attrs = mark.attrs || {};
		const key = JSON.stringify([attrs.href || '', attrs.title || '', attrs.target || '']);
		if (!link || key !== linkKey) {
			link = { type: 'link', url: attrs.href || '', children: [] };
			if (attrs.title) link.title = attrs.title;
			if (attrs.target) link.target = attrs.target;
			linkKey = key;
			out.push(link);
		}
		link.children.push(markFlags(n));
	}
	return out;
}

function withAlign(node, pmNode) {
	const a = pmNode.attrs && pmNode.attrs.textAlign;
	if (a === 'center' || a === 'right') node.align = a;
	return node;
}

// List items flatten paragraph wrappers to inline content: paragraphs join
// with '\n' texts, nested lists ride along as blocks (Shopify's shape).
//
// A nested list is itself a block boundary, so the paragraph after one starts a
// fresh run — no '\n' separator. That reset is what keeps the conversion
// idempotent: listItemToPm folds a leading '\n' into the trailing paragraph as
// a hardBreak rather than consuming it, so emitting a separator here would make
// every round-trip prepend one more newline to a [paragraph, list, paragraph]
// item. Both shapes ('A', list, 'B') and a legacy ('A', list, '\n', 'B') are
// fixed points.
function listItemChildrenFromPm(nodes) {
	const out = [];
	let sawParagraph = false;
	for (const n of nodes || []) {
		if (n.type === 'paragraph') {
			if (sawParagraph) out.push({ type: 'text', value: '\n' });
			out.push(...inlineFromPm(n.content));
			sawParagraph = true;
		} else if (n.type === 'bulletList' || n.type === 'orderedList') {
			out.push(listFromPm(n));
			sawParagraph = false;
		}
	}
	return out;
}

function listFromPm(pmList) {
	return {
		type: 'list',
		listType: pmList.type === 'orderedList' ? 'ordered' : 'unordered',
		children: (pmList.content || []).map((li) => ({
			type: 'list-item',
			children: listItemChildrenFromPm(li.content),
		})),
	};
}

function nonEmptyString(v) {
	return typeof v === 'string' && v !== '';
}

function positiveInt(v) {
	return Number.isInteger(v) && v > 0;
}

// Copy the named optional fields that hold a usable value; anything else is
// left off (absent, never null) so the emitted doc stays validateDoc-clean.
function copyFields(target, attrs, strings, ints = []) {
	for (const k of strings) if (nonEmptyString(attrs[k])) target[k] = attrs[k];
	for (const k of ints) if (positiveInt(attrs[k])) target[k] = attrs[k];
	return target;
}

// Tiptap node names for the two atoms: `image` and `linkPreview`. Their attrs
// carry the doc fields 1:1; any extra editor-only attr (an in-flight marker)
// is not copied, so it can never reach a stored doc.
function imageFromPm(n) {
	const attrs = n.attrs || {};
	if (!nonEmptyString(attrs.ref)) return null;
	return copyFields({ type: 'image', ref: attrs.ref }, attrs, ['alt', 'caption'], ['width', 'height']);
}

function linkPreviewFromPm(n) {
	const attrs = n.attrs || {};
	if (!nonEmptyString(attrs.url)) return null;
	return copyFields(
		{ type: 'link-preview', url: attrs.url },
		attrs,
		['title', 'description', 'siteName', 'imageRef']
	);
}

function blocksFromPm(nodes, atRoot = false) {
	const out = [];
	for (const n of nodes || []) {
		switch (n.type) {
			case 'image': {
				const img = atRoot ? imageFromPm(n) : null;
				if (img) out.push(img);
				break;
			}
			case 'linkPreview': {
				const lp = atRoot ? linkPreviewFromPm(n) : null;
				if (lp) out.push(lp);
				break;
			}
			case 'paragraph':
				out.push(withAlign({ type: 'paragraph', children: inlineFromPm(n.content) }, n));
				break;
			case 'heading':
				out.push(
					withAlign(
						{
							type: 'heading',
							level: (n.attrs && n.attrs.level) || 2,
							children: inlineFromPm(n.content),
						},
						n
					)
				);
				break;
			case 'bulletList':
			case 'orderedList':
				out.push(listFromPm(n));
				break;
			case 'blockquote':
				out.push({ type: 'blockquote', children: blocksFromPm(n.content) });
				break;
			case 'codeBlock':
				out.push({
					type: 'code-block',
					children: [
						{ type: 'text', value: (n.content || []).map((t) => t.text || '').join('') },
					],
				});
				break;
			default:
				// Unknown block types are dropped rather than guessed at.
				break;
		}
	}
	return out;
}

export function fromTiptap(pmJson) {
	return { type: 'root', children: blocksFromPm(pmJson && pmJson.content, true) };
}

// ---- doc tree → Tiptap (ProseMirror JSON) ---------------------------------

function textToPm(t, linkAttrs) {
	const parts = String(t.value ?? '').split('\n');
	const out = [];
	parts.forEach((part, i) => {
		if (i > 0) out.push({ type: 'hardBreak' });
		if (!part) return;
		const marks = [];
		if (t.bold) marks.push({ type: 'bold' });
		if (t.italic) marks.push({ type: 'italic' });
		if (t.underline) marks.push({ type: 'underline' });
		if (t.strike) marks.push({ type: 'strike' });
		if (linkAttrs) marks.push({ type: 'link', attrs: { ...linkAttrs } });
		const node = { type: 'text', text: part };
		if (marks.length) node.marks = marks;
		out.push(node);
	});
	return out;
}

function inlineToPm(nodes) {
	const out = [];
	for (const n of nodes || []) {
		if (n.type === 'text') {
			out.push(...textToPm(n, null));
		} else if (n.type === 'link') {
			const attrs = { href: n.url || '' };
			if (n.title) attrs.title = n.title;
			if (n.target) attrs.target = n.target;
			for (const c of n.children || []) {
				if (c.type === 'text') out.push(...textToPm(c, attrs));
			}
		}
	}
	return out;
}

function alignAttrs(n) {
	return n.align === 'center' || n.align === 'right' ? { textAlign: n.align } : null;
}

function paragraphToPm(inline, align) {
	const p = { type: 'paragraph' };
	if (align) p.attrs = align;
	if (inline.length) p.content = inline;
	return p;
}

// Inverse of listItemChildrenFromPm: the inline run becomes the item's lead
// paragraph ('\n' texts become hardBreaks inside it, not paragraph splits —
// visually identical and stable), nested lists follow as blocks. ProseMirror's
// listItem wants a leading paragraph, so one is emitted even when empty.
function listItemToPm(li) {
	const content = [];
	let run = [];
	for (const c of li.children || []) {
		if (c.type === 'list') {
			if (run.length || content.length === 0) {
				content.push(paragraphToPm(inlineToPm(run), null));
				run = [];
			}
			content.push(listToPm(c));
		} else {
			run.push(c);
		}
	}
	if (run.length || content.length === 0) {
		content.push(paragraphToPm(inlineToPm(run), null));
	}
	return { type: 'listItem', content };
}

function listToPm(list) {
	return {
		type: list.listType === 'ordered' ? 'orderedList' : 'bulletList',
		content: (list.children || []).map(listItemToPm),
	};
}

function blocksToPm(nodes, atRoot = false) {
	const out = [];
	for (const n of nodes || []) {
		switch (n.type) {
			case 'image':
				if (atRoot && nonEmptyString(n.ref)) {
					out.push({
						type: 'image',
						attrs: copyFields({ ref: n.ref }, n, ['alt', 'caption'], ['width', 'height']),
					});
				}
				break;
			case 'link-preview':
				if (atRoot && nonEmptyString(n.url)) {
					out.push({
						type: 'linkPreview',
						attrs: copyFields({ url: n.url }, n, ['title', 'description', 'siteName', 'imageRef']),
					});
				}
				break;
			case 'paragraph':
				out.push(paragraphToPm(inlineToPm(n.children), alignAttrs(n)));
				break;
			case 'heading': {
				const h = { type: 'heading', attrs: { level: n.level || 2, ...(alignAttrs(n) || {}) } };
				const inline = inlineToPm(n.children);
				if (inline.length) h.content = inline;
				out.push(h);
				break;
			}
			case 'list':
				out.push(listToPm(n));
				break;
			case 'blockquote':
				out.push({ type: 'blockquote', content: blocksToPm(n.children) });
				break;
			case 'code-block': {
				const value = (n.children || []).map((t) => t.value || '').join('');
				const cb = { type: 'codeBlock' };
				if (value) cb.content = [{ type: 'text', text: value }];
				out.push(cb);
				break;
			}
			default:
				break;
		}
	}
	return out;
}

export function toTiptap(doc) {
	const content = blocksToPm(doc && doc.children, true);
	// ProseMirror requires at least one block in a doc.
	return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

// ---- plain text -------------------------------------------------------------

// The doc flattened to text, for search indexes, list previews and "copy my
// text" fallbacks. Every block contributes its lines in document order and the
// lines join with '\n':
//   paragraph / heading   its inline text (link texts included, link urls not;
//                         a soft break stays a '\n')
//   list                  one line per item's inline run, nested lists after it
//   blockquote            its blocks' lines
//   code-block            its text
//   image                 alt, then caption
//   link-preview          title, then description, then url
// A line that is empty or whitespace-only is skipped, and NUL characters are
// removed. Unknown node types contribute nothing.
export function plainText(doc) {
	const lines = [];
	const push = (s) => {
		if (typeof s !== 'string') return;
		const clean = s.replace(/\u0000/g, '');
		if (clean.trim() !== '') lines.push(clean);
	};
	const inline = (nodes) => (nodes || []).map((n) => (n && n.type === 'text' ? n.value || '' : n && n.type === 'link' ? inline(n.children) : '')).join('');
	const block = (n) => {
		if (!n || typeof n !== 'object') return;
		switch (n.type) {
			case 'paragraph':
			case 'heading':
				push(inline(n.children));
				break;
			case 'list':
				for (const li of n.children || []) {
					let run = [];
					for (const c of (li && li.children) || []) {
						if (c && c.type === 'list') {
							push(inline(run));
							run = [];
							block(c);
						} else run.push(c);
					}
					push(inline(run));
				}
				break;
			case 'blockquote':
				for (const c of n.children || []) block(c);
				break;
			case 'code-block':
				push(inline(n.children));
				break;
			case 'image':
				push(n.alt);
				push(n.caption);
				break;
			case 'link-preview':
				push(n.title);
				push(n.description);
				push(n.url);
				break;
			default:
				break;
		}
	};
	for (const n of (doc && doc.children) || []) block(n);
	return lines.join('\n');
}

// Every image id the doc references — image `ref`s and link-preview
// `imageRef`s — once each, in document order. Walks the whole tree, so a
// misplaced atom still counts.
export function imageRefs(doc) {
	const seen = new Set();
	const walk = (n) => {
		if (!n || typeof n !== 'object') return;
		if (n.type === 'image' && nonEmptyString(n.ref)) seen.add(n.ref);
		if (n.type === 'link-preview' && nonEmptyString(n.imageRef)) seen.add(n.imageRef);
		if (Array.isArray(n.children)) n.children.forEach(walk);
	};
	walk(doc);
	return [...seen];
}

// ---- validation -------------------------------------------------------------

// Default limits for validateDoc. Byte limits count UTF-8 bytes; the other
// length caps count Unicode code points. Depth counts BLOCK nesting only: root
// is 0, each paragraph / heading / list / list-item / blockquote / code-block /
// image / link-preview is one deeper than its parent, and inline nodes (text,
// link) add nothing — so six nested lists (list-item at depth 12) fit exactly.
// List depth counts list nodes on the path, the outermost list being 1.
export const docLimits = Object.freeze({
	maxBytes: 262144, // JSON.stringify(doc), UTF-8
	maxNodes: 5000, // every node object, root and text nodes included
	maxDepth: 12,
	maxListDepth: 6,
	maxImages: 50,
	maxLinkPreviews: 50,
	maxTextBytes: 32768, // one text node's value, UTF-8
	maxHeadingLevel: 4,
	maxUrlLength: 2048, // link.url and link-preview.url
	maxPreviewTitle: 300,
	maxPreviewDescription: 1000,
	maxPreviewSiteName: 200,
	maxAlt: 500,
	maxCaption: 500,
});

const TEXT_KEYS = ['value', 'bold', 'italic', 'underline', 'strike'];
const NODE_SPEC = {
	root: { keys: ['children'], content: 'root' },
	paragraph: { keys: ['align', 'children'], content: 'inline' },
	heading: { keys: ['level', 'align', 'children'], content: 'inline' },
	list: { keys: ['listType', 'children'], content: 'list' },
	'list-item': { keys: ['children'], content: 'listItem' },
	blockquote: { keys: ['children'], content: 'block' },
	'code-block': { keys: ['children'], content: 'text' },
	link: { keys: ['url', 'title', 'target', 'children'], content: 'text' },
	text: { keys: TEXT_KEYS },
	image: { keys: ['ref', 'alt', 'caption', 'width', 'height'] },
	'link-preview': { keys: ['url', 'title', 'description', 'siteName', 'imageRef'] },
};
const BLOCKS = ['paragraph', 'heading', 'list', 'blockquote', 'code-block'];
const CONTENT = {
	root: [...BLOCKS, 'image', 'link-preview'],
	block: BLOCKS,
	inline: ['text', 'link'],
	list: ['list-item'],
	listItem: ['text', 'link', 'list'],
	text: ['text'],
};
const INLINE = new Set(['text', 'link']);

class DocError extends Error {
	constructor(code, path, message) {
		super(message);
		this.code = code;
		this.path = path;
	}
}

// Validate a doc against the strict format above. Returns { ok: true } or
// { ok: false, code, path, message } for the FIRST problem found, where `path`
// addresses the node like `children[3].children[0]` ('' = the root / the whole
// body). Codes: invalid, too_large, too_many_nodes, too_deep, list_too_deep,
// too_many_images, too_many_link_previews, unknown_type, not_allowed (a known
// node in the wrong place, e.g. an image inside a blockquote), unknown_key,
// text_too_long. Optional fields must be absent or a valid value (null is not
// accepted). `limits` overrides individual entries of docLimits. It does not
// check that an image `ref` exists — only the host knows that.
export function validateDoc(doc, limits) {
	const L = { ...docLimits, ...(limits || {}) };
	try {
		let json;
		try {
			json = JSON.stringify(doc);
		} catch {
			throw new DocError('invalid', '', 'body is not serializable JSON');
		}
		if (typeof json !== 'string') throw new DocError('invalid', '', 'body must be an object');
		if (utf8Length(json) > L.maxBytes) {
			throw new DocError('too_large', '', `body is larger than ${L.maxBytes} bytes`);
		}
		if (!isPlainObject(doc) || doc.type !== 'root') {
			throw new DocError('invalid', '', 'body must be a root node');
		}
		const counts = { nodes: 0, images: 0, previews: 0 };
		checkNode(doc, '', 0, 0, L, counts);
		return { ok: true };
	} catch (e) {
		if (e instanceof DocError) return { ok: false, code: e.code, path: e.path, message: e.message };
		throw e;
	}
}

function isPlainObject(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkNode(node, path, depth, listDepth, L, counts) {
	const at = path || 'root';
	if (++counts.nodes > L.maxNodes) {
		throw new DocError('too_many_nodes', path, `more than ${L.maxNodes} nodes`);
	}
	// The list rule is the more specific one, so it reports first.
	if (node.type === 'list' && listDepth + 1 > L.maxListDepth) {
		throw new DocError('list_too_deep', path, `lists nested deeper than ${L.maxListDepth}`);
	}
	if (depth > L.maxDepth) throw new DocError('too_deep', path, `nesting deeper than ${L.maxDepth}`);
	const spec = NODE_SPEC[node.type];
	for (const key of Object.keys(node)) {
		if (key !== 'type' && !spec.keys.includes(key)) {
			throw new DocError('unknown_key', path, `${at}: unknown key "${key}" on ${node.type}`);
		}
	}
	const bad = (msg) => new DocError('invalid', path, `${at}: ${msg}`);
	const optString = (key, max) => {
		if (!(key in node)) return;
		if (typeof node[key] !== 'string') throw bad(`${key} must be a string`);
		if (max != null && codePoints(node[key]) > max) {
			throw bad(`${key} is longer than ${max} characters`);
		}
	};
	const optAlign = () => {
		if ('align' in node && node.align !== 'center' && node.align !== 'right') {
			throw bad('align must be "center" or "right"');
		}
	};
	switch (node.type) {
		case 'paragraph':
			optAlign();
			break;
		case 'heading':
			if (!Number.isInteger(node.level) || node.level < 1 || node.level > L.maxHeadingLevel) {
				throw bad(`heading level must be 1–${L.maxHeadingLevel}`);
			}
			optAlign();
			break;
		case 'list':
			if (node.listType !== 'ordered' && node.listType !== 'unordered') {
				throw bad('listType must be "ordered" or "unordered"');
			}
			listDepth++;
			break;
		case 'link':
			if (typeof node.url !== 'string' || safeLinkUrl(node.url) == null) {
				throw bad('link url is not allowed');
			}
			if (codePoints(node.url) > L.maxUrlLength) {
				throw bad(`link url is longer than ${L.maxUrlLength} characters`);
			}
			optString('title');
			if ('target' in node && node.target !== '_blank') throw bad('link target must be "_blank"');
			break;
		case 'text':
			if (typeof node.value !== 'string') throw bad('text value must be a string');
			if (utf8Length(node.value) > L.maxTextBytes) {
				throw new DocError('text_too_long', path, `${at}: text longer than ${L.maxTextBytes} bytes`);
			}
			for (const flag of TEXT_KEYS.slice(1)) {
				if (flag in node && typeof node[flag] !== 'boolean') throw bad(`${flag} must be a boolean`);
			}
			break;
		case 'image':
			if (++counts.images > L.maxImages) {
				throw new DocError('too_many_images', path, `more than ${L.maxImages} images`);
			}
			if (!nonEmptyString(node.ref)) throw bad('image ref must be a non-empty string');
			optString('alt', L.maxAlt);
			optString('caption', L.maxCaption);
			for (const k of ['width', 'height']) {
				if (k in node && !positiveInt(node[k])) throw bad(`${k} must be a positive integer`);
			}
			break;
		case 'link-preview':
			if (++counts.previews > L.maxLinkPreviews) {
				throw new DocError('too_many_link_previews', path, `more than ${L.maxLinkPreviews} link previews`);
			}
			if (safePreviewUrl(node.url, L.maxUrlLength) == null) {
				throw bad('link preview url must be an absolute http(s) url without userinfo');
			}
			optString('title', L.maxPreviewTitle);
			optString('description', L.maxPreviewDescription);
			optString('siteName', L.maxPreviewSiteName);
			if ('imageRef' in node && !nonEmptyString(node.imageRef)) {
				throw bad('imageRef must be a non-empty string');
			}
			break;
		default:
			break;
	}
	if (!spec.content) return;
	if (!Array.isArray(node.children)) throw bad('children must be an array');
	const allowed = CONTENT[spec.content];
	node.children.forEach((child, i) => {
		const childPath = `${path ? `${path}.` : ''}children[${i}]`;
		if (!isPlainObject(child) || typeof child.type !== 'string') {
			throw new DocError('invalid', childPath, `${childPath}: not a node`);
		}
		if (!NODE_SPEC[child.type] || child.type === 'root') {
			throw new DocError('unknown_type', childPath, `${childPath}: unknown node type "${child.type}"`);
		}
		if (!allowed.includes(child.type)) {
			throw new DocError(
				'not_allowed',
				childPath,
				`${childPath}: ${child.type} is not allowed inside ${node.type}`
			);
		}
		const childDepth = INLINE.has(child.type) ? depth : depth + 1;
		checkNode(child, childPath, childDepth, listDepth, L, counts);
	});
}

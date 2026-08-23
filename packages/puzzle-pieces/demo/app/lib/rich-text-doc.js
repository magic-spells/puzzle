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
// `align` omitted means left. underline/strike flags, blockquote, code-block,
// and align are our extensions — a doc that avoids them is byte-compatible
// with Shopify's format. Newlines inside a text `value` are soft line breaks.
//
// fromTiptap()/toTiptap() convert against Tiptap's ProseMirror JSON so the
// editor engine stays swappable. Three deliberate normalizations (stable after
// one editor pass): Tiptap link MARKS group into link NODES, a list item
// with several paragraphs flattens to newline-separated inline content, and an
// empty text node ({ value: '' }) is dropped rather than written out.
//
// A STORED DOC IS UNTRUSTED INPUT — specifically every `link.url` in it. Docs
// arrive from databases, APIs, imports and pastes, and a `javascript:` URL that
// reaches an href is script execution in your page. Never assign `link.url` to
// an href yourself; run it through safeLinkUrl() below, which is the one policy
// both the RichText renderer and the RichTextEditor enforce.
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

function blocksFromPm(nodes) {
	const out = [];
	for (const n of nodes || []) {
		switch (n.type) {
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
	return { type: 'root', children: blocksFromPm(pmJson && pmJson.content) };
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

function blocksToPm(nodes) {
	const out = [];
	for (const n of nodes || []) {
		switch (n.type) {
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
	const content = blocksToPm(doc && doc.children);
	// ProseMirror requires at least one block in a doc.
	return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

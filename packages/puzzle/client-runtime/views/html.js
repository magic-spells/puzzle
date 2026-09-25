/**
 * The live-HTML node (D174): what an interpolation ending in `raw` or
 * `newline_to_br` renders as. Every export is reached from viewManager.js only
 * behind the inline `__PUZZLE_HAS_RAW_HTML__` probe, so an app whose templates
 * never use either formatter ships neither this module nor the sanitizer.
 *
 * DOM shape: `vnode.el` is an empty comment that holds the position, and
 * `vnode.nodes` are the parsed nodes right after it. The comment comes FIRST so
 * `el` is always a valid insertion reference for the sibling before it — the
 * contract every other vnode kind meets with its single node. The patcher never
 * reconciles inside `nodes`: a changed value replaces them all, an unchanged
 * one leaves them untouched, and a keyed move or a removal carries the whole
 * range (htmlTail / moveHtml / unmountHtml).
 */

import { sanitizeHtml, newlineToBr } from '../sanitize.js';

/** The markup a live-HTML vnode renders — shared with the SSG serializer. */
export function htmlOf(vnode) {
	const { value, br } = vnode.attrs;
	return br ? newlineToBr(value) : sanitizeHtml(value);
}

// Parsed through <template>: its content document is inert, so nothing in the
// markup loads or runs until the nodes are inserted — and the sanitizer has
// already removed everything that could run.
function parse(vnode) {
	const t = document.createElement('template');
	t.innerHTML = htmlOf(vnode);
	return [...t.content.childNodes];
}

export function mountHtml(vnode, parent, ref) {
	const start = document.createComment('');
	const nodes = parse(vnode);
	vnode.el = start;
	vnode.nodes = nodes;
	parent.insertBefore(start, ref ?? null);
	for (const node of nodes) parent.insertBefore(node, ref ?? null);
	return start;
}

export function patchHtml(oldVnode, newVnode) {
	const a = oldVnode.attrs;
	const b = newVnode.attrs;
	if (a.value === b.value && !a.br === !b.br) {
		newVnode.nodes = oldVnode.nodes;
		return false;
	}
	for (const node of oldVnode.nodes) node.remove();
	const nodes = parse(newVnode);
	newVnode.nodes = nodes;
	newVnode.el.after(...nodes);
	return true;
}

/** The last DOM node of the range — what a keyed move compares its successor against. */
export function htmlTail(vnode) {
	const nodes = vnode.nodes;
	return nodes?.length ? nodes[nodes.length - 1] : vnode.el;
}

/** Move the whole range before `ref`. */
export function moveHtml(parent, vnode, ref) {
	parent.insertBefore(vnode.el, ref);
	for (const node of vnode.nodes) parent.insertBefore(node, ref);
}

export function unmountHtml(vnode) {
	for (const node of vnode.nodes ?? []) node.remove();
	vnode.el?.remove();
}

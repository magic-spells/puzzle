/**
 * <Component> (D180): a bounded choice of imported component constructors.
 * The selected child is an ordinary component vnode; the surrounding comment
 * range keeps empty and selected content at one sibling position.
 */
import { ViewNode, COMPONENT_SLOT_TAG } from './ViewNode.js';
import { PuzzleView } from './PuzzleView.js';
import { devperfMutation } from '../devperf.js';

/**
 * @param {unknown} value
 * @returns {typeof PuzzleView | null}
 */
function componentClass(value) {
	if (value == null) return null;
	if (typeof value !== 'function' || !(value.prototype instanceof PuzzleView)) {
		throw new TypeError('[puzzle] <Component> expects an imported Puzzle component, or null/undefined');
	}
	return /** @type {typeof PuzzleView} */ (value);
}

/**
 * Compiler support for <Component is={...}>. Children are normal slot content.
 * @param {unknown} value
 * @param {Record<string, any>} [props]
 * @param {ViewNode[]} [children]
 * @returns {ViewNode}
 */
export function dynamicComponent(value, props = {}, children = []) {
	const selected = componentClass(value);
	return new ViewNode(COMPONENT_SLOT_TAG, { key: props.key, selected },
		selected ? [new ViewNode(selected, props, children)] : []);
}

/** @import { PuzzleView as Owner } from './PuzzleView.js' */
/** @typedef {(vnode: ViewNode, parent: Node, ref: Node | null, ctx: object, owner: Owner | null) => Node} Mount */
/** @typedef {(parent: Node, before: ViewNode[], after: ViewNode[], ctx: object, owner: Owner | null, tail: Node | null) => void} PatchChildren */
/** @typedef {(vnode: ViewNode, immediate?: boolean) => void} Unmount */

/**
 * @param {ViewNode} vnode
 * @param {Node} parent
 * @param {Node | null} ref
 * @param {object} ctx
 * @param {Owner | null} owner
 * @param {Mount} mount
 * @returns {Comment}
 */
export function mountComponentSlot(vnode, parent, ref, ctx, owner, mount) {
	const start = document.createComment('');
	const end = document.createComment('');
	vnode.el = start;
	vnode.slotEnd = end;
	parent.insertBefore(start, ref);
	parent.insertBefore(end, ref);
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation(2);
	for (const child of /** @type {ViewNode[]} */ (vnode.children)) mount(child, parent, end, ctx, owner);
	return start;
}

/**
 * Constructor changes destroy the previous child before constructing the next,
 * including pending async mounts and children with leave animations.
 * @param {ViewNode} before
 * @param {ViewNode} after
 * @param {Node} parent
 * @param {object} ctx
 * @param {Owner | null} owner
 * @param {Mount} mount
 * @param {PatchChildren} patchChildren
 * @param {Unmount} unmount
 */
export function patchComponentSlot(before, after, parent, ctx, owner, mount, patchChildren, unmount) {
	after.slotEnd = before.slotEnd;
	const oldChildren = /** @type {ViewNode[]} */ (before.children);
	const children = /** @type {ViewNode[]} */ (after.children);
	if (before.attrs.selected !== after.attrs.selected) {
		for (const child of oldChildren) unmount(child, true);
		for (const child of children) mount(child, parent, after.slotEnd, ctx, owner);
	} else {
		patchChildren(parent, oldChildren, children, ctx, owner, after.slotEnd);
	}
}

/**
 * @param {Node} parent
 * @param {ViewNode} vnode
 * @param {Node | null} ref
 * @param {Node} [end] resolved end when moving a component whose root is a range
 */
export function moveComponentSlot(parent, vnode, ref, end = vnode.slotEnd) {
	let node = vnode.el;
	while (node) {
		const next = node.nextSibling;
		parent.insertBefore(node, ref);
		if (node === end) break;
		node = next;
	}
}

/**
 * @param {ViewNode} vnode
 * @param {Unmount} unmount
 */
export function unmountComponentSlot(vnode, unmount) {
	for (const child of /** @type {ViewNode[]} */ (vnode.children)) unmount(child, true);
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		devperfMutation(Number(!!vnode.el?.parentNode) + Number(!!vnode.slotEnd?.parentNode));
	}
	vnode.el?.remove();
	vnode.slotEnd?.remove();
}

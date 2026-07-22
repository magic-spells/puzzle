/**
 * ViewNode — one node in the virtual tree (constellation/doc/DOC-RUNTIME-KERNEL.md,
 * constellation/doc/DOC-APP-ANATOMY.md §4, constellation/doc/DOC-DECISIONS.md D20).
 *
 * Pure data: the ViewManager owns all DOM creation and patching. Compiled
 * render functions build these trees:
 *
 *   new ViewNode('div', { class: 'card', key: todo.id }, [
 *     new ViewNode('text', { value: todo.text }),
 *     new ViewNode('button', { '@click': (e) => this.events.remove(todo) }, [...]),
 *   ])
 *
 * Three node kinds share this shape:
 * - Element/text — `tag` is a string ('text' is a text node, its content is
 *   attrs.value); any other string is an HTML element name.
 * - Component — `tag` is a PuzzleView subclass (a function); `attrs` are the
 *   child's props and `children` are its slot content (call-site markup).
 *   The ViewManager instantiates the class rather than creating an element
 *   (constellation/doc/DOC-APP-ANATOMY.md §4). Reusable components render inline — no wrapper
 *   element around the child's root (D20).
 * - Slot marker — `tag === SLOT_TAG`. A child's render tree emits one where
 *   `<children/>`/`<Slot/>` appeared; the ViewManager substitutes the slot content
 *   captured at the call site (those vnodes carry parent-scope handlers).
 *
 * Conventions:
 * - attrs starting with '@' are event listeners (mirrors template syntax).
 * - attrs.key drives keyed reconciliation in lists.
 * - `el` links to the live DOM node the ViewManager transfers across renders
 *   (the prototype failed to — constellation/doc/DOC-CODE-REVIEW.md §2.4); for a component vnode
 *   it tracks the child's current root so sibling insertion refs stay valid.
 * - `component` holds the child PuzzleView instance (component vnodes only),
 *   the way element vnodes hold `el`.
 * - `instance` (component vnodes only) pins a PRE-BUILT child instance the
 *   ViewManager must adopt instead of constructing one — the Router uses it to
 *   hand the layout a routed view whose `data()` already resolved pre-commit
 *   (constellation/doc/DOC-APP-ANATOMY.md §5, constellation/doc/DOC-VIEW-LIFECYCLE.md §4).
 */

import { PuzzleModel } from '../model.js';

/** Reserved tag marking a composition-marker (`<children/>`/`<Slot/>`/`<slot name>`) substitution point. */
export const SLOT_TAG = 'slot';

// Reserved tag marking a placeholder vnode — an empty, never-keyed comment node.
// Codegen pads the branches of a `{#if}`/`{#case}` so every branch contributes
// the SAME static vnode count: without it a variable-length branch shifts every
// trailing sibling's index, so the indexed patcher tag-mismatches and DESTROYS +
// remounts them (a toggled `{#if error}…{/if}` next to an <input> would blow away
// the input's focus/uncontrolled text). A placeholder holds the empty slot so the
// arity stays constant. No attrs, no children, never keyed. `new ViewNode('#')`.
export const PLACEHOLDER_TAG = '#';

// A row whose key resolves to null/undefined drops the whole list to positional
// diffing (silently, pre-v1.26). Warn at most once per session — a bounded
// global, like viewManager's warnDuplicateKey and animate.js's malformed-spec
// warning — so a loop of keyless rows stays quiet after the first.
let warnedNullKey = false;
function warnNullKey(item) {
	if (warnedNullKey) return;
	warnedNullKey = true;
	const shape = item?.constructor?.name || typeof item;
	console.warn(
		`[puzzle] {#for} item (${shape}) has no usable key (no primary key / .id) — ` +
			'falling back to positional diffing; add key={ … } to the row root.'
	);
}

export class ViewNode {
	constructor(tag, attrs = {}, children = []) {
		this.tag = tag;
		this.attrs = attrs || {};
		this.children = children || [];
		this.key = this.attrs.key != null ? this.attrs.key : null;
		this.el = null;
		this.component = null;
		// A pre-built child instance the ViewManager adopts (Router-preloaded
		// views); null means construct a fresh instance on first encounter.
		this.instance = null;
	}

	get isText() {
		return this.tag === 'text';
	}

	/** A component vnode when `tag` is a class rather than an element name. */
	get isComponent() {
		return typeof this.tag === 'function';
	}

	get isSlot() {
		return this.tag === SLOT_TAG;
	}

	// Internal surface (like SLOT_TAG): the compiled render() calls this for an
	// item-form {#for}'s synthetic key; app code shouldn't. Resolves a row's
	// reconciliation key when the real object is in hand — a store record keys by
	// its model's primaryKey() (so `.primary()` and template keying agree), any
	// other value keys by `.id` (v1 behavior). A null/undefined result warns once
	// and returns null (positional fallback, now diagnosed instead of silent).
	static keyOf(item) {
		if (item instanceof PuzzleModel) return item[item.constructor.primaryKey()];
		const key = item?.id;
		if (key == null) {
			warnNullKey(item);
			return null;
		}
		return key;
	}

	/** Component-vnode alias: a component's props ARE its attrs. */
	get props() {
		return this.attrs;
	}
}

export default ViewNode;

/**
 * ViewManager — render → diff → patch for ViewNode trees (constellation/doc/DOC-RUNTIME-KERNEL.md,
 * constellation/doc/DOC-APP-ANATOMY.md §4, constellation/doc/DOC-DECISIONS.md D20).
 *
 * Rewritten from the prototype per constellation/doc/DOC-CODE-REVIEW.md §2.4:
 * - DOM links (`el`) transfer from old to new tree on every patch, so updates
 *   keep working forever (the prototype froze after ~2 renders).
 * - Real keyed reconciliation: children with `key` are matched and MOVED,
 *   preserving their DOM nodes (checkbox/focus state) across reorders.
 * - `value`/`checked`/`disabled`/`selected` are set as PROPERTIES; boolean
 *   attributes are removed when falsy (setAttribute('checked', false) was
 *   truthy-present in the prototype).
 * - '@event' attrs attach listeners; patching swaps the handler without
 *   leaking the old one.
 * - Insertion uses childNodes-accurate reference nodes (text siblings counted).
 *
 * Composition (constellation/doc/DOC-APP-ANATOMY.md §4): a component vnode (class `tag`) is not
 * an element — the manager instantiates the child with the owner's `ctx`,
 * mounts it inline at the vnode's position (D20, no wrapper), reuses the
 * instance across re-renders (refresh only on prop change), and destroys it
 * when the vnode leaves the tree. composition markers in a child's tree are
 * substituted with the slot content captured at the call site before diffing.
 */

import { ViewNode, PLACEHOLDER_TAG } from './ViewNode.js';
import { beginFlip, playFlip } from './flip.js';

// these must be assigned as element properties, not attributes
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'muted']);

const SVG_NS = 'http://www.w3.org/2000/svg';

const LISTENERS = Symbol('puzzle-listeners');

// Suffix for the `once`-modifier "spent" flag stored alongside the handler on the
// LISTENERS object, keyed by the full attr name (D38). It deliberately SURVIVES the
// per-patch handler swap; it is cleared only when the listener is actually removed.
const ONCE_SPENT = '\x00once';

// `outside`-modifier (v1.52, D86) listeners attach to document in the CAPTURE
// phase. One shared options object so add and remove always pass the same
// capture flag — a mismatched remove silently leaves the document listener live.
const OUTSIDE_OPTS = { capture: true };

export class ViewManager {
	/**
	 * @param {Element} container host element this manager renders into
	 * @param {object} ctx owner's { store, router, formatters } — passed to
	 *   any child components this tree instantiates (constellation/doc/DOC-APP-ANATOMY.md §4)
	 */
	constructor(container, ctx = {}) {
		this.container = container;
		this.ctx = ctx;
		this.currentTree = null;
		// slot content injected at this component's composition markers (set by the
		// owning PuzzleView before each render; empty for views/layouts roots).
		this.slotChildren = [];
		// placeholder holding this subtree's DOM position until the first render
		// lands — needed because a child's mount() awaits async data() while the
		// synchronous parent patch must already have a stable insertion ref.
		this.anchor = null;
	}

	/**
	 * Reserve a DOM position synchronously, before async data() resolves. A
	 * comment node marks the spot; the first render replaces it in place.
	 */
	anchorAt(ref) {
		this.anchor = document.createComment('puzzle');
		this.container.insertBefore(this.anchor, ref ?? null);
	}

	/**
	 * Render a new tree: first call mounts, subsequent calls diff + patch.
	 * Slot markers are expanded against `slotChildren` before diffing.
	 */
	render(rawTree) {
		const newTree = expandSlots(rawTree, this.slotChildren);
		if (!this.currentTree) {
			mount(newTree, this.container, this.anchor, this.ctx);
			if (this.anchor) {
				this.anchor.remove();
				this.anchor = null;
			}
		} else {
			patch(this.currentTree, newTree, this.container, this.ctx);
		}
		this.currentTree = newTree;
		return newTree;
	}

	/** The DOM node currently occupying this subtree's position (or null). */
	get element() {
		return this.currentTree?.el ?? this.anchor ?? null;
	}

	/** Remove everything this manager mounted. */
	clear() {
		if (this.currentTree) unmount(this.currentTree);
		if (this.anchor) {
			this.anchor.remove();
			this.anchor = null;
		}
		this.currentTree = null;
	}
}

// ---- slot expansion ---------------------------------------------------------

/**
 * Substitute the slot markers in `vnode`'s tree with the call-site content
 * captured in `slotChildren`. Named slots (v1.21, D53) partition the content
 * once per render (partitionSlots) by each direct child's stripped `slot`
 * attribute; the bare default marker takes the unattributed remainder exactly as
 * before. Name-free templates AND slot-attr-free call sites take the same fast
 * path they always did — the default bucket is the original `slotChildren` array
 * (no clones) and no vnode changes unless a marker is actually present.
 */
export function expandSlots(vnode, slotChildren) {
	return expandNode(vnode, partitionSlots(slotChildren));
}

/**
 * Split captured call-site children into { default, named } by the `slot`
 * attribute (D53). A node carrying a non-empty static `slot` is routed to that
 * named bucket, CLONED minus the `slot` attr so it never reaches the DOM (and so
 * the original parent-owned vnode is never mutated); everything else is default
 * content. When no child carries a `slot` attr the fast path returns the
 * original array as `default` with `named` null — byte-identical to pre-D53.
 */
function partitionSlots(slotChildren) {
	let named = null;
	let def = null; // null until the first named child forces a fresh default list
	for (let i = 0; i < slotChildren.length; i++) {
		const sc = slotChildren[i];
		const name = sc.attrs && sc.attrs.slot;
		if (name != null && name !== '') {
			// Null-proto: a slot named "__proto__"/"constructor"/"toString" must key a
			// fresh bucket, not collide with an inherited Object.prototype value (which
			// would make `named[name] ??= []` skip the assignment and crash the .push).
			if (!named) named = Object.create(null);
			if (def === null) def = slotChildren.slice(0, i); // preceding = default
			(named[name] ??= []).push(stripSlotAttr(sc));
		} else if (def !== null) {
			def.push(sc);
		}
	}
	if (named === null) return { default: slotChildren, named: null };
	return { default: def ?? [], named };
}

/**
 * Clone a call-site vnode without its `slot` routing attribute (D53). Mirrors
 * expandNode's clone: a fresh ViewNode over the same children, preserving key
 * and the live DOM/instance links so patch/teardown keep working. The original
 * (parent-owned) vnode is left untouched.
 */
function stripSlotAttr(vnode) {
	const attrs = {};
	for (const k in vnode.attrs) {
		if (k !== 'slot') attrs[k] = vnode.attrs[k];
	}
	const clone = new ViewNode(vnode.tag, attrs, vnode.children);
	clone.key = vnode.key;
	clone.el = vnode.el;
	clone.component = vnode.component;
	clone.instance = vnode.instance;
	return clone;
}

/**
 * Replace slot markers anywhere in `vnode` against the partitioned `parts`. Only
 * nodes on the path to a marker are cloned; everything else is returned untouched
 * so DOM links survive. A named marker substitutes its named bucket when
 * non-empty, else its OWN fallback children (recursively expanded); the bare
 * marker substitutes the default bucket. Content is already parent-expanded —
 * spliced in as-is.
 *
 * Component vnodes (v1.38, D71): the walk descends into a component's CALL-SITE
 * children — they are authored in THIS template, so this template's markers
 * there must be substituted (`<Card><children/></Card>` in a layout forwards the
 * routed page into Card's default slot). The component's own TEMPLATE is never
 * entered — it expands its own slots against these children at render time.
 * Substituted content becomes ordinary slot content for the component; the
 * routed vnode's pinned `instance` rides along and is adopted at mount as usual.
 */
function expandNode(vnode, parts) {
	if (vnode.isText || vnode.isSlot) return vnode;
	// Inline-SVG seed (v1.14, D46): string children are verbatim markup, not a
	// vnode array — no slot marker can live inside them, so return the node as-is.
	if (typeof vnode.children === 'string') return vnode;

	const out = expandChildList(vnode.children, parts);
	if (!out) return vnode;

	const clone = new ViewNode(vnode.tag, vnode.attrs, out);
	clone.key = vnode.key;
	if (vnode.isComponent) {
		// Mirror stripSlotAttr's clone: preserve the live links so patch/teardown
		// keep working if this vnode has already been mounted (fresh render-tree
		// clones just copy nulls).
		clone.el = vnode.el;
		clone.component = vnode.component;
		clone.instance = vnode.instance;
	}
	return clone;
}

/**
 * expandNode's child loop: substitute markers in `kids`, expanding non-marker
 * children recursively. Returns the new child array, or null when nothing
 * changed (the caller keeps the original vnode — the no-marker fast path).
 */
function expandChildList(kids, parts) {
	let out = null;
	for (let i = 0; i < kids.length; i++) {
		const k = kids[i];
		if (k.isSlot) {
			if (!out) out = kids.slice(0, i);
			const name = k.attrs && k.attrs.name;
			const bucket = name ? parts.named && parts.named[name] : parts.default;
			if (bucket && bucket.length) {
				for (const sc of bucket) out.push(sc);
			} else {
				// Unfilled: render the marker's own fallback children (empty for the
				// bare default marker). Router-filled views/layouts only ever fill the
				// default, so a named marker there renders its fallback naturally (D53).
				for (const fb of k.children) out.push(expandNode(fb, parts));
			}
			continue;
		}
		const ek = expandNode(k, parts);
		if (out) out.push(ek);
		else if (ek !== k) {
			out = kids.slice(0, i);
			out.push(ek);
		}
	}
	return out;
}

// ---- mount ------------------------------------------------------------------

/** Create the DOM for vnode and insert it into parent (before ref, or append). */
export function mount(vnode, parent, ref, ctx) {
	if (vnode.isComponent) return mountComponent(vnode, parent, ref, ctx);

	let el;
	if (vnode.tag === PLACEHOLDER_TAG) {
		// Conditional arity-padding placeholder (see ViewNode.PLACEHOLDER_TAG): an
		// empty comment node holds a stable index slot so a variable-length
		// `{#if}`/`{#case}` branch can't shift its trailing siblings. No attrs, no
		// children — nothing else to do.
		el = document.createComment('');
		vnode.el = el;
		parent.insertBefore(el, ref ?? null);
		return el;
	}
	if (vnode.isText) {
		el = document.createTextNode(stringify(vnode.attrs.value));
	} else {
		el = inSvgNamespace(vnode.tag, parent)
			? document.createElementNS(SVG_NS, vnode.tag)
			: document.createElement(vnode.tag);
		for (const [name, value] of Object.entries(vnode.attrs)) {
			setAttr(el, name, value);
		}
		// Element ref (v1.39, D72): populate this.refs[name] with the live element the
		// moment it is created, BEFORE children mount and BEFORE the owning view's
		// mounted() hook fires (mount completes fully before mounted()). setAttr above
		// never wrote `ref` to the DOM; the setter (PuzzleView.__ref) does the capture.
		// The island element captures here too — island freezes CHILDREN, not the
		// element itself, so a ref on the island element is honored.
		if (typeof vnode.attrs.ref === 'function') vnode.attrs.ref(el);
		// Inline SVG (constellation/doc/DOC-SPEC.md §18, D46): string children are a
		// verbatim compile-time markup seed (an inlined `{#svg}` file) rather than a
		// vnode array. Drop it in once via innerHTML — the element was created via
		// the createElementNS path above so the SVG namespace is already correct —
		// and treat the subtree as island-owned (D44) from here on: the patcher
		// never reconciles it (see patch()).
		if (typeof vnode.children === 'string') {
			el.innerHTML = vnode.children;
		} else {
			for (const child of vnode.children) {
				mount(child, el, null, ctx);
			}
		}
		// A <select>'s controlled `value` is applied by setAttr above, BEFORE its
		// <option> children exist, so the browser silently falls back to the first
		// option. Re-assert it now that the options are mounted (SPEC §5).
		reassertSelectValue(el, vnode.attrs);
	}
	vnode.el = el;
	parent.insertBefore(el, ref ?? null);
	return el;
}

/**
 * First encounter of a component vnode: instantiate with the owner's ctx and
 * mount it at this position. mount() is async (awaits data()); the child's
 * anchor placeholder holds the slot synchronously, so `vnode.el` is a stable
 * node for sibling insertion refs even before data() resolves. On the next
 * render `vnode.el` is refreshed from the (now rendered) child root.
 *
 * A vnode carrying `instance` (a Router-preloaded view whose data() already
 * resolved) is adopted as-is and mounted with `preloaded: true`, so its
 * created()/data() are not run twice and its mount is synchronous — the
 * atomic-commit contract in constellation/doc/DOC-VIEW-LIFECYCLE.md §4.
 */
function mountComponent(vnode, parent, ref, ctx) {
	const preloaded = vnode.instance != null;
	const child = vnode.instance ?? new vnode.tag(ctx);
	vnode.component = child;
	child
		.mount(parent, { props: vnode.props, children: vnode.children, ref, preloaded })
		// ENTER animation (constellation/doc/DOC-SPEC.md §12): once the first
		// real render has landed (mount() resolved → this.element is the rendered
		// root, not the anchor), run the child's playIn(). Chained here so it
		// never blocks the synchronous patcher.
		.then(() => {
			// The async render has landed: the child's real root replaced the anchor
			// placeholder, so refresh the cached vnode.el off the now-live element. This
			// keeps the cached reference connected for a later reconciliation on this
			// position (patch()'s replace path resolves from the live element too, but
			// keeping vnode.el fresh avoids relying on the fallback).
			vnode.el = child.element;
			return child.playIn();
		})
		.catch((err) => {
			console.error('[puzzle] child mount failed:', err);
		});
	vnode.el = child.element;
	return vnode.el;
}

// ---- patch ------------------------------------------------------------------

/**
 * Patch oldVnode's DOM to match newVnode. Transfers `el` onto newVnode.
 * Falls back to replace when tag or key differ.
 */
export function patch(oldVnode, newVnode, parent, ctx) {
	if (!sameNode(oldVnode, newVnode)) {
		// Resolve the insertion reference from the LIVE DOM node, not the cached
		// vnode.el. For a component with async data(), mountComponent cached
		// child.element while it was still the placeholder Comment anchor; once the
		// async render commits, the real root replaced that anchor in the DOM but the
		// cached vnode.el still points at the now-DETACHED comment. insertBefore
		// against a detached node throws NotFoundError and empties the container. The
		// child's element getter always tracks its current root, so prefer it; fall
		// back to vnode.el for non-component (or not-yet-mounted) vnodes.
		const ref = (oldVnode.isComponent && oldVnode.component?.element) || oldVnode.el;
		mount(newVnode, parent, ref, ctx);
		unmount(oldVnode);
		return;
	}

	if (newVnode.isComponent) {
		patchComponent(oldVnode, newVnode);
		return;
	}

	const el = (newVnode.el = oldVnode.el);

	// Placeholder → placeholder (sameNode already matched tag '#' + null key):
	// transfer the comment el, nothing to patch. A placeholder ↔ real node swap is
	// a tag mismatch handled by the replace path above (mount the new, unmount the
	// comment — releaseSubtree/remove handle a comment-el vnode with no children).
	if (newVnode.tag === PLACEHOLDER_TAG) return;

	if (newVnode.isText) {
		const text = stringify(newVnode.attrs.value);
		if (el.nodeValue !== text) el.nodeValue = text;
		return;
	}

	patchAttrs(el, oldVnode.attrs, newVnode.attrs);

	// DOM island (constellation/doc/DOC-SPEC.md §17, D44): a static `island` attr
	// makes this element's children browser-/component-owned after mount. The
	// template seeded them once (mount is unchanged); the patcher never
	// reconciles them again. The element's own attrs/listeners still patch
	// (above) — only children are frozen. Carry the OLD (mounted) children
	// forward onto the new vnode so the vnodes holding live `el` links stay in
	// the tree for later patches and teardown; drop the fresh unpatched ones.
	if ('island' in newVnode.attrs) {
		newVnode.children = oldVnode.children;
		return;
	}

	// Inline SVG (constellation/doc/DOC-SPEC.md §18, D46): string children are an
	// innerHTML seed, island-owned like above — never reconciled. The element's own
	// attrs/listeners already patched. Re-apply the seed ONLY if it differs (a
	// same-node patch carrying a new file's markup); an identical seed leaves the
	// live DOM untouched. Dev live-reload of the .svg remounts anyway.
	if (typeof newVnode.children === 'string') {
		if (newVnode.children !== oldVnode.children) el.innerHTML = newVnode.children;
		return;
	}

	patchChildren(el, oldVnode.children, newVnode.children, ctx);

	// The option list may have changed under a <select> whose controlled `value`
	// was unchanged (patchAttrs skips it) or churned entirely — either way the
	// selection can desync. Re-assert the controlled value after the children
	// settle so option-list churn can't leave the wrong option selected (SPEC §5).
	reassertSelectValue(el, newVnode.attrs);
}

/**
 * Re-apply a <select>'s controlled `value` after its <option> children exist.
 * A no-op for any other element or a select without a controlled `value` attr.
 * Uses the same stringify coercion setAttr does; native fallback handles a value
 * that no longer matches any option (leaves selectedIndex where the browser puts it).
 */
function reassertSelectValue(el, attrs) {
	if (el.nodeName !== 'SELECT' || !('value' in attrs)) return;
	el.value = stringify(attrs.value);
}

/**
 * Same class + key: reuse the child instance (transferred onto newVnode). Push
 * new slot content always, and re-run the child's data() only when props
 * shallow-differ (constellation/doc/DOC-APP-ANATOMY.md §4 — the SPEC §4 prop-reactivity rule).
 * `vnode.el` tracks the child's live root so keyed sibling moves land right.
 */
function patchComponent(oldVnode, newVnode) {
	const child = (newVnode.component = oldVnode.component);
	const props = shallowEqual(oldVnode.props, newVnode.props) ? undefined : newVnode.props;
	child.applyParentUpdate({ props, children: newVnode.children });
	newVnode.el = child.element;
}

function sameNode(a, b) {
	return a.tag === b.tag && a.key === b.key;
}

function shallowEqual(a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	const ak = Object.keys(a);
	if (ak.length !== Object.keys(b).length) return false;
	for (const k of ak) {
		if (a[k] !== b[k]) return false;
	}
	return true;
}

/**
 * DOM elements currently lingering mid-leave-animation. They stay in the DOM
 * (in normal flow, in place) until destroyAnimated() removes them, but they are
 * no longer part of any vnode tree — the keyed move-guard must skip them when
 * comparing sibling positions (see nextPersistentSibling), or every survivor
 * ABOVE a leaver reads the leaver as its nextSibling, fails the guard, and gets
 * re-inserted BELOW it — cumulatively bubbling the fading element to the top of
 * the list. Entries are removed when the leave completes; WeakSet so an entry
 * can never outlive its element either way.
 */
const leavingEls = new WeakSet();

/**
 * Removing an element vnode detaches one DOM node, but component instances
 * anywhere in the subtree still hold store subscriptions and lifecycle state —
 * destroy them all, not just a top-level component vnode.
 */
function unmount(vnode) {
	if (vnode.isComponent) {
		const child = vnode.component;
		// LEAVE animation (constellation/doc/DOC-SPEC.md §12): when the leaving
		// instance declares `animations.out`, defer DOM removal + destroy() until
		// the out-animation finishes (destroyAnimated). The element stays in place
		// meanwhile — siblings patch AROUND it: it is registered in leavingEls so
		// the keyed move-guard ignores it, and it is never used as an insertBefore
		// reference (refs come only from newChildren). Best-effort edges: during a
		// GENUINE reorder concurrent with a leave, survivors order correctly but
		// the leaver's resting spot among them is unspecified; a newly mounted
		// sibling inserts relative to survivors and may land before or after a
		// leaver. Pure removals keep the leaver exactly in place. Without
		// `animations.out` this is the original synchronous, instant destroy() —
		// zero behaviour change (the whole existing suite is the regression net).
		if (child?.animations?.out) {
			const leavingEl = child.element;
			if (leavingEl && leavingEl.nodeType === 1 /* ELEMENT_NODE */) {
				leavingEls.add(leavingEl);
				child.destroyAnimated().finally(() => leavingEls.delete(leavingEl));
			} else {
				child.destroyAnimated();
			}
		} else {
			child?.destroy();
		}
		return;
	}
	releaseSubtree(vnode);
	vnode.el?.remove();
}

/**
 * Tear down an element vnode subtree that is being removed: fire element-ref
 * removals (v1.39, D72), detach `outside`-modifier document listeners (v1.52,
 * D86), and synchronously destroy every nested component instance
 * (constellation/doc/DOC-SPEC.md §12 — only the directly-removed component vnode
 * animates its leave; descendants tear down instantly with their ancestor).
 *
 * Centralizing here means refs null for EVERY removal shape that flows through
 * unmount(): a direct removal ({#if} toggling off), a parent-subtree removal
 * (this walk descends), a keyed list-row removal, and a full view destroy
 * (#vm.clear() → unmount(currentTree)). The ref-null is fired for `vnode` itself
 * (the island element included — island freezes children, not the element) before
 * recursing; the guard in the ref setter keeps a concurrent remount safe.
 * Component children are NOT descended into for refs: a component owns its own
 * subtree's refs and fires them through its own destroy() → #vm.clear().
 */
function releaseSubtree(vnode) {
	const ref = vnode.attrs.ref;
	if (typeof ref === 'function') ref(null, vnode.el);
	// `outside` (D86): the listener lives on DOCUMENT, so discarding the element
	// does NOT detach it — sweep this element's outside-flagged LISTENERS entries
	// here, the walk that already covers every removal shape (conditional toggle,
	// keyed-row removal, parent-subtree teardown, full view destroy). Plain
	// element listeners die with the element and need no sweep. The map is the
	// authoritative record of what is attached; skip the '\x00once' spent flags.
	const listeners = vnode.el?.[LISTENERS];
	if (listeners) {
		for (const key of Object.keys(listeners)) {
			if (key.endsWith(ONCE_SPENT)) continue;
			const [event, ...mods] = key.slice(1).split(':');
			if (!mods.includes('outside')) continue;
			document.removeEventListener(event, listeners[key], OUTSIDE_OPTS);
			delete listeners[key];
			delete listeners[key + ONCE_SPENT];
		}
	}
	// Inline-SVG seed (v1.14, D46): string children are inert markup, never vnodes
	// — no refs or component instances hide inside them.
	if (typeof vnode.children === 'string') return;
	for (const child of vnode.children) {
		if (child.isComponent) child.component?.destroy();
		else if (!child.isText) releaseSubtree(child);
	}
}

function patchAttrs(el, oldAttrs, newAttrs) {
	for (const [name, value] of Object.entries(newAttrs)) {
		// Element ref (v1.39, D72): the element PERSISTS through this patch. The
		// normal case is a cached setter identical on both sides (===) → nothing to
		// do; the ref already points at this el. Only a DIFFERING ref value (a
		// hand-written render, not the compiler) rebinds: release the old, capture
		// the new. setAttr never touches `ref`, so it is handled entirely here.
		if (name === 'ref') {
			const old = oldAttrs.ref;
			if (old !== value) {
				if (typeof old === 'function') old(null, el);
				if (typeof value === 'function') value(el);
			}
			continue;
		}
		// Controlled property-backed attrs (`value` on an input/textarea, `checked`
		// on a checkbox/radio) can drift from the live DOM through user interaction
		// the app never mirrored back into state — typing into an @change-bound input,
		// clicking an @change-bound checkbox. A later re-render whose BOUND value is
		// unchanged would skip the write on a vnode-to-vnode compare (`'' === ''`),
		// leaving the stale user text/state on screen while component state says
		// otherwise. Compare against the LIVE DOM property instead so the controlled
		// value is re-asserted regardless of vnode equality (React/Vue force-sync the
		// property on every patch for exactly this reason). The per-keystroke echo case
		// (bound value already equals the live property) still writes NOTHING — the
		// caret is preserved. <select>'s `value` is (re)asserted AFTER its <option>
		// children patch (reassertSelectValue); leave it to the generic path here since
		// its options may not exist yet at attr-patch time. Non-form elements that carry
		// a plain `value` (<li>, <progress>, <button>) keep the byte-identical vnode
		// compare — they never drift out of band.
		if (name === 'value' && (el.nodeName === 'INPUT' || el.nodeName === 'TEXTAREA')) {
			if (el.value !== stringify(value)) setAttr(el, name, value);
		} else if (name === 'checked' && el.nodeName === 'INPUT') {
			if (el.checked !== Boolean(value)) setAttr(el, name, value);
		} else if (oldAttrs[name] !== value) {
			setAttr(el, name, value);
		}
	}
	for (const name of Object.keys(oldAttrs)) {
		if (name in newAttrs) continue;
		// A persisting element dropping its `ref` (hand-written render — the compiler
		// emits ref statically) releases it: fire null so this.refs[name] clears.
		if (name === 'ref') {
			const old = oldAttrs.ref;
			if (typeof old === 'function') old(null, el);
		} else {
			removeAttr(el, name);
		}
	}
}

/**
 * Children reconciliation. If any child on either side carries a key, keyed
 * nodes are matched by (tag, key) and their DOM moved into position;
 * everything else falls back to index alignment.
 */
function patchChildren(el, oldChildren, newChildren, ctx) {
	const keyed = oldChildren.some((c) => c.key != null) || newChildren.some((c) => c.key != null);
	if (keyed) {
		patchKeyedChildren(el, oldChildren, newChildren, ctx);
	} else {
		patchIndexedChildren(el, oldChildren, newChildren, ctx);
	}
}

function patchIndexedChildren(el, oldChildren, newChildren, ctx) {
	const common = Math.min(oldChildren.length, newChildren.length);
	for (let i = 0; i < common; i++) {
		patch(oldChildren[i], newChildren[i], el, ctx);
	}
	for (let i = common; i < newChildren.length; i++) {
		mount(newChildren[i], el, null, ctx);
	}
	for (let i = common; i < oldChildren.length; i++) {
		unmount(oldChildren[i]);
	}
}

// Duplicate keys silently collapse (the (tag,key) Map keeps only the last), which
// surfaces as mystifying DOM churn — the older sibling never matches and gets
// unmounted. There is no dev/prod flag in the runtime, so warn at most once per
// session (a bounded global, like animate.js's malformed-spec warning).
let warnedDuplicateKey = false;
function warnDuplicateKey(key) {
	if (warnedDuplicateKey) return;
	warnedDuplicateKey = true;
	console.warn(
		`[puzzle] duplicate key ${JSON.stringify(key)} among keyed siblings — keys must be ` +
			'unique within a list; duplicates cause elements to be dropped or reordered unexpectedly.'
	);
}

function patchKeyedChildren(el, oldChildren, newChildren, ctx) {
	const oldKeyed = new Map();
	for (const child of oldChildren) {
		if (child.key != null) oldKeyed.set(child.tag + '\x00' + child.key, child);
	}

	const matched = new Set();
	let oldUnkeyed = oldChildren.filter((c) => c.key == null);
	let unkeyedIdx = 0;
	const seenNewKeys = new Set();
	// FLIP fast path (D85): one property check per new child during the pairing
	// map we already run. Lists without any `flip` attr never call into flip.js
	// — zero measurements, zero extra passes.
	let hasFlip = false;

	// First pass: pair every new child with its old counterpart (or none)
	const pairs = newChildren.map((newChild) => {
		if (!hasFlip && 'flip' in newChild.attrs) hasFlip = true;
		if (newChild.key != null) {
			const mapKey = newChild.tag + '\x00' + newChild.key;
			if (seenNewKeys.has(mapKey)) warnDuplicateKey(newChild.key);
			else seenNewKeys.add(mapKey);
			const match = oldKeyed.get(mapKey);
			if (match) matched.add(match);
			return [match ?? null, newChild];
		}
		// unkeyed: consume the next old unkeyed node POSITIONALLY, regardless of tag
		// (same alignment as the indexed path). patch() handles a tag mismatch by
		// replacing — the correct semantic. Requiring a tag match here mis-paired
		// every later unkeyed sibling whenever an earlier one changed tag or
		// disappeared (e.g. a conditional's placeholder ↔ real element swap, or a
		// dropped sibling above a stable one): the index never advanced past the
		// mismatch, so the survivor paired against the wrong old node and got torn down.
		if (unkeyedIdx < oldUnkeyed.length) {
			const candidate = oldUnkeyed[unkeyedIdx++];
			matched.add(candidate);
			return [candidate, newChild];
		}
		return [null, newChild];
	});

	// FLIP First-measure (D85): retained `flip` rows record their pre-patch
	// rects NOW — before removals reflow the survivors and before the move pass.
	// beginFlip bails candidate-free / reduced-motion / no-WAAPI lists before
	// any measurement.
	const flip = hasFlip ? beginFlip(pairs) : null;

	// Remove old children that found no new counterpart
	for (const child of oldChildren) {
		if (!matched.has(child)) unmount(child);
	}

	// Second pass: patch/mount and move into position, back to front so the
	// insertBefore reference (the next new child's el) is always final. The
	// move-guard compares against the next PERSISTENT sibling — elements
	// lingering mid-leave-animation don't count, so a pure removal leaves every
	// survivor (and the fading element) exactly where it was.
	let ref = null;
	for (let i = pairs.length - 1; i >= 0; i--) {
		const [oldChild, newChild] = pairs[i];
		if (oldChild) {
			patch(oldChild, newChild, el, ctx);
			if (nextPersistentSibling(newChild.el) !== ref) {
				el.insertBefore(newChild.el, ref);
			}
		} else {
			mount(newChild, el, ref, ctx);
		}
		ref = newChild.el;
	}

	// FLIP Last + Play (D85): every retained element is patched and in final
	// position — measure again and animate the moved rows from where they were.
	if (flip) playFlip(flip);
}

/** The next sibling that is not a leaving (mid-out-animation) element. */
function nextPersistentSibling(node) {
	let n = node.nextSibling;
	while (n && leavingEls.has(n)) n = n.nextSibling;
	return n;
}

// ---- attributes / properties / listeners --------------------------------------

function setAttr(el, name, value) {
	// `key`, `island` (D44), `ref` (D72), and `flip` (D85) are framework
	// directives, never DOM markup — the ref setter is invoked by
	// mount()/patchAttrs, and flip by patchKeyedChildren, not written here.
	if (name === 'key' || name === 'island' || name === 'ref' || name === 'flip') return;

	if (name.startsWith('@')) {
		// '@event' or '@event:mod:mod' (event modifiers). The bare event drives
		// addEventListener; the LISTENERS map keys by the FULL modified name so a
		// plain and a modified binding on the same event never collide.
		const [event, ...mods] = name.slice(1).split(':');
		// `outside` (D86): the listener lives on document, CAPTURE phase — capture
		// so an unrelated bubble-phase stopPropagation can't swallow the event, and
		// so a panel mounted synchronously mid-dispatch attaches AFTER document's
		// capture phase already passed (the open interaction can't instantly close
		// it). The element only anchors the containment gate (withModifiers).
		const target = mods.includes('outside') ? document : el;
		const opts = target === el ? undefined : OUTSIDE_OPTS;
		const listeners = (el[LISTENERS] ??= {});
		if (listeners[name]) target.removeEventListener(event, listeners[name], opts);
		if (typeof value === 'function') {
			// An outside binding always wraps (mods is non-empty by construction —
			// 'outside' itself is a modifier), so the gate below never needs a
			// separate no-other-mods path.
			const handler = mods.length ? withModifiers(name, mods, value, listeners, el) : value;
			target.addEventListener(event, handler, opts);
			listeners[name] = handler;
		} else {
			// Value nulled via an inline-if — the listener is actually REMOVED, so drop
			// the once-spent marker too (D38); leaving it would suppress a later re-add.
			delete listeners[name];
			delete listeners[name + ONCE_SPENT];
		}
		return;
	}

	if (PROPS.has(name)) {
		el[name] = name === 'value' ? stringify(value) : Boolean(value);
		// keep boolean ATTRIBUTES coherent for CSS selectors like [disabled]
		if (name !== 'value') {
			if (value) el.setAttribute(name, '');
			else el.removeAttribute(name);
		}
		return;
	}

	if (value === false || value == null) {
		el.removeAttribute(name);
	} else if (value === true) {
		el.setAttribute(name, '');
	} else {
		el.setAttribute(name, String(value));
	}
}

function removeAttr(el, name) {
	if (name === 'key' || name === 'island' || name === 'ref' || name === 'flip') return;

	if (name.startsWith('@')) {
		// Split the same way setAttr does so the correct DOM event type detaches
		// even when the key carries modifiers ('@event:mod' → event 'event').
		const [event, ...mods] = name.slice(1).split(':');
		const listeners = el[LISTENERS];
		if (listeners?.[name]) {
			// `outside` (D86) listeners live on document/capture — mirror setAttr's
			// target + options exactly or removeEventListener silently misses.
			if (mods.includes('outside')) document.removeEventListener(event, listeners[name], OUTSIDE_OPTS);
			else el.removeEventListener(event, listeners[name]);
			delete listeners[name];
			// The listener is gone — drop its once-spent marker too (D38), else a later
			// patch that re-adds this @event:once would read the stale flag and never fire.
			delete listeners[name + ONCE_SPENT];
		}
		return;
	}

	if (PROPS.has(name)) {
		el[name] = name === 'value' ? '' : false;
	}
	el.removeAttribute(name);
}

// Event-modifier key filters: modifier name → the KeyboardEvent.key it gates on
// (SPEC event modifiers). Mirrors the compiler's eventKeyFilters table.
const KEY_FILTERS = {
	enter: 'Enter',
	escape: 'Escape',
	tab: 'Tab',
	space: ' ',
	up: 'ArrowUp',
	down: 'ArrowDown',
	left: 'ArrowLeft',
	right: 'ArrowRight',
	backspace: 'Backspace',
	delete: 'Delete',
};

/**
 * Wrap a compiled handler with its event modifiers. Canonical execution order,
 * independent of written order:
 *   1. outside-gate (v1.52, D86) — the listener sits on document/capture; an
 *      event targeting INSIDE the bound element returns before every other
 *      step, so an inside event spends no `once` and preventDefaults nothing;
 *   2. key filter — a non-matching key returns BEFORE preventDefault so the
 *      browser's native behaviour for other keys is preserved;
 *   3. `once` — spend/detach: fires once EVER. The "spent" flag lives on the
 *      element's LISTENERS object keyed by the full attr name, so it survives
 *      the per-patch handler swap (a fresh closure is bound every render);
 *   4. preventDefault;
 *   5. stopPropagation;
 *   6. the handler.
 * @param {string} fullName the '@event:mod…' attr name (LISTENERS key)
 * @param {string[]} mods modifiers in written order
 * @param {Function} handler the compiled listener
 * @param {object} listeners the element's LISTENERS object (holds the spent flag)
 * @param {Element} el the bound element — the outside-gate's containment anchor
 */
function withModifiers(fullName, mods, handler, listeners, el) {
	const spentKey = fullName + ONCE_SPENT;
	const outside = mods.includes('outside');
	return (event) => {
		if (outside && el.contains(event.target)) return;
		for (const m of mods) {
			const key = KEY_FILTERS[m];
			if (key !== undefined && event.key !== key) return;
		}
		if (mods.includes('once')) {
			if (listeners[spentKey]) return;
			listeners[spentKey] = true;
		}
		if (mods.includes('prevent')) event.preventDefault();
		if (mods.includes('stop')) event.stopPropagation();
		handler(event);
	};
}

/**
 * SVG elements must be created in the SVG namespace — createElement('svg')
 * yields an inert HTMLUnknownElement the browser will not paint. The namespace
 * turns on at an <svg> tag and holds for descendants automatically (children
 * mount into the parent's namespaced el), except inside <foreignObject>, which
 * hosts HTML again. No state threads through the patch pipeline: the parent
 * NODE carries the namespace.
 */
function inSvgNamespace(tag, parent) {
	if (tag === 'svg') return true;
	return parent.namespaceURI === SVG_NS && parent.nodeName.toLowerCase() !== 'foreignobject';
}

function stringify(v) {
	return v == null ? '' : String(v);
}

export default ViewManager;

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

import { ViewNode, PLACEHOLDER_TAG, PORTAL_TAG, SNIPPET_TAG } from './ViewNode.js';
import { beginFlip, playFlip } from './flip.js';
import {
	mountPortal,
	patchPortal,
	portalAwareContains,
	unmountPortal,
} from './portal.js';
import { devperfComponentPatch, devperfMutation } from '../devperf.js';
import { displayValue as stringify } from '../display.js';
import { getErrorView, reportError } from '../errors.js';

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
	 * @param {object|null} owner view whose render tree this manager patches
	 */
	constructor(container, ctx = {}, owner = null) {
		this.container = container;
		this.ctx = ctx;
		this.owner = owner;
		this.currentTree = null;
		// slot content injected at this component's composition markers (set by the
		// owning PuzzleView before each render; empty for views/layouts roots).
		this.slotChildren = [];
		// placeholder holding this subtree's DOM position until the first render
		// lands — needed because a child's mount() awaits async data() while the
		// synchronous parent patch must already have a stable insertion ref.
		this.anchor = null;
		// A render threw partway — a patch(), or the very first mount(). The DOM
		// matches NEITHER currentTree nor the tree that was being applied, so nothing
		// may be diffed against it again. The
		// next render routes through renderFresh() while this is set (D145).
		this.treeUnknown = false;
		// The two live siblings bracketing this manager's DOM range, captured
		// immediately before the render that threw. Both sit OUTSIDE the range, so an
		// aborted render cannot have moved or removed them — they are the only
		// trustworthy handles on the corrupt range. (A failed FIRST mount brackets the
		// anchor's slot: that is the only stretch of container it could have dirtied.)
		this.unknownRange = null;
		// The vnode trees involved in that aborted render — both of a patch's, or the
		// single incoming one of a failed first mount. Their DOM positions are
		// lies, but their INSTANCE bookkeeping is not: nested component instances,
		// element refs and document-level `outside` listeners are reachable only
		// through them, and clearing the range by DOM removal releases none of it.
		this.unknownTrees = null;
	}

	/**
	 * Reserve a DOM position synchronously, before async data() resolves. A
	 * comment node marks the spot; the first render replaces it in place.
	 */
	anchorAt(ref) {
		this.anchor = document.createComment('puzzle');
		this.container.insertBefore(this.anchor, ref ?? null);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
			devperfMutation();
	}

	/**
	 * Render a new tree: first call mounts, subsequent calls diff + patch.
	 * Slot markers are expanded against `slotChildren` before diffing.
	 */
	render(rawTree, slotsExpanded = false) {
		// D145's "never patched over an unknown tree" is an invariant of the manager.
		// Route the next ordinary render through a fresh mount so it never diffs
		// against vnodes whose DOM links may be detached.
		if (this.treeUnknown) return this.renderFresh(rawTree, slotsExpanded);
		// SSG/static takeover preloads nested components by walking the expanded
		// tree and stores that exact tree for mount. Expanding it again cannot change
		// the output, but it loses the first pass's snippet-use state and emits a
		// false unused-snippet warning. All ordinary renders still expand here.
		const newTree = slotsExpanded
			? rawTree
			: expandSlots(rawTree, this.slotChildren, this.owner?.constructor);
		if (!this.currentTree) {
			// A FIRST mount throws too (a component's class-field initializer, a
			// `String(symbol)` in a text node), and it needs the same D145 machinery —
			// more so: `currentTree` is still null, so destroy() → clear() would walk
			// NOTHING while every component this mount already instantiated keeps its
			// store subscriptions, its document-level `outside` listeners and its
			// <Portal> range (portalCount is incremented BEFORE the portaled children
			// mount, so a throw under a Portal never lets the outlet go).
			//
			// The RANGE is the one asymmetry with the patch branch. mount() builds each
			// element's subtree detached and inserts the root into the container LAST,
			// so on a throw the container holds nothing this call put there — except
			// this manager's own anchor, and the local placeholder a <Portal> parks
			// before teleporting. Bracket the anchor's slot so renderFresh() sweeps
			// anything that did land; the anchor is the range's `after`, the EXCLUSIVE
			// stop, so the sweep can never eat the position marker it needs as an
			// insertion ref. With no anchor there is no trustworthy handle on an empty
			// range — null, exactly the patch branch's un-bracketed case, and
			// renderFresh() mounts without a sweep.
			const anchored = this.anchor != null && this.anchor.parentNode === this.container;
			const before = anchored ? this.anchor.previousSibling : null;
			try {
				mount(newTree, this.container, this.anchor, this.ctx, this.owner);
			} catch (err) {
				this.treeUnknown = true;
				this.unknownRange = anchored ? { before, after: this.anchor } : null;
				// ONE tree: a first mount has no outgoing tree. The incoming one is the
				// only record of what got instantiated before the throw, and
				// releaseAborted() is the only thing that can still reach it.
				this.unknownTrees = [newTree];
				throw err;
			}
			if (this.anchor) {
				this.anchor.remove();
				if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
					devperfMutation();
				this.anchor = null;
			}
		} else {
			// Bracket the managed range BEFORE patching. A throw partway through the
			// patch leaves the DOM half-updated, and `currentTree` (assigned only
			// below) would then describe a tree that no longer exists — diffing the
			// error face against it resolves insertion refs to moved or removed
			// nodes. Record the corrupt range instead and leave `currentTree` alone:
			// neither tree is true, so the manager reports the tree as UNKNOWN and
			// the next render goes through renderFresh().
			const el = this.currentTree.el ?? null;
			const bracketed = el != null && el.parentNode === this.container;
			const before = bracketed ? el.previousSibling : null;
			const after = bracketed ? el.nextSibling : null;
			try {
				patch(this.currentTree, newTree, this.container, this.ctx, this.owner);
			} catch (err) {
				this.treeUnknown = true;
				this.unknownRange = bracketed ? { before, after } : null;
				// BOTH trees: the aborted patch may have mounted components from the
				// new one and left components from the old one live.
				this.unknownTrees = [this.currentTree, newTree];
				throw err;
			}
		}
		this.currentTree = newTree;
		return newTree;
	}

	/**
	 * Mount `rawTree` over a DOM range this manager can no longer describe (see
	 * `treeUnknown`). The vnode tree is untrustworthy, so the old content is
	 * cleared by DOM removal across the bracketed range rather than by an
	 * unmount() walk, then the new tree is mounted from scratch. The anchor
	 * comment, if this manager still holds one, survives the clear and is the
	 * insertion ref (mount()'s normal first-render contract).
	 *
	 * DOM position is the only thing those trees lie about, so the non-DOM release
	 * still runs over BOTH of them first (releaseAborted): nested component
	 * instances keep their store subscriptions, `outside` listeners live on
	 * document, and portaled content sits outside the range entirely — none of it
	 * is reachable again once currentTree becomes the error face.
	 */
	renderFresh(rawTree, slotsExpanded = false) {
		const newTree = slotsExpanded
			? rawTree
			: expandSlots(rawTree, this.slotChildren, this.owner?.constructor);
		releaseAborted(this.unknownTrees);
		this.unknownTrees = null;
		const range = this.unknownRange;
		let removed = false;
		if (range) {
			const { before, after } = range;
			const stop = after && after.parentNode === this.container ? after : null;
			let node =
				before && before.parentNode === this.container
					? before.nextSibling
					: this.container.firstChild;
			while (node && node !== stop) {
				const next = node.nextSibling;
				// The anchor is this manager's position marker, not content.
				if (node !== this.anchor) {
					node.remove();
					removed = true;
				}
				node = next;
			}
		}
		if ((typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) && removed) devperfMutation();

		const after = range?.after;
		const ref =
			this.anchor && this.anchor.parentNode === this.container
				? this.anchor
				: after && after.parentNode === this.container
					? after
					: null;

		this.currentTree = null;
		this.treeUnknown = false;
		this.unknownRange = null;
		mount(newTree, this.container, ref, this.ctx, this.owner);
		if (this.anchor) {
			this.anchor.remove();
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
			this.anchor = null;
		}
		this.currentTree = newTree;
		return newTree;
	}

	/**
	 * Preserve this manager's exact position before a failed view is destroyed.
	 * For an aborted patch, release both lying vnode trees once, clear the trusted
	 * bracketed range by DOM removal, and place the recovery marker at that range.
	 */
	plantFailurePlaceholder() {
		if (this.treeUnknown) {
			const tree = this.renderFresh(new ViewNode(PLACEHOLDER_TAG));
			this.currentTree = null;
			return tree.el;
		}
		const placeholder = document.createComment('puzzle');
		const at = this.element;
		this.container.insertBefore(placeholder, at?.parentNode === this.container ? at : null);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
		return placeholder;
	}

	/** The DOM node currently occupying this subtree's position (or null). */
	get element() {
		return this.currentTree?.el ?? this.anchor ?? null;
	}

	/** Remove everything this manager mounted. */
	clear() {
		// A destroy that arrives BEFORE any replacement render still has to release the
		// aborted patch's two trees — unmount(currentTree) below reaches only the old
		// one, and only through positions that may no longer be true.
		if (this.unknownTrees) {
			releaseAborted(this.unknownTrees);
			this.unknownTrees = null;
		}
		if (this.currentTree) unmount(this.currentTree);
		if (this.anchor) {
			this.anchor.remove();
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				devperfMutation();
			this.anchor = null;
		}
		this.currentTree = null;
		this.treeUnknown = false;
		this.unknownRange = null;
	}
}

// ---- slot expansion ---------------------------------------------------------

/**
 * Substitute the slot markers in `vnode`'s tree with the call-site content
 * captured in `slotChildren`. Named slots (v1.21, D53) partition the content
 * once per render (partitionSlots) by each direct child's stripped `slot`
 * attribute; <Children/> and the bare <Slot/> take the unattributed remainder.
 * Snippet-free AND slot-attr-free call sites take the same fast path they
 * always did — the default bucket is the original `slotChildren` array (no
 * clones) and no vnode changes unless a marker is actually present. A bare
 * default marker inside a nested component invocation forwards the caller's
 * snippet metadata with that bucket; the nested component owns the eventual
 * stamp (or unused-snippet warning).
 */
export function expandSlots(vnode, slotChildren, component = null) {
	const parts = partitionSlots(slotChildren);
	if (
		typeof __PUZZLE_HAS_SNIPPETS__ === 'undefined' ||
		__PUZZLE_HAS_SNIPPETS__
	) {
		parts.component = component;
	}
	const expanded = expandNode(vnode, parts);
	if (
		(typeof __PUZZLE_HAS_SNIPPETS__ === 'undefined' ||
			__PUZZLE_HAS_SNIPPETS__) &&
		(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
	) {
		warnUnusedSnippets(parts, component);
	}
	return expanded;
}

/**
 * Split captured call-site children into default, named, and snippet buckets.
 * A node carrying a non-empty static `slot` is routed to that named bucket,
 * CLONED minus the `slot` attr so it never reaches the DOM (and so the original
 * parent-owned vnode is never mutated); everything else is default content.
 * Snippet lookup stays keyed by `fits`, while `snippetVnodes` preserves every
 * original metadata vnode in call-site order for forwarding. When no child
 * carries routing metadata the fast path returns the original array as
 * `default` with `named` null — byte-identical to pre-D53.
 */
function partitionSlots(slotChildren) {
	let named = null;
	let snippets = null;
	let snippetVnodes = null;
	let def = null; // null until the first named child forces a fresh default list
	for (let i = 0; i < slotChildren.length; i++) {
		const sc = slotChildren[i];
		if (
			(typeof __PUZZLE_HAS_SNIPPETS__ === 'undefined' ||
				__PUZZLE_HAS_SNIPPETS__) &&
			sc.tag === SNIPPET_TAG
		) {
			if (!snippets) snippets = Object.create(null);
			(snippetVnodes ??= []).push(sc);
			if (def === null) def = slotChildren.slice(0, i);
			snippets[sc.attrs.fits || 'default'] = sc;
			continue;
		}
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
	if (
		typeof __PUZZLE_HAS_SNIPPETS__ === 'undefined' ||
		__PUZZLE_HAS_SNIPPETS__
	) {
		if (named === null && snippets === null) {
			return { default: slotChildren, named: null, snippets: null, snippetUses: null };
		}
		return {
			default: def ?? [],
			named,
			snippets,
			snippetVnodes,
			snippetUses: snippets && Object.create(null),
			callSite: null,
		};
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
	if (typeof __PUZZLE_TAKEOVER__ === 'undefined' || __PUZZLE_TAKEOVER__) {
		clone.takeoverPreloaded = vnode.takeoverPreloaded;
		clone.takeoverFailed = vnode.takeoverFailed;
	}
	return clone;
}

/**
 * Replace slot markers anywhere in `vnode` against the partitioned `parts`. Only
 * nodes on the path to a marker are cloned; everything else is returned untouched
 * so DOM links survive. A named marker substitutes its named bucket; the bare
 * marker substitutes the default bucket. When the selected bucket is empty, the
 * marker's own children expand as fallback content (D141). Supplied content wins
 * completely. Content is already parent-expanded — spliced in as-is.
 *
 * Component vnodes (v1.38, D71): the walk descends into a component's CALL-SITE
 * children — they are authored in THIS template, so this template's markers
 * there must be substituted (`<Card><Children/></Card>` in a layout forwards the
 * routed page into Card's default slot). The component's own TEMPLATE is never
 * entered — it expands its own slots against these children at render time.
 * Substituted content becomes ordinary slot content for the component; the
 * routed vnode's pinned `instance` rides along and is adopted at mount as usual.
 * The snippet-only `parts.callSite` context mirrors the parser's D71 descent so
 * the forwarding path can tell a call-site marker from an identical marker in
 * the wrapper's own template. Each component creates a nearest-owner context:
 * a marker nested under call-site markup still causes metadata to be appended
 * to the COMPONENT'S direct children, where its partition pass can see it. The
 * entire context state machine folds away with the snippets define; ordinary
 * D71 recursion keeps its original call shape.
 */
function expandNode(vnode, parts) {
	if (vnode.isText || vnode.isSlot) return vnode;
	// Inline-SVG seed (v1.14, D46): string children are verbatim markup, not a
	// vnode array — no slot marker can live inside them, so return the node as-is.
	if (typeof vnode.children === 'string') return vnode;

	let callSite = null;
	let parentCallSite = null;
	if (
		(typeof __PUZZLE_HAS_SNIPPETS__ === 'undefined' ||
			__PUZZLE_HAS_SNIPPETS__) &&
		parts.snippetVnodes &&
		vnode.isComponent
	) {
		parentCallSite = parts.callSite;
		callSite = { forwarded: false };
		parts.callSite = callSite;
	}
	let out = expandChildList(vnode.children, parts);
	if (
		(typeof __PUZZLE_HAS_SNIPPETS__ === 'undefined' ||
			__PUZZLE_HAS_SNIPPETS__) &&
		callSite
	) {
		parts.callSite = parentCallSite;
		if (callSite.forwarded) out = [...(out ?? vnode.children), ...parts.snippetVnodes];
	}
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
		if (typeof __PUZZLE_TAKEOVER__ === 'undefined' || __PUZZLE_TAKEOVER__) {
			clone.takeoverPreloaded = vnode.takeoverPreloaded;
			clone.takeoverFailed = vnode.takeoverFailed;
		}
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
			const markerName = (k.attrs && k.attrs.name) || 'default';
			const bucket = markerName === 'default' ? parts.default : parts.named && parts.named[markerName];
			if (
				typeof __PUZZLE_HAS_SNIPPETS__ === 'undefined' ||
				__PUZZLE_HAS_SNIPPETS__
			) {
				const hasArgs = Object.prototype.hasOwnProperty.call(k.attrs, 'args');
				if (
					parts.callSite &&
					markerName === 'default' &&
					!hasArgs &&
					parts.snippetVnodes
				) {
					// D71-style implicit forwarding: a bare default marker authored in a
					// component invocation hands the caller's ordinary default content AND
					// every original Snippet vnode to that nested component. Default content
					// stays at the marker position; the nearest call-site context appends the
					// metadata to the component's DIRECT children after this descent, so a
					// marker nested under authored markup still reaches partitionSlots.
					if (bucket && bucket.length) {
						for (const sc of bucket) out.push(sc);
					} else {
						for (const fb of k.children) out.push(expandNode(fb, parts));
					}
					parts.callSite.forwarded = true;
					for (const forwarded of parts.snippetVnodes) {
						// Forwarding transfers warning ownership too: the wrapper used this
						// declaration by handing it on; the innermost recipient still warns if
						// none of its own markers consumes it.
						parts.snippetUses[forwarded.attrs.fits || 'default'] = true;
					}
					// Forward every snippet even if a different marker in this wrapper already
					// consumed it — snippet functions are reusable, and two consumers may stamp
					// the same declaration. The original vnodes remain unmodified and uninvoked.
					continue;
				}
				const snippet = parts.snippets && parts.snippets[markerName];
				if (snippet) {
					parts.snippetUses[markerName] = true;
					if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
						warnSnippetShape(snippet, k.attrs.args || {}, markerName, parts.component);
					}
					const stampedNodes = snippet.attrs.fn(k.attrs.args || {});
					if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
						warnSnippetOutputMarker(stampedNodes, markerName, parts.component);
					}
					for (const stamped of stampedNodes) out.push(stamped);
					continue;
				}
				if (
					hasArgs &&
					bucket &&
					bucket.length &&
					(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				) {
					warnPlainScopedContent(markerName, k.attrs.args || {}, parts.component);
				}
				if (bucket && bucket.length && !hasArgs) {
					for (const sc of bucket) out.push(sc);
				} else {
					for (const fb of k.children) out.push(expandNode(fb, parts));
				}
				continue;
			}
			if (bucket && bucket.length) {
				for (const sc of bucket) out.push(sc);
			} else {
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

const UNKNOWN_SNIPPET_OWNER = {};
let snippetWarnings;

function warnSnippet(component, issue, message) {
	const owner =
		(component != null && (typeof component === 'object' || typeof component === 'function'))
			? component
			: UNKNOWN_SNIPPET_OWNER;
	snippetWarnings ??= new WeakMap();
	let seen = snippetWarnings.get(owner);
	if (!seen) {
		seen = new Set();
		snippetWarnings.set(owner, seen);
	}
	if (seen.has(issue)) return;
	seen.add(issue);
	console.warn(`[puzzle] ${message}`);
}

function warnSnippetShape(snippet, args, name, component) {
	const params = snippet.attrs.params || [];
	const handed = Object.keys(args);
	const same =
		params.length === handed.length &&
		params.every((param) => Object.prototype.hasOwnProperty.call(args, param));
	if (same) return;
	warnSnippet(
		component,
		`shape:${name}`,
		`snippet fits slot "${name}" declares (${params.join(', ')}); ` +
			`slot hands over (${handed.join(', ')}) — the shapes don't match`
	);
}

function warnPlainScopedContent(name, args, component) {
	warnSnippet(
		component,
		`plain:${name}`,
		`plain content cannot fill args-bearing slot "${name}" handing over ` +
			`(${Object.keys(args).join(', ')}) — provide a matching <Snippet>; rendering the fallback`
	);
}

function warnSnippetOutputMarker(nodes, name, component) {
	if (!snippetOutputHasMarker(nodes)) return;
	warnSnippet(
		component,
		`output-marker:${name}`,
		`snippet fits slot "${name}" returned a composition marker — markers inside ` +
			`<Snippet> bodies are compile errors and belong in the component's own template`
	);
}

function snippetOutputHasMarker(nodes) {
	for (const node of nodes) {
		if (node == null || typeof node === 'string') continue;
		if (node.isSlot || node.isSnippet) return true;
		if (
			typeof node.children !== 'string' &&
			node.children.length > 0 &&
			snippetOutputHasMarker(node.children)
		) return true;
	}
	return false;
}

function warnUnusedSnippets(parts, component) {
	if (!parts.snippets) return;
	for (const name of Object.keys(parts.snippets)) {
		if (parts.snippetUses[name]) continue;
		warnSnippet(
			component,
			`unused:${name}`,
			`snippet fits slot "${name}", but no matching slot marker consumed it`
		);
	}
}

// ---- mount ------------------------------------------------------------------

/** Create the DOM for vnode and insert it into parent (before ref, or append). */
export function mount(vnode, parent, ref, ctx, owner = null) {
	if (vnode.isComponent) return mountComponent(vnode, parent, ref, ctx, owner);

	if (vnode.tag === PORTAL_TAG) {
		if (typeof __PUZZLE_HAS_PORTAL__ === 'undefined' || __PUZZLE_HAS_PORTAL__)
			return mountPortal(vnode, parent, ref, ctx, owner, mount);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) warnPortalCompiledOut();
		// A false-negative usage scan must not crash production. Preserve the
		// vnode's local position but leave its children inert, matching Portal's
		// ordinary placeholder shape without touching the compiled-out module.
		const placeholder = document.createComment('puzzle-portal');
		vnode.el = placeholder;
		parent.insertBefore(placeholder, ref ?? null);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
		return placeholder;
	}

	let el;
	if (vnode.tag === PLACEHOLDER_TAG) {
		// Conditional arity-padding placeholder (see ViewNode.PLACEHOLDER_TAG): an
		// empty comment node holds a stable index slot so a variable-length
		// `{#if}`/`{#case}` branch can't shift its trailing siblings. No attrs, no
		// children — nothing else to do.
		el = document.createComment('');
		vnode.el = el;
		parent.insertBefore(el, ref ?? null);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
			devperfMutation();
		return el;
	}
	if (vnode.isText) {
		el = document.createTextNode(stringify(vnode.attrs.value));
		vnode.el = el;
	} else {
		el = inSvgNamespace(vnode.tag, parent)
			? document.createElementNS(SVG_NS, vnode.tag)
			: document.createElement(vnode.tag);
		// PUBLISH the node before the first side effect, not after the last one. Every
		// step below can throw — setAttr installs `outside` listeners on DOCUMENT, a
		// hand-written tree's ref can be any function, a child's mount() is the whole
		// recursion (a component constructor, a `String(symbol)` in a text node) — and
		// an unwind hands the half-built tree to releaseAborted(), whose releaseSubtree()
		// reaches an element's LISTENERS and its captured ref through `vnode.el` alone.
		// Assigned last, that read found null and the D86 document listener this element
		// had already parked outlived the render that made it. The node is still detached
		// here, which no reader minds: `el.remove()` on a parentless node is a no-op and
		// every devperf/insertion-ref site tests `parentNode` first.
		vnode.el = el;
		for (const [name, value] of Object.entries(vnode.attrs)) {
			setAttr(el, name, value, owner);
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
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				devperfMutation();
			} else {
				for (const child of vnode.children) {
					mount(child, el, null, ctx, owner);
				}
		}
		// A <select>'s controlled `value` is applied by setAttr above, BEFORE its
		// <option> children exist, so the browser silently falls back to the first
		// option. Re-assert it now that the options are mounted (SPEC §5).
		reassertSelectValue(el, vnode.attrs);
	}
	// Insertion stays LAST: mount() builds detached and attaches the finished subtree
	// in one move, so a throw leaves the container holding nothing this call put there.
	parent.insertBefore(el, ref ?? null);
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
		devperfMutation();
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
function mountComponent(vnode, parent, ref, ctx, owner) {
	if ((typeof __PUZZLE_TAKEOVER__ === 'undefined' || __PUZZLE_TAKEOVER__) && vnode.takeoverFailed) {
		const placeholder = document.createComment('puzzle');
		vnode.el = placeholder;
		parent.insertBefore(placeholder, ref ?? null);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
			devperfMutation();
		return placeholder;
	}
	const preloaded = vnode.instance != null;
	// Gated HERE rather than at the `preloaded && !takeoverPreloaded` use below, so
	// a non-takeover build folds this to `false` and that test collapses to plain
	// `preloaded` — the pre-takeover behavior, with the property read gone.
	const takeoverPreloaded =
		(typeof __PUZZLE_TAKEOVER__ === 'undefined' || __PUZZLE_TAKEOVER__) && vnode.takeoverPreloaded;
	const child = vnode.instance ?? new vnode.tag(ctx);
	child.__retryParent = owner;
	vnode.component = child;
	child
		.mount(parent, { props: vnode.props, children: vnode.children, ref, preloaded })
		// Two-arg then(): the recovery handler below is attached to the MOUNT step
		// ONLY. A single trailing .catch() could not tell a failed mount from a
		// rejected playIn(), so a user enter hook that threw tore down a component
		// that had already mounted and painted.
		.then(
			// ENTER animation (constellation/doc/DOC-SPEC.md §12): once the first
			// real render has landed (mount() resolved → this.element is the rendered
			// root, not the anchor), run the child's playIn(). Chained here so it
			// never blocks the synchronous patcher.
			() => {
				// The async render has landed: the child's real root replaced the anchor
				// placeholder, so refresh the cached vnode.el off the now-live element. This
				// keeps the cached reference connected for a later reconciliation on this
				// position (patch()'s replace path resolves from the live element too, but
				// keeping vnode.el fresh avoids relying on the fallback).
				vnode.el = child.element;
				// playIn() runs viewWillShow()/viewDidShow() unguarded, so a throwing user
				// hook rejects here — with the child mounted, painted, and subscribed. Log
				// and leave the live tree alone: a rejected enter must never tear down a
				// component that mounted successfully (the enter-side mirror of
				// PuzzleView.destroyAnimated()'s leave-hook guard, and what router.js
				// #playInLogged already does for router-mounted animators).
				return Promise.resolve(child.playIn()).catch((err) =>
					reportError(
						ctx,
						err,
						{ phase: 'enter', view: child, route: child.route },
						'[puzzle] child enter animation failed:',
						err
					)
				);
			},
			(err) => {
				const info = reportError(
					ctx,
					err,
					{ phase: 'mount', view: child, route: child.route },
					preloaded && !takeoverPreloaded
						? '[puzzle] routed view mount failed — the failed position was replaced:'
						: getErrorView(ctx)
							? '[puzzle] component mount failed — the failed position was replaced:'
							: '[puzzle] component mount failed — the component was destroyed and will remount on the next patch:',
					err
				);
				child.__showErrorView?.(err, info);
				vnode.instance = null;
				// Gated: ungated this would ADD the property outside the constructor in a
				// non-takeover build — exactly the hidden-class transition the gate above
				// exists to avoid.
				if (typeof __PUZZLE_TAKEOVER__ === 'undefined' || __PUZZLE_TAKEOVER__)
					vnode.takeoverPreloaded = false;
			}
		);
	vnode.el = child.element;
	return vnode.el;
}

// ---- patch ------------------------------------------------------------------

/**
 * Patch oldVnode's DOM to match newVnode. Transfers `el` onto newVnode.
 * Falls back to replace when tag or key differ.
 */
export function patch(oldVnode, newVnode, parent, ctx, owner = null) {
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
		mount(newVnode, parent, ref, ctx, owner);
		unmount(oldVnode);
		return;
	}

	if (newVnode.isComponent) {
		// A component whose FIRST mount threw was torn down: its instance was
		// destroyed, with a bare comment left holding the position (mountComponent's
		// rejection handler). There is no live instance to update — mount a FRESH one
		// at the placeholder so a render that no longer throws yields a fully working
		// component (mounted() fires, setData() re-renders), then drop the placeholder.
		//
		// TWO shapes reach here, because that handler runs in a microtask. Normally it
		// nulled the links on the vnode that is still the tree node (`component ==
		// null`, `el` = the placeholder). But if a parent re-render RACED the microtask,
		// patchComponent had already copied the instance onto this newer vnode, whose
		// links the handler never saw — so the destroyed INSTANCE is the only witness
		// both vnodes share. Hence `isDestroyed` (the getter — NOT `destroyed`, which is
		// the always-truthy lifecycle hook METHOD and would remount every component on
		// every render), and hence the placeholder read off the instance: this vnode's
		// own `el` is the child's now-detached anchor.
		const dead = oldVnode.component;
		if (dead?.isDestroyed && dead.__hasErrorReplacement?.()) {
			newVnode.component = dead;
			newVnode.instance = oldVnode.instance;
			newVnode.el = dead.element;
			return;
		}
		if (dead == null || dead.isDestroyed) {
			const placeholder = dead?.__failedPlaceholder ?? oldVnode.el;
			// Only an ATTACHED node is a usable insertion ref — insertBefore against a
			// detached one throws NotFoundError and empties the container.
			mount(
				newVnode,
				parent,
				placeholder?.parentNode === parent ? placeholder : null,
				ctx,
				owner
			);
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				if (placeholder?.parentNode) devperfMutation();
			}
			placeholder?.remove();
			return;
		}
		patchComponent(oldVnode, newVnode);
		return;
	}

	const el = (newVnode.el = oldVnode.el);

	// Placeholder → placeholder (sameNode already matched tag '#' + null key):
	// transfer the comment el, nothing to patch. A placeholder ↔ real node swap is
	// a tag mismatch handled by the replace path above (mount the new, unmount the
	// comment — releaseSubtree/remove handle a comment-el vnode with no children).
	if (newVnode.tag === PLACEHOLDER_TAG) return;

	// Portal → portal: the local placeholder transferred above; the teleported
	// children patch against this portal's bracketed range inside the outlet.
	if (newVnode.tag === PORTAL_TAG) {
		if (typeof __PUZZLE_HAS_PORTAL__ === 'undefined' || __PUZZLE_HAS_PORTAL__)
			patchPortal(oldVnode, newVnode, ctx, owner, patchChildren);
		return;
	}

	if (newVnode.isText) {
		const text = stringify(newVnode.attrs.value);
		if (el.nodeValue !== text) {
			el.nodeValue = text;
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				devperfMutation();
		}
		return;
	}

	patchAttrs(el, oldVnode.attrs, newVnode.attrs, owner);

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
		if (newVnode.children !== oldVnode.children) {
			el.innerHTML = newVnode.children;
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				devperfMutation();
		}
		return;
	}

	patchChildren(el, oldVnode.children, newVnode.children, ctx, owner);

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
	// Compare against the LIVE property first, exactly as the INPUT/TEXTAREA branch of
	// patchAttrs does: a settled select re-asserted on every patch wrote the value it
	// already had and charged devperf a phantom DOM mutation. When the option list
	// churned (or the user changed the selection out of band) the live value differs
	// and the write still happens.
	const next = stringify(attrs.value);
	if (el.value === next) return;
	el.value = next;
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
		devperfMutation();
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
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		devperfComponentPatch(child, props === undefined);
	}
	child.applyParentUpdate({ props, children: newVnode.children });
	newVnode.el = child.element;
}

function sameNode(a, b) {
	// (tag, key) identity by SameValueZero — the same comparison the keyed map in
	// patchKeyedChildren uses, so a `NaN` key matches itself (a bare `===` reads
	// NaN !== NaN and would needlessly replace the row on every render).
	//
	// Child OWNERSHIP is part of that identity: an `island` element's children are
	// third-party-owned and frozen by carrying the mounted child vnodes forward, so
	// two conditional branches sharing a tag and key but disagreeing about `island`
	// describe different subtrees, not one subtree to patch across. Patching the flip
	// would diff stale seed vnodes against DOM the island's owner has since rewritten
	// — currentTree would end up holding detached nodes and every later render would
	// corrupt further. Making the flip a REPLACEMENT unmounts and remounts cleanly in
	// both directions. Components and text vnodes never carry `island` (it is rejected
	// on components), so neither side of this test moves for them.
	return (
		a.tag === b.tag &&
		(a.key === b.key || (a.key !== a.key && b.key !== b.key)) &&
		('island' in a.attrs) === ('island' in b.attrs)
	);
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
	if (vnode.tag === PORTAL_TAG) {
		if (typeof __PUZZLE_HAS_PORTAL__ === 'undefined' || __PUZZLE_HAS_PORTAL__)
			return unmountPortal(vnode, unmount);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (vnode.el?.parentNode) devperfMutation();
		}
		vnode.el?.remove();
		return;
	}
	if (vnode.isComponent) {
		const child = vnode.component;
		// A component vnode that never got as far as an instance, holding only a
		// comment placeholder: the takeoverFailed path in mountComponent returns
		// before constructing a child, so `component` is still null. No instance to
		// destroy — just drop the placeholder node so it doesn't linger in the DOM.
		//
		// NOT the first-mount-failure case. mountComponent assigns `vnode.component`
		// before it ever calls mount(), and its rejection handler clears
		// `vnode.instance` (the Router-preloaded pin) — never `component` — so a
		// failed mount arrives here with a DESTROYED instance and takes the
		// isDestroyed branch below.
		if (!child) {
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				if (vnode.el?.parentNode) devperfMutation();
			}
			vnode.el?.remove();
			return;
		}
		// A failed position is represented by its destroyed original instance. A
		// parent removal destroys the fresh error view and its marker exactly once.
		if (child.isDestroyed) {
			child.destroy();
			vnode.el?.remove();
			return;
		}
		// LEAVE animation (constellation/doc/DOC-SPEC.md §12): when the leaving
		// instance declares `animations.out`, defer DOM removal + destroy() until
		// the out-animation finishes (destroyAnimated). The element stays in place
		// meanwhile — siblings patch AROUND it: it is registered in leavingEls so
		// the keyed move-guard ignores it, and it is never used as an insertBefore
		// reference (refs come only from newChildren). Best-effort edges: during a
		// GENUINE reorder concurrent with a leave, survivors order correctly but
		// the leaver's resting spot among them is unspecified; a newly mounted
		// sibling inserts relative to survivors and may land before or after a
		// leaver. Pure removals keep the leaver exactly in place. Declaring NEITHER
		// an out-animation nor a hide hook keeps the original synchronous, instant
		// destroy() — zero behaviour change (the whole existing suite is the
		// regression net). Declaring a hide hook WITHOUT an animation still routes
		// through destroyAnimated(), because viewWillHide()/viewDidHide() are
		// lifecycle, not animation callbacks (D28): they fire in order with
		// zero-duration semantics, exactly as the router's teardown already fires
		// them. Nothing else changes for that view — playOut() with no `out` spec
		// awaits no animation, so the hooks and destroy() land in the same order.
		if (child?.animations?.out || child?.__hasHideHooks) {
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
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
		if (vnode.el?.parentNode) devperfMutation();
	}
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
		// A portal inside a removed subtree: its teleported children live in the
		// outlet, so the ancestor's el.remove() reaches neither their DOM nor their
		// instances — tear the whole portal down explicitly.
		if (child.tag === PORTAL_TAG) {
			if (typeof __PUZZLE_HAS_PORTAL__ === 'undefined' || __PUZZLE_HAS_PORTAL__)
				unmountPortal(child, unmount);
		} else if (child.isComponent) child.component?.destroy();
		else if (!child.isText) releaseSubtree(child);
	}
}

/**
 * Release the non-DOM resources held by the vnode trees of a render that threw
 * partway (ViewManager.treeUnknown) — both trees of an aborted patch, or the single
 * incoming tree of an aborted FIRST mount, which nothing else can reach at all
 * (currentTree is still null, so clear()'s unmount walk covers nothing).
 * The DOM is cleared separately, by range
 * removal, because these trees no longer describe where anything IS — but they are
 * still the only record of WHAT exists: nested component instances (and their store
 * subscriptions), element refs (D72), `outside` listeners parked on document (D86),
 * and portaled content living in the outlet. Raw node removal releases none of it,
	 * and once the manager adopts the error view nothing can reach these trees again.
 *
 * Both trees are walked because the aborted patch may have mounted components from
 * the incoming tree while leaving the outgoing tree's components live. An instance
 * carried across by patchComponent is reached twice; destroy() is idempotent
 * (#destroyed guard), the ref setters are removal-guarded, and the listener sweep
 * deletes the keys it detaches, so the second visit is a no-op.
 *
 * This runs on an already-failing path, so the guard is per TREE, not per node: one
 * tree's release throwing must not cost the OTHER tree its release, and neither may
 * stop the error view from mounting. Inside a tree the walk is deliberately
 * unguarded, because nothing it reaches is user code in a compiled app: ref setters
 * are the framework's own __ref closures (a Map lookup and an assignment), and
 * destroy() already contains the one user hook it fires, destroyed() (D118). Per-node
 * try/catch would buy nothing and cost bytes on a walk that also runs on every
 * ordinary removal. A hand-written render tree can still throw mid-walk; it forfeits
 * the rest of THAT tree's release, and the error view mounts regardless.
 */
function releaseAborted(trees) {
	if (!trees) return;
	for (const tree of trees) {
		if (!tree) continue;
		try {
			if (tree.tag === PORTAL_TAG) {
				if (typeof __PUZZLE_HAS_PORTAL__ === 'undefined' || __PUZZLE_HAS_PORTAL__)
					unmountPortal(tree, unmount);
			} else if (tree.isComponent) tree.component?.destroy();
			else if (!tree.isText) releaseSubtree(tree);
		} catch (err) {
			console.error('[puzzle] releasing an aborted render failed:', err);
		}
	}
}

function patchAttrs(el, oldAttrs, newAttrs, owner = null) {
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
		// the app never mirrored back into state — typing into an input whose write
		// commits on `change` (an author handler, or D147's synthesized
		// '@change:bind'), clicking such a checkbox, or an in-flight IME composition
		// whose write the bind guard is deliberately holding back. A later re-render whose BOUND value is
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
			if (el.value !== stringify(value)) setAttr(el, name, value, owner);
		} else if (name === 'checked' && el.nodeName === 'INPUT') {
			if (el.checked !== Boolean(value)) setAttr(el, name, value, owner);
			// The property guard above short-circuits precisely when the USER moved
			// checkedness, which is also the only path that leaves the content
			// attribute stale — `el.checked = x` writes the property, never the
			// attribute (that is defaultChecked). Skipping setAttr therefore breaks
			// this file's own "keep boolean ATTRIBUTES coherent for CSS selectors"
			// rule for `checked` alone: `input[checked]` keeps matching an unchecked
			// box, and form.reset() restores the stale attribute with no change event,
			// so state and UI diverge with nothing to resync them. Reflect the
			// attribute on its own rather than falling through to setAttr, which would
			// re-assign the property and bill two devperfMutation() calls per patch —
			// moving the D121/D122 counts and the stress form-state baseline.
			else if (el.hasAttribute('checked') !== Boolean(value)) {
				if (value) el.setAttribute('checked', '');
				else el.removeAttribute('checked');
				if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
			}
		} else if (oldAttrs[name] !== value) {
			setAttr(el, name, value, owner);
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
function patchChildren(el, oldChildren, newChildren, ctx, owner, tail = null) {
	const keyed = oldChildren.some((c) => c.key != null) || newChildren.some((c) => c.key != null);
	if (keyed) {
		patchKeyedChildren(el, oldChildren, newChildren, ctx, owner, tail);
	} else {
		patchIndexedChildren(el, oldChildren, newChildren, ctx, owner, tail);
	}
}

// `tail` is the insertion reference for children appended at the END of the
// list. Null (every ordinary element parent) appends to the parent; a portal
// passes its range's closing comment so teleported children stay inside their
// own bracketed span of the shared outlet.
function patchIndexedChildren(el, oldChildren, newChildren, ctx, owner, tail = null) {
	const common = Math.min(oldChildren.length, newChildren.length);
	for (let i = 0; i < common; i++) {
		patch(oldChildren[i], newChildren[i], el, ctx, owner);
	}
	for (let i = common; i < newChildren.length; i++) {
		mount(newChildren[i], el, tail, ctx, owner);
	}
	for (let i = common; i < oldChildren.length; i++) {
		if (
			(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) &&
			oldChildren[i].isComponent &&
			oldChildren[i].component?.animations?.out
		) {
			warnUnkeyedOutAnimation();
		}
		unmount(oldChildren[i]);
	}
}

let warnedUnkeyedOutAnimation = false;
function warnUnkeyedOutAnimation() {
	if (warnedUnkeyedOutAnimation) return;
	warnedUnkeyedOutAnimation = true;
	console.warn(
		'[puzzle] out animations in an unkeyed list can misorder siblings — ' +
			'give the list items key attributes'
	);
}

// Two siblings with the SAME tag and SAME key silently collapse (the per-tag Map
// keeps only the last), which surfaces as mystifying DOM churn — the older sibling
// never matches and gets unmounted. There is no dev/prod flag in the runtime, so
// warn at most once per session (a bounded global, like animate.js's malformed-spec
// warning).
let warnedDuplicateKey = false;
function warnDuplicateKey(key) {
	if (warnedDuplicateKey) return;
	warnedDuplicateKey = true;
	console.warn(
		`[puzzle] duplicate key ${JSON.stringify(key)} among keyed siblings — keys must be ` +
			'unique within a list; duplicates cause elements to be dropped or reordered unexpectedly.'
	);
}

// D89's usage scan prunes node_modules/dist/vendor/dot-dirs, so a `flip` attr
// arriving from an INSTALLED .pzl component is invisible to it: the define lands
// false, flip.js tree-shakes out, and the reorder animation silently never plays.
// The formatter half of the same scan degrades LOUDLY (D43's unknown-formatter
// error) — this is flip's equivalent, dev-only and once per session.
let warnedFlipCompiledOut = false;
function warnFlipCompiledOut() {
	if (warnedFlipCompiledOut) return;
	warnedFlipCompiledOut = true;
	console.warn(
		'[puzzle] a `flip` attribute is present at runtime, but flip support was compiled out — ' +
			'the build scan found no `flip` in project templates (it does not scan node_modules or ' +
			'build output), so the reorder animation will not play. Use `flip` on an element in ' +
			'project source to keep the runtime in, or remove the attribute.'
	);
}

// Same false-negative posture as flip: installed/generated templates are
// outside the first-party usage walk, so a Portal vnode can still arrive after
// __PUZZLE_HAS_PORTAL__ was baked false. Warn once in development; mount() keeps
// an inert placeholder so production never throws.
let warnedPortalCompiledOut = false;
function warnPortalCompiledOut() {
	if (warnedPortalCompiledOut) return;
	warnedPortalCompiledOut = true;
	console.warn(
		'[puzzle] a `<Portal>` vnode is present at runtime, but Portal support was compiled out — ' +
			'the build scan found no `<Portal>` in project templates (it does not scan node_modules ' +
			'or build output), so the portal content will not render. Use `<Portal>` in project ' +
			'source to keep the runtime in, or remove the vnode.'
	);
}

function patchKeyedChildren(el, oldChildren, newChildren, ctx, owner, tail = null) {
	// Keyed identity is the pair (tag, key), with BOTH sides compared by native
	// SameValueZero — never string concatenation. Partition by raw `tag` (a
	// component's class object by identity, an element's tag string) into a nested
	// Map keyed by the raw `key`. This keeps distinct-type keys distinct (`1` vs
	// `"1"`, `true` vs `"true"`), lets `NaN` self-match (SameValueZero), and never
	// stringifies a component tag to its class source. Old `tag + '\x00' + key`
	// concatenation collapsed all of these, unmounting a live row and aliasing two
	// logical rows onto one DOM node while falsely warning about duplicate keys.
	const oldKeyed = new Map(); // tag -> Map<rawKey, child>
	for (const child of oldChildren) {
		if (child.key != null) {
			let byKey = oldKeyed.get(child.tag);
			if (!byKey) oldKeyed.set(child.tag, (byKey = new Map()));
			byKey.set(child.key, child);
		}
	}

	const matched = new Set();
	let oldUnkeyed = oldChildren.filter((c) => c.key == null);
	let unkeyedIdx = 0;
	const seenNewKeys = new Map(); // tag -> Set<rawKey>
	// FLIP fast path (D85): one property check per new child during the pairing
	// map we already run. Lists without any `flip` attr never call into flip.js
	// — zero measurements, zero extra passes.
	//
	// Build-time gate (D89): the two touchpoints that REFERENCE flip.js — the
	// beginFlip and playFlip calls below — are wrapped in the inline
	// `typeof __PUZZLE_HAS_FLIP__ …` probe. When the compiler proves no template
	// uses a `flip` attr it defines the flag false; MinifySyntax folds both probes
	// to dead branches, `beginFlip`/`playFlip` go unreferenced, and flip.js
	// tree-shakes out entirely. Undefined (vitest / no-compiler) ⇒ probe is true,
	// so behavior is identical. The probe MUST be inlined at each site — a named
	// const or helper is not constant-propagated by esbuild and would keep the
	// import alive.
	//
	// The detection below is deliberately NOT probe-wrapped: it references no
	// import, so gating it buys no tree-shaking — only skipping one `in` check per
	// child, which is exactly the check that already runs today. Leaving it bare
	// keeps the hot pairing loop readable at zero cost.
	let hasFlip = false;

	// First pass: pair every new child with its old counterpart (or none)
	const pairs = newChildren.map((newChild) => {
		if (!hasFlip && 'flip' in newChild.attrs) hasFlip = true;
		if (newChild.key != null) {
			let seen = seenNewKeys.get(newChild.tag);
			if (!seen) seenNewKeys.set(newChild.tag, (seen = new Set()));
			if (seen.has(newChild.key)) warnDuplicateKey(newChild.key);
			else seen.add(newChild.key);
			const byKey = oldKeyed.get(newChild.tag);
			const match = byKey ? byKey.get(newChild.key) : undefined;
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
	const flip =
		(typeof __PUZZLE_HAS_FLIP__ === 'undefined' || __PUZZLE_HAS_FLIP__) && hasFlip
			? beginFlip(pairs)
			: null;
	// Dev-only diagnostic for the compiled-out-but-present case (see the helper).
	// The __PUZZLE_DEV__ probe folds this whole branch dead in production, so the
	// helper goes unreferenced and minifies away with it.
	if (
		(typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) &&
		typeof __PUZZLE_HAS_FLIP__ !== 'undefined' &&
		!__PUZZLE_HAS_FLIP__ &&
		hasFlip
	) {
		warnFlipCompiledOut();
	}

	// Remove old children that found no new counterpart
	for (const child of oldChildren) {
		if (!matched.has(child)) unmount(child);
	}

	// Second pass: patch/mount and move into position, back to front so the
	// insertBefore reference (the next new child's el) is always final. The
	// move-guard compares against the next PERSISTENT sibling — elements
	// lingering mid-leave-animation don't count, so a pure removal leaves every
	// survivor (and the fading element) exactly where it was.
	let ref = tail;
	for (let i = pairs.length - 1; i >= 0; i--) {
		const [oldChild, newChild] = pairs[i];
		if (oldChild) {
			patch(oldChild, newChild, el, ctx, owner);
			if (nextPersistentSibling(newChild.el) !== ref) {
				el.insertBefore(newChild.el, ref);
				if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
					devperfMutation();
				}
			}
		} else {
			mount(newChild, el, ref, ctx, owner);
		}
		ref = newChild.el;
	}

	// FLIP Last + Play (D85): every retained element is patched and in final
	// position — measure again and animate the moved rows from where they were.
	if ((typeof __PUZZLE_HAS_FLIP__ === 'undefined' || __PUZZLE_HAS_FLIP__) && flip) playFlip(flip);
}

/** The next sibling that is not a leaving (mid-out-animation) element. */
function nextPersistentSibling(node) {
	let n = node.nextSibling;
	while (n && leavingEls.has(n)) n = n.nextSibling;
	return n;
}

// ---- attributes / properties / listeners --------------------------------------

function setAttr(el, name, value, owner = null) {
	// D150: codegen escapes a literal @-prefixed attribute from {#raw} as an
	// impossible-in-source `@@name` vnode key so it cannot enter the listener path.
	if (
		(typeof __PUZZLE_HAS_RAW_AT__ === 'undefined' || __PUZZLE_HAS_RAW_AT__) &&
		name.startsWith('@@')
	) {
		setLiteralAtAttr(el, name.slice(1), value === true ? '' : stringify(value));
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
		return;
	}
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
		detachListener(el, name, event, mods, listeners);
		if (typeof value === 'function') {
			// A spent once-binding survives fresh handler closures across patches
			// (D38). Its listener detached when it fired, so do not resurrect it.
			if (mods.includes('once') && listeners[name + ONCE_SPENT]) return;
			// An outside binding always wraps (mods is non-empty by construction —
			// 'outside' itself is a modifier), so the gate below never needs a
			// separate no-other-mods path.
			// D146: an event handler re-enters the owning view from the event loop,
			// which may be INSIDE a suspended prepared data()'s window. Run it with
			// the destination eval scope fenced off so `this.params`/`this.route`
			// report the committed route — a handler writing `{ orgId: this.params.id }`
			// must not write against a navigation that has not landed (and may never).
			// The fence wraps the modifier chain too; those are framework steps and
			// read no route state, so the ordering in withModifiers is unaffected.
			const bound =
				typeof owner?.__withCommittedScope === 'function'
					? (event) => owner.__withCommittedScope(() => value(event))
					: value;
			const handler = mods.length
				? withModifiers(name, event, mods, bound, listeners, el)
				: bound;
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
		// The attribute NAME rides along as the diagnostic label, exactly as the
		// removal path below passes it: display.js dedups its undefined-value warning
		// by label, so an unlabeled `<input value={ missing }>` both warned as a
		// nameless "undefined template value" and collapsed into the same '' key as
		// every other unlabeled site — only the first of them ever warned.
		el[name] = name === 'value' ? stringify(value, name) : Boolean(value);
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
			devperfMutation();
		// keep boolean ATTRIBUTES coherent for CSS selectors like [disabled]
		if (name !== 'value') {
			if (value) el.setAttribute(name, '');
			else el.removeAttribute(name);
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
				devperfMutation();
		}
		return;
	}

	if (value === false || value == null) {
		// Preserve attribute-removal semantics, but still hand an undefined binding
		// to the shared display policy for its development diagnostic. The RESULT is
		// discarded — the call exists only for that warning — so the probe leads and
		// production pays nothing per nullish attribute. The attribute NAME rides
		// along as the label: display.js dedups warnings by label, so without it every
		// brace-only undefined in the app collapsed into the one '' key and only the
		// first ever warned. Production is byte-neutral — the whole call folds away
		// with this dev gate.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (value === undefined) stringify(value, name);
		}
		el.removeAttribute(name);
	} else if (value === true) {
		el.setAttribute(name, '');
	} else {
		el.setAttribute(name, stringify(value));
	}
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
		devperfMutation();
}

// The HTML parser accepts @-prefixed attribute names, but setAttribute() rejects
// them as invalid XML Names. Parse the NAME once into an Attr node, then attach
// it; subsequent patches can update Attr.value directly (D150).
function setLiteralAtAttr(el, name, value) {
	const existing = el.getAttributeNode(name);
	if (existing) {
		existing.value = value;
		return;
	}
	const template = document.createElement('template');
	template.innerHTML = `<i ${name}></i>`;
	const attr = template.content.firstElementChild.getAttributeNode(name).cloneNode();
	attr.value = value;
	el.setAttributeNode(attr);
}

function removeAttr(el, name) {
	if (
		(typeof __PUZZLE_HAS_RAW_AT__ === 'undefined' || __PUZZLE_HAS_RAW_AT__) &&
		name.startsWith('@@')
	) {
		el.removeAttribute(name.slice(1));
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) devperfMutation();
		return;
	}
	if (name === 'key' || name === 'island' || name === 'ref' || name === 'flip') return;

	if (name.startsWith('@')) {
		// Split the same way setAttr does so the correct DOM event type detaches
		// even when the key carries modifiers ('@event:mod' → event 'event').
		const [event, ...mods] = name.slice(1).split(':');
		const listeners = el[LISTENERS];
		if (listeners) {
			detachListener(el, name, event, mods, listeners);
			// Explicit removal resets a once-binding even when spend already detached
			// its handler — a later re-add must start fresh (D38).
			delete listeners[name + ONCE_SPENT];
		}
		return;
	}

	if (PROPS.has(name)) {
		el[name] = name === 'value' ? '' : false;
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
			devperfMutation();
	}
	el.removeAttribute(name);
	if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)
		devperfMutation();
}

/**
 * Detach one patch-managed listener and drop its live-handler entry. The
 * once-spent marker is deliberately left alone; only an explicit binding
 * removal resets it (D38).
 */
function detachListener(el, name, event, mods, listeners) {
	const handler = listeners[name];
	if (!handler) return;
	if (mods.includes('outside')) document.removeEventListener(event, handler, OUTSIDE_OPTS);
	else el.removeEventListener(event, handler);
	delete listeners[name];
}

// Event-modifier key filters: modifier name → the KeyboardEvent.key it gates on
// (SPEC event modifiers). Hand-mirrors the compiler's eventKeyFilters table
// (compiler/internal/parser/parser.go); tests/event-key-filters-parity.test.js
// asserts the two stay byte-identical. Exported for that test only — a named
// export tree-shakes when unused.
export const KEY_FILTERS = {
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
 * @param {string} eventName the bare DOM event name
 * @param {string[]} mods modifiers in written order
 * @param {Function} handler the compiled listener
 * @param {object} listeners the element's LISTENERS object (holds the spent flag)
 * @param {Element} el the bound element — the outside-gate's containment anchor
 */
function withModifiers(fullName, eventName, mods, handler, listeners, el) {
	const spentKey = fullName + ONCE_SPENT;
	const outside = mods.includes('outside');
	return (event) => {
		if (
			outside &&
			((typeof __PUZZLE_HAS_PORTAL__ === 'undefined' || __PUZZLE_HAS_PORTAL__)
				? portalAwareContains(el, event.target)
				: el.contains(event.target))
		)
			return;
		for (const m of mods) {
			const key = KEY_FILTERS[m];
			if (key !== undefined && event.key !== key) return;
		}
		if (mods.includes('once')) {
			if (listeners[spentKey]) return;
			listeners[spentKey] = true;
			detachListener(el, fullName, eventName, mods, listeners);
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

export default ViewManager;

/**
 * serialize — pure ViewNode → HTML string for static site generation (M1).
 *
 * The build-time counterpart to the ViewManager: it walks the SAME ViewNode
 * trees the compiled render() methods build, but emits an HTML STRING instead of
 * creating and patching DOM. Nothing DOM-shaped runs — no `mounted()`, no
 * animations — so it is safe to drive at build time under Node (the whole point
 * of the SSG path: PuzzleView.preload() loads a view's data() DOM-free, and this
 * serializes the resulting tree).
 *
 * Semantics mirror viewManager.js exactly so prerendered markup matches what the
 * browser would mount from the identical tree (the router takes over on load —
 * see router.js #swap SSG branch):
 * - text nodes stringify attrs.value the way ViewManager's stringify() does;
 * - attribute handling mirrors setAttr(): `key`/`island`/`@event` directives are
 *   dropped, controlled value is emitted as real HTML for each form element
 *   (`input value`, `textarea` text, selected `<option>`), truthy boolean props
 *   and `true` become bare attrs, `false`/null/undefined omit, everything else is
 *   an escaped string;
 * - a component vnode renders inline with NO wrapper element (D20), adopting a
 *   pinned `instance` or constructing + preloading a fresh one;
 * - slot markers are expanded via the shared expandSlots() (viewManager.js), so
 *   named/default slots and fallbacks behave identically;
 * - string children (an inlined `{#svg}` island seed, v1.14 D46) are emitted
 *   verbatim — they map to innerHTML seeding in the browser;
 * - void elements self-close without children.
 *
 * Principled differences from a jsdom mount of the same tree (documented, tested
 * for in the equivalence suite): controlled form values are serialized as their
 * HTML initial-state equivalents, whereas ViewManager assigns live properties.
 * Boolean attrs serialize bare (`disabled`) where jsdom canonicalizes to
 * `disabled=""`; they are equivalent HTML.
 */

import { SLOT_TAG, PLACEHOLDER_TAG } from '../views/ViewNode.js';
import { expandSlots } from '../views/viewManager.js';

// Void elements (HTML spec): self-closing, never carry children.
const VOID_ELEMENTS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
	'link', 'meta', 'source', 'track', 'wbr',
]);

// Boolean element properties the ViewManager assigns AND reflects as bare attrs
// (mirrors viewManager.js PROPS, minus `value`, which is handled on its own).
const BOOLEAN_PROPS = new Set(['checked', 'disabled', 'selected', 'muted']);

/** Coerce a text/attr value to a string the way viewManager.js stringify() does. */
function stringify(v) {
	return v == null ? '' : String(v);
}

/** Escape a text node's content: the three characters that would break HTML text. */
function escapeText(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a double-quoted attribute value (adds the quote characters over text). */
function escapeAttr(s) {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * One element's attributes as a string (each emitted attr is space-prefixed).
 * `key`/`island`/`ref` (D72)/`@event` are framework directives, never markup. Controlled
 * `select`/`textarea` values are represented by descendants/text instead of a
 * dead value attr; other values keep the normal setAttr-compatible emission.
 */
function serializeAttrs(tag, attrs, { selected = false, controlledSelect = false } = {}) {
	let out = '';
	for (const [name, value] of Object.entries(attrs)) {
		if (name === 'key' || name === 'island' || name === 'ref' || name.startsWith('@')) continue;
		if (name === 'value' && (tag === 'select' || tag === 'textarea')) continue;
		if (name === 'selected' && controlledSelect && tag === 'option') continue;
		if (name === 'value') {
			out += ` value="${escapeAttr(stringify(value))}"`;
		} else if (BOOLEAN_PROPS.has(name)) {
			if (value) out += ` ${name}`;
		} else if (value === false || value == null) {
			// omitted
		} else if (value === true) {
			out += ` ${name}`;
		} else {
			out += ` ${name}="${escapeAttr(String(value))}"`;
		}
	}
	if (selected) out += ' selected';
	return out;
}

/**
 * Serialize a ViewNode (or a raw string child) to HTML. Async because a component
 * vnode without a pinned instance is preloaded (created() + awaited data()) before
 * its render tree can be serialized.
 *
 * @param {import('../views/ViewNode.js').ViewNode|string|null} vnode
 * @param {object} [options]
 * @param {object} [options.ctx] the { store, router, formatters } passed to any
 *   component this tree instantiates (the owner's context, exactly as ViewManager)
 * @returns {Promise<string>}
 *
 * Note: the route snapshot is NOT threaded through serialization. Only the routed
 * views/layouts get a `this.route` (they are pinned instances preloaded with the
 * snapshot by ssg/index.js renderRoute); any NON-routed nested component this tree
 * instantiates is preloaded with `route: null`, matching the browser where the
 * ViewManager mounts nested components without a route (this.route === null
 * off-router, viewManager.js ~264). Threading it here would diverge build-time
 * render from browser render for a component that probes `if (this.route)`.
 */
export async function serialize(vnode, { ctx = {} } = {}) {
	return serializeNode(vnode, ctx, null);
}

async function serializeNode(vnode, ctx, selectState) {
	if (vnode == null) return '';
	// A raw string child is verbatim compile-time markup (an inlined `{#svg}` seed)
	// — emitted as-is, the way ViewManager drops it in via innerHTML (D46).
	if (typeof vnode === 'string') return vnode;

	if (vnode.isText) return escapeText(stringify(vnode.attrs.value));

	// Placeholder (codegen arity-padding for conditionals): the browser mounts an
	// empty comment node here, which contributes no visible markup — serialize to
	// nothing. The router takeover re-renders the same tree, so the mounted comment
	// simply replaces this empty span of the SSG output.
	if (vnode.tag === PLACEHOLDER_TAG) return '';

	// Slot markers are substituted by expandSlots() before serialization, so one
	// never reaches here; guard defensively rather than emit a bogus <slot> tag.
	if (vnode.tag === SLOT_TAG) return '';

	if (vnode.isComponent) return serializeComponent(vnode, ctx, selectState);

	const tag = vnode.tag;
	let childSelectState = selectState;
	if (tag === 'select' && 'value' in vnode.attrs) {
		// Single-select semantics: the first matching option wins. multiple-select
		// array matching is deliberately out of scope for the D67 SSG pass.
		childSelectState = { value: stringify(vnode.attrs.value), matched: false };
	}

	let selected = false;
	if (tag === 'option' && childSelectState && !childSelectState.matched) {
		if (optionValue(vnode) === childSelectState.value) {
			selected = true;
			childSelectState.matched = true;
		}
	}

	const open = `<${tag}${serializeAttrs(tag, vnode.attrs, {
		selected,
		controlledSelect: Boolean(childSelectState),
	})}>`;
	if (VOID_ELEMENTS.has(tag)) return open;

	if (tag === 'textarea' && 'value' in vnode.attrs) {
		// Pathological template case: if a textarea has both value={...} and
		// children, the browser's value property wins, so SSG replaces the children.
		return `${open}${escapeText(stringify(vnode.attrs.value))}</${tag}>`;
	}

	// Inline-SVG seed (D46): string children are verbatim markup, not a vnode list.
	const inner =
		typeof vnode.children === 'string'
			? vnode.children
			: await serializeChildren(vnode.children, ctx, childSelectState);
	return `${open}${inner}</${tag}>`;
}

/** Serialize and concatenate a child vnode list in order. */
async function serializeChildren(children, ctx, selectState) {
	let out = '';
	for (const child of children) {
		out += await serializeNode(child, ctx, selectState);
	}
	return out;
}

function optionValue(vnode) {
	if (Object.prototype.hasOwnProperty.call(vnode.attrs, 'value')) {
		return stringify(vnode.attrs.value);
	}
	return collectTextContent(vnode.children);
}

function collectTextContent(children) {
	if (!children) return '';
	if (typeof children === 'string') return children;
	let out = '';
	for (const child of children) {
		if (typeof child === 'string') {
			out += child;
		} else if (child?.isText) {
			out += stringify(child.attrs.value);
		} else if (child && !child.isComponent) {
			out += collectTextContent(child.children);
		}
	}
	return out;
}

/**
 * Serialize a component vnode inline (no wrapper element, D20). A pinned
 * `instance` (a Router/SSG-chain view whose data() already resolved via preload,
 * carrying the route snapshot) is adopted as-is; otherwise this is a NON-routed
 * nested component, so a fresh instance is constructed with `ctx` and preloaded
 * with `route: null` — mirroring the browser, where the ViewManager mounts nested
 * components without a route (this.route stays null off-router, viewManager.js
 * ~264). `preload()` runs created() + awaited data() with NO DOM and NO
 * mounted()/animations (PuzzleView.preload, DOC-APP-ANATOMY §5). The resolved
 * render() tree is slot-expanded against the call-site children and serialized.
 * Always render(), never renderSkeleton() — a build has real data.
 */
async function serializeComponent(vnode, ctx, selectState) {
	const instance = vnode.instance ?? new vnode.tag(ctx);
	if (vnode.instance == null) {
		await instance.preload({ params: {}, props: vnode.attrs, route: null });
	}
	const rendered = instance.render();
	if (rendered == null) return '';
	const tree = expandSlots(rendered, vnode.children);
	return serializeNode(tree, ctx, selectState);
}

export default serialize;

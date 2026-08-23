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
 * - attribute handling mirrors setAttr(): `key`/`island`/`ref`/`flip`/`@event`
 *   directives are dropped, controlled value is emitted as real HTML for each form element
 *   (`input value`, `textarea` text, selected `<option>`), truthy boolean props
 *   and `true` become bare attrs, `false`/null/undefined omit, everything else is
 *   an escaped string;
 * - a component vnode renders inline with NO wrapper element (D20), adopting a
 *   pinned `instance` or constructing + preloading a fresh one;
 * - slot markers are expanded via the shared expandSlots() (viewManager.js), so
 *   named/default slots and unfilled-marker omission behave identically;
 * - string children (an inlined `{#svg}` island seed, v1.14 D46) are emitted
 *   verbatim — they map to innerHTML seeding in the browser;
 * - `<script>`/`<style>` are RAWTEXT: their text is emitted unescaped (a JSON-typed
 *   script gets the `\u003c` data-island escape instead), and content that would
 *   end — or refuse to end — the element in the parser is a build error;
 * - void elements self-close without children.
 *
 * Principled differences from a jsdom mount of the same tree (documented, tested
 * for in the equivalence suite): controlled form values are serialized as their
 * HTML initial-state equivalents, whereas ViewManager assigns live properties.
 * Boolean attrs serialize bare (`disabled`) where jsdom canonicalizes to
 * `disabled=""`; they are equivalent HTML.
 */

import { SLOT_TAG, PLACEHOLDER_TAG, PORTAL_TAG } from '../views/ViewNode.js';
import { expandSlots } from '../views/viewManager.js';
import { displayValue as stringify } from '../display.js';

// Void elements (HTML spec): self-closing, never carry children.
const VOID_ELEMENTS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
	'link', 'meta', 'source', 'track', 'wbr',
]);

// Boolean element properties the ViewManager assigns AND reflects as bare attrs
// (mirrors viewManager.js PROPS, minus `value`, which is handled on its own).
const BOOLEAN_PROPS = new Set(['checked', 'disabled', 'selected', 'muted']);

/** Escape a text node's content: the three characters that would break HTML text. */
export function escapeText(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The JSON-in-script emission rule, shared with the static data island
 * (ssg/index.js). Replacing `<` with the `\u003c` escape is JSON-transparent — a
 * parser decodes it back to the same string — and makes a literal `</script>`
 * impossible to emit, so content can never end the RAWTEXT element early.
 */
export function escapeScriptJson(s) {
	return s.replace(/</g, '\\u003c');
}

/** Escape a double-quoted attribute value (adds the quote characters over text). */
export function escapeAttr(s) {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * One element's attributes as a string (each emitted attr is space-prefixed).
 * `key`/`island`/`ref` (D72)/`flip` (D85)/`@event` are framework directives, never
 * markup. Controlled `select`/`textarea` values are represented by
 * descendants/text instead of a dead value attr; other values keep the normal
 * setAttr-compatible emission.
 */
function serializeAttrs(tag, attrs, { selected = false, controlledSelect = false } = {}) {
	let out = '';
	for (const [vnodeName, value] of Object.entries(attrs)) {
		const literalAt = vnodeName.startsWith('@@');
		const name = literalAt ? vnodeName.slice(1) : vnodeName;
		if (
			!literalAt &&
			(name === 'key' ||
				name === 'island' ||
				name === 'ref' ||
				name === 'flip' ||
				name.startsWith('@'))
		) {
			continue;
		}
		if (name === 'value' && (tag === 'select' || tag === 'textarea')) continue;
		if (name === 'selected' && controlledSelect && tag === 'option') continue;
		if (name === 'value') {
			out += ` value="${escapeAttr(stringify(value))}"`;
		} else if (BOOLEAN_PROPS.has(name)) {
			if (value) out += ` ${name}`;
		} else if (value === false || value == null) {
			// Omitted to mirror ViewManager attribute semantics, but an undefined
			// binding still gets its development diagnostic — the result is
			// discarded, the call is only there for the warning. The attribute NAME is
			// the dedup label (display.js keys warned-once by it); without it every
			// unlabeled undefined collapsed into one '' key and only the first warned.
			if (value === undefined) stringify(value, name);
		} else if (value === true) {
			out += ` ${name}`;
		} else {
			out += ` ${name}="${escapeAttr(stringify(value))}"`;
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

	// Portals emit NOTHING in prerendered HTML (D144): their content belongs to a
	// framework-created outlet that only exists once the browser runtime mounts, so
	// portaled markup appears at takeover, never in the static output.
	if (vnode.tag === PORTAL_TAG) return '';

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

	if (tag === 'script' || tag === 'style') {
		// RAWTEXT elements (D113): the HTML parser reads their content verbatim and
		// never entity-decodes it, so escapeText would ship `&amp;`/`&lt;` to crawlers
		// and turn a `a > b` CSS combinator into dead markup.
		return `${open}${rawtextContent(tag, vnode.attrs, collectTextContent(vnode.children))}</${tag}>`;
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
 * A RAWTEXT element's text content (D113). JSON-typed `<script>` payloads take the
 * data-island escape; every other script/style body is emitted byte-raw, because
 * that is what the HTML parser reads back. Raw emission is only safe while the
 * content cannot reach the parser's end-of-RAWTEXT (or double-escape) states, so
 * those cases throw at build time instead — a failed build keeps the last good
 * dist/ via the atomic swap.
 */
function rawtextContent(tag, attrs, text) {
	if (tag === 'style') {
		if (/<\/style/i.test(text)) {
			throw new Error(
				'[puzzle] prerender: <style> content contains `</style`, which ends the style ' +
					'element in the HTML parser — the rest of the stylesheet would escape as page ' +
					'markup. Escape or restructure the content.'
			);
		}
		return text;
	}
	// A missing type is the ordinary default JavaScript script kind, not a
	// missing template value — do not route that internal absence through the
	// undefined-display diagnostic.
	const type = (attrs.type == null ? '' : stringify(attrs.type)).trim().toLowerCase();
	if (type === 'application/json' || type.endsWith('+json')) return escapeScriptJson(text);
	if (/<\/script/i.test(text)) {
		throw new Error(
			'[puzzle] prerender: <script> content contains `</script`, which ends the script ' +
				'element in the HTML parser — the rest would escape as page markup. Put JSON ' +
				'payloads in a JSON-typed script (type="application/ld+json"), which is escaped ' +
				'automatically, or escape the sequence in source (`<\\/script>`).'
		);
	}
	// script-data-double-escaped state: once `<!--` is followed by `<script`, the
	// parser stops treating `</script>` as the end tag, so OUR closer would not close
	// the element and the rest of the page would be swallowed as script content.
	if (text.includes('<!--') && /<script/i.test(text)) {
		throw new Error(
			'[puzzle] prerender: <script> content contains both `<!--` and `<script`, the HTML ' +
				'script-data-double-escaped state — the parser then does NOT end the script element ' +
				'at its closing tag, so the rest of the page is swallowed. Put JSON payloads in a ' +
				'JSON-typed script (type="application/ld+json"), which is escaped automatically, or ' +
				'escape the sequence in source (`<\\/script>`).'
		);
	}
	return text;
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

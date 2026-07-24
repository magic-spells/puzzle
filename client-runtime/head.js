/**
 * Route head management (D84, v1.50 — constellation/doc/DOC-SPEC.md §45).
 *
 * ONE resolver, TWO consumers: route `meta` carries four RESERVED head fields —
 * `title` (pre-D84 behavior preserved), `description`, `canonical`,
 * `socialImage` — and both delivery paths consume the same resolution:
 *
 *  - the SSG shell injection (ssg/index.js) string-injects the derived tags so
 *    crawlers/unfurlers see them before any JS runs (the authoritative path —
 *    link-preview bots do not run the app);
 *  - the SPA router syncs the same tags at the #commitLocation point the old
 *    #setTitle occupied, inheriting D61 atomicity (a failed or superseded
 *    navigation never touches the head).
 *
 * Every generated tag carries `data-puzzle-head="<id>"` with a PER-TAG identity
 * (e.g. "og:title", "description", "canonical") that is IDENTICAL between the
 * SSG injector and syncHead below — that identity match is what makes hybrid
 * takeover ADOPT the prerendered tags in place instead of duplicating them.
 * The framework only ever creates, updates, or removes marker-bearing tags;
 * every unmanaged head element is left alone. The `<title>` element itself is
 * the one unmarked managed surface: SSG replaces it textually, the SPA assigns
 * `document.title` — both pre-D84 mechanisms, kept as-is.
 *
 * This module is DOM-free except syncHead (browser-only by contract): the
 * resolver + tag table run under Node for the prerender pass.
 */

/** The reserved `meta` head fields (SPEC §45). Order is resolution/emission order. */
export const HEAD_FIELDS = ['title', 'description', 'canonical', 'socialImage'];

/**
 * The managed-tag table — the single source of truth for WHAT each resolved
 * field derives, shared by the SSG string injector and the browser sync so the
 * two paths can never drift apart. Each entry is one generated tag:
 *  - `id`: its `data-puzzle-head` identity (stable across SSG and SPA — the
 *    adoption key);
 *  - `field`: which resolved field feeds it;
 *  - `tag`/`attr`/`name`: `<meta property|name="…" content=value>` shape, or
 *    the one `<link rel="canonical" href=value>` exception;
 *  - `fixed`: a constant content (twitter:card) emitted whenever the field
 *    resolves, independent of the field's value.
 * og:* uses `property=` and twitter:* uses `name=` per each network's
 * convention. `<title>` is intentionally absent (see the module header).
 */
export const MANAGED_TAGS = [
	{ id: 'og:title', field: 'title', tag: 'meta', attr: 'property', name: 'og:title' },
	{ id: 'twitter:title', field: 'title', tag: 'meta', attr: 'name', name: 'twitter:title' },
	{ id: 'description', field: 'description', tag: 'meta', attr: 'name', name: 'description' },
	{ id: 'og:description', field: 'description', tag: 'meta', attr: 'property', name: 'og:description' },
	{
		id: 'twitter:description',
		field: 'description',
		tag: 'meta',
		attr: 'name',
		name: 'twitter:description',
	},
	{ id: 'canonical', field: 'canonical', tag: 'link' },
	{ id: 'og:url', field: 'canonical', tag: 'meta', attr: 'property', name: 'og:url' },
	{ id: 'og:image', field: 'socialImage', tag: 'meta', attr: 'property', name: 'og:image' },
	{ id: 'twitter:image', field: 'socialImage', tag: 'meta', attr: 'name', name: 'twitter:image' },
	{
		id: 'twitter:card',
		field: 'socialImage',
		tag: 'meta',
		attr: 'name',
		name: 'twitter:card',
		fixed: 'summary_large_image',
	},
];

/**
 * Resolve the four reserved fields from a route chain (root→leaf order, as the
 * router and SSG both hold it). EACH FIELD RESOLVES INDEPENDENTLY, nearest-
 * defined walking leaf→root — the exact walk the router's old #setTitle did for
 * `meta.title` alone: `undefined` (absent) inherits from a parent, `null`
 * explicitly STOPS the walk and suppresses an inherited value. Values are
 * static strings or null by contract (no functions/HTML/arrays — SPEC §45).
 *
 * Returns `{ title, description, canonical, socialImage }`, each `string|null`.
 * "Resolved null" and "nothing defined anywhere" are deliberately NOT
 * distinguished: for managed tags both mean absent/removed, and for
 * `document.title` both mean leave-it-alone (see syncHead). The one semantic
 * asymmetry lives in `title`: an explicit `null` suppresses the derived
 * og:title/twitter:title tags but does NOT clear `document.title` — clearing
 * it would show a blank tab, and pre-D84 a never-resolving title also left
 * `document.title` untouched, so null keeps that posture.
 *
 * @param {Array<object>} chain route defs root→leaf (entry.chain)
 * @returns {{ title: string|null, description: string|null, canonical: string|null, socialImage: string|null }}
 */
export function resolveHead(chain) {
	const out = {};
	for (const field of HEAD_FIELDS) {
		out[field] = resolveField(chain, field);
	}
	return out;
}

/** Nearest-defined `meta[field]` leaf→root; `undefined` keeps walking, `null` stops it. */
function resolveField(chain, field) {
	for (let i = chain.length - 1; i >= 0; i--) {
		const meta = chain[i].meta;
		// `!== undefined` (not `!= null`): an explicit null is a DEFINED value here
		// — it terminates the walk as suppression (D84). Absent/undefined inherits.
		if (meta && meta[field] !== undefined) return meta[field];
	}
	return null;
}

/**
 * Browser-only: sync `document.head` + `document.title` to a resolved head.
 * Called by the router inside the #commitLocation window (never in memory mode
 * — the caller guards, D42: an embed must not touch the host page's head).
 *
 * Per managed tag: adopt-by-identity. An existing `[data-puzzle-head="<id>"]`
 * element is UPDATED in place when its field resolves (this is how hybrid
 * takeover adopts the SSG-emitted tags — same identities, so navigation #0 and
 * every later commit find them instead of appending duplicates), CREATED and
 * appended to <head> when missing, and REMOVED when the field no longer
 * resolves (navigating to a route that suppresses or never defines it must not
 * leave a stale description/canonical behind). Unmanaged head elements are
 * never touched.
 *
 * `document.title` is assigned ONLY for a non-null resolved title — resolved
 * null (explicit suppression) and nothing-defined both leave it as-is
 * (byte-compatible with the pre-D84 #setTitle; see resolveHead).
 *
 * @param {{ title: string|null, description: string|null, canonical: string|null, socialImage: string|null }} resolved
 */
export function syncHead(resolved) {
	if (resolved.title != null) document.title = String(resolved.title);

	const head = document.head;
	for (const spec of MANAGED_TAGS) {
		const value = resolved[spec.field];
		const existing = head.querySelector(`[data-puzzle-head="${spec.id}"]`);

		if (value == null) {
			if (existing) existing.remove();
			continue;
		}

		// twitter:card is a constant flag of "a social image exists", not a value carrier.
		const content = spec.fixed ?? String(value);

		if (existing && existing.tagName.toLowerCase() === spec.tag) {
			setTagValue(existing, spec, content);
		} else {
			// A marker-bearing element of the WRONG element kind (hand-edited shell)
			// can't be updated meaningfully — rebuild it under the same identity.
			if (existing) existing.remove();
			const el = document.createElement(spec.tag);
			el.setAttribute('data-puzzle-head', spec.id);
			if (spec.tag === 'link') el.setAttribute('rel', 'canonical');
			else el.setAttribute(spec.attr, spec.name);
			setTagValue(el, spec, content);
			head.appendChild(el);
		}
	}
}

/** Write the value-carrying attribute: `href` for the canonical link, `content` for metas. */
function setTagValue(el, spec, content) {
	el.setAttribute(spec.tag === 'link' ? 'href' : 'content', content);
}

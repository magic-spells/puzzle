/**
 * Managed head-tag machinery (D84, v1.50 — constellation/doc/DOC-SPEC.md §45).
 *
 * Split out of head.js by D88 so a title-only app never bundles it. TWO
 * consumers of the shared MANAGED_TAGS table:
 *  - the SPA router's #syncHead calls `syncTags` behind the `__PUZZLE_HAS_HEAD_TAGS__`
 *    build gate — when the compiler proves no route defines
 *    description/canonical/socialImage, the call folds away and this whole module
 *    tree-shakes out of the browser bundle;
 *  - the SSG string injector (ssg/index.js) imports MANAGED_TAGS directly at
 *    build time (unconditional — the prerender always emits whatever resolved),
 *    so crawlers/unfurlers see the tags before any JS runs.
 *
 * Every generated tag carries `data-puzzle-head="<id>"` with a PER-TAG identity
 * (e.g. "og:title", "description", "canonical") that is IDENTICAL between the SSG
 * injector and syncTags below — that identity match is what makes hybrid takeover
 * ADOPT the prerendered tags in place instead of duplicating them. The framework
 * only ever creates, updates, or removes marker-bearing tags; every unmanaged
 * head element is left alone. (`<title>` is NOT here — it is the title core's
 * job, see head.js syncTitle.)
 *
 * DOM-free except syncTags (browser-only by contract): the tag table runs under
 * Node for the prerender pass.
 */

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
 * convention. `<title>` is intentionally absent (see head.js).
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
 * Browser-only: sync the managed `document.head` tags to a resolved head. The
 * `<title>` is handled separately by head.js syncTitle — this is the tag half of
 * the old syncHead, called only when the app uses head tags (D88 gate).
 *
 * Per managed tag: adopt-by-identity. An existing `[data-puzzle-head="<id>"]`
 * element is UPDATED in place when its field resolves (this is how hybrid
 * takeover adopts the SSG-emitted tags — same identities, so navigation #0 and
 * every later commit find them instead of appending duplicates), CREATED and
 * appended to <head> when missing, and REMOVED when the field no longer resolves
 * (navigating to a route that suppresses or never defines it must not leave a
 * stale description/canonical behind). Unmanaged head elements are never touched.
 *
 * @param {{ title: string|null, description: string|null, canonical: string|null, socialImage: string|null }} resolved
 */
export function syncTags(resolved) {
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

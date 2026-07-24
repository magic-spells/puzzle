/**
 * Managed head-tag machinery (D84, v1.50 — constellation/doc/DOC-SPEC.md §45).
 *
 * BUILD-TIME ONLY. The single consumer is the SSG string injector
 * (ssg/index.js), which imports MANAGED_TAGS at prerender time so
 * crawlers/unfurlers see each page's tags in the served HTML before any JS runs.
 *
 * There is deliberately no browser-side counterpart. The runtime never syncs
 * og:/twitter:/description/canonical tags in ANY output mode: crawlers fetch
 * every URL fresh from the server and never client-navigate, so they always read
 * the tags baked into that page. Only an in-page consumer reading
 * `document.querySelector('meta[property="og:title"]')` AFTER a client
 * navigation would notice, and that is explicitly not supported. (The browser tab
 * `<title>` is a separate, always-in concern — head.js syncTitle keeps it current
 * on every navigation.)
 *
 * Every generated tag carries `data-puzzle-head="<id>"` with a PER-TAG identity
 * (e.g. "og:title", "description", "canonical"), so a prerendered page's managed
 * tags are identifiable and never confused with hand-authored head elements in
 * the shell. (`<title>` is NOT here — it is the title core's job, see head.js.)
 *
 * DOM-free: this module runs under Node for the prerender pass.
 */

/**
 * The managed-tag table — the single source of truth for WHAT each resolved
 * field derives, consumed by the SSG string injector. Each entry is one
 * generated tag:
 *  - `id`: its `data-puzzle-head` identity — the key injectShell replaces or
 *    removes a same-identity shell tag by;
 *  - `field`: which resolved field feeds it;
 *  - `tag`/`attr`/`name`: `<meta property|name="…" content=value>` shape, or
 *    the one `<link rel="canonical" href=value>` exception;
 *  - `fixed`: a constant content (twitter:card) emitted whenever the field
 *    resolves, independent of the field's value.
 * og:* uses `property=` and twitter:* uses `name=` per each network's
 * convention. `<title>` is intentionally absent (see head.js).
 *
 * `id` remains part of the emitted markup (`data-puzzle-head`) even though
 * nothing reads it back at runtime any more: it labels the framework's own tags
 * in the served HTML so a later pass — or a human reading View Source — can tell
 * them apart from the shell's hand-authored head.
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

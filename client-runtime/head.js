/**
 * Route head management — resolver + title core (D84, v1.50 — constellation/doc/DOC-SPEC.md §45).
 *
 * ONE resolver, TWO consumers: route `meta` carries four RESERVED head fields —
 * `title` (delivered via the pre-D84 document.title / textual-<title> path),
 * `description`, `canonical`, `socialImage` — and both delivery paths consume
 * the same resolution (all four share the uniform null-suppression walk):
 *
 *  - the SSG shell injection (ssg/index.js) string-injects the derived tags so
 *    crawlers/unfurlers see them before any JS runs (the authoritative path —
 *    link-preview bots do not run the app);
 *  - the SPA router syncs the same tags at the #commitLocation point the old
 *    #setTitle occupied, inheriting D61 atomicity (a failed or superseded
 *    navigation never touches the head).
 *
 * MODULE SPLIT (D89): this file holds the always-present core — the resolver and
 * the one-line `document.title` sync (syncTitle) that EVERY routed app needs.
 * The managed-tag machinery (the MANAGED_TAGS table, the DOM sync loop, and the
 * SSG string builder's shared table) lives in ./headTags.js, imported by the
 * router only behind the `__PUZZLE_HAS_HEAD_TAGS__` build gate and by ssg/index.js
 * unconditionally (build-time). A title-only app (no route defines
 * description/canonical/socialImage) never pulls headTags.js into its bundle and
 * never runs the ~10 per-navigation querySelector probes the tag sync performs.
 *
 * This module is DOM-free except syncTitle (browser-only by contract): the
 * resolver runs under Node for the prerender pass.
 */

/** The reserved `meta` head fields (SPEC §45). Order is resolution/emission order. */
export const HEAD_FIELDS = ['title', 'description', 'canonical', 'socialImage'];

/**
 * Resolve the four reserved fields from a route chain (root→leaf order, as the
 * router and SSG both hold it). EACH FIELD RESOLVES INDEPENDENTLY, nearest-
 * defined walking leaf→root, with ONE uniform null posture for every field:
 * `undefined` (absent) inherits from a parent, an explicit `null` is a DEFINED
 * value that STOPS the walk and suppresses any inherited value. (This corrects
 * a 0.2.0 pre-release divergence where `title` alone inherited on null; §45 /
 * D84 make suppression uniform — see the 0.1.x→0.2.0 migration note.)
 * Values are static strings or null by contract (no functions/HTML/arrays —
 * SPEC §45).
 *
 * Returns `{ title, description, canonical, socialImage }`, each `string|null`.
 * "Resolved null" and "nothing defined anywhere" are deliberately NOT
 * distinguished: for managed tags both mean absent/removed, and for
 * `document.title` both mean leave-it-alone (see syncTitle) — a resolved-null
 * title never clears `document.title` (clearing it would show a blank tab, and
 * a never-resolving title also leaves it untouched, so an explicitly-suppressed
 * title keeps that same leave-alone posture rather than blanking the tab).
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

/** Nearest-defined `meta[field]` leaf→root; `undefined` keeps walking, `null` stops it (suppression). */
function resolveField(chain, field) {
	// Uniform for ALL reserved fields (title included): `undefined`/absent keeps
	// climbing toward the root (inherit), an explicit `null` is a DEFINED value
	// that TERMINATES the walk and suppresses any inherited value (D84 §45). A
	// suppressed title resolves to null → syncTitle / the SSG injector leave the
	// current tab title / shell <title> untouched (see resolveHead + syncTitle).
	for (let i = chain.length - 1; i >= 0; i--) {
		const meta = chain[i].meta;
		if (!meta) continue;
		const value = meta[field];
		if (value !== undefined) return value;
	}
	return null;
}

/**
 * Browser-only: sync `document.title` to a resolved head. This is the ALWAYS-IN
 * half of the old syncHead — every routed app assigns its tab title. The managed
 * head-tag sync (headTags.js `syncTags`) is a separate, build-gated call in the
 * router's #syncHead (D89).
 *
 * `document.title` is assigned ONLY for a non-null resolved title — resolved
 * null (explicit suppression) and nothing-defined both leave it as-is (the
 * assignment mechanism is the pre-D84 #setTitle; only the null posture is now
 * uniform suppression rather than title-inherits — see resolveHead).
 *
 * @param {{ title: string|null }} resolved
 */
export function syncTitle(resolved) {
	if (resolved.title != null) document.title = String(resolved.title);
}

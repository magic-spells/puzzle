/**
 * Route head management — resolver + title core (D84, v1.50 — constellation/doc/DOC-SPEC.md §45).
 *
 * ONE resolver, TWO consumers: route `meta` carries four RESERVED head fields —
 * `title`, `description`, `canonical`, `socialImage` — resolved by one uniform
 * null-suppression walk, then delivered by two DISJOINT paths:
 *
 *  - the SSG shell injection (ssg/index.js) string-injects the derived og:/
 *    twitter:/description/canonical tags at build time, so crawlers/unfurlers
 *    see them before any JS runs. This is the ONLY path that emits those tags —
 *    link-preview bots fetch each URL fresh and never run the app;
 *  - the browser router assigns `document.title` at the #commitLocation point the
 *    old #setTitle occupied, inheriting D61 atomicity (a failed or superseded
 *    navigation never touches it).
 *
 * MODULE SPLIT (D89, amended): this file holds the resolver and the one-line
 * `document.title` sync (syncTitle) that EVERY routed app needs. The managed-tag
 * table lives in ./headTags.js and is imported ONLY by ssg/index.js — build
 * time, under Node. No browser bundle in any output mode contains it, and the
 * router performs no per-navigation head-tag DOM work at all.
 *
 * This module is DOM-free except syncTitle (browser-only by contract): the
 * resolver runs under Node for the prerender pass.
 */

/**
 * The reserved `meta` head fields (SPEC §45). Order is resolution/emission order.
 * @type {Array<'title' | 'description' | 'canonical' | 'socialImage'>}
 */
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
 * SPEC §45); `title` and `description` may also be a translation reference
 * `{ t: 'key' }` (D177), which resolves through `i18n` (see headText).
 *
 * Returns `{ title, description, canonical, socialImage }`, each `string|null`.
 * "Resolved null" and "nothing defined anywhere" are deliberately NOT
 * distinguished: for managed tags both mean absent/removed, and for
 * `document.title` both mean leave-it-alone (see syncTitle) — a resolved-null
 * title never clears `document.title` (clearing it would show a blank tab, and
 * a never-resolving title also leaves it untouched, so an explicitly-suppressed
 * title keeps that same leave-alone posture rather than blanking the tab).
 *
 * @param {ReadonlyArray<{ meta?: Record<string, any> | null }>} chain route defs root→leaf (entry.chain)
 * @param {HeadI18n | null} [i18n] the prerender pass's i18n service (D175), for `{ t }` text
 * @returns {{ title: string|null, description: string|null, canonical: string|null, socialImage: string|null }}
 */
export function resolveHead(chain, i18n) {
	const out = /** @type {ReturnType<typeof resolveHead>} */ ({});
	for (const field of HEAD_FIELDS) {
		out[field] = resolveHeadField(chain, field);
	}
	// Only the two text fields translate; canonical and socialImage are URLs.
	out.title = headText(out.title, i18n);
	out.description = headText(out.description, i18n);
	return out;
}

/** @typedef {{ t(key: unknown): string }} HeadI18n the slice of the i18n service head text needs */

/** @type {boolean | undefined} */
let headTextWarned;

/**
 * Head text (D177): a resolved `title`/`description` as printable text. A string
 * or null passes through unchanged; a translation reference `{ t: 'key' }`
 * resolves through the app's i18n service — `i18n.t(key)`, so a missing key
 * prints the key itself (D175). With no service (an app without `i18n`) the
 * reference prints nothing — null, the same leave-alone posture as a suppressed
 * field — and development warns once.
 *
 * The object branch sits behind the inline `__PUZZLE_HAS_I18N__` probe, and the
 * router calls this only behind the same probe, so an app without translations
 * ships none of it. The prerender calls it unconditionally (Node, never shipped).
 *
 * @param {unknown} value a resolved head field (resolveHeadField)
 * @param {HeadI18n | null} [i18n] the app's (or prerender pass's) i18n service
 * @returns {any} the text, or null
 */
export function headText(value, i18n) {
	if (value === null || typeof value !== 'object') return value;
	const key = /** @type {{ t?: unknown }} */ (value).t;
	if ((typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__) && i18n) return i18n.t(key);
	if ((typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) && !headTextWarned) {
		headTextWarned = true;
		console.warn(
			`[puzzle] route meta { t: "${String(key)}" } needs i18n configured in puzzle.config.js — the head text prints nothing`
		);
	}
	return null;
}

/**
 * Nearest-defined `meta[field]` leaf→root; `undefined` keeps walking, `null` stops it (suppression).
 * Exported because the browser router resolves ONE field (`title`) per
 * navigation — resolveHead and HEAD_FIELDS are the SSG's entry point and
 * tree-shake out of app bundles.
 *
 * @param {ReadonlyArray<{ meta?: Record<string, any> | null }>} chain route defs root→leaf (entry.chain)
 * @param {string} field the `meta` key to resolve
 * @returns {any} the nearest defined value (a string or null by contract), else null
 */
export function resolveHeadField(chain, field) {
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
 * Browser-only: sync `document.title` to a resolved title (resolveHeadField
 * chain, 'title'). This is the ONLY head work the runtime performs — every routed app assigns its tab title, and the
 * managed og:/twitter:/description/canonical tags are emitted exclusively at
 * build time by the SSG injector (see headTags.js).
 *
 * `document.title` is assigned ONLY for a string — resolved null (explicit
 * suppression) and nothing-defined both leave it as-is (the assignment
 * mechanism is the pre-D84 #setTitle; only the null posture is now uniform
 * suppression rather than title-inherits — see resolveHead). So does an
 * untranslated `{ t }` reference in an app without i18n, which would otherwise
 * put "[object Object]" in the tab.
 *
 * @param {unknown} title the resolved `title` field
 */
export function syncTitle(title) {
	if (typeof title === 'string') document.title = title;
}

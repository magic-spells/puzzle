/**
 * The first-visit redirect (D177): a small inline script the prerender puts in
 * the head of every unprefixed (default-locale) page under `i18n.routing:
 * 'prefix'`, unless the manifest says `detect: false`.
 *
 * `localeRedirect` is the script. Its SOURCE TEXT is what ships (see
 * redirectScript), so it must stand alone: no module scope, no imports, no
 * helpers, and nothing newer than the browsers a static site serves. It reads
 * every browser global through its `w` argument (`window` on the page, a fake
 * in tests). Its locale matching is a second copy of `selectLocale` in i18n.js;
 * `tests/i18n-ssg.test.js` runs both against one shared case table.
 */

import { escapeScriptJson } from './serialize.js';

/**
 * Redirect once to this page under the wanted locale's prefix, when the URL has
 * no locale prefix, the visitor did not come from this site, and the wanted
 * locale — the stored choice, else the first `navigator.languages` match — is
 * not the default. Query and fragment are kept; the target is a same-origin
 * path (its leading slashes collapse, as `samePath` does).
 *
 * @param {string[]} tags configured locales, in config order
 * @param {string} def the default locale
 * @param {string} base the normalized routerBase (`''` for a root deploy)
 * @param {any} w the window
 */
export function localeRedirect(tags, def, base, w) {
	try {
		const loc = w.location;
		const path = loc.pathname;
		if (base && path !== base && path.indexOf(base + '/') !== 0) return;
		const rest = path.slice(base.length);
		const first = rest.split('/')[1];
		if (first !== def && tags.indexOf(first) >= 0) return;
		const ref = w.document.referrer;
		if (ref) {
			try {
				if (new URL(ref).origin === loc.origin) return;
			} catch {}
		}
		let stored = '';
		try {
			stored = w.localStorage.getItem('__puzzleLocale');
		} catch {}
		let want = typeof stored === 'string' && stored ? tags.find((t) => t.toLowerCase() === stored.toLowerCase()) : '';
		if (!want) {
			const nav = w.navigator || {};
			const langs = nav.languages && nav.languages.length ? nav.languages : [nav.language];
			for (let i = 0; i < langs.length && !want; i++) {
				const lang = langs[i];
				if (typeof lang !== 'string' || !lang) continue;
				const low = lang.toLowerCase();
				const root = low.split('-')[0];
				want =
					tags.find((t) => t.toLowerCase() === low) ||
					tags.find((t) => t.toLowerCase() === root) ||
					tags.find((t) => t.split('-')[0].toLowerCase() === root);
			}
		}
		if (!want || want === def) return;
		const target = base + '/' + want + (rest || '/') + loc.search + loc.hash;
		loc.replace(target.replace(/^[/\\][/\\\t\n\r]*/, '/'));
	} catch {}
}

/**
 * The inline `<script>` for one build: localeRedirect's source, called with
 * the build's locales and base. The arguments are JSON with `<` escaped (the
 * D113 JSON-in-script rule); the function source is checked rather than
 * escaped, since a `<` there is code.
 *
 * @param {{ defaultLocale: string, locales: Record<string, string> }} manifest
 * @param {string} base the normalized routerBase
 * @returns {string}
 */
export function redirectScript(manifest, base) {
	// Indentation dropped: the source has no template literal or multi-line
	// string, so a newline's following whitespace is never content.
	const source = String(localeRedirect).replace(/\n\s+/g, '\n');
	if (/<\/script|<!--/i.test(source)) {
		throw new Error('[puzzle] the locale redirect script cannot be inlined: its source contains </script or <!--');
	}
	const args = [Object.keys(manifest.locales), manifest.defaultLocale, base]
		.map((value) => escapeScriptJson(JSON.stringify(value)))
		.join(',');
	return `<script>(${source})(${args},window)</script>`;
}

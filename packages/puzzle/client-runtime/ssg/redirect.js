/**
 * The first-visit redirect (D177): a small inline script the prerender puts in
 * the head of every unprefixed (default-locale) page under `i18n.routing:
 * 'prefix'`, unless the manifest says `detect: false`. The plain SPA makes the
 * same decision at mount (app.js `firstVisitRedirect`), through `selectLocale`.
 *
 * `localeRedirect` is the script. Its SOURCE TEXT is what ships (see
 * redirectScript), so it must stand alone: no module scope, no imports, no
 * helpers. It reads every browser global through its `w` argument (`window` on
 * the page, a fake in tests). Its locale matching is a second copy of
 * `selectLocale` in i18n.js; `tests/fixtures/locale-redirect-cases.js` is the
 * one decision table this script, the SPA redirect and `selectLocale` all run.
 * It ships on every default-locale page, so its identifiers are short.
 */

import { escapeScriptJson } from './serialize.js';

/**
 * Redirect once to this page under the wanted locale's prefix, when the URL has
 * no locale prefix, the visitor did not come from this site, and the wanted
 * locale — the stored choice, else the first `navigator.languages` match — is
 * not the default. Query and fragment are kept; the target is a same-origin
 * path (its leading slashes collapse, as `samePath` does).
 *
 * Locals: `l` location, `p` pathname, `r` the path after the base, `s` the
 * stored choice, `n` the wanted locale, `g` navigator, `a` its languages, `x`
 * one language lower-cased, `o` its base language.
 *
 * @param {string[]} t configured locales, in config order
 * @param {string} d the default locale
 * @param {string} b the normalized routerBase (`''` for a root deploy)
 * @param {any} w the window
 */
export function localeRedirect(t, d, b, w) {
	try {
		const l = w.location;
		const p = l.pathname;
		if (b && p !== b && !p.startsWith(b + '/')) return;
		const r = p.slice(b.length);
		const f = r.split('/')[1];
		if (f !== d && t.includes(f)) return;
		try {
			if (new URL(w.document.referrer).origin === l.origin) return;
		} catch {}
		let s = '';
		try {
			s = w.localStorage.getItem('__puzzleLocale');
		} catch {}
		let n = typeof s === 'string' && s ? t.find((y) => y.toLowerCase() === s.toLowerCase()) : '';
		const g = w.navigator || {};
		const a = g.languages && g.languages.length ? g.languages : [g.language];
		for (let i = 0; i < a.length && !n; i++) {
			if (typeof a[i] !== 'string' || !a[i]) continue;
			const x = a[i].toLowerCase();
			const o = x.split('-')[0];
			n =
				t.find((y) => y.toLowerCase() === x) ||
				t.find((y) => y.toLowerCase() === o) ||
				t.find((y) => y.toLowerCase().split('-')[0] === o);
		}
		if (n && n !== d) l.replace((b + '/' + n + (r || '/') + l.search + l.hash).replace(/^[/\\][/\\\t\n\r]*/, '/'));
	} catch {}
}

/**
 * The inline `<script>` for one build: localeRedirect's source, squeezed and
 * called with the build's locales and base. The squeeze collapses whitespace
 * and drops it beside punctuation — safe because the source has no string or
 * regex literal containing whitespace and ends every statement explicitly, and
 * tests run the emitted text against the whole decision table. The arguments
 * are JSON with `<` escaped (the D113 JSON-in-script rule); the function source
 * is checked rather than escaped, since a `<` there is code.
 *
 * @param {{ defaultLocale: string, locales: Record<string, string> }} manifest
 * @param {string} base the normalized routerBase
 * @returns {string}
 */
export function redirectScript(manifest, base) {
	const source = String(localeRedirect)
		.replace(/^function localeRedirect/, 'function')
		.replace(/\s+/g, ' ')
		.replace(/ ?([^\w$ ]) ?/g, '$1');
	if (/<\/script|<!--/i.test(source)) {
		throw new Error('[puzzle] the locale redirect script cannot be inlined: its source contains </script or <!--');
	}
	const args = [Object.keys(manifest.locales), manifest.defaultLocale, base]
		.map((value) => escapeScriptJson(JSON.stringify(value)))
		.join(',');
	return `<script>(${source})(${args},window)</script>`;
}

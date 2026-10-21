/*
 * puzzle-pieces pre-paint — the anti-flash snippet.
 *
 * Inline the whole file in your app shell's <head>, BEFORE the stylesheet link:
 *
 *   <script data-key="puzzle:appearance" data-default-mode="dark">
 *     …this file…
 *   <\/script>
 *
 * (The closing tag above is escaped on purpose: an inline script ends at the
 * first literal `</` + `script`, comments included, so this file must never
 * spell one out.)
 *
 * It has to be inline and it has to be first: a module that arrives with app.js
 * arrives a frame too late, and until then the page paints the default — a
 * black flash for a light account, the wrong palette for a warm one.
 *
 * It reads ONE localStorage key (JSON `{ "scheme", "mode" }`) and writes the
 * two attributes and the inline `color-scheme` that themes/default.css keys on:
 *
 *   data-scheme  the PALETTE — absent for the default
 *   data-theme   the STYLE — dark | dim | mixed | light
 *   colorScheme  light for light and mixed, dark for dim and dark
 *
 * Parameters, as data attributes on the <script> tag (all optional):
 *   data-key             the storage key (default `puzzle:appearance`;
 *                        Pyramid passes `pyramid:appearance`)
 *   data-default-mode    the style to paint when nothing is stored. Omit it and
 *                        the page follows the OS between light and dark.
 *   data-default-scheme  the palette to paint when nothing is stored.
 *
 * It leaves the three on `window.__puzzleAppearance` for appearance.js, whose
 * boot() then agrees with this paint (an explicit configure() still wins).
 *
 * Compatibility: a stored `theme` field is read as `scheme` (Pyramid's shape),
 * the old `dim` palette reads as `cool` and the old `medium` mode as `dim`.
 * The same three aliases live in appearance.js — CHANGE THEM THERE AND CHANGE
 * THEM HERE.
 */
(function () {
	var SCHEMES = ['default', 'cool', 'warm', 'void'];
	var MODES = ['dark', 'dim', 'mixed', 'light'];
	// normalizeScheme / normalizeMode from appearance.js: the alias, then the
	// list. Every source below goes through them, as it does there.
	var toScheme = function (value) {
		if (value === 'dim') value = 'cool';
		return SCHEMES.indexOf(value) !== -1 ? value : null;
	};
	var toMode = function (value) {
		if (value === 'medium') value = 'dim';
		return MODES.indexOf(value) !== -1 ? value : null;
	};
	var script = document.currentScript;
	var attr = function (name) {
		return script ? script.getAttribute(name) : null;
	};
	var key = attr('data-key') || 'puzzle:appearance';
	// Hand the parameters on: appearance.js seeds its storage key and fallback
	// from this object, so boot() reads the same key and keeps the same defaults
	// this snippet painted, without a configure() call repeating them.
	window.__puzzleAppearance = { key: key, scheme: attr('data-default-scheme'), mode: attr('data-default-mode') };
	var root = document.documentElement;
	var pick = {};
	try {
		pick = JSON.parse(localStorage.getItem(key) || 'null') || {};
	} catch (e) {
		// Storage unavailable or junk: paint the defaults, as appearance.read() does.
	}
	var scheme = toScheme(pick.scheme) || toScheme(pick.theme) || toScheme(attr('data-default-scheme'));
	// A stored `mode: null` is a real choice — "follow the OS" — not an
	// empty store, so it must NOT fall through to data-default-mode (that
	// would paint the default and let boot() strip it: the very flash this
	// file exists to prevent). Only a missing or unknown mode takes the default.
	var mode = pick.mode === null ? null : toMode(pick.mode) || toMode(attr('data-default-mode'));
	if (scheme && scheme !== 'default') {
		root.setAttribute('data-scheme', scheme);
	}
	if (mode) {
		root.setAttribute('data-theme', mode);
		root.style.colorScheme = mode === 'light' || mode === 'mixed' ? 'light' : 'dark';
	}
})();

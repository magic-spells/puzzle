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
 *   data-theme   the MODE — light | medium | dark
 *   colorScheme  light for light, dark for medium and dark
 *
 * Parameters, as data attributes on the <script> tag (all optional):
 *   data-key             the storage key (default `puzzle:appearance`;
 *                        Pyramid passes `pyramid:appearance`)
 *   data-default-mode    the mode to paint when nothing is stored. Omit it and
 *                        the page follows the OS between light and dark.
 *   data-default-scheme  the palette to paint when nothing is stored.
 *
 * Compatibility: a stored `theme` field is read as `scheme` (Pyramid's shape),
 * and a stored `mixed` mode reads as `medium`. The same two aliases live in
 * appearance.js — CHANGE THEM THERE AND CHANGE THEM HERE.
 */
(function () {
	var SCHEMES = ['default', 'dim', 'warm', 'void'];
	var MODES = ['light', 'medium', 'dark'];
	var script = document.currentScript;
	var attr = function (name) {
		return script ? script.getAttribute(name) : null;
	};
	var key = attr('data-key') || 'puzzle:appearance';
	var root = document.documentElement;
	try {
		var pick = JSON.parse(localStorage.getItem(key) || 'null') || {};
		var scheme = pick.scheme || pick.theme || attr('data-default-scheme');
		var mode = pick.mode === 'mixed' ? 'medium' : pick.mode;
		// A stored `mode: null` is a real choice — "follow the OS" — not an
		// empty store, so it must NOT fall through to data-default-mode (that
		// would paint the default and let boot() strip it: the very flash this
		// file exists to prevent). Only a missing or unknown mode takes the default.
		if (pick.mode === null) mode = null;
		else if (MODES.indexOf(mode) === -1) mode = attr('data-default-mode');
		if (SCHEMES.indexOf(scheme) !== -1 && scheme !== 'default') {
			root.setAttribute('data-scheme', scheme);
		}
		if (MODES.indexOf(mode) !== -1) {
			root.setAttribute('data-theme', mode);
			root.style.colorScheme = mode === 'light' ? 'light' : 'dark';
		}
	} catch (e) {
		/* storage unavailable — appearance.boot() sorts the attributes out */
	}
})();

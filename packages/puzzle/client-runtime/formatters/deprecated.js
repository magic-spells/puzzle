// The deprecated built-ins (D176 §4): the names a JavaScript method or a `Math`
// global already says, which leave the function library. Each still works; the
// first call in development warns once and names the JavaScript that replaces
// it. `round` is not here: `.toFixed()` returns a padded string, so nothing in
// JavaScript rounds half away from zero to a number in one call.
//
// Not a formatter module: builtins-all.js namespace-imports builtins.js, so a
// helper exported from there would become a formatter name. builtins.js calls
// warnDeprecated() only from behind the inline `__PUZZLE_DEV__` probe, so a
// production build drops the call, and with it this module.

// Name → the JavaScript that replaces it, as the warning prints it.
export const DEPRECATED_FORMATTERS = {
	upcase: '`.toUpperCase()`',
	downcase: '`.toLowerCase()`',
	trim: '`.trim()`',
	strip: '`.trim()` (it removes the same leading and trailing whitespace)',
	replace:
		'`.replaceAll(search, replacement)` for plain strings; the old formatter was `.split(search).join(replacement)`, which is the exact equivalent',
	join: "`.join(', ')` (this joined with ', ' by default; `.join()` with no argument joins with ',')",
	abs: '`Math.abs(x)`',
	ceil: '`Math.ceil(x)`',
	floor: '`Math.floor(x)`',
};

let warned;

/** Warn once per name that a deprecated built-in ran, naming its replacement. */
export function warnDeprecated(name) {
	if ((warned ??= new Set()).has(name)) return;
	warned.add(name);
	console.warn(`[puzzle] "${name}" is deprecated — JavaScript already covers it: use ${DEPRECATED_FORMATTERS[name]}`);
}

// The formatter locale (D175): the locale every locale-rendered formatter passes to
// Intl. `undefined` — the viewer's locale, Intl's default — unless the app
// configured translations, in which case the i18n service sets it to the active
// locale on load and on every switch, and the prerender sets it to the build's
// default locale.
//
// One slot per page, not per app: two mounted apps with different locales share
// it, and the last switch wins (accepted by D175).
//
// Every READ of the slot sits behind the inline `__PUZZLE_HAS_I18N__` probe, so an
// app without translations folds each one to `undefined` and ships exactly the
// code it shipped before the slot existed. Not a formatter module: builtins-all.js
// namespace-imports builtins.js, so a helper exported from there would become a
// formatter name.

export let formatLocale;

/**
 * Set the locale the locale-rendered formatters use. Called by the i18n service
 * and the prerender only. A change drops the cached number formats; the
 * single-slot caches in builtins.js compare the locale they were built for.
 */
export function setFormatLocale(tag) {
	if (tag !== formatLocale) {
		formatLocale = tag;
		NUMBER_FORMATTERS.clear();
	}
}

// Locale-rendered numbers: one cached NumberFormat per fraction-digit count, so
// the decimals print as given — `1234.5` stays one decimal, never Intl's default
// three-digit rounding. Shared by `pluralize`, `number_with_delimiter` and `t`'s
// `{count}`. The cache holds one locale's formats; setFormatLocale clears it.
const NUMBER_FORMATTERS = new Map();
export function localeNumber(n) {
	const [m, e = 0] = String(Math.abs(n)).split('e');
	const digits = Math.min(20, Math.max(0, (m.split('.')[1] || '').length - Number(e)));
	let formatter = NUMBER_FORMATTERS.get(digits);
	if (!formatter) {
		formatter = new Intl.NumberFormat(
			typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__ ? formatLocale : undefined,
			{
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
			},
		);
		NUMBER_FORMATTERS.set(digits, formatter);
	}
	return formatter.format(n);
}

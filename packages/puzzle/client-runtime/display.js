let warned;

function warnOnce(kind, expression, message) {
	const key = kind + (expression || '');
	if ((warned ??= new Set()).has(key)) return;
	warned.add(key);

	const where = expression ? ` for "${expression}"` : '';
	console.warn(`[puzzle] ${kind} template value${where}; ${message}`);
}

/**
 * Coerce a template display value to text — the one printing rule (D127, D173
 * V6), shared by text, quoted attributes, the browser and the SSG serializer.
 *
 * - `null` and `undefined` print nothing. `null` is ordinary optional data and
 *   is silent; `undefined` warns once per expression in development, because
 *   it is usually a missing or misspelled data field.
 * - Numbers print by JavaScript's Number::toString; `NaN` and ±Infinity print
 *   nothing. Booleans print `true`/`false`; strings print as they are.
 * - A list prints its items by this same rule, joined with `,`. With `sep` —
 *   a brace-only attribute passes `' '` (D173 V9) — the list is an attribute
 *   token list instead: `false` and every item that prints nothing are
 *   dropped, so `class={ [active && 'on', 'btn'] }` writes `class="btn"` (the
 *   clsx idiom). Items nested deeper always join with `,`.
 * - Any other object prints nothing and warns once per expression in
 *   development (`[object Object]` and a Date's locale string are never display
 *   text — format the value or print one of its fields; a Date gets its own
 *   message naming the date formatters). setAttr and the SSG serializer omit an
 *   object-valued attribute before it gets here.
 *
 * The compiler passes expression names behind a bundle-time dev gate so
 * production output carries none of the diagnostic strings.
 */
export function displayValue(value, expression = 0, sep) {
	if (Array.isArray(value)) {
		return value
			.map((item) => (sep && item === false ? '' : displayValue(item, expression)))
			.filter((text) => text || !sep)
			.join(sep);
	}
	if (value == null || typeof value == 'object' || (typeof value == 'number' && !isFinite(value))) {
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			if (value === undefined) warnOnce('undefined', expression, 'rendering an empty string');
			else if (value instanceof Date) {
				warnOnce('Date', expression, 'rendering nothing — format it with | date (or | datetime, | time)');
			} else if (value !== null && typeof value == 'object') {
				warnOnce('object', expression, 'rendering nothing — format it or print one of its fields');
			}
		}
		return '';
	}
	return String(value);
}

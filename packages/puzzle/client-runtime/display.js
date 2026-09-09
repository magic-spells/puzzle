let warnedUndefined;

function warnUndefined(expression) {
	const key = expression || '';
	const warned = (warnedUndefined ??= new Set());
	if (warned.has(key)) return;
	warned.add(key);

	const where = expression ? ` for "${expression}"` : '';
	console.warn(`[puzzle] undefined template value${where}; rendering an empty string`);
}

/**
 * Coerce a template display value to text.
 *
 * `null` is ordinary optional data and renders silently as empty. `undefined`
 * does the same, but warns once per expression in development because it is
 * usually a missing or misspelled data field. The compiler passes expression
 * names behind a bundle-time dev gate so production output carries none of the
 * diagnostic strings.
 */
export function displayValue(value, expression = 0) {
	if (value === undefined) {
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			warnUndefined(expression);
		}
		return '';
	}
	return value === null ? '' : String(value);
}

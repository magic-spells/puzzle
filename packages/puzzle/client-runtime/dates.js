/**
 * The one date-input parse rule (D114), shared by the built-in date formatters
 * and the datastore's JSON hydration boundary.
 *
 * It lives in its own module rather than inside formatters/builtins.js because
 * the datastore must not import the formatter module graph (and builtins.js's
 * export list is the formatter registry — nothing else may appear there).
 */

// A bare YYYY-MM-DD string is a CALENDAR date and must display as written in every
// time zone (D114). The ES spec parses that date-only form as UTC midnight, which
// Intl then renders a day early for anyone west of UTC, so build LOCAL midnight from
// the components instead. A round-trip mismatch means the components name a day
// that doesn't exist ("2026-02-31") — coerced to Invalid Date so the callers'
// fail-soft passes the raw value through. Deliberately NOT `new Date(v)`: the ES
// grammar accepts any day up to 31, so that would silently roll into March —
// TZ-dependently — while "2026-13-01" (which fails the grammar) returned raw.
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "There is no date here." `new Date(v)` coerces its argument with ToNumber, and
 * ToNumber(null) is 0, ToNumber(false) is 0, ToNumber(true) is 1, ToNumber('') is
 * 0 — so every one of those rendered the Unix epoch ("12/31/1969", "56 years ago")
 * while `undefined` correctly rendered nothing. An unset `todo.completedAt` is the
 * common case, and null is what a cleared field, an absent column and a JSON `null`
 * all arrive as. They are all absent, and absent renders like `undefined` does.
 *
 * Numeric 0 is deliberately NOT here: it is a legitimate epoch timestamp.
 */
export const noDate = (v) => v == null || v === '' || typeof v === 'boolean';

export function parseDateInput(v) {
	// Invalid Date is exactly what `new Date(undefined)` already produced, so every
	// caller's existing undefined path covers these without a second branch.
	if (noDate(v)) return new Date(NaN);
	if (typeof v === 'string' && DATE_ONLY.test(v)) {
		const [y, m, d] = v.split('-').map(Number);
		const local = new Date(y, m - 1, d);
		if (local.getFullYear() === y && local.getMonth() === m - 1 && local.getDate() === d) {
			return local;
		}
		return new Date(NaN);
	}
	return new Date(v);
}

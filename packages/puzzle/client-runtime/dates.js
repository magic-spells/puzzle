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

/**
 * The local-midnight Date a calendar date parses to, tagged so it stays
 * recognizable as a DAY after parsing.
 *
 * `typeof v === 'string' && DATE_ONLY.test(v)` can only classify the value at
 * the moment it is still text. The datastore revives a `date()` field the
 * instant a payload lands, so every consumer downstream of hydration sees a
 * Date and cannot tell "2026-07-24" (a day) from an instant that happens to
 * fall on local midnight. That ambiguity is not cosmetic: the calendar date
 * would be serialized back as `toISOString()` — a UTC instant, which east of
 * UTC names the PREVIOUS day — so a Rails/Django `DateField` round-tripped
 * through save() came back one day earlier. Carrying the classification on the
 * value itself keeps D114's rule intact across the string→Date boundary.
 *
 * A subclass, not a flag property: `instanceof Date` still holds (validation's
 * type gate, Intl, relational comparison, every app-side check), the tag cannot
 * be lost to a spread or a structured copy of the FIELD, and `toJSON` — the one
 * hook `JSON.stringify` consults, which is what every write path goes
 * through — writes the calendar date back exactly as it arrived.
 */
export class CalendarDate extends Date {
	toJSON() {
		// Match Date.prototype.toJSON's contract for a non-finite date: null, not
		// a "NaN-NaN-NaN" string. Unreachable through parseDateInput (it only
		// constructs one after the round-trip check), but a direct construction
		// must not be able to poison a payload.
		return Number.isNaN(this.getTime()) ? null : calendarISO(this);
	}
}

/** True when a value is a calendar date — a DAY — rather than an instant. */
export const isCalendarDate = (v) => v instanceof CalendarDate;

/**
 * The `YYYY-MM-DD` a CalendarDate names, read off its LOCAL fields — the
 * components it was built from. Never `toISOString()`: that re-expresses local
 * midnight as a UTC instant, which is the whole bug.
 */
export function calendarISO(d) {
	return (
		String(d.getFullYear()).padStart(4, '0') +
		'-' +
		String(d.getMonth() + 1).padStart(2, '0') +
		'-' +
		String(d.getDate()).padStart(2, '0')
	);
}

export function parseDateInput(v) {
	// Invalid Date is exactly what `new Date(undefined)` already produced, so every
	// caller's existing undefined path covers these without a second branch.
	if (noDate(v)) return new Date(NaN);
	// Already classified — re-parsing through `new Date(v)` below would clone it
	// into a plain Date and throw the classification away, which is exactly how a
	// revived field lost its calendar identity on the way to a formatter.
	if (isCalendarDate(v)) return v;
	if (typeof v === 'string' && DATE_ONLY.test(v)) {
		const [y, m, d] = v.split('-').map(Number);
		const local = new CalendarDate(y, m - 1, d);
		if (local.getFullYear() === y && local.getMonth() === m - 1 && local.getDate() === d) {
			return local;
		}
		return new Date(NaN);
	}
	return new Date(v);
}

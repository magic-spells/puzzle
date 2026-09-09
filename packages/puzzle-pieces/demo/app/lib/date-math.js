/**
 * Pure date helpers — no DOM access, no time zones, no UTC.
 *
 * Dates are represented as plain `{ year, month, day }` objects where `month`
 * is 1-based (1 = January … 12 = December) so it maps directly onto the ISO
 * `YYYY-MM-DD` string. Every conversion to a native `Date` uses the local-time
 * `new Date(year, monthIndex, day)` constructor — never `Date.parse` or
 * `new Date('YYYY-MM-DD')`, whose UTC parsing shifts the day by one in most
 * time zones.
 *
 * Ported near-verbatim from @magic-spells/date-picker (src/utils/date-math.js).
 * The range/interval (`parseISOInterval`, `isBetween`, …) and month-mode
 * (`parseISOMonth`, `formatISOMonth`) helpers were dropped — the Calendar piece
 * is single-date only; re-add them alongside DatePicker range mode when that
 * lands.
 *
 * @typedef {{ year: number, month: number, day: number }} DateParts
 */

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Number of days in a given month, honouring leap years.
 * @param {number} year
 * @param {number} month 1-based month
 * @returns {number}
 */
export function daysInMonth(year, month) {
	// day 0 of the next month is the last day of this month
	return new Date(year, month, 0).getDate();
}

/**
 * Parses an ISO `YYYY-MM-DD` string into date parts. Returns null for anything
 * that is not a real calendar date (bad format, month 13, Feb 30, …).
 * @param {string} isoString
 * @returns {DateParts | null}
 */
export function parseISODate(isoString) {
	if (typeof isoString !== 'string') return null;
	const match = isoString.trim().match(ISO_PATTERN);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);

	if (month < 1 || month > 12) return null;
	if (day < 1 || day > daysInMonth(year, month)) return null;

	return { year, month, day };
}

/**
 * Formats date parts as an ISO `YYYY-MM-DD` string.
 * @param {DateParts} parts
 * @returns {string}
 */
export function formatISODate({ year, month, day }) {
	const yyyy = String(year).padStart(4, '0');
	const mm = String(month).padStart(2, '0');
	const dd = String(day).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * First year of the fixed-size year page containing `year`. Pages are anchored
 * so that `startOfYearPage(2026)` (default 12-year page) returns 2016 and the
 * page spans 2016–2027. Works for negative years too.
 * @param {number} year
 * @param {number} [pageSize] page length in years (default 12)
 * @returns {number}
 */
export function startOfYearPage(year, pageSize = 12) {
	return Math.floor(year / pageSize) * pageSize;
}

/**
 * Converts date parts into a local-time `Date` at midnight.
 * @param {DateParts} parts
 * @returns {Date}
 */
export function toDate({ year, month, day }) {
	return new Date(year, month - 1, day);
}

/**
 * Converts a native `Date` into local-time date parts.
 * @param {Date} date
 * @returns {DateParts}
 */
export function fromDate(date) {
	return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/**
 * Returns a copy of `parts` moved by `amount` days (may be negative). Crosses
 * month and year boundaries correctly.
 * @param {DateParts} parts
 * @param {number} amount
 * @returns {DateParts}
 */
export function addDays(parts, amount) {
	return fromDate(new Date(parts.year, parts.month - 1, parts.day + amount));
}

/**
 * Returns a copy of `parts` moved by `amount` months (may be negative). The
 * day-of-month is clamped so overflow rolls back to the last valid day rather
 * than spilling into the following month — e.g. Jan 31 + 1 month = Feb 28/29.
 * @param {DateParts} parts
 * @param {number} amount
 * @returns {DateParts}
 */
export function addMonths(parts, amount) {
	const zeroBasedMonth = parts.month - 1 + amount;
	const year = parts.year + Math.floor(zeroBasedMonth / 12);
	const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
	const day = Math.min(parts.day, daysInMonth(year, month));
	return { year, month, day };
}

/**
 * True when two date parts refer to the same calendar day. Either argument may
 * be null.
 * @param {DateParts | null} a
 * @param {DateParts | null} b
 * @returns {boolean}
 */
export function isSameDay(a, b) {
	if (!a || !b) return false;
	return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Chronological comparator: -1 if `a` is before `b`, 1 if after, 0 if equal.
 * @param {DateParts} a
 * @param {DateParts} b
 * @returns {number}
 */
export function compareDates(a, b) {
	if (a.year !== b.year) return a.year < b.year ? -1 : 1;
	if (a.month !== b.month) return a.month < b.month ? -1 : 1;
	if (a.day !== b.day) return a.day < b.day ? -1 : 1;
	return 0;
}

/**
 * Clamps date parts into the inclusive `[min, max]` range. Either bound may be
 * null (open on that side).
 * @param {DateParts} parts
 * @param {DateParts | null} min
 * @param {DateParts | null} max
 * @returns {DateParts}
 */
export function clampDate(parts, min, max) {
	if (min && compareDates(parts, min) < 0) return { ...min };
	if (max && compareDates(parts, max) > 0) return { ...max };
	return { ...parts };
}

/**
 * True when `parts` falls inside the inclusive `[min, max]` range. Either bound
 * may be null.
 * @param {DateParts} parts
 * @param {DateParts | null} min
 * @param {DateParts | null} max
 * @returns {boolean}
 */
export function isInRange(parts, min, max) {
	if (min && compareDates(parts, min) < 0) return false;
	if (max && compareDates(parts, max) > 0) return false;
	return true;
}

/**
 * Offset (0–6) of a weekday from the configured start of the week. Given the
 * native `Date.getDay()` value (0 = Sunday) and a `firstDayOfWeek`, returns how
 * many days `dayOfWeek` sits after the week's start.
 * @param {number} dayOfWeek 0 (Sunday) … 6 (Saturday)
 * @param {number} firstDayOfWeek 0 (Sunday) … 6 (Saturday)
 * @returns {number}
 */
export function startOfWeekIndex(dayOfWeek, firstDayOfWeek) {
	return (dayOfWeek - firstDayOfWeek + 7) % 7;
}

/**
 * First day of the week containing `parts`, honouring `firstDayOfWeek`.
 * @param {DateParts} parts
 * @param {number} firstDayOfWeek
 * @returns {DateParts}
 */
export function startOfWeek(parts, firstDayOfWeek) {
	const offset = startOfWeekIndex(toDate(parts).getDay(), firstDayOfWeek);
	return addDays(parts, -offset);
}

/**
 * Last day of the week containing `parts`, honouring `firstDayOfWeek`.
 * @param {DateParts} parts
 * @param {number} firstDayOfWeek
 * @returns {DateParts}
 */
export function endOfWeek(parts, firstDayOfWeek) {
	const offset = startOfWeekIndex(toDate(parts).getDay(), firstDayOfWeek);
	return addDays(parts, 6 - offset);
}

/**
 * Builds a fixed 6-week × 7-day calendar matrix for a month. Always returns 6
 * rows of 7 cells (42 total) so the grid never changes height between months;
 * leading and trailing cells belong to the adjacent months and are flagged with
 * `isCurrentMonth: false`.
 * @param {{ year: number, month: number, firstDayOfWeek?: number }} options
 * @returns {Array<Array<DateParts & { isCurrentMonth: boolean }>>}
 */
export function getCalendarGrid({ year, month, firstDayOfWeek = 0 }) {
	const firstOfMonth = { year, month, day: 1 };
	const leadingDays = startOfWeekIndex(toDate(firstOfMonth).getDay(), firstDayOfWeek);
	const gridStart = addDays(firstOfMonth, -leadingDays);

	const weeks = [];
	let cursor = gridStart;
	for (let week = 0; week < 6; week += 1) {
		const row = [];
		for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
			row.push({ ...cursor, isCurrentMonth: cursor.month === month && cursor.year === year });
			cursor = addDays(cursor, 1);
		}
		weeks.push(row);
	}
	return weeks;
}

// Built-in template formatters. Keep this module side-effect-free so bundlers
// can tree-shake unused named exports from compiler-generated manifests.

// null/undefined render as empty string, never the literal "null"/"undefined"
const str = (v) => (v == null ? '' : String(v));

// Normalize a `decimals` argument to a digit count toFixed/Intl accept: coerce to
// an integer and clamp to the valid 0–100 range. A non-numeric, NaN, or Infinite
// argument falls back to `dflt` (the formatter's own default) so a bad argument
// fails soft instead of throwing RangeError. Shared by round/currency/percentage.
const normDecimals = (decimals, dflt) => {
	const n = Math.trunc(Number(decimals));
	if (!Number.isFinite(n)) return dflt;
	return Math.min(100, Math.max(0, n));
};

export function escape(v) {
	return str(v)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function raw(v) {
	return str(v);
}

export function noescape(v) {
	return str(v);
}

export function trim(v) {
	return str(v).trim();
}

export function downcase(v) {
	return str(v).toLowerCase();
}

export function upcase(v) {
	return str(v).toUpperCase();
}

export function capitalize(v) {
	const s = str(v);
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function truncate(v, n = 100, ell = '…') {
	const s = str(v);
	return s.length > n ? s.slice(0, Math.max(0, n - String(ell).length)) + ell : s;
}

export function replace(v, search, replace = '') {
	const s = str(v);
	// string search replaces ALL occurrences (Liquid semantics);
	// a RegExp is applied as given
	return typeof search === 'string' ? s.split(search).join(replace) : s.replace(search, replace);
}

export function split(v, separator = ',') {
	return str(v).split(separator);
}

export function strip(v) {
	return str(v).replace(/^\s+|\s+$/g, '');
}

export function strip_html(v) {
	return str(v).replace(/<[^>]*>/g, '');
}

export function strip_newlines(v) {
	return str(v).replace(/\n/g, '');
}

export function newline_to_br(v) {
	return str(v).replace(/\n/g, '<br>');
}

export function pluralize(count, singular, plural) {
	return Number(count) === 1 ? singular : (plural || singular + 's');
}

export function plus(v, n) {
	return Number(v) + Number(n);
}

export function minus(v, n) {
	return Number(v) - Number(n);
}

export function times(v, n) {
	return Number(v) * Number(n);
}

export function divided_by(v, n) {
	return Number(v) / Number(n);
}

export function modulo(v, n) {
	return Number(v) % Number(n);
}

export function round(v, decimals = 0) {
	// normDecimals clamps to toFixed's valid 0–100 range and integer-coerces, so a
	// negative (round(5, -1)), oversized (round(5, 101)), or non-numeric decimals
	// fails soft (falls back to 0) instead of throwing RangeError.
	return Number(Number(v).toFixed(normDecimals(decimals, 0)));
}

export function floor(v) {
	return Math.floor(Number(v));
}

export function ceil(v) {
	return Math.ceil(Number(v));
}

export function abs(v) {
	return Math.abs(Number(v));
}

export function first(arr) {
	return Array.isArray(arr) ? arr[0] : arr;
}

export function last(arr) {
	return Array.isArray(arr) ? arr[arr.length - 1] : arr;
}

export function size(v) {
	if (Array.isArray(v)) return v.length;
	if (typeof v === 'string') return v.length;
	if (v && typeof v === 'object') return Object.keys(v).length;
	return 0;
}

export function join(arr, sep = ', ') {
	return Array.isArray(arr) ? arr.join(sep) : str(arr);
}

export function reverse(v) {
	if (Array.isArray(v)) return [...v].reverse();
	// Spread iterates by code POINT, not UTF-16 code unit — `split('')` would tear
	// a surrogate pair (emoji) into two lone surrogates and reorder them wrong.
	if (typeof v === 'string') return [...v].reverse().join('');
	return v;
}

// Comparator shared by keyed/keyless sort. Two numbers compare NUMERICALLY (so
// [2,10,1] → [1,2,10], not the lexicographic [1,10,2] a bare Array.sort gives),
// with NaN pushed to the end (NaN vs NaN is equal). Any other type pair — or a
// number/non-number mix — falls back to string comparison, preserving the prior
// keyless default() behavior for non-numeric data.
function compareValues(a, b) {
	if (typeof a === 'number' && typeof b === 'number') {
		if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
		if (Number.isNaN(b)) return -1;
		return a < b ? -1 : a > b ? 1 : 0;
	}
	const as = String(a);
	const bs = String(b);
	return as < bs ? -1 : as > bs ? 1 : 0;
}

export function sort(arr, key) {
	if (!Array.isArray(arr)) return arr;
	// Copy first — never mutate the caller's array (a formatter is display-only).
	const sorted = [...arr];
	if (key) {
		sorted.sort((a, b) => compareValues(a[key], b[key]));
	} else {
		sorted.sort(compareValues);
	}
	return sorted;
}

export function uniq(arr) {
	if (!Array.isArray(arr)) return arr;
	return [...new Set(arr)];
}

export function compact(arr) {
	if (!Array.isArray(arr)) return arr;
	return arr.filter(v => v != null && v !== '');
}

export function map(arr, key) {
	if (!Array.isArray(arr)) return arr;
	return arr.map(item => item[key]);
}

export function where(arr, key, value) {
	if (!Array.isArray(arr)) return arr;
	return arr.filter(item => item[key] === value);
}

export function json(v) {
	return JSON.stringify(v);
}

export function currency(v, sym = '$', decimals = 2) {
	const num = Number(v);
	return Number.isFinite(num) ? sym + num.toFixed(normDecimals(decimals, 2)) : str(v);
}

export function percentage(v, decimals = 0) {
	const num = Number(v) * 100;
	return Number.isFinite(num) ? num.toFixed(normDecimals(decimals, 0)) + '%' : str(v);
}

export function number_with_delimiter(v, delimiter = ',') {
	const num = Number(v);
	if (!Number.isFinite(num)) return str(v);
	const parts = String(num).split('.');
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, delimiter);
	return parts.join('.');
}

export function in_timezone(v, tz = 'UTC') {
	const d = new Date(v);
	// An unknown time-zone identifier throws RangeError at DateTimeFormat
	// construction, and formatToParts throws on an invalid date — fail soft to the
	// un-shifted date so a bad tz/date never crashes the render.
	try {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric', month: '2-digit', day: '2-digit',
			hour: '2-digit', minute: '2-digit', second: '2-digit',
			hour12: false
		}).formatToParts(d);
		const get = t => parts.find(p => p.type === t)?.value;
		const iso = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
		return new Date(iso);
	} catch {
		return d;
	}
}

export function date(v, preset = 'date', locale = undefined) {
	const d = new Date(v);
	if (isNaN(d.getTime())) return str(v);

	if (preset === 'iso') return d.toISOString();

	const formats = {
		date:     { year: 'numeric', month: '2-digit', day: '2-digit' },
		time:     { hour: '2-digit', minute: '2-digit' },
		short:    { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
		long:     { year: 'numeric', month: 'long', day: '2-digit' },
		datetime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
	};

	const options = formats[preset] || formats.date;
	// An invalid locale throws RangeError at DateTimeFormat construction — fail
	// soft to the raw value like the invalid-date guard above.
	try {
		return new Intl.DateTimeFormat(locale, options).format(d);
	} catch {
		return str(v);
	}
}

export function time(v, preset = 'time', locale = undefined) {
	return date(v, preset, locale);
}

export function datetime(v, preset = 'datetime', locale = undefined) {
	return date(v, preset, locale);
}

export function timeago(v) {
	const then = new Date(v).getTime();
	if (isNaN(then)) return str(v);

	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	const diff = Math.round((then - Date.now()) / 1000);
	const units = [
		['year', 31536000],
		['month', 2592000],
		['day', 86400],
		['hour', 3600],
		['minute', 60],
		['second', 1]
	];

	for (const [unit, secs] of units) {
		if (Math.abs(diff) >= secs || unit === 'second') {
			return rtf.format(Math.trunc(diff / secs), unit);
		}
	}
	// Unreachable today (the `unit === 'second'` guard always returns on the last
	// iteration), but an explicit final return guarantees a refactor can never let
	// this yield undefined — fall back to the raw value like the isNaN guard above.
	return str(v);
}

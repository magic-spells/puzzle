// Built-in template formatters. Keep this module side-effect-free so bundlers
// can tree-shake unused named exports from compiler-generated manifests.
//
// The names split into the STANDARD set (D174), which Sites implements too with
// the same arguments and meaning, and three PuzzleKit-only names: `link` (built
// by the registry, not here), `timeago` and `in_timezone`. The identical-output
// part of the standard set is pinned by tests/conformance/formatters.json.
// List shaping (sort, filter, map, pick) is JavaScript in PuzzleKit — `data()` or
// a plain expression — so there are deliberately no list formatters here beyond
// `join` and `size`.

import { calendarISO, isCalendarDate, noDate, parseDateInput } from '../dates.js';
import { formatLocale, localeNumber } from './locale.js';
import { sanitizeHtml, newlineToBr } from '../sanitize.js';

// null/undefined render as empty string, never the literal "null"/"undefined"
const str = (v) => (v == null ? '' : String(v));

// A number read from a display value, or NaN. A missing value (and '' and a
// boolean) is NaN rather than Number()'s 0, so `{ unset | currency }` prints
// nothing instead of "$0.00".
const num = (v) => (v == null || v === '' || typeof v === 'boolean' ? NaN : Number(v));

// Normalize a `places` argument to a digit count toFixed accepts: coerce to an
// integer and clamp to 0–100. A non-numeric, NaN, or infinite argument falls back
// to `dflt` so a bad argument fails soft instead of throwing RangeError. Shared by
// currency/percentage (round takes negative places too, with its own clamp).
const normDecimals = (decimals, dflt) => {
	const n = Math.trunc(Number(decimals));
	if (!Number.isFinite(n)) return dflt;
	return Math.min(100, Math.max(0, n));
};

// n × 10^p computed on the DECIMAL digits, not in binary: `1.005` shifted by 2 is
// exactly 100.5 here, where `1.005 * 100` is 100.49999999999999. Handles the
// exponent form String() uses outside 1e-6 … 1e21.
const shift = (n, p) => {
	const [m, e = 0] = String(n).split('e');
	return Number(`${m}e${Number(e) + p}`);
};

// Round half away from zero on the decimal value (D174 F19). Negative places
// round to tens, hundreds, …. A value too large to scale is returned unchanged.
function roundHalfAway(n, p) {
	if (!Number.isFinite(n)) return n;
	const scaled = shift(Math.abs(n), p);
	if (!Number.isFinite(scaled)) return n;
	const r = shift(Math.round(scaled), -p);
	return n < 0 ? -r : r;
}

// Group the digits of a whole-number string in threes. A function replacement,
// so a delimiter containing `$` is inserted literally.
const group = (whole, delimiter) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, () => delimiter);

// Locale-rendered numbers (`localeNumber`, formatters/locale.js) use the
// viewer's locale — Intl's default — or, when the app configures translations,
// the active locale (D175). The date family, `compact_number` and `timeago` read
// the same slot, each behind the inline `__PUZZLE_HAS_I18N__` probe.

// ── Markup ────────────────────────────────────────────────────────────────────

// A text interpolation already escapes (it becomes a text node), so `escape` is an
// identity: the page shows the value's characters, `<b>` as `<b>` — never the
// double-escaped `&lt;b&gt;` (D174 F8).
export function escape(v) {
	return str(v);
}

// The two markup formatters (D174). A template never calls these functions:
// codegen lowers a text interpolation whose chain ENDS in either name to the
// live-HTML node (views/html.js), which runs the same sanitizer, and anywhere
// else either name is a compile error. So an app formatter registered under
// `raw` can never inject markup. The functions return the markup strings the
// node renders — for script code, and for the shared conformance table.
export function raw(v) {
	return sanitizeHtml(str(v));
}

export function newline_to_br(v) {
	return newlineToBr(str(v));
}

// ── Text ──────────────────────────────────────────────────────────────────────

export function trim(v) {
	return str(v).trim();
}

export function downcase(v) {
	return str(v).toLowerCase();
}

export function upcase(v) {
	return str(v).toUpperCase();
}

// Upper-cases the first character and leaves the rest alone, so `iPhone` and
// `NASA` survive (D174 F1). The old behavior is `downcase | capitalize`.
export function capitalize(v) {
	const s = str(v);
	if (s === '') return s;
	const first = String.fromCodePoint(s.codePointAt(0));
	return first.toUpperCase() + s.slice(first.length);
}

// Counts code points, and the result is never longer than `length`: an ellipsis
// longer than the limit is clipped (D174 F25).
export function truncate(v, length = 100, ellipsis = '…') {
	const s = str(v);
	let n = Math.trunc(Number(length));
	if (Number.isNaN(n)) n = 100;
	n = Math.max(0, n);
	// UTF-16 length bounds the code-point count from above, so a string this
	// short needs no code-point walk.
	if (s.length <= n) return s;
	const chars = [...s];
	if (chars.length <= n) return s;
	const ell = [...str(ellipsis)].slice(0, n);
	return chars.slice(0, n - ell.length).join('') + ell.join('');
}

export function replace(v, search, replacement = '') {
	const s = str(v);
	// A string search replaces ALL occurrences, literally (Liquid semantics); a
	// RegExp is applied as given — a PuzzleKit addition.
	return typeof search === 'string'
		? s.split(search).join(str(replacement))
		: s.replace(search, str(replacement));
}

// `''` splits into code points; a missing input is an empty list (D174 F22).
export function split(v, separator = ',') {
	if (v == null) return [];
	const s = str(v);
	return separator === '' ? [...s] : s.split(separator);
}

export function strip(v) {
	return str(v).replace(/^\s+|\s+$/g, '');
}

// Scan to the `>` closing a tag that starts at `start`, skipping quoted attribute
// values; -1 when the tag never closes.
function tagEnd(s, start) {
	let quote = '';
	for (let i = start; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === '>') {
			return i;
		}
	}
	return -1;
}

// Removes tags and comments, quote-aware, without decoding entities. A `<` not
// followed by a tag name, and unfinished markup, stay as text (D174 F23 — the
// same scanner as Sites' stripHTML).
export function strip_html(v) {
	const s = str(v);
	let out = '';
	let i = 0;
	while (i < s.length) {
		if (s.startsWith('<!--', i)) {
			const end = s.indexOf('-->', i + 4);
			if (end >= 0) {
				i = end + 3;
				continue;
			}
		} else if (s[i] === '<' && i + 1 < s.length) {
			let start = i + 1;
			if (s[start] === '/' && start + 1 < s.length) start++;
			const c = s[start];
			if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '!' || c === '?') {
				const end = tagEnd(s, start + 1);
				if (end >= 0) {
					i = end + 1;
					continue;
				}
			}
		}
		out += s[i];
		i++;
	}
	return out;
}

export function strip_newlines(v) {
	return str(v).replace(/[\r\n]/g, '');
}

// Prints the count AND the word: `1 comment`, `3 comments`, `2 men`. The word is
// `singular` only for exactly 1; the count is formatted in the viewer's locale,
// like number_with_delimiter (D174 F15).
export function pluralize(count, singular, plural) {
	const n = num(count);
	if (!Number.isFinite(n)) return str(count);
	const word = n === 1 ? str(singular) : plural == null ? str(singular) + 's' : str(plural);
	return localeNumber(n) + ' ' + word;
}

// ── Numbers ───────────────────────────────────────────────────────────────────

export function plus(v, n) {
	return Number(v) + Number(n);
}

export function minus(v, n) {
	return Number(v) - Number(n);
}

export function times(v, n) {
	return Number(v) * Number(n);
}

// A zero divisor gives a missing value, which prints nothing and is what the next
// formatter in the chain receives (D174 F7). No integer division.
export function divided_by(v, n) {
	const d = Number(n);
	return d === 0 ? undefined : Number(v) / d;
}

// The remainder takes the dividend's sign; a zero divisor gives a missing value
// (D174 F11).
export function modulo(v, n) {
	const d = Number(n);
	return d === 0 ? undefined : Number(v) % d;
}

// Rounds half away from zero on the decimal value — `1.005 | round(2)` is 1.01,
// `2.5 | round` is 3 — and negative places round to tens and hundreds (D174 F19).
// Returns a number, so a chain keeps doing arithmetic.
export function round(v, places = 0) {
	let p = Math.trunc(Number(places));
	if (!Number.isFinite(p)) p = 0;
	return roundHalfAway(Number(v), Math.min(100, Math.max(-100, p)));
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

// Groups thousands with `,`, puts the sign before the symbol (`-$1,234.50`), and
// rounds by round's rule (D174 F3). An amount that rounds to zero is unsigned.
export function currency(v, symbol = '$', places = 2) {
	const n = num(v);
	if (!Number.isFinite(n)) return str(v);
	const p = normDecimals(places, 2);
	const rounded = roundHalfAway(n, p);
	const [whole, frac] = Math.abs(rounded).toFixed(p).split('.');
	return (rounded < 0 ? '-' : '') + str(symbol) + group(whole, ',') + (frac ? '.' + frac : '');
}

// Takes the number as written: `12.5 | percentage(1)` is `12.5%`. A ratio is
// `ratio | times(100) | percentage` (D174 F14).
export function percentage(v, places = 0) {
	const n = num(v);
	if (!Number.isFinite(n)) return str(v);
	const p = normDecimals(places, 0);
	return roundHalfAway(n, p).toFixed(p) + '%';
}

// Groups the whole part and keeps the decimals as given. With no argument it
// follows the viewer's locale (`1.234,5` in de-DE); an explicit delimiter forces
// it, groups in threes and keeps `.` as the decimal point.
export function number_with_delimiter(v, delimiter) {
	const n = num(v);
	if (!Number.isFinite(n)) return str(v);
	if (delimiter == null) return localeNumber(n);
	const [whole, frac] = String(n).split('.');
	return group(whole, str(delimiter)) + (frac === undefined ? '' : '.' + frac);
}

// Shortens a large number with a localized suffix: `1.2K`, `45K`, `3.4M` in en.
// One cached formatter, rebuilt when the formatter locale moves (D175).
let compactFormatter;
let compactLocale;
export function compact_number(v) {
	const n = num(v);
	if (!Number.isFinite(n)) return str(v);
	if ((typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__) && compactLocale !== formatLocale) {
		compactLocale = formatLocale;
		compactFormatter = undefined;
	}
	compactFormatter ??= new Intl.NumberFormat(
		typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__ ? formatLocale : undefined,
		{ notation: 'compact' },
	);
	return compactFormatter.format(n);
}

// ── Values ────────────────────────────────────────────────────────────────────

// `fallback` when the value is missing, `false`, `''` or an empty list. Every
// other value — `0` and an empty object included — passes through. `default` is
// a reserved word, so it is exported under an alias; that makes it this module's
// default export, which the namespace import in builtins-all.js and the
// compiler's virtual manifest both read by the name `default`.
function defaultValue(v, fallback) {
	return v == null || v === false || v === '' || (Array.isArray(v) && v.length === 0)
		? fallback
		: v;
}
export { defaultValue as default };

// A list's item count, a string's CODE-POINT count, an object's key count, and
// `0` for anything else, a missing value included (D174 F20).
export function size(v) {
	if (Array.isArray(v)) return v.length;
	if (typeof v === 'string') {
		let n = 0;
		for (const _ of v) n++;
		return n;
	}
	if (v && typeof v === 'object') return Object.keys(v).length;
	return 0;
}

export function join(arr, sep = ', ') {
	return Array.isArray(arr) ? arr.join(sep) : str(arr);
}

// Compare two strings by Unicode code point (UTF-8 byte order, which is what Go's
// map-key sort uses). UTF-16 code-unit order differs only when a surrogate meets
// U+E000–U+FFFF, so remap those two ranges before comparing.
function compareCodePoints(a, b) {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		let x = a.charCodeAt(i);
		let y = b.charCodeAt(i);
		if (x === y) continue;
		if (x >= 0xd800) x += x < 0xe000 ? 0x2000 : -0x800;
		if (y >= 0xd800) y += y < 0xe000 ? 0x2000 : -0x800;
		return x - y;
	}
	return a.length - b.length;
}

// JSON with object keys sorted by code point; a missing value, NaN and ±Infinity
// give `null` (D174 F9). Written out rather than JSON.stringify with a replacer:
// a JS object always enumerates integer-like keys first, so no rebuilt object can
// carry code-point order. A cycle serializes as `null` rather than throwing.
// The output is NOT HTML-escaped — the text node it lands in handles that.
function toJSON(v, stack) {
	if (v != null && typeof v.toJSON === 'function') v = v.toJSON();
	if (v == null) return 'null';
	switch (typeof v) {
		case 'number':
			return Number.isFinite(v) ? JSON.stringify(v) : 'null';
		case 'string':
			return JSON.stringify(v);
		case 'boolean':
			return String(v);
		case 'bigint':
			return String(v);
		case 'object':
			break;
		default:
			return undefined; // function / symbol: omitted from objects, null in lists
	}
	if (stack.includes(v)) return 'null';
	stack.push(v);
	let out;
	if (Array.isArray(v)) {
		out = '[' + v.map((item) => toJSON(item, stack) ?? 'null').join(',') + ']';
	} else {
		const parts = [];
		for (const key of Object.keys(v).sort(compareCodePoints)) {
			const item = toJSON(v[key], stack);
			if (item !== undefined) parts.push(JSON.stringify(key) + ':' + item);
		}
		out = '{' + parts.join(',') + '}';
	}
	stack.pop();
	return out;
}

export function json(v) {
	return toJSON(v, []) ?? 'null';
}

// ── Dates ─────────────────────────────────────────────────────────────────────

// The calendar-date parse rule (D114) — noDate, parseDateInput, and the
// CalendarDate tag its `isCalendarDate`/`calendarISO` pair reads — is shared with
// the datastore's JSON hydration boundary, so it lives in ../dates.js; see that
// module for the rationale. Nothing here may re-export it: this module's export
// list IS the formatter registry.
//
// Calendar-date branches below test the PARSED value, never `typeof v ===
// 'string'`. By the time a value reaches a template it has usually been through
// the store, which revives a `date()` field to a Date on the way in — a
// string-shaped test sees an instant there and silently takes the wrong branch.
//
// `date`, `time` and `datetime` share the presets `short`, `medium` (the
// default), `long` and `iso` (D174 F4–F6). The first three are Intl styles in the
// viewer's locale and time zone; `iso` is locale-free and uses the viewer's zone.
const DATE_PRESETS = {
	date: {
		short: { dateStyle: 'short' },
		medium: { dateStyle: 'medium' },
		long: { dateStyle: 'long' },
	},
	time: {
		short: { timeStyle: 'short' },
		medium: { timeStyle: 'medium' },
		long: { timeStyle: 'long' },
	},
	datetime: {
		short: { dateStyle: 'short', timeStyle: 'short' },
		medium: { dateStyle: 'medium', timeStyle: 'medium' },
		long: { dateStyle: 'long', timeStyle: 'long' },
	},
};

const DATE_FORMATTERS = new Map();
const TIMEZONE_FORMATTERS = new Map();
// `timeago` takes no locale, so there is exactly one formatter to cache — built
// on first use so importing the module never constructs an Intl object.
let relativeTimeFormatter;
let relativeLocale;
// Dev-only warn-once ledger for unknown presets; production never touches it.
let warnedPresets;

const pad2 = (n) => String(n).padStart(2, '0');

// RFC 3339 pieces in the Date's local zone: `15:04:05` plus `Z` or `±hh:mm`.
function isoTime(d) {
	const offset = -d.getTimezoneOffset();
	const abs = Math.abs(offset);
	const zone =
		offset === 0 ? 'Z' : (offset < 0 ? '-' : '+') + pad2(Math.trunc(abs / 60)) + ':' + pad2(abs % 60);
	return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + zone;
}

function formatDate(kind, v, preset, locale) {
	// An absent value renders NOTHING, in every preset (`iso` included). The invalid
	// -date fall-through below already does that for null/undefined/'' via str(), but
	// not for a boolean — 'false' is not a date worth echoing back — so the empty
	// path is explicit.
	if (noDate(v)) return '';
	const d = parseDateInput(v);
	if (isNaN(d.getTime())) return str(v);
	// An explicit locale argument wins; otherwise the formatter locale (D175).
	if (typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__) locale ??= formatLocale;

	if (preset === 'iso') {
		// A calendar date names a day, not an instant: its ISO form is the day
		// itself, whichever formatter asked (D114).
		if (isCalendarDate(d) || kind === 'date') return calendarISO(d);
		return kind === 'time' ? isoTime(d) : calendarISO(d) + 'T' + isoTime(d);
	}

	const presets = DATE_PRESETS[kind];
	let resolved = preset;
	if (!Object.hasOwn(presets, preset)) {
		// An unknown preset is a development error, reported once per name, and
		// renders as `medium`. hasOwn first so a typo can never mint a cache entry.
		if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
			warnedPresets ??= new Set();
			const key = kind + ':' + preset;
			if (!warnedPresets.has(key)) {
				warnedPresets.add(key);
				// The retired preset names `date`/`time`/`datetime` are formatters now.
				const retired =
					preset !== kind && Object.hasOwn(DATE_PRESETS, preset)
						? ` — use the ${preset} formatter instead`
						: '';
				console.error(
					`[puzzle] unknown ${kind} preset "${preset}"${retired}; the presets are short, medium, long and iso (rendered as medium)`,
				);
			}
		}
		resolved = 'medium';
	}
	// Only undefined and string locales are cache KEYS. Intl also accepts a locale
	// LIST (and an Intl.Locale), and a call site that builds one inline hands over a
	// fresh object every render — identity keying would miss the Map every time AND
	// insert, growing it without bound. Those construct a formatter per call instead.
	const cacheable = locale === undefined || typeof locale === 'string';
	const cacheKey = kind + ':' + resolved;
	// An invalid locale throws RangeError at DateTimeFormat construction — fail
	// soft to the raw value like the invalid-date guard above.
	try {
		const localeFormatters = cacheable ? DATE_FORMATTERS.get(locale) : undefined;
		let formatter = localeFormatters?.get(cacheKey);
		if (!formatter) {
			formatter = new Intl.DateTimeFormat(locale, presets[resolved]);
			if (localeFormatters) {
				localeFormatters.set(cacheKey, formatter);
			} else if (cacheable) {
				DATE_FORMATTERS.set(locale, new Map([[cacheKey, formatter]]));
			}
		}
		return formatter.format(d);
	} catch {
		return str(v);
	}
}

export function date(v, preset = 'medium', locale = undefined) {
	return formatDate('date', v, preset, locale);
}

export function time(v, preset = 'medium', locale = undefined) {
	return formatDate('time', v, preset, locale);
}

export function datetime(v, preset = 'medium', locale = undefined) {
	return formatDate('datetime', v, preset, locale);
}

export function in_timezone(v, tz = 'UTC') {
	// An absent value has no instant to re-express, and the fail-soft below would
	// hand the next formatter in the pipe an Invalid Date — `{ x | in_timezone:'UTC'
	// | date }` then rendered the literal text "Invalid Date" for an unset field.
	// Same empty answer as date()/timeago(), for the same reason.
	if (noDate(v)) return '';
	const d = parseDateInput(v);
	// A bare YYYY-MM-DD names a DAY, not an instant, so there is nothing to
	// re-express in another zone — return D114's local midnight untouched.
	// Shifting it would move the day: the local-midnight instant read as a wall
	// clock in `tz` lands on the day before (or after) for any viewer whose own
	// offset differs, making a calendar date render differently per viewer — the
	// exact TZ dependence D114 removed from `date`/`timeago`.
	if (isCalendarDate(d)) return d;
	// An unknown time-zone identifier throws RangeError at DateTimeFormat
	// construction, and formatToParts throws on an invalid date — fail soft to the
	// un-shifted date so a bad tz/date never crashes the render.
	try {
		let formatter = TIMEZONE_FORMATTERS.get(tz);
		if (!formatter) {
			formatter = new Intl.DateTimeFormat('en-CA', {
				timeZone: tz,
				year: 'numeric', month: '2-digit', day: '2-digit',
				hour: '2-digit', minute: '2-digit', second: '2-digit',
				hour12: false
			});
			TIMEZONE_FORMATTERS.set(tz, formatter);
		}
		const parts = formatter.formatToParts(d);
		const get = t => parts.find(p => p.type === t)?.value;
		const iso = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
		return new Date(iso);
	} catch {
		return d;
	}
}

export function timeago(v) {
	// `{ todo.completedAt | timeago }` on an incomplete todo: nothing to say.
	if (noDate(v)) return '';
	const then = parseDateInput(v).getTime();
	if (isNaN(then)) return str(v);

	if ((typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__) && relativeLocale !== formatLocale) {
		relativeLocale = formatLocale;
		relativeTimeFormatter = undefined;
	}
	const rtf = (relativeTimeFormatter ??= new Intl.RelativeTimeFormat(
		typeof __PUZZLE_HAS_I18N__ === 'undefined' || __PUZZLE_HAS_I18N__ ? formatLocale : undefined,
		{ numeric: 'auto' },
	));
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

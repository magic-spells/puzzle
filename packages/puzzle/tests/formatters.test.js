import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
	FormatterRegistry,
	makeFormatterRegistry,
	STANDARD_FORMATTERS,
} from '../client-runtime/formatters.js';
import fullBuiltins from '../client-runtime/formatters/builtins-all.js';
import builtinNames from '../client-runtime/formatters/builtins.json';
import conformance from './conformance/formatters.json';

const f = new FormatterRegistry().getAll();

function spyOnIntlConstructor(name) {
	const Original = Intl[name];
	return vi.spyOn(Intl, name).mockImplementation(function (...args) {
		return new Original(...args);
	});
}

describe('built-in Intl formatter caches', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it('reuses the same DateTimeFormat for repeated locale/preset calls', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('DateTimeFormat');
		const { date } = await import('../client-runtime/formatters/builtins.js');

		expect(date('2026-07-24', 'long', 'en-US')).toBe('July 24, 2026');
		expect(date('2026-01-01', 'long', 'en-US')).toBe('January 1, 2026');
		expect(constructor).toHaveBeenCalledTimes(1);
	});

	it('keeps alternating date presets cached independently with correct output', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('DateTimeFormat');
		const { date } = await import('../client-runtime/formatters/builtins.js');

		expect(date('2026-07-24', 'short', 'en-US')).toBe('7/24/26');
		expect(date('2026-07-24', 'long', 'en-US')).toBe('July 24, 2026');
		expect(date('2026-01-01', 'short', 'en-US')).toBe('1/1/26');
		expect(date('2026-01-01', 'long', 'en-US')).toBe('January 1, 2026');
		expect(constructor).toHaveBeenCalledTimes(2);
	});

	it('shares the medium cache entry across unknown presets', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('DateTimeFormat');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { date } = await import('../client-runtime/formatters/builtins.js');

		expect(date('2026-07-24', 'bogus-one', 'en-US')).toBe('Jul 24, 2026');
		expect(date('2026-01-01', 'bogus-two', 'en-US')).toBe('Jan 1, 2026');
		expect(date('2026-01-01', 'medium', 'en-US')).toBe('Jan 1, 2026');
		expect(constructor).toHaveBeenCalledTimes(1);
	});

	it('keeps date, time and datetime presets in separate cache entries', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('DateTimeFormat');
		const { date, time, datetime } = await import('../client-runtime/formatters/builtins.js');
		const at = new Date(2026, 8, 24, 15, 4, 5);

		expect(date(at, 'short', 'en-US')).toBe('9/24/26');
		expect(time(at, 'short', 'en-US')).toBe('3:04 PM');
		expect(datetime(at, 'short', 'en-US')).toBe('9/24/26, 3:04 PM');
		expect(date(at, 'short', 'en-US')).toBe('9/24/26');
		expect(constructor).toHaveBeenCalledTimes(3);
	});

	it('leaves invalid locales uncached without poisoning a later valid call', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('DateTimeFormat');
		const { date } = await import('../client-runtime/formatters/builtins.js');
		const value = '2026-07-24T12:00:00Z';

		expect(date(value, 'long', 'en US')).toBe(value);
		expect(date(value, 'long', 'en US')).toBe(value);
		expect(date('2026-07-24', 'long', 'en-US')).toBe('July 24, 2026');
		expect(constructor).toHaveBeenCalledTimes(3);
	});

	it('never keys the date cache on a non-string locale', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('DateTimeFormat');
		const { date } = await import('../client-runtime/formatters/builtins.js');
		const list = ['en-US'];

		// Intl accepts a locale LIST, but a Map keyed by it can only ever be hit by
		// the SAME array instance — a call site that builds one inline would miss and
		// insert on every render, growing the cache without bound. So a list formats
		// correctly and constructs per call instead. (The cache itself is module-
		// private, so the construction count is the observable proxy for its size:
		// keying on the list would make the repeated `list` calls hit.)
		expect(date('2026-07-24', 'long', list)).toBe('July 24, 2026');
		expect(date('2026-01-01', 'long', list)).toBe('January 1, 2026');
		expect(date('2026-07-24', 'long', ['en-US'])).toBe('July 24, 2026');
		expect(constructor).toHaveBeenCalledTimes(3);

		// And they leave the string cache alone: one construction, then hits.
		expect(date('2026-07-24', 'long', 'en-US')).toBe('July 24, 2026');
		expect(date('2026-01-01', 'long', 'en-US')).toBe('January 1, 2026');
		expect(constructor).toHaveBeenCalledTimes(4);
	});

	it('reuses the RelativeTimeFormat used by timeago', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('RelativeTimeFormat');
		const { timeago } = await import('../client-runtime/formatters/builtins.js');
		const now = Date.now();

		expect(timeago(new Date(now - 2 * 3600 * 1000))).toMatch(/2 hours ago/);
		expect(timeago(new Date(now - 3 * 60 * 1000))).toMatch(/3 minutes ago/);
		expect(constructor).toHaveBeenCalledTimes(1);
	});

	it('reuses the DateTimeFormat for an in_timezone target', async () => {
		vi.resetModules();
		const constructor = spyOnIntlConstructor('DateTimeFormat');
		const { in_timezone } = await import('../client-runtime/formatters/builtins.js');

		const first = in_timezone('2026-07-24T00:00:00Z', 'Asia/Tokyo');
		const second = in_timezone('2026-07-24T01:00:00Z', 'Asia/Tokyo');
		expect([first.getFullYear(), first.getMonth(), first.getDate(), first.getHours()]).toEqual([2026, 6, 24, 9]);
		expect([second.getFullYear(), second.getMonth(), second.getDate(), second.getHours()]).toEqual([2026, 6, 24, 10]);
		expect(constructor).toHaveBeenCalledTimes(1);
	});
});

describe('FormatterRegistry', () => {
	it('keeps the compiler allowlist in sync with the full built-in manifest', () => {
		// builtins.json is in declaration order; the manifest DEFAULT is now the
		// ./builtins.js module namespace object (whose Object.keys sorts keys
		// alphabetically), so compare as SETS — the invariant this guards is the
		// same NAME set, not iteration order (D31).
		expect([...builtinNames].sort()).toEqual(Object.keys(fullBuiltins).sort());
	});

	it('exposes the raw function map compiled render code needs', () => {
		// Compiled code calls __formatters.escape(...) and the guarded form
		// (__formatters.name || __formatters.__missing('name'))(...) directly (D43).
		expect(typeof f.escape).toBe('function');
		// __missing is a FACTORY (D43): it takes the offending name and returns a
		// pass-through formatter.
		expect(typeof f.__missing).toBe('function');
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const passthrough = f.__missing('zzznope');
		expect(typeof passthrough).toBe('function');
		expect(passthrough('untouched')).toBe('untouched');
		spy.mockRestore();
	});

	describe('registration validation', () => {
		it('rejects empty and non-string formatter names', () => {
			const reg = new FormatterRegistry();
			const formatter = (value) => value;

			expect(() => reg.register('', formatter)).toThrow(
				'[puzzle] formatter name must be a non-empty string'
			);
			expect(() => reg.register(null, formatter)).toThrow(
				'[puzzle] formatter name must be a non-empty string'
			);
		});

		it('rejects non-function values from direct and config registration', () => {
			const reg = new FormatterRegistry();

			expect(() => reg.register('price', 'not-a-function')).toThrow(
				'[puzzle] formatter "price" must be a function (got string)'
			);
			expect(() => makeFormatterRegistry({ price: null })).toThrow(
				'[puzzle] formatter "price" must be a function (got object)'
			);
		});

		it('registers a valid formatter function', () => {
			const reg = new FormatterRegistry();
			reg.register('double', (value) => value * 2);

			expect(reg.get('double')(4)).toBe(8);
		});

		it('keeps missing-name pass-through and did-you-mean behavior', () => {
			const reg = new FormatterRegistry();
			reg.register('decorate', (value) => `**${value}**`);
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(reg.get('decorat')('plain')).toBe('plain');
			expect(spy).toHaveBeenCalledWith(
				'[puzzle] unknown formatter "decorat" — value passed through unchanged (did you mean "decorate"?)'
			);
			spy.mockRestore();
		});
	});

	it('escape is an identity on text: the page shows the characters (D174 F8)', () => {
		// A text interpolation already escapes, so escaping again printed the
		// entities (`&lt;b&gt;`) instead of the characters.
		expect(f.escape('<b>"a" & \'b\'</b>')).toBe('<b>"a" & \'b\'</b>');
	});

	it('renders null and undefined as empty string, not literals', () => {
		expect(f.escape(null)).toBe('');
		expect(f.escape(undefined)).toBe('');
		expect(f.capitalize(null)).toBe('');
		expect(f.trim(undefined)).toBe('');
	});

	it('raw passes content through', () => {
		expect(f.raw('<br>')).toBe('<br>');
	});

	describe('string formatters', () => {
		it('capitalize upper-cases the first character and leaves the rest (D174 F1)', () => {
			expect(f.capitalize('hELLO')).toBe('HELLO');
			expect(f.capitalize('iPhone')).toBe('IPhone');
			expect(f.capitalize('élan')).toBe('Élan');
			// The first CODE POINT: an astral first character is not torn in half.
			expect(f.capitalize('𐐨x')).toBe('𐐀x');
			// The old behavior is one chain away.
			expect(f.capitalize(f.downcase('hELLO'))).toBe('Hello');
		});

		it('truncate counts code points and never exceeds the length (D174 F25)', () => {
			expect(f.truncate('hello world', 8)).toBe('hello w…');
			expect(f.truncate('short', 100)).toBe('short');
			expect(f.truncate('😀😀😀😀', 3)).toBe('😀😀…');
			expect(f.truncate('😀😀😀', 3)).toBe('😀😀😀');
			expect(f.truncate('hello', 3, '.....')).toBe('...');
			expect(f.truncate('hello', -2)).toBe('');
			expect(f.truncate('x'.repeat(120))).toBe('x'.repeat(99) + '…');
		});

		it('replace replaces ALL occurrences for string search (Liquid semantics)', () => {
			expect(f.replace('a-b-c', '-', '+')).toBe('a+b+c');
			expect(f.replace('a-b-c', '-')).toBe('abc');
			// A RegExp search stays a PuzzleKit addition.
			expect(f.replace('a1b22', /\d+/g, '#')).toBe('a#b#');
		});

		it('split: code points for an empty separator, an empty list for a missing value (D174 F22)', () => {
			expect(f.split('a,b')).toEqual(['a', 'b']);
			expect(f.split('a😀', '')).toEqual(['a', '😀']);
			expect(f.split(null)).toEqual([]);
			expect(f.split(undefined, ' ')).toEqual([]);
		});

		it('strip_html is quote-aware and leaves a bare < alone (D174 F23)', () => {
			expect(f.strip_html('<p>Hi <b>there</b></p>')).toBe('Hi there');
			expect(f.strip_html('a < b and 1<2')).toBe('a < b and 1<2');
			expect(f.strip_html('<a title="x>y" data-q=\'>\'>link</a>')).toBe('link');
			expect(f.strip_html('x<!-- a <b> comment -->y')).toBe('xy');
			expect(f.strip_html('open <!-- never closed')).toBe('open <!-- never closed');
			expect(f.strip_html('Tom &amp; Jerry')).toBe('Tom &amp; Jerry');
		});

		it('strip_newlines removes CR and LF (D174 F24)', () => {
			expect(f.strip_newlines('a\r\nb\nc\rd')).toBe('abcd');
		});

		it('pluralize prints the count and the word (D174 F15)', () => {
			expect(f.pluralize(1, 'todo')).toBe('1 todo');
			expect(f.pluralize(3, 'todo')).toBe('3 todos');
			expect(f.pluralize(0, 'todo')).toBe('0 todos');
			expect(f.pluralize(2, 'person', 'people')).toBe('2 people');
			expect(f.pluralize(1, 'man', 'men')).toBe('1 man');
			// The count is formatted in the viewer's locale.
			expect(f.pluralize(1234, 'comment')).toBe(`${new Intl.NumberFormat().format(1234)} comments`);
			// A missing count prints nothing.
			expect(f.pluralize(undefined, 'todo')).toBe('');
			expect(f.pluralize(null, 'todo')).toBe('');
		});
	});

	describe('number formatters', () => {
		it('round returns a number, preserving numeric chaining', () => {
			expect(f.round(3.7)).toBe(4);
			expect(f.round(3.14159, 2)).toBe(3.14);
			expect(f.times(f.round(2.6), 2)).toBe(6);
		});

		it('round goes half away from zero on the DECIMAL value (D174 F19)', () => {
			expect(f.round(1.005, 2)).toBe(1.01);
			expect(f.round(2.5)).toBe(3);
			expect(f.round(-2.5)).toBe(-3);
			expect(f.round(0.5)).toBe(1);
			expect(f.round(1.45, 1)).toBe(1.5);
			// Tiny and huge values survive String()'s exponent form.
			expect(f.round(1.5e-7, 7)).toBe(2e-7);
			expect(f.round(1e21)).toBe(1e21);
		});

		it('round takes negative places for tens and hundreds (D174 F19)', () => {
			expect(f.round(5, -1)).toBe(10);
			expect(f.round(1234.5, -2)).toBe(1200);
			expect(f.round(1250, -2)).toBe(1300);
			expect(f.round(-1250, -2)).toBe(-1300);
		});

		it('round fails soft on a bad places argument', () => {
			for (const bad of [1e9, Infinity, -Infinity, NaN, 'abc', {}, [1, 2]]) {
				expect(() => f.round(3.14159, bad)).not.toThrow();
			}
			expect(f.round(3.14159, NaN)).toBe(3); // → default 0
			expect(f.round(3.14159, 'abc')).toBe(3);
			expect(f.round(3.14159, 101)).toBe(3.14159); // clamped to 100
			// A numeric STRING is coerced (integer-truncated), matching a number.
			expect(f.round(3.14159, '2')).toBe(3.14);
			expect(f.round(3.14159, 2.9)).toBe(3.14);
		});

		it('divided_by and modulo give a missing value for a zero divisor (D174 F7, F11)', () => {
			expect(f.divided_by(7, 2)).toBe(3.5);
			expect(f.divided_by(1, 0)).toBeUndefined();
			expect(f.modulo(-7, 3)).toBe(-1);
			expect(f.modulo(7, 0)).toBeUndefined();
			// The missing value flows on: the next formatter sees it, not Infinity.
			expect(f.plus(f.divided_by(1, 0), 1)).toBeNaN();
			expect(f.escape(f.divided_by(1, 0))).toBe('');
		});

		it('currency groups thousands and puts the sign before the symbol (D174 F3)', () => {
			expect(f.currency(9.5)).toBe('$9.50');
			expect(f.currency(9.5, '€', 0)).toBe('€10');
			expect(f.currency(1234567.891)).toBe('$1,234,567.89');
			expect(f.currency(-1234.5)).toBe('-$1,234.50');
			expect(f.currency(1.005)).toBe('$1.01');
			// An amount that rounds to zero carries no sign.
			expect(f.currency(-0.001)).toBe('$0.00');
			// A `$` in the symbol is inserted literally.
			expect(f.currency(1000, '$$')).toBe('$$1,000.00');
			// A missing amount prints nothing.
			expect(f.currency(null)).toBe('');
			expect(f.currency('abc')).toBe('abc');
		});

		it('percentage takes the number as written (D174 F14)', () => {
			expect(f.percentage(12.5, 1)).toBe('12.5%');
			expect(f.percentage(12.5)).toBe('13%');
			expect(f.percentage(0.256)).toBe('0%');
			// A ratio is one times(100) away.
			expect(f.percentage(f.times(0.256, 100), 1)).toBe('25.6%');
		});

		it('places argument fails soft for currency and percentage', () => {
			for (const bad of [-5, 1e9, Infinity, -Infinity, NaN, 'abc', {}, [1, 2]]) {
				expect(() => f.currency(9.5, '$', bad)).not.toThrow();
				expect(() => f.percentage(25.6, bad)).not.toThrow();
			}
			expect(f.currency(9.5, '$', Infinity)).toBe('$9.50'); // → default 2
			expect(f.currency(9.5, '$', '0')).toBe('$10'); // → 0
			expect(f.currency(9.5, '$', -5)).toBe('$10'); // → clamped to 0
			expect(f.percentage(25.6, NaN)).toBe('26%'); // → default 0
			expect(f.percentage(25.6, '1')).toBe('25.6%'); // → 1
		});

		it('number_with_delimiter follows the viewer locale by default', () => {
			const expected = (n, digits) =>
				new Intl.NumberFormat(undefined, {
					minimumFractionDigits: digits,
					maximumFractionDigits: digits,
				}).format(n);
			expect(f.number_with_delimiter(1234567)).toBe(expected(1234567, 0));
			// The decimals print as given — never Intl's default three-digit rounding.
			expect(f.number_with_delimiter(1234.5678)).toBe(expected(1234.5678, 4));
			expect(f.number_with_delimiter(1234.5)).toBe(expected(1234.5, 1));
			expect(f.number_with_delimiter(null)).toBe('');
		});

		it('number_with_delimiter with an explicit delimiter forces it and keeps "." decimals', () => {
			expect(f.number_with_delimiter(1234567, ',')).toBe('1,234,567');
			expect(f.number_with_delimiter(1234.56, ',')).toBe('1,234.56');
			expect(f.number_with_delimiter(1234567, '.')).toBe('1.234.567');
			expect(f.number_with_delimiter(-1234567.5, ' ')).toBe('-1 234 567.5');
		});

		it('compact_number shortens with a localized suffix', () => {
			const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });
			for (const n of [847, 1234, 45000, 3400000]) {
				expect(f.compact_number(n)).toBe(compact.format(n));
			}
			expect(f.compact_number(null)).toBe('');
			expect(f.compact_number('abc')).toBe('abc');
		});
	});

	describe('value formatters', () => {
		it('default replaces missing, false, empty text and an empty list — not 0', () => {
			for (const empty of [null, undefined, false, '', []]) {
				expect(f.default(empty, 'n/a')).toBe('n/a');
			}
			for (const kept of [0, 'x', true, [0], {}]) {
				expect(f.default(kept, 'n/a')).toBe(kept);
			}
		});

		it('join / size', () => {
			expect(f.join(['a', 'b'])).toBe('a, b');
			expect(f.join(['a', 'b'], ' | ')).toBe('a | b');
			expect(f.size([1, 2, 3])).toBe(3);
			expect(f.size('abcd')).toBe(4);
		});

		it('size counts code points, keys, and 0 for anything else (D174 F20)', () => {
			expect(f.size('a😀')).toBe(2);
			expect(f.size({ a: 1, b: 2 })).toBe(2);
			for (const other of [null, undefined, 5, true]) expect(f.size(other)).toBe(0);
		});

		it('json sorts keys by code point and prints null for missing and non-finite (D174 F9)', () => {
			expect(f.json({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
			// Integer-like keys sort as text, not first as a JS object enumerates them.
			expect(f.json({ b: 1, 9: 2, 10: 3 })).toBe('{"10":3,"9":2,"b":1}');
			// Code-point order puts an astral key after U+FFFD (UTF-16 order would not).
			expect(f.json({ '😀': 1, '�': 2 })).toBe('{"�":2,"😀":1}');
			expect(f.json(undefined)).toBe('null');
			expect(f.json(NaN)).toBe('null');
			expect(f.json([1, undefined, Infinity, () => 1])).toBe('[1,null,null,null]');
			expect(f.json({ a: undefined, f() {} })).toBe('{"a":null}');
			expect(f.json('<b>')).toBe('"<b>"');
			expect(f.json(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
			const cycle = { a: 1 };
			cycle.self = cycle;
			expect(f.json(cycle)).toBe('{"a":1,"self":null}');
		});
	});

	describe('removed list formatters (D174)', () => {
		it('are gone from the built-in set', () => {
			for (const name of ['sort', 'where', 'map', 'uniq', 'reverse', 'compact', 'first', 'last', 'noescape']) {
				expect(Object.hasOwn(fullBuiltins, name)).toBe(false);
				expect(builtinNames).not.toContain(name);
				expect(f[name]).toBeUndefined();
			}
		});
	});

	describe('date formatters', () => {
		it('date presets format and invalid input passes through', () => {
			expect(f.date('not a date')).toBe('not a date');
		});

		it('short / medium / long presets per formatter, medium by default (D174 F4–F6)', () => {
			const at = new Date(2026, 8, 24, 15, 4, 5);
			expect(f.date(at, 'short', 'en-US')).toBe('9/24/26');
			expect(f.date(at, 'medium', 'en-US')).toBe('Sep 24, 2026');
			expect(f.date(at, 'long', 'en-US')).toBe('September 24, 2026');
			expect(f.time(at, 'short', 'en-US')).toBe('3:04 PM');
			expect(f.time(at, 'medium', 'en-US')).toBe('3:04:05 PM');
			// long adds the zone name, whatever zone the suite runs in.
			expect(f.time(at, 'long', 'en-US')).toMatch(/^3:04:05 PM \S+/);
			expect(f.datetime(at, 'short', 'en-US')).toBe('9/24/26, 3:04 PM');
			expect(f.datetime(at, 'medium', 'en-US')).toBe('Sep 24, 2026, 3:04:05 PM');
			// No preset means medium, in the viewer's locale.
			const medium = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
			expect(f.date(at)).toBe(medium.format(at));
		});

		it('iso presets are RFC 3339 in the viewer zone', () => {
			const at = new Date(2026, 8, 24, 15, 4, 5);
			const offset = -at.getTimezoneOffset();
			const pad = (n) => String(n).padStart(2, '0');
			const zone =
				offset === 0
					? 'Z'
					: `${offset < 0 ? '-' : '+'}${pad(Math.trunc(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
			expect(f.date(at, 'iso')).toBe('2026-09-24');
			expect(f.time(at, 'iso')).toBe(`15:04:05${zone}`);
			expect(f.datetime(at, 'iso')).toBe(`2026-09-24T15:04:05${zone}`);
		});

		it('an unknown preset is a development error, reported once, and renders as medium', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const at = new Date(2026, 8, 24, 15, 4, 5);
			expect(f.date(at, 'fancy', 'en-US')).toBe('Sep 24, 2026');
			expect(f.date(at, 'fancy', 'en-US')).toBe('Sep 24, 2026');
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0][0]).toContain('unknown date preset "fancy"');
			// The retired preset names point at the formatter that replaced them.
			expect(f.date(at, 'datetime', 'en-US')).toBe('Sep 24, 2026');
			expect(spy.mock.calls[1][0]).toContain('use the datetime formatter instead');
			spy.mockRestore();
		});

		it('date/time formatters fail soft on invalid date, locale, or time zone', () => {
			// Invalid date → the raw value passes through (existing behavior).
			expect(f.date('total garbage')).toBe('total garbage');
			expect(f.time('total garbage')).toBe('total garbage');
			expect(f.datetime('total garbage')).toBe('total garbage');

			// Invalid locale throws RangeError at DateTimeFormat construction — must
			// fall back to the raw value instead of crashing the render.
			expect(() => f.date('2026-01-15T12:00:00Z', 'long', 'en US')).not.toThrow();
			expect(f.date('2026-01-15T12:00:00Z', 'long', 'en US')).toBe('2026-01-15T12:00:00Z');
			expect(() => f.datetime('2026-01-15T12:00:00Z', 'medium', 'not-a-locale-!!')).not.toThrow();

			// Invalid time-zone identifier throws RangeError — in_timezone must fail
			// soft (to the un-shifted date) rather than throw.
			expect(() => f.in_timezone('2026-01-15T12:00:00Z', 'Not/AZone')).not.toThrow();
			expect(f.in_timezone('2026-01-15T12:00:00Z', 'Not/AZone')).toBeInstanceOf(Date);
			expect(() => f.in_timezone('total garbage', 'UTC')).not.toThrow();

			// Valid inputs are byte-identical (a real tz still shifts the date).
			expect(f.in_timezone('2026-01-15T12:00:00Z', 'America/New_York')).toBeInstanceOf(Date);
		});

		it('timeago produces relative phrasing', () => {
			const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
			expect(f.timeago(twoHoursAgo)).toMatch(/2 hours ago/);
			expect(f.timeago('nonsense')).toBe('nonsense');
		});

		it('timeago always returns a string for a valid date (never undefined)', () => {
			// The seconds branch handles "now"; the explicit final return backstops it.
			expect(typeof f.timeago(new Date())).toBe('string');
			expect(typeof f.timeago(new Date(Date.now() - 5000))).toBe('string');
		});

		// `new Date(v)` coerces with ToNumber, and ToNumber(null|false|'') is 0 —
		// so an unset `todo.completedAt` used to render the Unix epoch
		// ("12/31/1969", "56 years ago") while undefined correctly rendered nothing.
		it('an ABSENT value renders empty, never the Unix epoch', () => {
			for (const empty of [null, undefined, '', false, true]) {
				expect(f.date(empty)).toBe('');
				expect(f.date(empty, 'long', 'en-US')).toBe('');
				expect(f.date(empty, 'iso')).toBe('');
				expect(f.time(empty)).toBe('');
				expect(f.datetime(empty)).toBe('');
				expect(f.timeago(empty)).toBe('');
			}
		});

		it('in_timezone renders an absent value empty, like every other date formatter', () => {
			// It used to return the Invalid Date `undefined` produced. That reads as
			// harmless until it is piped: in_timezone is a mid-pipeline stage, and
			// `{ x | in_timezone:'UTC' | date }` handed `date` a Date object — which
			// noDate() does not consider absent — so an unset field rendered the
			// literal text "Invalid Date" instead of nothing.
			for (const empty of [null, undefined, '', false, true]) {
				expect(f.in_timezone(empty, 'America/New_York')).toBe('');
				expect(f.date(f.in_timezone(empty, 'America/New_York'))).toBe('');
				expect(f.datetime(f.in_timezone(empty, 'America/New_York'))).toBe('');
				expect(f.timeago(f.in_timezone(empty, 'America/New_York'))).toBe('');
			}
		});

		it('numeric 0 stays a legitimate epoch timestamp', () => {
			// The one falsy input that IS a date. `0` and `'0'` both name the epoch.
			expect(f.date(0, 'iso')).toBe(f.date(new Date(0), 'iso'));
			expect(f.datetime(0, 'iso')).toMatch(/^19(70-01-01|69-12-31)T/);
			expect(f.date(0, 'long', 'en-US')).not.toBe('');
			expect(f.timeago(0)).not.toBe('');
			expect(Number.isNaN(f.in_timezone(0, 'UTC').getTime())).toBe(false);
		});
	});

	// Every assertion here must hold in ANY machine time zone — that IS the fix.
	describe('date/time formatters — calendar dates display as written (D114)', () => {
		const DATE_OPTS = { dateStyle: 'short' };
		const fmt = (d) => new Intl.DateTimeFormat('en-US', DATE_OPTS).format(d);

		it('renders a bare YYYY-MM-DD as the day written, not UTC-shifted', () => {
			// The regression: date-only strings parse as UTC midnight per the ES spec,
			// so before D114 everyone west of UTC saw 07/23/2026 here.
			expect(f.date('2026-07-24', 'short', 'en-US')).toBe('7/24/26');
			expect(f.date('2026-01-01', 'long', 'en-US')).toBe('January 1, 2026');
		});

		it('datetime on a calendar date lands on local midnight of that day', () => {
			const out = f.datetime('2026-07-24', 'short', 'en-US');
			expect(out).toContain('7/24/26');
			expect(out).toContain('12:00');
		});

		it('the iso preset is idempotent for a calendar date', () => {
			// The ISO form of a calendar date is itself; toISOString() on its local
			// midnight would emit a time-zone-dependent instant instead.
			expect(f.date('2026-07-24', 'iso')).toBe('2026-07-24');
			expect(f.date('2026-01-01', 'iso')).toBe('2026-01-01');
			expect(f.datetime('2026-07-24', 'iso')).toBe('2026-07-24');
			expect(f.time('2026-07-24', 'iso')).toBe('2026-07-24');
		});

		it('leaves full ISO datetimes, Date instances, and timestamps untouched', () => {
			expect(f.datetime('2026-07-24T12:00:00Z', 'iso')).toMatch(/^2026-07-2[45]T\d\d:\d\d:00(Z|[+-]\d\d:\d\d)$/);
			// A Date/number formats exactly as the pre-D114 `new Date(v)` path did.
			const inst = new Date(2026, 6, 24, 15, 30);
			expect(f.date(inst, 'short', 'en-US')).toBe(fmt(new Date(inst)));
			expect(f.date(inst.getTime(), 'short', 'en-US')).toBe(fmt(new Date(inst.getTime())));
			expect(f.date('2026-07-24T12:00:00Z', 'short', 'en-US')).toBe(fmt(new Date('2026-07-24T12:00:00Z')));
		});

		it('fails soft to the raw value on any invalid calendar components', () => {
			// A month outside 01-12 fails the ES date grammar → Invalid Date → raw.
			expect(f.date('2026-13-01')).toBe('2026-13-01');
			// "2026-02-31" is spec-LEGAL (DD ≤ 31) and would roll into March —
			// TZ-dependently. D114's round-trip check coerces it to Invalid Date
			// instead, so a nonexistent day fails soft exactly like a nonexistent month.
			expect(f.date('2026-02-31', 'short', 'en-US')).toBe('2026-02-31');
			expect(f.timeago('2026-02-31')).toBe('2026-02-31');
		});

		it('does not claim non-strict date-only forms', () => {
			// "2026-7-24" misses the leading zero, so the calendar rule never applies;
			// it stays on whatever the engine's fallback parser does, without throwing.
			expect(() => f.date('2026-7-24', 'short', 'en-US')).not.toThrow();
			expect(() => f.date('2026-7-24', 'iso')).not.toThrow();
		});

		it('timeago reads a calendar date as local midnight too', () => {
			expect(f.timeago('2026-07-24')).toBe(f.timeago(new Date(2026, 6, 24).getTime()));
		});

		it('in_timezone returns a calendar date UNSHIFTED, whatever the target zone', () => {
			// A bare YYYY-MM-DD names a day, not an instant, so there is nothing for
			// in_timezone to re-express — shifting it would move the day and make the
			// rendered date depend on the VIEWER's zone, the exact defect D114 removed
			// from date/timeago. NOTE: the earlier form of this test compared against a
			// locally built Date on both sides, so both moved with the process zone and
			// it passed under every TZ even while the output was wrong. Absolute,
			// multi-process-zone coverage lives in tests/formatters-timezone.test.js.
			const midnight = new Date(2026, 6, 24).getTime();
			expect(f.in_timezone('2026-07-24', 'UTC').getTime()).toBe(midnight);
			expect(f.in_timezone('2026-07-24', 'Asia/Tokyo').getTime()).toBe(midnight);
			expect(f.in_timezone('2026-07-24', 'Pacific/Honolulu').getTime()).toBe(midnight);
			expect(f.date(f.in_timezone('2026-07-24', 'America/New_York'), 'short', 'en-US')).toBe('7/24/26');
			expect(f.date(f.in_timezone('2026-03-01', 'America/New_York'), 'short', 'en-US')).toBe('3/1/26');
			expect(f.date(f.in_timezone('2026-07-24', 'Asia/Tokyo'), 'short', 'en-US')).toBe('7/24/26');
		});

		it('in_timezone still re-expresses a real instant in the target zone', () => {
			// The other half of the contract: an instant DOES move. UTC midnight is
			// 09:00 the same morning in Tokyo. Assert wall-clock components, which are
			// process-zone-stable, rather than getTime(), which is not.
			const tokyo = f.in_timezone('2026-07-24T00:00:00Z', 'Asia/Tokyo');
			expect([tokyo.getFullYear(), tokyo.getMonth(), tokyo.getDate(), tokyo.getHours()]).toEqual([2026, 6, 24, 9]);
			// Date instances and timestamps are instants too, never calendar dates.
			const fromDate = f.in_timezone(new Date('2026-07-24T00:00:00Z'), 'Asia/Tokyo');
			expect([fromDate.getDate(), fromDate.getHours()]).toEqual([24, 9]);
			const la = f.in_timezone('2026-07-24T00:00:00Z', 'America/Los_Angeles');
			expect([la.getDate(), la.getHours()]).toEqual([23, 17]);
		});
	});

	// Unknown-formatter typo-guard (v1.12, D43): warn once, pass through, suggest.
	describe('unknown-formatter guard (D43)', () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('warns exactly once per unknown name and passes the value through', () => {
			const reg = new FormatterRegistry();
			const missing = reg.getAll().__missing;
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

			// Same name twice → one log; the returned formatter is a pass-through.
			expect(missing('captialize')('Bob')).toBe('Bob');
			expect(missing('captialize')(42)).toBe(42);
			expect(spy).toHaveBeenCalledTimes(1);
		});

		it('offers a did-you-mean for a close typo (edit distance ≤ 2)', () => {
			const reg = new FormatterRegistry();
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			reg.getAll().__missing('captialize');
			expect(spy).toHaveBeenCalledTimes(1);
			const msg = spy.mock.calls[0][0];
			expect(msg).toContain('unknown formatter "captialize"');
			expect(msg).toContain('value passed through unchanged');
			expect(msg).toContain('did you mean "capitalize"?');
		});

		it('omits the suggestion when nothing is within edit distance 2', () => {
			const reg = new FormatterRegistry();
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			reg.getAll().__missing('xqzwvblfar');
			expect(spy).toHaveBeenCalledTimes(1);
			const msg = spy.mock.calls[0][0];
			expect(msg).toContain('unknown formatter "xqzwvblfar"');
			expect(msg).not.toContain('did you mean');
		});

		it('get() returns a callable pass-through for unknown names', () => {
			const reg = new FormatterRegistry();
			const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const fn = reg.get('nopeformatter');
			expect(typeof fn).toBe('function');
			expect(fn('through')).toBe('through');
			// get() still returns the real formatter for a known name.
			expect(reg.get('capitalize')('hi')).toBe('Hi');
		});
	});

	it('app-registered formatters override built-ins by name', () => {
		const reg = new FormatterRegistry();
		reg.register('pluralize', () => 'custom');
		expect(reg.getAll().pluralize(1, 'x')).toBe('custom');
	});
});

describe('the standard set (D174)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('is the 34 standard names, all built in; timeago and in_timezone are PuzzleKit-only', () => {
		expect(STANDARD_FORMATTERS).toHaveLength(34);
		expect(new Set(STANDARD_FORMATTERS).size).toBe(34);
		for (const name of STANDARD_FORMATTERS) expect(builtinNames).toContain(name);
		expect(builtinNames.filter((name) => !STANDARD_FORMATTERS.includes(name)).sort()).toEqual([
			'in_timezone',
			'timeago',
		]);
	});

	it('warns in development when an app formatter shadows a standard name, and the app wins', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const registry = makeFormatterRegistry({ pluralize: () => 'mine', plural: () => 'other' });
		expect(registry.getAll().pluralize(2, 'x')).toBe('mine');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('app formatter "pluralize" shadows the standard formatter');
	});

	it('does not warn for PuzzleKit-only names or the app-supplied link', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		makeFormatterRegistry({ timeago: () => 'now', in_timezone: (v) => v, link: (v) => v, compact: (v) => v });
		expect(warn).not.toHaveBeenCalled();
	});

	it('names the replacement when a template uses a removed formatter', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const missing = new FormatterRegistry().getAll().__missing;
		const hints = {
			sort: 'data()',
			where: 'data()',
			map: 'data()',
			uniq: 'data()',
			reverse: 'data()',
			compact: 'compact_number',
			first: 'items[0]',
			last: 'items.at(-1)',
			noescape: 'use raw',
		};
		for (const [name, hint] of Object.entries(hints)) {
			// Still a pass-through, like any unknown name (D43).
			expect(missing(name)('value')).toBe('value');
			const message = error.mock.calls.at(-1)[0];
			expect(message).toContain(`formatter "${name}" was removed`);
			expect(message).toContain(hint);
		}
		expect(error).toHaveBeenCalledTimes(Object.keys(hints).length);
	});
});

// The shared conformance table: the same cases Sites' Go tests run. JSON null is
// the missing value in both directions. A case with a `zone` must render in that
// zone, and Node only reads TZ at startup, so those run in one child process per
// zone (the same mechanism as tests/formatters-timezone.test.js).
describe('standard formatter conformance table (D174)', () => {
	const fromJSON = (v) => (v === null ? undefined : v);
	const toJSONValue = (v) => (v === undefined ? null : v);
	const local = conformance.cases.filter((c) => !c.zone);
	const zoned = conformance.cases.filter((c) => c.zone);

	it('covers every identical-output standard name except the markup pair (group e)', () => {
		const covered = new Set(conformance.cases.map((c) => c.name));
		const localeRendered = ['date', 'time', 'datetime', 'number_with_delimiter', 'compact_number', 'pluralize'];
		for (const name of STANDARD_FORMATTERS) {
			if (localeRendered.includes(name) || name === 'raw' || name === 'newline_to_br') continue;
			expect(covered.has(name), name).toBe(true);
		}
		for (const name of covered) expect(STANDARD_FORMATTERS).toContain(name);
	});

	it.each(local.map((c) => [`${c.name}(${JSON.stringify(c.input)}, ${JSON.stringify(c.args)})`, c]))(
		'%s',
		(_label, c) => {
			const out = f[c.name](fromJSON(c.input), ...c.args.map(fromJSON));
			expect(toJSONValue(out)).toEqual(c.expect);
		},
	);

	const zones = [...new Set(zoned.map((c) => c.zone))];
	it.each(zones)('zone %s', (zone) => {
		const cases = zoned.filter((c) => c.zone === zone);
		const builtins = new URL('../client-runtime/formatters/builtins.js', import.meta.url).href;
		const script = `
import * as f from ${JSON.stringify(builtins)};
const cases = ${JSON.stringify(cases)};
process.stdout.write(JSON.stringify(cases.map((c) => f[c.name](c.input ?? undefined, ...c.args) ?? null)));
`;
		const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
			cwd: fileURLToPath(new URL('..', import.meta.url)),
			env: { ...process.env, TZ: zone },
			encoding: 'utf8',
		});
		expect(JSON.parse(out)).toEqual(cases.map((c) => c.expect));
	});
});

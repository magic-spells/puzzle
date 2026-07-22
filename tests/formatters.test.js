import { describe, it, expect, vi, afterEach } from 'vitest';
import { FormatterRegistry } from '../client-runtime/formatters.js';
import fullBuiltins from '../client-runtime/formatters/builtins-all.js';
import builtinNames from '../client-runtime/formatters/builtins.json';

const f = new FormatterRegistry().getAll();

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

	it('escapes HTML by default', () => {
		expect(f.escape('<b>"a" & \'b\'</b>')).toBe('&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
	});

	it('renders null and undefined as empty string, not literals', () => {
		expect(f.escape(null)).toBe('');
		expect(f.escape(undefined)).toBe('');
		expect(f.capitalize(null)).toBe('');
		expect(f.trim(undefined)).toBe('');
	});

	it('raw/noescape pass content through for the skip-escape path', () => {
		expect(f.raw('<br>')).toBe('<br>');
		expect(f.noescape('<br>')).toBe('<br>');
	});

	describe('string formatters', () => {
		it('capitalize', () => {
			expect(f.capitalize('hELLO')).toBe('Hello');
		});

		it('truncate honors length and ellipsis', () => {
			expect(f.truncate('hello world', 8)).toBe('hello w…');
			expect(f.truncate('short', 100)).toBe('short');
		});

		it('replace replaces ALL occurrences for string search (Liquid semantics)', () => {
			expect(f.replace('a-b-c', '-', '+')).toBe('a+b+c');
		});

		it('pluralize', () => {
			expect(f.pluralize(1, 'todo')).toBe('todo');
			expect(f.pluralize(3, 'todo')).toBe('todos');
			expect(f.pluralize(2, 'person', 'people')).toBe('people');
		});
	});

	describe('number formatters', () => {
		it('round returns a number, preserving numeric chaining', () => {
			expect(f.round(3.7)).toBe(4);
			expect(f.round(3.14159, 2)).toBe(3.14);
			expect(f.times(f.round(2.6), 2)).toBe(6);
		});

		it('round clamps a negative decimals instead of throwing (fail-soft)', () => {
			// toFixed(-1) would throw RangeError; clamp to 0 decimals like a whole round.
			expect(() => f.round(5, -1)).not.toThrow();
			expect(f.round(5, -1)).toBe(5);
			expect(f.round(3.7, -2)).toBe(4);
		});

		it('round clamps an oversized decimals instead of throwing (fail-soft)', () => {
			// toFixed(101) would throw RangeError; clamp to toFixed's max of 100.
			expect(() => f.round(3.14159, 101)).not.toThrow();
			expect(f.round(3.14159, 101)).toBe(3.14159);
			expect(f.round(3.14159, 100)).toBe(3.14159);
			expect(f.round(2.5, 1e9)).toBe(2.5);
		});

		it('currency and percentage', () => {
			expect(f.currency(9.5)).toBe('$9.50');
			expect(f.currency(9.5, '€', 0)).toBe('€10');
			expect(f.percentage(0.256)).toBe('26%');
			expect(f.percentage(0.256, 1)).toBe('25.6%');
		});

		it('decimals argument fails soft across round/currency/percentage', () => {
			// A bad `decimals` — negative, oversized, Infinity, NaN, or a non-numeric
			// string — must never throw RangeError; it normalizes (integer-coerce +
			// clamp 0–100, else the formatter default) via the shared helper.
			for (const bad of [-5, 1e9, Infinity, -Infinity, NaN, 'abc', {}, [1, 2]]) {
				expect(() => f.round(3.14159, bad)).not.toThrow();
				expect(() => f.currency(9.5, '$', bad)).not.toThrow();
				expect(() => f.percentage(0.256, bad)).not.toThrow();
			}
			// Negative/oversized/non-finite fall back correctly.
			expect(f.round(3.14159, Infinity)).toBe(3);   // → 0 decimals
			expect(f.round(3.14159, NaN)).toBe(3);        // → default 0
			expect(f.round(3.14159, -2)).toBe(3);         // → 0
			expect(f.round(3.14159, 101)).toBe(3.14159);  // → 100
			// A numeric STRING is coerced (integer-truncated), matching a number.
			expect(f.round(3.14159, '2')).toBe(3.14);
			expect(f.round(3.14159, 2.9)).toBe(3.14);     // truncated to 2
			expect(f.currency(9.5, '$', Infinity)).toBe('$9.50'); // → default 2
			expect(f.currency(9.5, '$', '0')).toBe('$10');        // → 0
			expect(f.percentage(0.256, NaN)).toBe('26%');         // → default 0
			expect(f.percentage(0.256, '1')).toBe('25.6%');       // → 1
		});

		it('number_with_delimiter groups thousands and keeps decimals', () => {
			expect(f.number_with_delimiter(1234567)).toBe('1,234,567');
			expect(f.number_with_delimiter(1234.56)).toBe('1,234.56');
			expect(f.number_with_delimiter(1234567, '.')).toBe('1.234.567');
		});
	});

	describe('array formatters', () => {
		it('join / first / last / size', () => {
			expect(f.join(['a', 'b'])).toBe('a, b');
			expect(f.join(['a', 'b'], ' | ')).toBe('a | b');
			expect(f.first([1, 2, 3])).toBe(1);
			expect(f.last([1, 2, 3])).toBe(3);
			expect(f.size([1, 2, 3])).toBe(3);
			expect(f.size('abcd')).toBe(4);
		});

		it('sort by key, uniq, where', () => {
			const items = [{ n: 'b' }, { n: 'a' }];
			expect(f.sort(items, 'n').map(i => i.n)).toEqual(['a', 'b']);
			expect(f.uniq([1, 1, 2])).toEqual([1, 2]);
			expect(f.where([{ ok: true }, { ok: false }], 'ok', true)).toEqual([{ ok: true }]);
		});

		it('keyless sort is NUMERIC for numbers (not lexicographic) and lexical for strings', () => {
			// bare Array.sort() string-coerces → [1,10,2]; the comparator fixes it.
			expect(f.sort([2, 10, 1])).toEqual([1, 2, 10]);
			expect(f.sort(['b', 'a'])).toEqual(['a', 'b']);
			// NaN is pushed to the end
			expect(f.sort([3, NaN, 1])).toEqual([1, 3, NaN]);
		});

		it('keyed sort on a numeric field stays numeric', () => {
			const items = [{ price: 2 }, { price: 10 }, { price: 1 }];
			expect(f.sort(items, 'price').map(i => i.price)).toEqual([1, 2, 10]);
		});

		it('does not mutate the input array', () => {
			const input = [2, 10, 1];
			const out = f.sort(input);
			expect(input).toEqual([2, 10, 1]); // original untouched
			expect(out).not.toBe(input);
		});
	});

	describe('date formatters', () => {
		it('date presets format and invalid input passes through', () => {
			expect(f.date('2026-01-15T12:00:00Z', 'iso')).toBe('2026-01-15T12:00:00.000Z');
			expect(f.date('not a date')).toBe('not a date');
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
			expect(() => f.datetime('2026-01-15T12:00:00Z', 'datetime', 'not-a-locale-!!')).not.toThrow();

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

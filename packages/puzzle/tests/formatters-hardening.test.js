// Built-in function edges (D174, D175): `strip_html` on hostile unterminated
// markup (must stay linear), and the locale-rendered number functions under a
// formatter locale Intl rejects.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strip_html, compact_number, number_with_delimiter, pluralize, timeago } from '../client-runtime/formatters/builtins.js';
import { setFormatLocale, localeNumber } from '../client-runtime/formatters/locale.js';

afterEach(() => setFormatLocale(undefined));

describe('strip_html', () => {
	it('stays linear on unterminated tags and comments', () => {
		for (const input of ['<a'.repeat(40000), '<!--'.repeat(40000), '<a "'.repeat(30000)]) {
			const start = performance.now();
			const out = strip_html(input);
			expect(performance.now() - start).toBeLessThan(500);
			expect(out).toBe(input);
		}
	});

	it('still strips a tag that follows an unterminated one', () => {
		// The first tag's quote never closes, so it stays text; a later `<b>` —
		// scanned from outside any quote — is still a tag.
		expect(strip_html('<a title="x <b>y</b>')).toBe('<a title="x y');
		expect(strip_html('<a <b>c')).toBe('c');
		expect(strip_html("x <i 'q> <u>z</u>")).toBe("x <i 'q> z");
		expect(strip_html('a <!-- open <b>bold</b>')).toBe('a <!-- open bold');
	});
});

describe('a formatter locale Intl rejects', () => {
	it('falls back to the viewer locale instead of throwing mid-render', () => {
		expect(() => new Intl.NumberFormat('en_US')).toThrow(RangeError);
		setFormatLocale('en_US');
		expect(() => localeNumber(1234.5)).not.toThrow();
		expect(number_with_delimiter(1234.5)).toBe(new Intl.NumberFormat(undefined, { minimumFractionDigits: 1 }).format(1234.5));
		expect(compact_number(1500)).toBe(new Intl.NumberFormat(undefined, { notation: 'compact' }).format(1500));
		expect(pluralize(3, 'item')).toMatch(/3 items/);
		expect(() => timeago(new Date(Date.now() - 3600 * 1000))).not.toThrow();
	});
});

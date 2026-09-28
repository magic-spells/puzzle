import { describe, it, expect } from 'vitest';
import { sizeOf } from '../client-runtime/index.js';

// The template `.size` property (D176) compiles to `__z(x)` — this helper.
describe('sizeOf (`.size` in a template)', () => {
	it('counts the items of a list', () => {
		expect(sizeOf([])).toBe(0);
		expect(sizeOf(['a', 'b', 'c'])).toBe(3);
	});

	it('counts a string in code points, not UTF-16 units', () => {
		expect(sizeOf('')).toBe(0);
		expect(sizeOf('hello')).toBe(5);
		// '😀' is one code point and two UTF-16 units.
		expect('a😀b'.length).toBe(4);
		expect(sizeOf('a😀b')).toBe(3);
		// A family emoji is several code points joined by ZWJs, not one.
		expect(sizeOf('👨‍👩‍👧')).toBe(5);
	});

	it('reads an object’s own size field', () => {
		expect(sizeOf({ size: 1024, name: 'photo.jpg' })).toBe(1024);
		expect(sizeOf({ name: 'no size' })).toBeUndefined();
	});

	it('answers a Map or Set with its native size', () => {
		expect(sizeOf(new Map([['a', 1], ['b', 2]]))).toBe(2);
		expect(sizeOf(new Set([1, 2, 3]))).toBe(3);
	});

	it('gives a missing value no size', () => {
		expect(sizeOf(null)).toBeUndefined();
		expect(sizeOf(undefined)).toBeUndefined();
		// …so a comparison against it is false.
		expect(sizeOf(null) > 0).toBe(false);
	});
});

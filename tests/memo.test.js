import { describe, it, expect, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';

// this.memo() is a pure per-instance cache (v1.29, D64; SPEC §32) — no DOM,
// store, or mount required, so a bare PuzzleView instance exercises it directly.
const view = () => new PuzzleView();

describe('PuzzleView.memo — reference-stable derived values (D64)', () => {
	it('returns the SAME reference for the same key + same deps across calls', () => {
		const v = view();
		const factory = vi.fn(() => ({ a: 1 }));

		const first = v.memo('opts', ['carousel'], factory);
		const second = v.memo('opts', ['carousel'], factory);

		expect(second).toBe(first); // reference stable
		expect(factory).toHaveBeenCalledTimes(1); // cached — factory ran once
	});

	it('re-runs the factory and returns a NEW reference when a dep changes (===)', () => {
		const v = view();
		const factory = vi.fn((effect) => ({ effect }));

		const first = v.memo('opts', ['carousel'], () => factory('carousel'));
		const second = v.memo('opts', ['fade'], () => factory('fade'));

		expect(second).not.toBe(first);
		expect(second).toEqual({ effect: 'fade' });
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('treats a change in deps LENGTH as a miss', () => {
		const v = view();
		const factory = vi.fn(() => ({}));

		const first = v.memo('k', ['a'], factory);
		const second = v.memo('k', ['a', 'b'], factory); // longer deps → miss
		const third = v.memo('k', ['a'], factory); // shorter again → miss

		expect(second).not.toBe(first);
		expect(third).not.toBe(second);
		expect(factory).toHaveBeenCalledTimes(3);
	});

	it('keeps distinct keys independent', () => {
		const v = view();
		const a = v.memo('a', [1], () => ({ which: 'a' }));
		const b = v.memo('b', [1], () => ({ which: 'b' }));

		expect(a).not.toBe(b);
		// Re-reading each key returns its own cached value, unaffected by the other.
		expect(v.memo('a', [1], () => ({ which: 'a2' }))).toBe(a);
		expect(v.memo('b', [1], () => ({ which: 'b2' }))).toBe(b);
	});

	it('does not share caches across view instances', () => {
		const v1 = view();
		const v2 = view();

		const a = v1.memo('opts', ['x'], () => ({ id: 1 }));
		const factory2 = vi.fn(() => ({ id: 2 }));
		const b = v2.memo('opts', ['x'], factory2); // same key+deps, different instance

		expect(b).not.toBe(a); // v2 has its own cache — a fresh build
		expect(factory2).toHaveBeenCalledTimes(1);
	});

	it('a NaN dep is a cache HIT (Object.is, not ===), so the factory runs once', () => {
		// NaN !== NaN, so a bare === comparison would MISS every render and re-run
		// the factory, returning a new object each time and defeating the D64
		// reference-stability contract. Object.is(NaN, NaN) is true.
		const v = view();
		const factory = vi.fn(() => ({ derived: true }));

		const first = v.memo('k', [NaN], factory);
		const second = v.memo('k', [NaN], factory);

		expect(second).toBe(first); // reference stable across a NaN dep
		expect(factory).toHaveBeenCalledTimes(1);

		// changing the dep to a real number still busts the cache
		const third = v.memo('k', [3], factory);
		expect(third).not.toBe(first);
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('caches after the first call for an empty deps array', () => {
		const v = view();
		const factory = vi.fn(() => ({ constant: true }));

		const first = v.memo('const', [], factory);
		const second = v.memo('const', [], factory);
		const third = v.memo('const', [], factory);

		expect(second).toBe(first);
		expect(third).toBe(first);
		expect(factory).toHaveBeenCalledTimes(1); // [] always matches [] positionally
	});
});

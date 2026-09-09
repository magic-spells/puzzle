// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

// Anti-flash hold: <puzzle-skeleton min-duration="N"> holds the loaded swap
// until the skeleton has been up at least N ms (v1.20, D52; DOC-SPEC §16).

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const deferred = () => {
	let resolve, reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
};

// Hand-assembled compiled component (the same idiom as view.test.js's skeleton
// suite): renderSkeleton + the optional skeletonMinDuration prototype assignment
// exactly as the Go codegen emits them (v1.20, D52).
const makeSkeletonView = (gate, minDuration) => {
	class V extends PuzzleView {
		async data() {
			const post = await gate.promise;
			return { post };
		}
	}
	V.prototype.render = function () {
		return h('article', {}, [text(this.getData().post)]);
	};
	V.prototype.renderSkeleton = function () {
		return h('article', { class: 'is-loading' }, [h('div', { class: 'bg-skeleton' })]);
	};
	if (minDuration !== undefined) V.prototype.skeletonMinDuration = minDuration;
	return V;
};

describe('PuzzleView — skeleton anti-flash min-duration (v1.20, D52)', () => {
	beforeEach(() => vi.useFakeTimers()); // fakes setTimeout AND Date.now()
	afterEach(() => vi.useRealTimers());

	it('holds the loaded swap until min-duration elapses, then swaps once', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate, 300);
		const el = container();
		const v = await new V().mount(el); // resolves after the SKELETON render
		expect(v.loaded).toBe(false);
		expect(el.querySelector('article.is-loading')).toBeTruthy();

		// Data commits well within the hold window.
		gate.resolve('real content');
		await gate.promise;
		await Promise.resolve(); // let refresh().then(commit) run

		// Still holding: skeleton up, loaded false, real content NOT shown.
		expect(v.loaded).toBe(false);
		expect(el.querySelector('.is-loading')).toBeTruthy();
		expect(el.textContent).not.toBe('real content');

		// Cross the hold boundary — the single deferred swap fires.
		vi.advanceTimersByTime(300);
		expect(v.loaded).toBe(true);
		expect(el.textContent).toBe('real content');
		expect(el.querySelector('.is-loading')).toBeNull();
	});

	it('data slower than min-duration swaps immediately on commit (no extra wait)', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate, 300);
		const el = container();
		const v = await new V().mount(el);
		expect(v.loaded).toBe(false);

		// The skeleton has been up longer than the hold before data arrives.
		vi.advanceTimersByTime(400);
		expect(v.loaded).toBe(false); // no data yet — skeleton stays

		gate.resolve('late');
		await gate.promise;
		await Promise.resolve();

		// elapsed (400) >= min (300): swap immediately, no deferral.
		expect(v.loaded).toBe(true);
		expect(el.textContent).toBe('late');
		expect(el.querySelector('.is-loading')).toBeNull();
	});

	it('last-wins: a refresh during the hold produces ONE swap with the latest data', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate, 300);
		const el = container();
		const v = await new V().mount(el);

		const before = vi.fn();
		const after = vi.fn();
		v.beforeUpdate = before;
		v.afterUpdate = after;

		gate.resolve('first');
		await gate.promise;
		await Promise.resolve();
		expect(v.loaded).toBe(false); // held

		// A newer data() commit lands DURING the hold (store-change / prop change).
		v.data = () => Promise.resolve({ post: 'second' });
		await v.refresh();
		expect(v.loaded).toBe(false); // no early swap, no re-armed timer
		expect(el.querySelector('.is-loading')).toBeTruthy();

		// One swap at expiry, bracketed by beforeUpdate/afterUpdate, latest data.
		vi.advanceTimersByTime(300);
		expect(v.loaded).toBe(true);
		expect(el.textContent).toBe('second');
		expect(before).toHaveBeenCalledTimes(1);
		expect(after).toHaveBeenCalledTimes(1);
	});

	it('destroy() during the hold cancels the timer — no late render, no error', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate, 300);
		const el = container();
		const v = await new V().mount(el);
		gate.resolve('x');
		await gate.promise;
		await Promise.resolve();
		expect(v.loaded).toBe(false); // held

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		v.destroy();
		vi.advanceTimersByTime(1000); // the cancelled timer must not fire a render
		expect(v.loaded).toBe(false);
		expect(errSpy).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it('min-duration absent → swaps at data-commit time (v1.8 behavior, byte-for-byte semantics)', async () => {
		const gate = deferred();
		const V = makeSkeletonView(gate); // no skeletonMinDuration on the prototype
		const el = container();
		const v = await new V().mount(el);
		expect(v.loaded).toBe(false);
		expect(el.querySelector('.is-loading')).toBeTruthy();

		gate.resolve('real content');
		await gate.promise;
		await Promise.resolve();

		// No hold — the swap happens as soon as the first data() commits.
		expect(v.loaded).toBe(true);
		expect(el.textContent).toBe('real content');
		expect(el.querySelector('.is-loading')).toBeNull();
	});
});

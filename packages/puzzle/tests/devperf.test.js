// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView, ViewNode } from '../client-runtime/index.js';
import { Store } from '../client-runtime/datastore/store.js';
import {
	devperfInstallSink,
	devperfSnapshot,
} from '../client-runtime/devperf.js';
import {
	measureRenders,
	mountView,
	settled,
} from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const handles = [];
const cleanups = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	for (const handle of handles.splice(0)) handle.destroy();
	vi.restoreAllMocks();
});

describe('dev performance render instrumentation', () => {
	it('counts ViewManager.render entries and detects zero-mutation wasted renders', async () => {
		class RenderCounter extends PuzzleView {
			data() {
				return { count: 0 };
			}
			render() {
				return h('div', {}, [text(this.getData().count)]);
			}
		}

		const view = await mountView(RenderCounter);
		handles.push(view);
		const renders = [];
		cleanups.push(
			devperfInstallSink((event) => {
				if (event.type === 'render') renders.push(event);
			})
		);

		view.instance.setData('count', 0);
		view.instance.setData('count', 0);
		await settled();
		view.instance.setData('count', 1);
		await settled();

		expect(renders).toHaveLength(2);
		expect(renders[0]).toMatchObject({
			viewName: 'RenderCounter',
			wasted: true,
			domMutations: 0,
			causes: ['local-state'],
		});
		expect(renders[1]).toMatchObject({
			viewName: 'RenderCounter',
			wasted: false,
			domMutations: 1,
			causes: ['local-state'],
		});
		expect(renders[0].treeDuration).toBeGreaterThanOrEqual(0);
		expect(renders[0].patchDuration).toBeGreaterThanOrEqual(0);
	});

	it('surfaces serialized async data() head-of-line deferrals with count and time', async () => {
		const store = new Store();
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		class DeferredData extends PuzzleView {
			async data() {
				await gate;
				return {};
			}
			render() {
				return h('div');
			}
		}

		const events = [];
		cleanups.push(
			devperfInstallSink((event) => {
				if (event.type === 'tracking-deferral') events.push(event);
			})
		);
		const before = devperfSnapshot();
		const mounts = [
			mountView(DeferredData, { store }),
			mountView(DeferredData, { store }),
			mountView(DeferredData, { store }),
		];
		release();
		const mounted = await Promise.all(mounts);
		handles.push(...mounted);
		const after = devperfSnapshot();

		// The third evaluation waits behind the first, retries beside the second,
		// then defers again behind that new head: serialization is visible as three
		// head-of-line waits, not merely two delayed callers.
		expect(events).toHaveLength(3);
		expect(events.every((event) => event.duration >= 0)).toBe(true);
		expect(after.asyncTrackingDeferrals - before.asyncTrackingDeferrals).toBe(3);
		expect(after.asyncTrackingDeferredMs).toBeGreaterThanOrEqual(
			before.asyncTrackingDeferredMs
		);
	});

	it('closes the render scope when render() throws, leaving later renders unpoisoned', async () => {
		// A render that throws skips devperfRenderEnd. If the prepared mark's scope
		// stayed on the stack, currentChain() would keep handing that abandoned chain
		// to every later render in the process — they would share one chainId and
		// accumulate executions until the recursion guard suppressed them.
		class Exploding extends PuzzleView {
			render() {
				if (this.getData().explode) throw new Error('render exploded');
				return h('div', {}, [text(this.getData().label ?? 'ok')]);
			}
		}
		class Neighbor extends PuzzleView {
			render() {
				return h('div', {}, [text(String(this.getData().tick ?? 0))]);
			}
		}

		const exploding = await mountView(Exploding);
		const neighbor = await mountView(Neighbor);
		handles.push(exploding, neighbor);
		const renders = [];
		cleanups.push(
			devperfInstallSink((event) => {
				if (event.type === 'render') renders.push(event);
			})
		);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		exploding.instance.setData('explode', true);
		exploding.instance.flushUpdates(); // flushUpdates catches and logs the throw
		await settled();
		expect(error).toHaveBeenCalledWith('[puzzle] render update failed:', expect.any(Error));
		// The failed attempt never entered the patch, so it reports no render.
		expect(renders.filter((event) => event.viewName === 'Exploding')).toHaveLength(0);

		// Two later, independent interactions each open their OWN chain at depth 1.
		neighbor.instance.setData('tick', 1);
		await settled();
		neighbor.instance.setData('tick', 2);
		await settled();

		const neighborRenders = renders.filter((event) => event.viewName === 'Neighbor');
		expect(neighborRenders).toHaveLength(2); // nothing suppressed
		expect(neighborRenders[0].chainId).not.toBe(neighborRenders[1].chainId);
		expect(neighborRenders.every((event) => event.depth === 1)).toBe(true);
		expect(neighbor.element.textContent).toBe('2');

		// The thrower is intentionally destroyed by D145; its invisible recovery
		// placeholder does not poison later instrumentation.
		expect(exploding.instance.isDestroyed).toBe(true);
		expect(exploding.element.nodeType).toBe(Node.COMMENT_NODE);
	});

	it('reports both halves of a reentrant render and leaves no scope behind', async () => {
		// User code runs INSIDE the render span — a `ref` callback fires mid-patch —
		// and refresh() with a sync data() is fully synchronous, so one view can be
		// rendering twice at once. Both renders must report, and neither may strand
		// its scope: a stranded scope keeps every later render in the process inside
		// the same causal chain, where executions accumulate until the recursion
		// guard suppresses an unrelated view.
		let armed = false; // only reenter from a PATCH, not from the mount render
		let reentered = false;
		class Reentrant extends PuzzleView {
			data() {
				return { label: 'x' };
			}
			render() {
				return h('div', {}, [
					// A fresh closure each render, so patchAttrs rebinds (and fires) it on
					// a PERSISTING element — no DOM churn, just user code inside the patch.
					h('span', {
						ref: () => {
							if (!armed || reentered) return;
							reentered = true;
							this.refresh();
						},
					}),
				]);
			}
		}
		class Neighbor extends PuzzleView {
			render() {
				return h('div', {}, [text(String(this.getData().tick ?? 0))]);
			}
		}

		const reentrant = await mountView(Reentrant);
		const neighbor = await mountView(Neighbor);
		handles.push(reentrant, neighbor);
		const renders = [];
		const loops = [];
		cleanups.push(
			devperfInstallSink((event) => {
				if (event.type === 'render') renders.push(event);
				if (event.type === 'loop') loops.push(event);
			})
		);

		armed = true;
		reentrant.instance.setData('tick', 1);
		await settled();

		const reentrantRenders = renders.filter((event) => event.viewName === 'Reentrant');
		expect(reentered).toBe(true);
		expect(reentrantRenders).toHaveLength(2); // inner and outer both closed

		// Two later, independent interactions each open their OWN chain at depth 1 —
		// the proof that the outer render's scope was popped.
		neighbor.instance.setData('tick', 1);
		await settled();
		neighbor.instance.setData('tick', 2);
		await settled();

		const neighborRenders = renders.filter((event) => event.viewName === 'Neighbor');
		expect(neighborRenders).toHaveLength(2);
		expect(neighborRenders[0].chainId).not.toBe(neighborRenders[1].chainId);
		expect(neighborRenders.every((event) => event.depth === 1)).toBe(true);
		expect(loops).toHaveLength(0);
	});

	it('warns about a rolling-second zero-mutation runaway WITHOUT stopping the view', async () => {
		// Byte-identical output while `label` is unset — the cross-frame guard's
		// exact trigger — then a real DOM change once it is set.
		class FrameRunaway extends PuzzleView {
			render() {
				return h('div', {}, [text(this.getData().label ?? 'stable')]);
			}
		}

		const view = await mountView(FrameRunaway);
		handles.push(view);
		const events = [];
		cleanups.push(
			devperfInstallSink((event) => {
				if (event.type === 'render' || event.type === 'loop') events.push(event);
			})
		);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		for (let i = 0; i < 61; i++) {
			view.instance.setData('tick', i);
			view.instance.flushUpdates();
		}

		const renders = events.filter((event) => event.type === 'render');
		const loop = events.find(
			(event) => event.type === 'loop' && event.kind === 'cross-frame'
		);
		// Every update rendered. The mount render is inside the rolling second too,
		// so the window crossed the 60-render threshold partway through the burst —
		// and the renders after that point still happened, because this guard warns
		// and never gates. (When it did gate, only 59 of the 61 arrived.)
		expect(renders).toHaveLength(61);
		expect(renders.every((event) => event.wasted)).toBe(true);
		expect(loop).toMatchObject({ viewName: 'FrameRunaway', kind: 'cross-frame' });
		// The warning is throttled to one per rolling window, not one per frame.
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('__PUZZLE_PERF__');
		expect(warn.mock.calls[0][0]).toContain('likely a render loop');
		// It must not claim devperf intervened.
		expect(warn.mock.calls[0][0]).not.toContain('stopped');

		// The whole point: work still gets done after the warning. A render that
		// DOES change the DOM lands.
		view.instance.setData('label', 'after the warning');
		view.instance.flushUpdates();
		expect(view.element.textContent).toBe('after the warning');
		const afterWarning = events.filter((event) => event.type === 'render').at(-1);
		expect(afterWarning).toMatchObject({ wasted: false, domMutations: 1 });
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe('dev performance store instrumentation', () => {
	it('reports both halves of a reentrant flush and leaves no scope behind', async () => {
		// A function subscriber may call flush() synchronously during delivery. Both
		// flushes must report, the delivery counters must land on the INNER one's
		// caller (the outer flush, whose _deliverNotifications is running), and
		// neither may strand its scope — a stranded scope would keep every later
		// interaction inside the same causal chain forever.
		const store = new Store();
		const flushes = [];
		cleanups.push(
			devperfInstallSink((event) => {
				if (event.type === 'store-flush') flushes.push(event);
			})
		);
		let reentered = false;
		const subscriber = () => {
			if (reentered) return;
			reentered = true;
			store.flush();
		};
		store.withTracking(subscriber, () => store.findMany('item'));

		store.createRecord('item', {});
		store.flush();

		expect(flushes).toHaveLength(2);
		expect(flushes[0].chainId).toBe(flushes[1].chainId);
		expect(flushes[0].notified).toBe(0); // the reentrant flush delivered nothing
		expect(flushes[1].notified).toBe(1); // the outer flush's delivery counted here

		await settled();
		store.createRecord('item', {});
		store.flush();

		expect(flushes).toHaveLength(3);
		expect(flushes[2].chainId).not.toBe(flushes[1].chainId);
	});
});

describe('dev performance loop detector', () => {
	it(
		'reports and stops a data() -> store-write -> data() cycle at 100 executions',
		async () => {
			class FeedbackLoop extends PuzzleView {
				looping = false;

				data() {
					const items = this.ctx.store.findMany('item');
					if (this.looping && items.length > 0) {
						this.ctx.store.createRecord('item', {});
					}
					return { count: items.length };
				}

				render() {
					return h('div', {}, [text(this.getData().count)]);
				}
			}

			const view = await mountView(FeedbackLoop);
			handles.push(view);
			const loops = [];
			const renders = [];
			cleanups.push(
				devperfInstallSink((event) => {
					if (event.type === 'loop') loops.push(event);
					if (event.type === 'render' && event.viewName === 'FeedbackLoop') {
						renders.push(event);
					}
				})
			);
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			view.instance.looping = true;
			view.store.createRecord('item', {});

			await settled({ maxPasses: 150 });

			expect(loops).toContainEqual(
				expect.objectContaining({
					viewName: 'FeedbackLoop',
					kind: 'recursive',
					depth: 100,
				})
			);
			expect(error).toHaveBeenCalledWith(
				expect.stringContaining('stopped FeedbackLoop after 100 executions')
			);
			expect(view.element.textContent).toBe('100');
			// The recursive guard genuinely SUPPRESSES: the cycle would otherwise run
			// to settled()'s 150-pass cap, so the render count has to stay at the
			// limit rather than merely be warned about. This is the regression the
			// warn-only change to the cross-frame guard must not have caused.
			expect(renders.length).toBeLessThanOrEqual(100);
		},
		3000
	);
});

describe('measureRenders', () => {
	it('returns correct immutable counts for a known store-backed interaction', async () => {
		class ProfileCounter extends PuzzleView {
			data() {
				return { count: this.ctx.store.findMany('item').length };
			}

			events = {
				add: () => this.ctx.store.createRecord('item', {}),
			};

			render() {
				return h('div', {}, [
					h('button', { class: 'add', '@click': this.events.add }, [text('Add')]),
					h('span', { class: 'count' }, [text(this.getData().count)]),
				]);
			}
		}

		const view = await mountView(ProfileCounter);
		handles.push(view);
		const profile = await measureRenders(view, async () => {
			await view.click('.add');
		});

		expect(profile).toEqual({
			renders: 1,
			wastedRenders: 0,
			domMutations: 1,
			rendersByView: { ProfileCounter: 1 },
			causes: { store: 1 },
			maxRecursiveDepth: 1,
			storeNotifications: 1,
		});
		expect(Object.isFrozen(profile)).toBe(true);
		expect(Object.isFrozen(profile.rendersByView)).toBe(true);
		expect(Object.isFrozen(profile.causes)).toBe(true);
	});

	// The handle was required but never patched or inspected — the sink is global.
	// Both call shapes are supported; the two-arg form stays self-documenting.
	it('accepts the callback-only form', async () => {
		class Bumper extends PuzzleView {
			data() {
				return { count: this.ctx.store.findMany('item').length };
			}
			events = { add: () => this.ctx.store.createRecord('item', {}) };
			render() {
				return h('div', {}, [
					h('button', { class: 'add', '@click': this.events.add }, [text('Add')]),
					h('span', { class: 'count' }, [text(this.getData().count)]),
				]);
			}
		}

		const view = await mountView(Bumper);
		handles.push(view);
		const profile = await measureRenders(async () => {
			await view.click('.add');
		});

		expect(profile.renders).toBe(1);
		expect(profile.rendersByView).toEqual({ Bumper: 1 });
		expect(Object.isFrozen(profile)).toBe(true);
	});

	it('still rejects a call with no callback at all', async () => {
		await expect(measureRenders()).rejects.toThrow(
			'[puzzle/testing] measureRenders() expects a callback'
		);
		const view = await mountView(
			class extends PuzzleView {
				render() {
					return h('div', {}, [text('x')]);
				}
			}
		);
		handles.push(view);
		await expect(measureRenders(view)).rejects.toThrow(
			'[puzzle/testing] measureRenders() expects a callback'
		);
	});
});

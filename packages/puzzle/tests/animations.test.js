// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { playAnimation, prefersReducedMotion } from '../client-runtime/views/animate.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

// Hand-written stand-ins for compiler output (SPEC §4), same style as the other
// suites: render() returns a ViewNode tree; a component vnode is
// `new ViewNode(Class, props, slotChildren)`.
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

// Drain microtasks + the setTimeout(0) macrotask so a chained mount→playIn and
// awaited animation.finished settle.
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- controllable fake WAAPI -------------------------------------------------
// jsdom has NO Element.prototype.animate; we install a fake with a DEFERRED
// finished promise (manual finish()), a cancel spy that rejects finished (real
// WAAPI semantics), and captured keyframes/options for assertions. Restored to
// undefined (jsdom's real state) after each test.
let fakeAnimations;

function installFakeAnimate() {
	fakeAnimations = [];
	Element.prototype.animate = function (keyframes, options) {
		let resolve, reject;
		const finished = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const anim = {
			keyframes,
			options,
			finished,
			finishedState: 'running',
			finish() {
				this.finishedState = 'finished';
				resolve(this);
			},
			cancel: vi.fn(function () {
				this.finishedState = 'cancelled';
				reject(new DOMException('The user aborted a request.', 'AbortError'));
			}),
		};
		fakeAnimations.push(anim);
		return anim;
	};
}

function uninstallFakeAnimate() {
	delete Element.prototype.animate;
	fakeAnimations = undefined;
}

const IN = { from: { opacity: 0 }, to: { opacity: 1 }, duration: 200, easing: 'ease-out' };
const OUT = { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 };

describe('animate.js — playAnimation()', () => {
	afterEach(() => {
		if (fakeAnimations) uninstallFakeAnimate();
		vi.restoreAllMocks();
	});

	it('instant-finishes (never throws) when el.animate is missing (jsdom default)', async () => {
		const el = document.createElement('div');
		expect(typeof el.animate).not.toBe('function');
		const handle = playAnimation(el, IN, {});
		await expect(handle.finished).resolves.toBeUndefined();
		expect(() => handle.cancel()).not.toThrow();
	});

	it('maps spec → el.animate([from,to], {duration,easing,delay,fill})', async () => {
		installFakeAnimate();
		const el = container();
		playAnimation(el, { ...IN, delay: 30 }, {});
		const a = fakeAnimations[0];
		expect(a.keyframes).toEqual([IN.from, IN.to]);
		expect(a.options).toMatchObject({
			duration: 200,
			easing: 'ease-out',
			delay: 30,
			fill: 'both',
		});
	});

	it('finished resolves (does not reject) when the animation is cancelled', async () => {
		installFakeAnimate();
		const el = container();
		const handle = playAnimation(el, IN, {});
		handle.cancel();
		await expect(handle.finished).resolves.toBeUndefined();
		expect(fakeAnimations[0].cancel).toHaveBeenCalledTimes(1);
	});

	it('reduced motion zeroes duration and delay but still runs the animation', async () => {
		installFakeAnimate();
		const el = container();
		playAnimation(el, { ...IN, delay: 30 }, { reducedMotion: true });
		expect(fakeAnimations[0].options).toMatchObject({ duration: 0, delay: 0 });
	});

	it('warns ONCE per malformed spec object and instant-finishes', async () => {
		installFakeAnimate();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = container();
		const bad = { from: { opacity: 0 } }; // no `to`, no numeric duration

		const h1 = playAnimation(el, bad, {});
		const h2 = playAnimation(el, bad, {});
		await expect(h1.finished).resolves.toBeUndefined();
		await expect(h2.finished).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledTimes(1); // once per spec object
		expect(fakeAnimations).toHaveLength(0); // never reached el.animate
	});

	it('prefersReducedMotion() is false when matchMedia is absent (jsdom)', () => {
		expect(typeof globalThis.matchMedia).not.toBe('function');
		expect(prefersReducedMotion()).toBe(false);
	});
});

describe('PuzzleView — enter/leave hooks (order, with & without animations)', () => {
	afterEach(() => {
		if (fakeAnimations) uninstallFakeAnimate();
		vi.restoreAllMocks();
	});

	it('playIn fires viewWillShow → in-animation → viewDidShow, in order', async () => {
		installFakeAnimate();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: IN };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn();
		expect(calls).toEqual(['willShow']); // animation not finished yet
		expect(fakeAnimations).toHaveLength(1);
		expect(fakeAnimations[0].keyframes).toEqual([IN.from, IN.to]);

		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willShow', 'didShow']);
	});

	it('playIn fires both hooks even with NO animations field (zero-duration)', async () => {
		installFakeAnimate();
		const calls = [];
		class V extends PuzzleView {
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		await v.playIn();
		expect(calls).toEqual(['willShow', 'didShow']);
		expect(fakeAnimations).toHaveLength(0); // no spec → no animate call
	});

	it('playIn runs at most once per mount', async () => {
		const calls = [];
		class V extends PuzzleView {
			viewWillShow() { calls.push('willShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		await v.playIn();
		await v.playIn();
		expect(calls).toEqual(['willShow']);
	});

	it('playOut fires viewWillHide → out-animation → viewDidHide, in order', async () => {
		installFakeAnimate();
		const calls = [];
		class V extends PuzzleView {
			animations = { out: OUT };
			viewWillHide() { calls.push('willHide'); }
			viewDidHide() { calls.push('didHide'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playOut();
		expect(calls).toEqual(['willHide']);
		expect(fakeAnimations[0].keyframes).toEqual([OUT.from, OUT.to]);

		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willHide', 'didHide']);
	});

	// #abortEnter only unwinds a PENDING visible-trigger enter, so a running
	// mount-trigger enter survived into the leave: playOut overwrote
	// #currentAnimation and both fill:'both' animations owned the same element at
	// once (SPEC §12 one-animator rule). Cancelling the enter also resolves its
	// finished promise (animate.js normalises the AbortError), so the awaiting
	// playIn() resumes — and must not fire viewDidShow into a leave.
	it('playOut cancels a running mount-trigger enter and suppresses its viewDidShow', async () => {
		installFakeAnimate();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: IN, out: OUT };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			viewWillHide() { calls.push('willHide'); }
			viewDidHide() { calls.push('didHide'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const enter = v.playIn();
		expect(fakeAnimations).toHaveLength(1);
		const enterAnim = fakeAnimations[0];
		expect(calls).toEqual(['willShow']);

		const leave = v.playOut(); // interrupts mid-enter
		const outAnim = fakeAnimations[1];
		expect(outAnim.keyframes).toEqual([OUT.from, OUT.to]);
		// The enter is gone before the out spec starts filling the same element.
		expect(enterAnim.finishedState).toBe('cancelled');
		expect(fakeAnimations.filter((a) => a.finishedState === 'running')).toEqual([outAnim]);

		await enter; // resolves via the cancel
		expect(calls).toEqual(['willShow', 'willHide']); // no didShow into the leave

		outAnim.finish();
		await leave;
		expect(calls).toEqual(['willShow', 'willHide', 'didHide']);
	});

	it('an enter that COMPLETES before the leave still fires both hooks in SPEC order', async () => {
		installFakeAnimate();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: IN, out: OUT };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			viewWillHide() { calls.push('willHide'); }
			viewDidHide() { calls.push('didHide'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const enter = v.playIn();
		fakeAnimations[0].finish();
		await enter;
		expect(calls).toEqual(['willShow', 'didShow']);

		const leave = v.playOut();
		const outAnim = fakeAnimations[fakeAnimations.length - 1];
		outAnim.finish();
		await leave;
		expect(calls).toEqual(['willShow', 'didShow', 'willHide', 'didHide']);
	});

	it('a store mutation during leave neither re-runs data() nor re-renders the leaving view', async () => {
		installFakeAnimate();
		class Todo extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				text: Puzzle.string(),
			};
		}
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: 't1', text: 'before' });
		store.flush();
		const dataSpy = vi.fn();
		const renderSpy = vi.fn();
		const hooks = [];
		class V extends PuzzleView {
			animations = { out: OUT };
			data() {
				dataSpy();
				return { todos: this.ctx.store.findMany('todo') };
			}
			render() {
				renderSpy();
				return h('div', {}, [text(this.getData().todos[0].text)]);
			}
			viewWillHide() {
				hooks.push('willHide');
			}
			viewDidHide() {
				hooks.push('didHide');
			}
		}
		const v = await new V({ store }).mount(container());
		expect(dataSpy).toHaveBeenCalledTimes(1);
		expect(renderSpy).toHaveBeenCalledTimes(1);

		const leave = v.playOut();
		expect(hooks).toEqual(['willHide']);
		v.refresh();
		v.setData('ignored', true);
		v.onStoreChange();
		v.applyParentUpdate({ props: { ignored: true } });
		v.flushUpdates();
		store.findOne('todo', 't1').update({ text: 'during leave' });
		store.flush();

		expect(dataSpy).toHaveBeenCalledTimes(1);
		expect(renderSpy).toHaveBeenCalledTimes(1);
		expect(v.element.textContent).toBe('before');

		fakeAnimations[0].finish();
		await leave;
		expect(hooks).toEqual(['willHide', 'didHide']);
		v.destroy();
	});

	it('playOut is idempotent — a second call returns the same promise', async () => {
		installFakeAnimate();
		const willHide = vi.fn();
		class V extends PuzzleView {
			animations = { out: OUT };
			viewWillHide() { willHide(); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p1 = v.playOut();
		const p2 = v.playOut();
		expect(p1).toBe(p2);
		expect(willHide).toHaveBeenCalledTimes(1);
		fakeAnimations[0].finish();
		await p1;
	});
});

describe('PuzzleView — destroy() vs destroyAnimated()', () => {
	afterEach(() => {
		if (fakeAnimations) uninstallFakeAnimate();
		vi.restoreAllMocks();
	});

	it('plain destroy() stays synchronous and instant (element gone immediately)', async () => {
		installFakeAnimate();
		const destroyed = vi.fn();
		class V extends PuzzleView {
			animations = { out: OUT }; // declared, but plain destroy() must ignore it
			render() { return h('div', {}, [text('x')]); }
			destroyed() { destroyed(); }
		}
		const el = container();
		const v = await new V().mount(el);
		v.destroy();
		expect(el.innerHTML).toBe(''); // removed right away, no await
		expect(destroyed).toHaveBeenCalledTimes(1);
		expect(fakeAnimations).toHaveLength(0); // no out-animation played
	});

	it('destroyAnimated() defers DOM removal until the out-animation finishes', async () => {
		installFakeAnimate();
		const destroyed = vi.fn();
		class V extends PuzzleView {
			animations = { out: OUT };
			render() { return h('div', { id: 'leaver' }, [text('x')]); }
			destroyed() { destroyed(); }
		}
		const el = container();
		const v = await new V().mount(el);

		const p = v.destroyAnimated();
		await tick();
		// still in the DOM while animating
		expect(el.querySelector('#leaver')).not.toBeNull();
		expect(destroyed).not.toHaveBeenCalled();
		expect(fakeAnimations).toHaveLength(1);

		fakeAnimations[0].finish();
		await p;
		expect(el.querySelector('#leaver')).toBeNull(); // removed only after finish
		expect(destroyed).toHaveBeenCalledTimes(1);
	});

	it('destroy() during an animated leave cancels it and cleans up once', async () => {
		installFakeAnimate();
		const destroyed = vi.fn();
		class V extends PuzzleView {
			animations = { out: OUT };
			render() { return h('div', { id: 'leaver' }, [text('x')]); }
			destroyed() { destroyed(); }
		}
		const el = container();
		const v = await new V().mount(el);

		const p = v.destroyAnimated();
		await tick();
		const anim = fakeAnimations[0];

		// hard destroy mid-flight (e.g. router error path)
		v.destroy();
		expect(anim.cancel).toHaveBeenCalledTimes(1);
		expect(el.querySelector('#leaver')).toBeNull(); // cleaned up immediately
		expect(destroyed).toHaveBeenCalledTimes(1);

		await expect(p).resolves.toBeUndefined(); // no double-destroy, no throw
		expect(destroyed).toHaveBeenCalledTimes(1); // still once
	});

	it('destroyAnimated() on an already-destroyed instance just destroys', async () => {
		installFakeAnimate();
		class V extends PuzzleView {
			animations = { out: OUT };
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		v.destroy();
		await expect(v.destroyAnimated()).resolves.toBeUndefined();
		expect(fakeAnimations).toHaveLength(0);
	});

	it('a throwing viewWillHide still tears the view down, logs, and never rejects (FIX 8)', async () => {
		installFakeAnimate();
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const destroyed = vi.fn();
		class V extends PuzzleView {
			animations = { out: OUT };
			viewWillHide() { throw new Error('user hook boom'); }
			render() { return h('div', { id: 'leaver' }, [text('x')]); }
			destroyed() { destroyed(); }
		}
		const el = container();
		const v = await new V().mount(el);

		// playOut rejects when viewWillHide throws; destroyAnimated must swallow it,
		// log a [puzzle]-prefixed error, and STILL run destroy() (element removed).
		await expect(v.destroyAnimated()).resolves.toBeUndefined();
		expect(el.querySelector('#leaver')).toBeNull(); // torn down despite the throw
		expect(destroyed).toHaveBeenCalledTimes(1);
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining('[puzzle] leave hook failed during teardown:'),
			expect.any(Error)
		);
	});
});

describe('ViewManager — enter animation on component mount', () => {
	afterEach(() => {
		if (fakeAnimations) uninstallFakeAnimate();
		vi.restoreAllMocks();
	});

	it('a mounted component vnode runs playIn() with its declared spec', async () => {
		installFakeAnimate();
		const calls = [];
		class Child extends PuzzleView {
			animations = { in: IN };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('span', { class: 'child' }, [text('hi')]); }
		}
		class Host extends PuzzleView {
			render() { return h('div', {}, [comp(Child)]); }
		}
		const el = container();
		await new Host().mount(el);
		await tick();

		expect(el.querySelector('.child')).not.toBeNull();
		expect(fakeAnimations).toHaveLength(1);
		expect(fakeAnimations[0].keyframes).toEqual([IN.from, IN.to]);
		expect(calls).toEqual(['willShow']); // in-animation still running

		fakeAnimations[0].finish();
		await tick();
		expect(calls).toEqual(['willShow', 'didShow']);
	});
});

describe('ViewManager — leave animation on component removal', () => {
	afterEach(() => {
		if (fakeAnimations) uninstallFakeAnimate();
		vi.restoreAllMocks();
	});

	class Row extends PuzzleView {
		animations = { out: OUT };
		data(params, props) { return { id: props.id }; }
		render() { return h('li', { 'data-id': this.getData().id }, [text(this.getData().id)]); }
	}

	it('warns once for unkeyed out-animated removal and does not warn for keyed removal', async () => {
		class KeyedHost extends PuzzleView {
			created() { this.setData({ order: ['a', 'b'] }); }
			data() { return { order: this.getData().order }; }
			render() {
				return h('ul', {}, this.getData().order.map((id) => comp(Row, { key: id, id })));
			}
		}
		class UnkeyedHost extends PuzzleView {
			created() { this.setData({ order: ['a', 'b', 'c'] }); }
			data() { return { order: this.getData().order }; }
			render() {
				return h('ul', {}, this.getData().order.map((id) => comp(Row, { id })));
			}
		}
		installFakeAnimate();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const keyed = await new KeyedHost().mount(container());
		await tick();
		keyed.setData('order', ['a']);
		keyed.flushUpdates();
		expect(warn).not.toHaveBeenCalled();

		const unkeyed = await new UnkeyedHost().mount(container());
		await tick();
		unkeyed.setData('order', ['a', 'b']);
		unkeyed.flushUpdates();
		unkeyed.setData('order', ['a']);
		unkeyed.flushUpdates();

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			'[puzzle] out animations in an unkeyed list can misorder siblings — ' +
				'give the list items key attributes'
		);
		fakeAnimations.forEach((a) => a.finishedState === 'running' && a.finish());
		await tick();
	});

	it('defers DOM removal until the out-animation finishes', async () => {
		const destroyed = vi.fn();
		class Item extends Row { destroyed() { destroyed(); } }
		class Host extends PuzzleView {
			created() { this.setData({ show: true }); }
			data() { return { show: this.getData().show }; }
			render() { return h('ul', {}, this.getData().show ? [comp(Item, { id: 'x' })] : []); }
		}
		installFakeAnimate();
		const el = container();
		const host = await new Host().mount(el);
		await tick();

		host.setData('show', false);
		host.flushUpdates(); // triggers unmount → destroyAnimated()
		await tick();

		expect(el.querySelector('li')).not.toBeNull(); // still present, animating
		expect(destroyed).not.toHaveBeenCalled();
		expect(fakeAnimations.length).toBeGreaterThanOrEqual(1);

		fakeAnimations[fakeAnimations.length - 1].finish();
		await tick();
		expect(el.querySelector('li')).toBeNull(); // gone after finish
		expect(destroyed).toHaveBeenCalledTimes(1);
	});

	it('a component WITHOUT animations.out is removed synchronously (no regression)', async () => {
		class Plain extends PuzzleView {
			render() { return h('li', { class: 'plain' }, [text('p')]); }
		}
		class Host extends PuzzleView {
			created() { this.setData({ show: true }); }
			data() { return { show: this.getData().show }; }
			render() { return h('ul', {}, this.getData().show ? [comp(Plain)] : []); }
		}
		const el = container();
		const host = await new Host().mount(el);
		host.setData('show', false);
		host.flushUpdates();
		expect(el.querySelector('.plain')).toBeNull(); // instant, no await needed
	});

	it('fires the hide hooks on removal of a component with NO animations (D28)', async () => {
		const order = [];
		class Hooked extends PuzzleView {
			viewWillHide() { order.push('viewWillHide'); }
			viewDidHide() { order.push('viewDidHide'); }
			destroyed() { order.push('destroyed'); }
			render() { return h('li', { class: 'hooked' }, [text('h')]); }
		}
		class Host extends PuzzleView {
			created() { this.setData({ show: true }); }
			data() { return { show: this.getData().show }; }
			render() { return h('ul', {}, this.getData().show ? [comp(Hooked)] : []); }
		}
		const el = container();
		const host = await new Host().mount(el);
		await tick();

		host.setData('show', false);
		host.flushUpdates();
		await tick();

		// The hide hooks are LIFECYCLE, not animation callbacks: declaring them
		// without an `animations` field still fires them in order (zero-duration
		// semantics), exactly as the router's own teardown path does.
		expect(order).toEqual(['viewWillHide', 'viewDidHide', 'destroyed']);
		expect(el.querySelector('.hooked')).toBeNull();
	});

	it('keyed reorder while one item is leaving keeps the survivors correctly ordered', async () => {
		const instances = {};
		class Item extends Row {
			created() { instances[this.props.id] = this; }
		}
		class Host extends PuzzleView {
			created() { this.setData({ order: ['a', 'b', 'c'] }); }
			data() { return { order: this.getData().order }; }
			render() {
				return h('ul', {}, this.getData().order.map((id) => comp(Item, { key: id, id })));
			}
		}
		installFakeAnimate();
		const el = container();
		const host = await new Host().mount(el);
		await tick();

		const [instA, instC] = [instances.a, instances.c];

		// remove 'b' AND swap the survivors to [c, a]
		host.setData('order', ['c', 'a']);
		host.flushUpdates();
		await tick();

		const ids = [...el.querySelectorAll('li')].map((n) => n.dataset.id);
		expect(ids).toContain('b'); // leaving element lingers in the DOM
		expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('a')); // survivors reordered
		// survivors are the SAME instances (never rebuilt)
		expect(instances.a).toBe(instA);
		expect(instances.c).toBe(instC);

		// finish every outstanding leave; the lingering 'b' is removed
		fakeAnimations.forEach((a) => a.finishedState === 'running' && a.finish());
		await tick();
		expect([...el.querySelectorAll('li')].map((n) => n.dataset.id)).toEqual(['c', 'a']);
	});

	// The leaver must not be bubbled to the top by the move-guard: with the
	// leaving element excluded from sibling comparisons, a pure removal produces
	// ZERO moves, so the fading item stays exactly in its slot.
	it('deleting a middle keyed item leaves it in place while it animates out', async () => {
		class Host extends PuzzleView {
			created() { this.setData({ order: ['a', 'b', 'c', 'd', 'e'] }); }
			data() { return { order: this.getData().order }; }
			render() {
				return h('ul', {}, this.getData().order.map((id) => comp(Row, { key: id, id })));
			}
		}
		installFakeAnimate();
		const el = container();
		const host = await new Host().mount(el);
		await tick();

		host.setData('order', ['a', 'b', 'd', 'e']);
		host.flushUpdates();
		await tick();

		// leaving 'c' still occupies its original slot, full order untouched
		const ids = [...el.querySelectorAll('li')].map((n) => n.dataset.id);
		expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);

		fakeAnimations.forEach((a) => a.finishedState === 'running' && a.finish());
		await tick();
		expect([...el.querySelectorAll('li')].map((n) => n.dataset.id)).toEqual(['a', 'b', 'd', 'e']);
	});

	it('deleting two non-adjacent items keeps both in place while they animate out', async () => {
		class Host extends PuzzleView {
			created() { this.setData({ order: ['a', 'b', 'c', 'd', 'e'] }); }
			data() { return { order: this.getData().order }; }
			render() {
				return h('ul', {}, this.getData().order.map((id) => comp(Row, { key: id, id })));
			}
		}
		installFakeAnimate();
		const el = container();
		const host = await new Host().mount(el);
		await tick();

		host.setData('order', ['a', 'c', 'e']);
		host.flushUpdates();
		await tick();

		expect([...el.querySelectorAll('li')].map((n) => n.dataset.id)).toEqual([
			'a', 'b', 'c', 'd', 'e',
		]);

		fakeAnimations.forEach((a) => a.finishedState === 'running' && a.finish());
		await tick();
		expect([...el.querySelectorAll('li')].map((n) => n.dataset.id)).toEqual(['a', 'c', 'e']);
	});

	it('deleting the head item keeps it at the head while it animates out', async () => {
		class Host extends PuzzleView {
			created() { this.setData({ order: ['a', 'b', 'c'] }); }
			data() { return { order: this.getData().order }; }
			render() {
				return h('ul', {}, this.getData().order.map((id) => comp(Row, { key: id, id })));
			}
		}
		installFakeAnimate();
		const el = container();
		const host = await new Host().mount(el);
		await tick();

		host.setData('order', ['b', 'c']);
		host.flushUpdates();
		await tick();

		expect([...el.querySelectorAll('li')].map((n) => n.dataset.id)).toEqual(['a', 'b', 'c']);

		fakeAnimations.forEach((a) => a.finishedState === 'running' && a.finish());
		await tick();
		expect([...el.querySelectorAll('li')].map((n) => n.dataset.id)).toEqual(['b', 'c']);
	});
});

describe('PuzzleView — reduced motion (durations zeroed at the source)', () => {
	afterEach(() => {
		if (fakeAnimations) uninstallFakeAnimate();
		vi.restoreAllMocks();
	});

	it('playIn passes reducedMotion → duration 0 to el.animate', async () => {
		installFakeAnimate();
		globalThis.matchMedia = vi.fn(() => ({ matches: true }));
		try {
			class V extends PuzzleView {
				animations = { in: IN };
				render() { return h('div', {}, [text('x')]); }
			}
			const v = await new V().mount(container());
			const p = v.playIn();
			expect(fakeAnimations[0].options).toMatchObject({ duration: 0, delay: 0 });
			fakeAnimations[0].finish();
			await p;
		} finally {
			delete globalThis.matchMedia;
		}
	});
});

describe('animate.js — fill release (give the element back)', () => {
	it('release: true cancels the animation after it finishes, so fill stops owning properties', async () => {
		installFakeAnimate();
		const el = document.createElement('div');
		const { finished } = playAnimation(
			el,
			{ from: { opacity: 0 }, to: { opacity: 1 }, duration: 100 },
			{ release: true }
		);
		const anim = fakeAnimations[0];
		expect(anim.cancel).not.toHaveBeenCalled(); // still animating: no release yet

		anim.finish();
		await finished;
		await Promise.resolve(); // let the chained release run
		expect(anim.cancel).toHaveBeenCalledTimes(1); // ownership handed back
	});

	it('without release (leave animations), no cancel after finish', async () => {
		installFakeAnimate();
		const el = document.createElement('div');
		const { finished } = playAnimation(el, {
			from: { opacity: 1 },
			to: { opacity: 0 },
			duration: 100,
		});
		fakeAnimations[0].finish();
		await finished;
		await Promise.resolve();
		expect(fakeAnimations[0].cancel).not.toHaveBeenCalled();
	});

	it('playIn() releases; the element is free for its own CSS transitions afterwards', async () => {
		installFakeAnimate();
		class Fading extends PuzzleView {
			animations = {
				in: { from: { opacity: 0 }, to: { opacity: 1 }, duration: 120 },
			};
			render() {
				return new ViewNode('div', { class: 'fades' }, []);
			}
		}
		const el = document.createElement('div');
		document.body.appendChild(el);
		const v = await new Fading().mount(el);
		const p = v.playIn();
		const anim = fakeAnimations[0];
		anim.finish();
		await p;
		await Promise.resolve();
		expect(anim.cancel).toHaveBeenCalledTimes(1);
	});
});

// @vitest-environment jsdom
//
// Two leave-path contracts:
//
// D136 §3 — leave INERTNESS. A leaving view is inert from playOut() start. The
// 0.7.0 change that routes hide-hook components through destroyAnimated() made
// ORDINARY component removal asynchronous, so the mount/commit path (#commit,
// #swapLoaded, #completeMount) can now land mid-leave for any view declaring
// viewWillHide/viewDidHide — not just one declaring animations.out. Those three
// carried no #leaving guard, so a component with an async data() rendered into
// the DOM and fired mounted() after its parent had already removed it.
//
// D28 — hook ORDER. viewWillHide → out → viewDidHide → destroyed, with the hooks
// firing even when no animation is declared (zero-duration semantics). A view
// RESTORED from a failed navigation must not fire its closing hook while it is
// back on screen — it fires the SHOW bracket instead, because it is visible and
// live again — and its eventual real departure must still fire both hide hooks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const tick = () => new Promise((r) => setTimeout(r, 0));
// jsdom's requestAnimationFrame does NOT fire inside a setTimeout(0), so the
// setData re-render path needs a real frame to land.
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const OUT = { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 };

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

function deferred() {
	let resolve;
	const promise = new Promise((r) => (resolve = r));
	return { promise, resolve };
}

// jsdom has no Element.prototype.animate — install a fake whose `finished` only
// settles on an explicit finish()/cancel(), so a leave window can be held open.
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
				if (this.finishedState !== 'running') return;
				this.finishedState = 'finished';
				resolve(this);
			},
			cancel() {
				if (this.finishedState !== 'running') return;
				this.finishedState = 'cancelled';
				reject(new DOMException('The user aborted a request.', 'AbortError'));
			},
		};
		fakeAnimations.push(anim);
		return anim;
	};
}

afterEach(() => {
	delete Element.prototype.animate;
	fakeAnimations = undefined;
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('leave inertness covers the mount/commit path (D136 §3)', () => {
	it('a hide-hook view resolving data() mid-leave neither renders nor mounts', async () => {
		const gate = deferred();
		const order = [];

		class Child extends PuzzleView {
			async data() {
				await gate.promise;
				return { label: 'LOADED' };
			}
			viewWillHide() {
				order.push('willHide');
			}
			viewDidHide() {
				order.push('didHide');
			}
			mounted() {
				order.push('mounted');
			}
			destroyed() {
				order.push('destroyed');
			}
			render() {
				order.push('render');
				return h('puzzle-view', { class: 'child' }, [text(this.getData().label ?? '')]);
			}
		}

		const el = container();
		const child = new Child();
		const mounting = child.mount(el); // data() is still pending — do not await
		await tick();
		expect(order).toEqual([]);

		// The parent removes it: hide hooks now route removal through the async
		// destroyAnimated() path, so the view is #leaving with no animation at all.
		const leaving = child.playOut();
		await leaving;
		expect(order).toEqual(['willHide', 'didHide']);

		// data() lands AFTER the leave started. Nothing may render, and mounted()
		// must not fire on a view its owner has already let go.
		gate.resolve();
		await mounting;
		await tick();

		expect(order).toEqual(['willHide', 'didHide']);
		expect(el.querySelector('.child')).toBeNull();
		expect(el.textContent).not.toContain('LOADED');

		child.destroy();
		await tick();
		expect(order).toEqual(['willHide', 'didHide', 'destroyed']);
	});

	it('a refresh committing mid-leave does not paint into the removed subtree', async () => {
		installFakeAnimate();
		const second = deferred();
		const order = [];
		let child;
		let runs = 0;

		class Child extends PuzzleView {
			animations = { out: OUT };
			created() {
				child = this;
			}
			async data() {
				// The FIRST run resolves so the child gets a real element (an animation
				// can only hold the leave window open on an element, never on the comment
				// anchor a still-loading view occupies). The SECOND run is the one left
				// in flight across the removal.
				if (++runs > 1) await second.promise;
				return { label: runs > 1 ? 'LOADED' : 'FIRST' };
			}
			viewWillHide() {
				order.push('willHide');
			}
			viewDidHide() {
				order.push('didHide');
			}
			mounted() {
				order.push('mounted');
			}
			destroyed() {
				order.push('destroyed');
			}
			render() {
				order.push('render');
				return h('puzzle-view', { class: 'child' }, [text(this.getData().label ?? '')]);
			}
		}

		let host;
		class Host extends PuzzleView {
			created() {
				host = this;
			}
			data() {
				return {};
			}
			render() {
				return h('div', { class: 'host' }, this.getData().show ? [comp(Child)] : []);
			}
		}

		const el = container();
		await new Host().mount(el);
		host.setData('show', true);
		await frame();
		expect(el.textContent).toContain('FIRST');
		order.length = 0;

		// A refresh starts while the child is still owned — it clears the entry guard
		// that refresh() itself carries — and stays suspended.
		const refreshing = child.refresh();

		// Now the owner removes it. The out animation holds the leave window open.
		host.setData('show', false);
		await frame();
		expect(order).toEqual(['willHide']);

		// The commit lands INSIDE the leave. Nothing may render, and no LOADED text
		// may be grafted into a subtree the parent already let go.
		second.resolve();
		await refreshing;
		await tick();

		expect(order).toEqual(['willHide']);
		expect(el.textContent).not.toContain('LOADED');

		fakeAnimations.at(-1).finish();
		await tick();
		expect(order).toEqual(['willHide', 'didHide', 'destroyed']);
		expect(el.querySelector('.child')).toBeNull();
	});
});

describe('restored-then-departed hook order (D28 / D136 §3)', () => {
	it('a restored view fires the show bracket, not a closing hook, and its real leave fires both', async () => {
		installFakeAnimate();
		const order = [];

		class Leaver extends PuzzleView {
			animations = { out: OUT };
			viewWillShow() {
				order.push('willShow');
			}
			viewDidShow() {
				order.push('didShow');
			}
			viewWillHide() {
				order.push('willHide');
			}
			viewDidHide() {
				order.push('didHide');
			}
			destroyed() {
				order.push('destroyed');
			}
			data() {
				return { v: 'x' };
			}
			render() {
				return h('puzzle-view', { class: 'leaver' }, [text(this.getData().v)]);
			}
		}

		const el = container();
		const view = await new Leaver().mount(el);
		// The mount's own enter bracket — cleared so the timeline below is the
		// leave/restore/leave sequence alone.
		order.length = 0;

		// A navigation starts, so the view plays out…
		view.playOut();
		await tick();
		expect(order).toEqual(['willHide']);

		// …and then FAILS, so the router restores this still-committed view.
		// Cancelling the animation resolves the awaited `finished`, which must not
		// fall through to viewDidHide() on a view that is back on screen; the view is
		// visible and live again, so the SHOW bracket fires at zero duration instead.
		view._restoreFromLeaving();
		await tick();
		expect(order).toEqual(['willHide', 'willShow', 'didShow']);
		expect(view.isDestroyed).toBe(false);
		expect(el.querySelector('.leaver')).not.toBeNull();

		// The genuine departure. The out sequence is spent (D136 §3: no second
		// animation), but the hooks are lifecycle, not animation callbacks, so both
		// still fire in order before destroyed().
		await view.destroyAnimated();
		await tick();
		expect(order).toEqual([
			'willHide',
			'willShow',
			'didShow',
			'willHide',
			'didHide',
			'destroyed',
		]);
		// Spent means spent: the restore cancelled the only animation ever created.
		expect(fakeAnimations).toHaveLength(1);
	});

	it('a hooks-only view restored and then removed still fires both hooks', async () => {
		const order = [];
		class Leaver extends PuzzleView {
			viewWillShow() {
				order.push('willShow');
			}
			viewDidShow() {
				order.push('didShow');
			}
			viewWillHide() {
				order.push('willHide');
			}
			viewDidHide() {
				order.push('didHide');
			}
			destroyed() {
				order.push('destroyed');
			}
			data() {
				return { v: 'x' };
			}
			render() {
				return h('puzzle-view', { class: 'leaver' }, [text(this.getData().v)]);
			}
		}

		const el = container();
		const view = await new Leaver().mount(el);
		order.length = 0;

		await view.playOut();
		expect(order).toEqual(['willHide', 'didHide']);

		view._restoreFromLeaving();
		await tick();
		expect(order).toEqual(['willHide', 'didHide', 'willShow', 'didShow']);
		expect(view.isDestroyed).toBe(false);

		await view.destroyAnimated();
		await tick();
		expect(order).toEqual([
			'willHide',
			'didHide',
			'willShow',
			'didShow',
			'willHide',
			'didHide',
			'destroyed',
		]);
	});
});

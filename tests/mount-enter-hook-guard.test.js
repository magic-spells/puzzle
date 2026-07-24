// @vitest-environment jsdom
//
// Regression: a THROWING enter hook must not tear down a component that already
// mounted (viewManager.js mountComponent). playIn() was chained onto the mount
// promise under a SINGLE .catch, so a user viewWillShow()/viewDidShow() that threw
// ran the FIRST-MOUNT RECOVERY path — a live, painted child was destroyed, replaced
// by a comment placeholder, and its store subscriptions dropped (the catch's own
// "the instance never reached mounted()" comment was false in that case). The
// recovery now hangs off the mount step alone (two-arg then) and playIn() has its
// own logging catch: the enter-side mirror of PuzzleView.destroyAnimated()'s
// leave-hook guard, "a rejected leave must never strand the element on screen".
//
// BOTH branches are asserted here — a throwing enter hook keeps the tree, a
// throwing first-mount data() still tears it down — so the split cannot silently
// collapse back into one catch. Setup follows tests/keyed-reconciliation.test.js;
// a real Store rides in ctx so lost subscriptions are observable.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);
// setData re-renders schedule through requestAnimationFrame (jsdom fires that on a
// ~16ms timer), and a child mount then resolves data() across microtasks — so flush
// past several rAF ticks + microtask drains.
const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 20));
		await Promise.resolve();
	}
};

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

// Mount a Host rendering one child component at a fixed position, over a live
// store. `instances` collects every constructed child so a silent teardown +
// re-mount (the bug) is visible as a second instance.
async function mountHost(Child) {
	const instances = [];
	class Instrumented extends Child {
		constructor(...args) {
			super(...args);
			instances.push(this);
		}
	}
	class Host extends PuzzleView {
		render() {
			return h('div', { id: 'host' }, [comp(Instrumented, { n: this.getData()?.n ?? 0 })]);
		}
	}
	const el = document.createElement('div');
	document.body.appendChild(el);
	const store = new Store({ todo: Todo });
	store.createRecord('todo', { id: 't1', text: 'ship it' });
	const host = await new Host({ store }).mount(el);
	await flush();
	return { host, el, store, instances };
}

// A child that subscribes to the store in data(), records mounted(), and throws
// from whichever enter hook the caller names.
function makeChild({ throwOn = null } = {}) {
	return class extends PuzzleView {
		mountedCount = 0;
		data() {
			// Subscribes THIS instance to the 'todo' key via withTracking.
			return { todos: this.ctx.store.findMany('todo') };
		}
		mounted() {
			this.mountedCount++;
		}
		viewWillShow() {
			if (throwOn === 'will') throw new Error('boom (viewWillShow)');
		}
		viewDidShow() {
			if (throwOn === 'did') throw new Error('boom (viewDidShow)');
		}
		render() {
			return h('span', { class: 'child' }, [text(String(this.props?.n ?? 0))]);
		}
	};
}

describe('mountComponent — a throwing enter hook leaves the mounted tree alone', () => {
	for (const hook of ['will', 'did']) {
		const name = hook === 'will' ? 'viewWillShow()' : 'viewDidShow()';

		it(`${name} throw: the child stays mounted, subscribed, and patchable`, async () => {
			const err = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { host, el, store, instances } = await mountHost(makeChild({ throwOn: hook }));

			// The enter failure is logged under its OWN message — this is not a mount
			// failure and must never be reported (or handled) as one.
			expect(err).toHaveBeenCalledWith(
				'[puzzle] child enter animation failed:',
				expect.any(Error)
			);
			expect(err).not.toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));

			// The child is still on screen — not swapped for a comment placeholder.
			const child = el.querySelector('.child');
			expect(child).not.toBeNull();
			expect(child.isConnected).toBe(true);
			expect(child.textContent).toBe('0');

			// Exactly one instance, alive, mounted() fired once, subscription intact.
			expect(instances).toHaveLength(1);
			const view = instances[0];
			expect(view.isDestroyed).toBe(false);
			expect(view.mountedCount).toBe(1);
			expect(store.keysBySubscriber.has(view)).toBe(true);

			// And the position still PATCHES the same live instance: a host re-render
			// updates props in place instead of mounting a fresh component over a
			// placeholder (what the shared-catch teardown forced).
			host.setData({ n: 1 });
			await flush();
			expect(el.querySelector('.child').textContent).toBe('1');
			expect(instances).toHaveLength(1);
			expect(instances[0]).toBe(view);
		});
	}

	it('a first-mount failure is STILL torn down and replaced by the comment placeholder', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		class Broken extends PuzzleView {
			data() {
				throw new Error('boom (data)');
			}
			render() {
				return h('span', { class: 'child' }, []);
			}
		}
		const { el, store, instances } = await mountHost(Broken);

		// The recovery branch ran — and only it.
		expect(err).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		expect(err).not.toHaveBeenCalledWith(
			'[puzzle] child enter animation failed:',
			expect.any(Error)
		);

		// No rendered child; a bare comment holds the position under #host.
		expect(el.querySelector('.child')).toBeNull();
		const hostEl = el.querySelector('#host');
		expect(hostEl.childNodes).toHaveLength(1);
		expect(hostEl.childNodes[0].nodeType).toBe(8 /* COMMENT_NODE */);

		// The dead instance is destroyed and holds no store subscription.
		expect(instances).toHaveLength(1);
		expect(instances[0].isDestroyed).toBe(true);
		expect(store.keysBySubscriber.has(instances[0])).toBe(false);
	});
});

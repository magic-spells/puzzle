// @vitest-environment jsdom
//
// Regression: a render() that returns null must EMPTY the view's DOM.
//
// #renderNow() rendered with `if (tree) this.#vm.render(tree)`, so a HAND-WRITTEN
// render() (compiled templates always emit a root vnode) that returned a vnode on
// one pass and null on the next silently left the PREVIOUS DOM on screen — stale
// content, live listeners, and nested component instances that were never
// destroyed. The null branch now clears the manager's tree and re-anchors at the
// same position, so the DOM empties and a later truthy tree mounts back in place
// and stays interactive.
//
// Harness follows tests/mount-enter-hook-guard.test.js (rAF-scheduled setData
// re-renders need several macrotask ticks to land).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

// setData re-renders schedule through requestAnimationFrame (jsdom fires that on a
// ~16ms timer) — flush past a few ticks plus microtask drains.
const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 20));
		await Promise.resolve();
	}
};

// A view whose render() is null-able from local state: `hide` blanks it, `n` is
// the visible payload so a later re-render is observably live.
class Toggling extends PuzzleView {
	render() {
		const { hide, n } = this.getData();
		if (hide) return null;
		return h('div', { class: 'body' }, [text(String(n ?? 0))]);
	}
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('render() returning null clears the mounted DOM', () => {
	it('vnode → null empties the DOM; null → vnode mounts fresh and stays interactive', async () => {
		const el = container();
		const v = await new Toggling().mount(el);
		expect(el.querySelector('.body')).not.toBeNull();
		expect(el.querySelector('.body').textContent).toBe('0');

		// The stale-DOM bug: this render returns null and the previous tree stayed up.
		v.setData({ hide: true });
		await flush();
		expect(el.querySelector('.body')).toBeNull();
		expect(el.textContent).toBe(''); // nothing renderable left behind
		// The position is still held by a comment placeholder, so this.element stays a
		// live node for a parent's insertion refs (patch()/patchComponent read it).
		expect(v.element).not.toBeNull();
		expect(v.element.nodeType).toBe(8 /* COMMENT_NODE */);
		expect(v.element.isConnected).toBe(true);

		// Back to a real tree: it must mount fresh (the manager stayed reusable).
		v.setData({ hide: false, n: 1 });
		await flush();
		expect(el.querySelector('.body')).not.toBeNull();
		expect(el.querySelector('.body').textContent).toBe('1');

		// And the re-mounted tree still patches — the view is not a one-shot corpse.
		v.setData({ n: 2 });
		await flush();
		expect(el.querySelector('.body').textContent).toBe('2');

		v.destroy();
	});

	it('the re-mounted tree lands at its ORIGINAL position among container siblings', async () => {
		const el = container();
		const v = await new Toggling().mount(el);
		// A sibling AFTER the view's root: a naive clear() would drop the position and
		// the later re-render would append past this node.
		const tail = document.createElement('i');
		tail.id = 'tail';
		el.appendChild(tail);

		v.setData({ hide: true });
		await flush();
		expect(el.querySelector('.body')).toBeNull();
		expect(el.lastElementChild).toBe(tail); // still the last element

		v.setData({ hide: false, n: 7 });
		await flush();
		const body = el.querySelector('.body');
		expect(body).not.toBeNull();
		expect(body.textContent).toBe('7');
		expect(body.nextElementSibling).toBe(tail); // re-mounted BEFORE the sibling

		v.destroy();
	});

	it('repeated null renders do not stack up placeholder nodes', async () => {
		const el = container();
		const v = await new Toggling().mount(el);

		v.setData({ hide: true });
		await flush();
		v.setData({ hide: true, n: 1 });
		await flush();
		v.setData({ hide: true, n: 2 });
		await flush();

		expect(el.childNodes).toHaveLength(1);
		expect(el.childNodes[0].nodeType).toBe(8 /* COMMENT_NODE */);

		v.setData({ hide: false, n: 3 });
		await flush();
		expect(el.childNodes).toHaveLength(1);
		expect(el.querySelector('.body').textContent).toBe('3');

		v.destroy();
	});

	it('null on the FIRST render mounts nothing, never throws, and a later tree works', async () => {
		const el = container();
		class LateStart extends PuzzleView {
			render() {
				return this.getData().ready ? h('div', { class: 'body' }, [text('ok')]) : null;
			}
		}
		const v = await new LateStart().mount(el); // must not throw
		expect(el.querySelector('.body')).toBeNull();
		expect(el.textContent).toBe('');
		// The mount-time anchor still holds the spot — nothing was cleared or stacked.
		expect(el.childNodes).toHaveLength(1);
		expect(el.childNodes[0].nodeType).toBe(8 /* COMMENT_NODE */);
		expect(v.element).toBe(el.childNodes[0]);

		v.setData({ ready: true });
		await flush();
		expect(el.querySelector('.body')).not.toBeNull();
		expect(el.querySelector('.body').textContent).toBe('ok');
		expect(el.childNodes).toHaveLength(1); // the anchor was consumed, not orphaned

		v.destroy();
	});

	it('clearing to null destroys nested component instances (no leaked children)', async () => {
		const el = container();
		const mounted = [];
		class Child extends PuzzleView {
			mounted() {
				mounted.push(this);
			}
			render() {
				return h('span', { class: 'child' }, [text('c')]);
			}
		}
		class Host extends PuzzleView {
			render() {
				if (this.getData().hide) return null;
				return h('div', { class: 'body' }, [new ViewNode(Child, {}, [])]);
			}
		}
		const host = await new Host().mount(el);
		await flush();
		expect(el.querySelector('.child')).not.toBeNull();
		expect(mounted).toHaveLength(1);

		host.setData({ hide: true });
		await flush();
		expect(el.querySelector('.child')).toBeNull();
		expect(mounted[0].isDestroyed).toBe(true); // torn down with the cleared tree

		host.setData({ hide: false });
		await flush();
		expect(el.querySelector('.child')).not.toBeNull();
		expect(mounted).toHaveLength(2); // a FRESH child instance mounted
		expect(mounted[1].isDestroyed).toBe(false);

		host.destroy();
	});
});

describe('render() null does not disturb the skeleton path', () => {
	it('a skeleton renders before load and the loaded swap still replaces it', async () => {
		const el = container();
		let resolveData;
		class Skel extends PuzzleView {
			async data() {
				await new Promise((r) => {
					resolveData = r;
				});
				return { n: 5 };
			}
			renderSkeleton() {
				return h('div', { class: 'skeleton' }, [text('...')]);
			}
			render() {
				return h('div', { class: 'body' }, [text(String(this.getData().n))]);
			}
		}
		const v = new Skel();
		v.mount(el);
		await flush();
		expect(el.querySelector('.skeleton')).not.toBeNull();
		expect(v.loaded).toBe(false);

		resolveData();
		await flush();
		expect(el.querySelector('.skeleton')).toBeNull();
		expect(el.querySelector('.body').textContent).toBe('5');
		expect(v.loaded).toBe(true);

		v.destroy();
	});
});

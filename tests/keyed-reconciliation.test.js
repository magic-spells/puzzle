// @vitest-environment jsdom
// Keyed reconciliation identity (batch-2 hardening): the (tag, key) pair is
// compared by native SameValueZero via tag-partitioned nested Maps, NOT by
// `tag + '\x00' + key` string concatenation. Concatenation collapsed keys that
// only differ by type (`1` vs `"1"`, `NaN` vs `"NaN"`) and stringified component
// class tags to their source — unmounting a live row, aliasing two logical rows
// onto one DOM node, and firing a false duplicate-key warning. Plus: a component
// whose FIRST mount throws is torn down and replaced by a fresh working instance
// on the next render (not reused forever in a permanently-broken state).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);
// setData re-renders schedule through requestAnimationFrame (jsdom fires that on a
// ~16ms timer), and a fresh child mount then resolves data() across microtasks —
// so flush past several rAF ticks + microtask drains.
const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 20));
		await Promise.resolve();
	}
};

function mount(tree) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const vm = new ViewManager(container);
	vm.render(tree);
	return { vm, container };
}

// Each row's text encodes its key value AND type, so a collision (one node reused
// for two logical rows) is visible as a wrong/duplicated label.
const stamp = (k) => `${String(k)}@${typeof k}`;
const list = (keys) => h('ul', {}, keys.map((k) => h('li', { key: k }, [text(stamp(k))])));

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('keyed identity — type-preserving (tag, key) pairs', () => {
	it('sibling keys 1 (number) and "1" (string) stay distinct — no collision, no false warning', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { vm, container } = mount(list([1, '1']));
		const [liNum, liStr] = [...container.querySelectorAll('li')];
		expect(liNum.textContent).toBe('1@number');
		expect(liStr.textContent).toBe('1@string');

		// Reorder: the SAME two nodes move; neither is torn down or aliased.
		vm.render(list(['1', 1]));
		const after = [...container.querySelectorAll('li')];
		expect(after).toHaveLength(2);
		expect(after[0]).toBe(liStr); // "1" now first — same node, moved
		expect(after[1]).toBe(liNum); // 1 now second — same node, moved
		expect(after[0].textContent).toBe('1@string');
		expect(after[1].textContent).toBe('1@number');
		expect(warn).not.toHaveBeenCalled();
	});

	it('NaN (number) and "NaN" (string) keys stay distinct; a NaN key self-matches', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { vm, container } = mount(list([NaN, 'NaN']));
		const [liNum, liStr] = [...container.querySelectorAll('li')];
		expect(liNum.textContent).toBe('NaN@number');
		expect(liStr.textContent).toBe('NaN@string');

		// Re-render identical: NaN matches NaN (SameValueZero) — same nodes reused,
		// no remount, no duplicate warning despite two "NaN"-stringifying keys.
		vm.render(list([NaN, 'NaN']));
		const after = [...container.querySelectorAll('li')];
		expect(after[0]).toBe(liNum);
		expect(after[1]).toBe(liStr);
		expect(warn).not.toHaveBeenCalled();
	});

	it('true (boolean) and "true" (string) keys stay distinct', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { vm, container } = mount(list([true, 'true']));
		const [liBool, liStr] = [...container.querySelectorAll('li')];
		vm.render(list([true, 'true']));
		const after = [...container.querySelectorAll('li')];
		expect(after[0]).toBe(liBool);
		expect(after[1]).toBe(liStr);
		expect(after[0].textContent).toBe('true@boolean');
		expect(after[1].textContent).toBe('true@string');
		expect(warn).not.toHaveBeenCalled();
	});

	it('component vnodes of identical source but different classes share a key without a false warning', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// Two classes with byte-identical source but distinct identity — old
		// `String(tag)` concatenation made them collide; identity-keyed maps do not.
		const makeComp = () =>
			class extends PuzzleView {
				render() {
					return h('span', { class: 'c' }, [text('x')]);
				}
			};
		const A = makeComp();
		const B = makeComp();
		const tree = () => h('ul', {}, [comp(A, { key: 'k' }), comp(B, { key: 'k' })]);
		const { vm } = mount(tree());
		await flush();
		vm.render(tree()); // keyed patch pass — where the collision warning would fire
		await flush();
		expect(warn).not.toHaveBeenCalled();
	});

	it('a genuine duplicate (same tag AND same key) still warns', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { vm } = mount(list(['dup', 'dup']));
		vm.render(list(['dup', 'dup'])); // keyed patch pass detects the real duplicate
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('duplicate key');
	});
});

describe('first-mount failure recovery', () => {
	it('a child whose first mount throws is replaced by a fresh working instance next render', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		let shouldThrow = true;
		const mountedInstances = [];

		class Child extends PuzzleView {
			data() {
				if (shouldThrow) throw new Error('boom');
				return { ok: true };
			}
			mounted() {
				mountedInstances.push(this);
			}
			render() {
				return h('span', { class: 'child' }, [text(this.getData()?.ok ? 'ok' : 'no')]);
			}
		}

		class Host extends PuzzleView {
			render() {
				return h('div', { id: 'host' }, [comp(Child, { n: this.getData()?.n ?? 0 })]);
			}
		}

		const el = document.createElement('div');
		document.body.appendChild(el);
		const host = await new Host().mount(el);
		await flush(); // let the rejected child-mount microtask settle

		// First mount threw: error logged, no child content rendered, mounted() never fired.
		expect(err).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		expect(el.querySelector('.child')).toBe(null);
		expect(mountedInstances).toHaveLength(0);

		// data() will now succeed; force the host to re-render this position.
		shouldThrow = false;
		host.setData({ n: 1 });
		await flush();

		const child = el.querySelector('.child');
		expect(child).not.toBe(null);
		expect(child.textContent).toBe('ok');
		expect(mountedInstances).toHaveLength(1); // a FRESH instance mounted and fired mounted()

		// And the fresh instance is live — a local re-render works.
		mountedInstances[0].setData({});
		await flush();
		expect(el.querySelector('.child').textContent).toBe('ok');
	});

	it('a failed-mount child that is removed before recovery leaves no stray placeholder', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		class Child extends PuzzleView {
			data() {
				throw new Error('boom');
			}
			render() {
				return h('span', { class: 'child' }, []);
			}
		}
		class Host extends PuzzleView {
			render() {
				const show = this.getData()?.show ?? true;
				return h('div', { id: 'host' }, show ? [comp(Child, {})] : []);
			}
		}
		const el = document.createElement('div');
		document.body.appendChild(el);
		const host = await new Host().mount(el);
		await flush();
		expect(err).toHaveBeenCalled();

		host.setData({ show: false }); // unmount the failed child
		await flush();
		// No leftover comment placeholder or element under #host.
		expect(el.querySelector('#host').childNodes).toHaveLength(0);
	});
});

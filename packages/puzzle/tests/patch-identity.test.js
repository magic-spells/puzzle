// @vitest-environment jsdom
//
// The identity short-circuit in patch() (D170): the
// same vnode OBJECT on both sides of a patch means the same `el`, the
// same attrs object, the same children array and the same component instance, so
// the subtree is skipped entirely. It is the one line that makes a list block's
// cached rows and the compiler's cached static subtrees free to reconcile.
//
// "Skipped" is asserted two ways, because zero DOM mutations alone would not
// prove it — an equal-but-distinct copy also writes nothing. A MutationObserver
// shows the DOM was not touched; a counting getter on the vnode's `children`
// shows the subtree was not even WALKED.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewManager, patch } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);

// A child mount resolves data() across microtasks and setData re-renders through
// rAF (jsdom fires that on a ~16ms timer) — the same flush the keyed
// reconciliation suite uses.
const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 20));
		await Promise.resolve();
	}
};

function mount(tree) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const vm = new ViewManager(container, {});
	vm.render(tree);
	return { vm, container };
}

/** Count how many times the patcher reaches into this vnode's children. */
function countChildReads(vnode) {
	const kids = vnode.children;
	const counter = { reads: 0 };
	Object.defineProperty(vnode, 'children', {
		configurable: true,
		get() {
			counter.reads++;
			return kids;
		},
		set(value) {
			// island/inline-SVG carry-forward assigns children; keep it working.
			Object.defineProperty(vnode, 'children', { value, writable: true, configurable: true });
		},
	});
	return counter;
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('patch() identity short-circuit', () => {
	it('does no DOM work below a subtree that is the same object', () => {
		const cached = h('header', { class: 'shell' }, [
			h('h1', { class: 'title' }, [text('Puzzle')]),
			h('p', {}, [text('a quiet place')]),
		]);
		const { vm, container } = mount(h('div', {}, [cached, h('span', {}, [text('0')])]));
		const headerEl = container.querySelector('header');

		const observer = new MutationObserver(() => {});
		observer.observe(container, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
		});

		// A fresh root and a fresh dynamic sibling, with the SAME cached header.
		vm.render(h('div', {}, [cached, h('span', {}, [text('1')])]));

		const records = observer.takeRecords();
		observer.disconnect();
		// One characterData write, for the sibling that actually changed.
		expect(records).toHaveLength(1);
		expect(records[0].type).toBe('characterData');
		// The element is the very same node, still in place and still correct.
		expect(container.querySelector('header')).toBe(headerEl);
		expect(headerEl.textContent).toBe('Puzzlea quiet place');
	});

	it('does not WALK a subtree that is the same object', () => {
		const cached = h('header', { class: 'shell' }, [h('h1', {}, [text('Puzzle')])]);
		const { vm, container } = mount(h('div', {}, [cached, h('span', {}, [text('0')])]));
		const next = h('div', {}, [cached, h('span', {}, [text('1')])]);

		// patch() directly rather than vm.render(): expandSlots walks every tree on
		// its way in (it has to find markers, and a cached subtree can hold none —
		// per-site marker analysis is explicitly out of scope for 0.8.0), so the
		// claim under test is about the PATCHER, not about the whole render.
		const reads = countChildReads(cached);
		patch(vm.currentTree, next, container, {}, null);

		expect(reads.reads).toBe(0);
		expect(container.querySelector('span').textContent).toBe('1');
	});

	it('re-asserts a drifted controlled value from the cached subtree\'s control list', () => {
		const input = h('input', { type: 'text', value: 'state' }, []);
		const row = h('label', {}, [input]);
		// What listBlock attaches when meta.ctrl is set on the site.
		row.controls = [input];

		const { vm, container } = mount(h('form', {}, [row]));
		const el = container.querySelector('input');
		expect(el.value).toBe('state');

		// The user typed without committing (a change-committed field, a held IME
		// composition): the live DOM disagrees with state and no vnode compare can
		// see it.
		el.value = 'typed';
		vm.render(h('form', {}, [row]));

		expect(el.value).toBe('state');
	});

	it('leaves a control-free cached subtree completely alone', () => {
		const cached = h('p', {}, [text('static')]);
		const { vm, container } = mount(h('div', {}, [cached]));
		const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
		const insertBefore = vi.spyOn(Node.prototype, 'insertBefore');

		vm.render(h('div', {}, [cached]));

		expect(setAttribute).not.toHaveBeenCalled();
		expect(insertBefore).not.toHaveBeenCalled();
		expect(container.querySelector('p').textContent).toBe('static');
	});

	it('still diffs a distinct but equal vnode (the short-circuit is identity, not equality)', () => {
		const make = () => h('p', { class: 'x' }, [text('same')]);
		const first = make();
		const { vm } = mount(h('div', {}, [first]));
		const second = make();
		const reads = countChildReads(second);

		vm.render(h('div', {}, [second]));

		expect(reads.reads).toBeGreaterThan(0);
	});
});

describe('a cached component vnode across an unmount', () => {
	it('constructs a FRESH instance when a branch toggle mounts it again', async () => {
		const instances = [];
		class Panel extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				instances.push(this);
			}

			render() {
				return h('p', { class: 'panel' }, [text('panel')]);
			}
		}

		// The row/static cache hands back the SAME component vnode every render.
		const cachedPanel = comp(Panel, { key: 'p' }, []);
		const tree = (on) => h('div', {}, [on ? cachedPanel : h('#')]);

		const { vm, container } = mount(tree(true));
		await flush();
		expect(instances).toHaveLength(1);
		expect(container.querySelector('.panel')).not.toBe(null);

		// Branch off: the vnode is unmounted and its instance destroyed. Its links
		// are dropped, so the vnode carries no corpse back into the tree.
		vm.render(tree(false));
		await flush();
		expect(instances[0].isDestroyed).toBe(true);
		expect(cachedPanel.component).toBe(null);
		expect(container.querySelector('.panel')).toBe(null);

		// Branch on again (walkthrough G): mounting the SAME vnode must build a new
		// instance — adopting the destroyed one would mount a view whose mounted(),
		// setData() and refresh() are all inert, with no diagnostic.
		vm.render(tree(true));
		await flush();
		expect(instances).toHaveLength(2);
		expect(instances[1]).not.toBe(instances[0]);
		expect(container.querySelector('.panel').textContent).toBe('panel');

		// And the fresh instance is live.
		instances[1].setData({ n: 1 });
		await flush();
		expect(container.querySelector('.panel').textContent).toBe('panel');
	});

	it('refreshes a cached row\'s el when its child replaced its root', async () => {
		// A component-mode skeleton whose root tag differs from the real template's:
		// when data() lands, the patcher REPLACES the root, so `child.element` moves
		// to a node the parent's cached vnode has never seen. patchComponent re-reads
		// `child.element` on every parent render for exactly this reason; the
		// identity short-circuit has to do the same, because patchKeyedChildren uses
		// `newChild.el` as its move guard AND as the next insertion ref — a stale one
		// splices the detached skeleton node back into the list.
		class Row extends PuzzleView {
			async data() {
				await Promise.resolve();
				return { text: this.props.label };
			}

			renderSkeleton() {
				return h('div', { class: 'skeleton' }, []);
			}

			render() {
				return h('li', { class: 'row', 'data-id': this.props.id }, [
					text(this.getData().text),
				]);
			}
		}

		// The same vnode objects on every render — what a list block hands back.
		const rowA = comp(Row, { key: 'a', id: 'a', label: 'A' }, []);
		const rowB = comp(Row, { key: 'b', id: 'b', label: 'B' }, []);
		const { vm, container } = mount(h('ul', {}, [rowA, rowB]));
		await flush();

		const list = container.querySelector('ul');
		expect([...list.querySelectorAll('li')].map((li) => li.dataset.id)).toEqual(['a', 'b']);
		expect(list.querySelector('.skeleton')).toBe(null);

		// Reorder: the cached vnodes come back in the new order and the keyed
		// patcher moves their elements.
		vm.render(h('ul', {}, [rowB, rowA]));
		await flush();

		expect([...list.children].map((node) => node.dataset?.id)).toEqual(['b', 'a']);
		// The detached skeleton roots stay detached — no zombie node was re-inserted.
		expect(list.querySelector('.skeleton')).toBe(null);
		expect(list.children).toHaveLength(2);
	});

	it('mounts a fresh child at a cached vnode whose TAKEOVER mount failed', async () => {
		const instances = [];
		class Panel extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				instances.push(this);
			}

			render() {
				return h('p', { class: 'panel' }, [text('panel')]);
			}
		}

		// The shape ssg/preload.js leaves when a nested component's takeover
		// preparation throws: mountComponent parks a bare comment and never
		// constructs a child, so the vnode has NO instance at all.
		const cached = comp(Panel, { key: 'p' }, []);
		cached.takeoverFailed = true;
		const { vm, container } = mount(h('div', {}, [cached]));
		await flush();

		expect(instances).toHaveLength(0);
		expect(cached.component).toBe(null);
		expect(container.querySelector('.panel')).toBe(null);

		// The ordinary next render. A freshly emitted vnode would arrive without the
		// flag; a CACHED one is the same object, so the short-circuit is what decides
		// whether the position can ever recover — with `component === null` treated
		// as "not describing the DOM", it falls through to patch()'s recovery arm and
		// mounts a fresh child over the placeholder.
		cached.takeoverFailed = false;
		vm.render(h('div', {}, [cached]));
		await flush();

		expect(instances).toHaveLength(1);
		expect(container.querySelector('.panel')?.textContent).toBe('panel');
		expect(container.querySelector('.panel')).toBe(cached.component.element);
	});

	it('ignores a PINNED instance that is already destroyed', async () => {
		const instances = [];
		class Pinned extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				instances.push(this);
			}

			render() {
				return h('p', { class: 'pinned' }, [text('pinned')]);
			}
		}

		// A takeover/router pin whose instance died before this mount (the shape
		// preload.js leaves on a cached tree after a branch toggle).
		const dead = new Pinned({});
		dead.destroy();
		const vnode = comp(Pinned, { key: 'x' }, []);
		vnode.instance = dead;

		const { container } = mount(h('div', {}, [vnode]));
		await flush();

		expect(instances).toHaveLength(2);
		expect(vnode.component).toBe(instances[1]);
		expect(container.querySelector('.pinned')).not.toBe(null);
	});
});

describe('failed-mount recovery survives the unmount link-dropping', () => {
	it('remounts a fresh instance at a CACHED vnode whose first mount threw', async () => {
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
				return h('span', { class: 'child' }, [text('ok')]);
			}
		}

		// The same vnode object on every render — the case the nulling in unmount()
		// must not disturb: NOTHING unmounted this vnode, it is still in the tree,
		// and patch()'s recovery arm has to find its destroyed instance through
		// `oldVnode.component` to know the position needs a fresh mount.
		const cachedChild = comp(Child, { key: 'c' }, []);
		const { vm, container } = mount(h('div', {}, [cachedChild]));
		await flush();

		expect(container.querySelector('.child')).toBe(null);
		expect(mountedInstances).toHaveLength(0);
		expect(cachedChild.component?.isDestroyed).toBe(true);
		expect(err).toHaveBeenCalled();

		shouldThrow = false;
		vm.render(h('div', {}, [cachedChild]));
		await flush();

		// Identity would short-circuit a healthy vnode — but the recovery arm runs
		// BEFORE any of that, because the old and new vnode here are the same object
		// only by accident of caching; what matters is the destroyed instance.
		expect(container.querySelector('.child')?.textContent).toBe('ok');
		expect(mountedInstances).toHaveLength(1);
	});
});

// @vitest-environment jsdom
//
// A cached vnode whose sibling INDEX moves (D170).
//
// `this.__c[n]` and a row's `s.c[n]` hand the patcher the SAME vnode object on
// every render. Index pairing assumed it also stays at the same index, but a
// variable-length unkeyed run before it — an unkeyed `{#for}` over primitives,
// slot content — shifts it. Paired with a different old vnode, the cached node
// was patched into a foreign element and then unmounted as a leftover, which
// removed the one element it describes and orphaned the original: the static
// markup duplicated and rows went missing. These tests pin that a shifted cached
// vnode keeps its own element, exactly once, in the right place.
import { afterEach, describe, expect, it } from 'vitest';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { listRows } from '../client-runtime/views/listBlock.js';
import { mountView, settled } from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const handles = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	document.body.innerHTML = '';
});

function setup() {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { vm: new ViewManager(container, {}), container };
}

/** A stand-in for a compiled static subtree: one object for every render. */
const buildStatic = () => h('li', { class: 'add' }, [h('b', {}, [text('Add')]), text(' a tag')]);

describe('a cached vnode behind an unkeyed run', () => {
	it('keeps its own element when the run shrinks, grows and empties', () => {
		const { vm, container } = setup();
		const S = buildStatic();
		const tree = (tags) => h('ul', {}, [...tags.map((t) => h('li', {}, [text(t)])), S]);

		vm.render(tree(['a', 'b']));
		const add = container.querySelector('.add');
		const html = () => container.querySelector('ul').innerHTML;

		for (const tags of [['a'], ['a', 'b'], [], ['x', 'y', 'z'], ['a']]) {
			vm.render(tree(tags));
			expect(html()).toBe(tags.map((t) => `<li>${t}</li>`).join('') + '<li class="add"><b>Add</b> a tag</li>');
			expect(container.querySelector('.add')).toBe(add);
			expect(S.el).toBe(add);
		}
	});

	it('keeps two cached siblings apart across a variable run between them', () => {
		const { vm, container } = setup();
		const head = h('li', { class: 'head' }, [h('b', {}, [text('Head')]), text('!')]);
		const S = buildStatic();
		const tree = (tags) => h('ul', {}, [head, ...tags.map((t) => h('li', {}, [text(t)])), S]);

		vm.render(tree(['a', 'b', 'c']));
		for (const tags of [['a'], [], ['p', 'q']]) {
			vm.render(tree(tags));
			const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
			expect(items).toEqual(['Head!', ...tags, 'Add a tag']);
		}
	});

	it('pairs a cached UNKEYED sibling with itself inside a keyed list', () => {
		// Keyed rows reconcile by key, but unkeyed siblings still pair
		// positionally among themselves — a variable unkeyed run shifts the
		// cached one exactly as in an unkeyed list.
		const { vm, container } = setup();
		const S = buildStatic();
		const tree = (notes) =>
			h('ul', {}, [
				h('li', { key: 'k1' }, [text('keyed')]),
				...notes.map((n) => h('li', { class: 'note' }, [text(n)])),
				S,
			]);

		vm.render(tree(['n1', 'n2']));
		const add = container.querySelector('.add');
		for (const notes of [['n1'], ['n1', 'n2', 'n3'], []]) {
			vm.render(tree(notes));
			const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
			expect(items).toEqual(['keyed', ...notes, 'Add a tag']);
			expect(container.querySelector('.add')).toBe(add);
		}
	});

	it("keeps a row's `s.c` subtree after the row's own inner unkeyed loop", () => {
		// A plain-object item is always dirty, so the row body re-runs every pass
		// while its `s.c[0]` stays the same object.
		const { vm, container } = setup();
		const view = new PuzzleView({});
		view.__dirty = 0;
		const meta = { key: (item) => item.id };
		const render = (parts) =>
			vm.render(
				h(
					'ul',
					{},
					listRows(
						view,
						view,
						0,
						[{ id: 1, parts }],
						(s) =>
							h('li', { key: s.k }, [
								...s.item.parts.map((p) => h('span', {}, [text(p)])),
								(s.c[0] ??= h('em', { class: 'tail' }, [h('b', {}, [text('t')]), text('ail')])),
							]),
						meta
					)
				)
			);

		render(['a', 'b']);
		const tail = container.querySelector('.tail');
		for (const parts of [['a'], ['a', 'b', 'c'], []]) {
			render(parts);
			expect(container.querySelector('li').innerHTML).toBe(
				parts.map((p) => `<span>${p}</span>`).join('') + '<em class="tail"><b>t</b>ail</em>'
			);
			expect(container.querySelector('.tail')).toBe(tail);
		}
	});

	it('does not destroy a component that lives inside the shifted subtree', async () => {
		let created = 0;
		let destroyed = 0;
		class Badge extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				created++;
			}
			render() {
				return h('i', { class: 'badge' }, [text('badge')]);
			}
			destroyed() {
				destroyed++;
			}
		}
		class Tags extends PuzzleView {
			data() {
				return { tags: ['a', 'b'] };
			}
			render() {
				const d = this.getData();
				return h('ul', {}, [
					...d.tags.map((t) => h('li', {}, [text(t)])),
					(this.__c[0] ??= h('li', { class: 'add' }, [new ViewNode(Badge, {}, []), text(' add')])),
				]);
			}
		}

		const view = await mountView(Tags);
		handles.push(view);
		for (const tags of [['a'], ['a', 'b'], []]) {
			view.instance.setData('tags', tags);
			await settled();
			expect(view.findAll('.badge')).toHaveLength(1);
			expect(view.findAll('li').map((li) => li.textContent)).toEqual([...tags, 'badge add']);
		}
		expect(created).toBe(1);
		expect(destroyed).toBe(0);
	});
});

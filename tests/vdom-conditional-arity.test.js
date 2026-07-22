// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ViewNode, PLACEHOLDER_TAG } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import serialize from '../client-runtime/ssg/serialize.js';

// A variable-length {#if}/{#case} branch used to shift every trailing sibling's
// index, so the indexed patcher tag-mismatched and DESTROYED + remounted them
// (toggling `{#if error}…{/if}` next to an <input> wiped the input's focus and
// uncontrolled text; a trailing <List/> fully remounted). Codegen now pads each
// branch with placeholder vnodes so its static arity is constant. These trees are
// built the way the padded codegen output now emits — a conditional contributes
// `[...real]` in one state and `[...real-or-placeholders]` of the SAME length in
// the other.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const ph = () => new ViewNode(PLACEHOLDER_TAG);

const setup = (ctx = {}) => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { container, vm: new ViewManager(container, ctx) };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('conditional arity — placeholder padding keeps trailing siblings', () => {
	it('preserves a trailing input node (identity + focus + uncontrolled text) across a toggle', () => {
		const { container, vm } = setup();

		// error=false → the conditional contributes a placeholder; error=true → a <p>.
		// The <input> carries no controlled `value`, so its typed text is uncontrolled
		// state that only survives if the element is not remounted.
		vm.render(h('div', {}, [ph(), h('input', { placeholder: 'name' })]));
		const input = container.querySelector('input');
		input.value = 'half-typed';
		input.focus();
		expect(document.activeElement).toBe(input);

		// toggle error ON
		vm.render(h('div', {}, [h('p', {}, [text('Bad input')]), h('input', { placeholder: 'name' })]));
		expect(container.querySelector('input')).toBe(input); // SAME node, not remounted
		expect(input.value).toBe('half-typed'); // uncontrolled text kept
		expect(document.activeElement).toBe(input); // focus kept
		expect(container.querySelector('p').textContent).toBe('Bad input');

		// toggle error OFF again — placeholder replaces the <p>, input still stable
		vm.render(h('div', {}, [ph(), h('input', { placeholder: 'name' })]));
		expect(container.querySelector('input')).toBe(input);
		expect(input.value).toBe('half-typed');
		expect(container.querySelector('p')).toBeNull();
	});

	it('does not destroy or recreate a trailing component when the conditional toggles', async () => {
		const destroyed = vi.fn();
		let instances = 0;
		class List extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				instances++;
			}
			destroyed() {
				destroyed();
			}
			render() {
				return h('ul', { class: 'list' }, [h('li', {}, [text('row')])]);
			}
		}

		const ctx = { store: null, router: null, formatters: null };
		const { container, vm } = setup(ctx);

		// loading=false → placeholder ahead of the <List/>
		vm.render(h('div', {}, [ph(), comp(List)]));
		await tick();
		const instance = vm.currentTree.children[1].component;
		expect(instance).toBeInstanceOf(List);
		expect(instances).toBe(1);

		// loading=true → a spinner replaces the placeholder; the List rides along
		vm.render(h('div', {}, [h('span', { class: 'spin' }, [text('…')]), comp(List)]));
		await tick();
		expect(destroyed).not.toHaveBeenCalled();
		expect(instances).toBe(1); // no new instance constructed
		expect(vm.currentTree.children[1].component).toBe(instance); // same instance reused

		// toggle back
		vm.render(h('div', {}, [ph(), comp(List)]));
		await tick();
		expect(destroyed).not.toHaveBeenCalled();
		expect(instances).toBe(1);
		expect(vm.currentTree.children[1].component).toBe(instance);
	});

	it('keyed container: keyed rows + unkeyed siblings around a toggling conditional keep identity', () => {
		const { container, vm } = setup();

		const tree = (cond) =>
			h('div', {}, [
				cond ? h('span', { class: 'warn' }, [text('!')]) : ph(),
				h('li', { key: 'a' }, [text('a')]),
				h('li', { key: 'b' }, [text('b')]),
				h('input', { placeholder: 'trailing' }),
			]);

		vm.render(tree(false)); // [placeholder, li-a, li-b, input] — keyed path (rows keyed)
		const input = container.querySelector('input');
		const rowA = [...container.querySelectorAll('li')].find((n) => n.textContent === 'a');
		input.value = 'kept';

		vm.render(tree(true)); // [span, li-a, li-b, input]
		expect(container.querySelector('input')).toBe(input); // unkeyed trailing preserved
		expect(input.value).toBe('kept');
		expect([...container.querySelectorAll('li')].find((n) => n.textContent === 'a')).toBe(rowA);
		expect(container.querySelector('.warn').textContent).toBe('!');

		vm.render(tree(false)); // back to placeholder
		expect(container.querySelector('input')).toBe(input);
		expect(input.value).toBe('kept');
		expect(container.querySelector('.warn')).toBeNull();
	});

	it('case-style branches of different real lengths stay arity-stable (padded)', () => {
		const { container, vm } = setup();

		// A {#case} whose 2-item clause and 1-item clause are both padded to length 2,
		// with a trailing sibling after the case spread. Toggling which branch is live
		// must not disturb the trailing input.
		const twoItemBranch = () => [h('span', {}, [text('a1')]), h('span', {}, [text('a2')])];
		const oneItemBranch = () => [h('span', {}, [text('b1')]), ph()];

		const tree = (branch) => h('div', {}, [...branch(), h('input', { placeholder: 't' })]);

		vm.render(tree(oneItemBranch)); // [b1, placeholder, input]
		const input = container.querySelector('input');
		input.value = 'stable';

		vm.render(tree(twoItemBranch)); // [a1, a2, input]
		expect(container.querySelector('input')).toBe(input);
		expect(input.value).toBe('stable');

		vm.render(tree(oneItemBranch)); // back
		expect(container.querySelector('input')).toBe(input);
		expect(input.value).toBe('stable');
	});

	it('SSG serializer emits nothing for a placeholder vnode', async () => {
		expect(await serialize(ph())).toBe('');
		// A placeholder inside a tree contributes no markup at all.
		const html = await serialize(h('div', {}, [ph(), h('span', {}, [text('x')]), ph()]));
		expect(html).toBe('<div><span>x</span></div>');
	});
});

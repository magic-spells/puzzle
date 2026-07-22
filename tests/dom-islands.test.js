// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';

// DOM islands (v1.13, D44): a static `island` attr freezes an element's children
// after the template seeds them once — the patcher never reconciles them again,
// while the element's own attrs/listeners keep patching. See DOC-SPEC §17.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const setup = () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { container, vm: new ViewManager(container) };
};

describe('ViewManager — DOM islands (island attr)', () => {
	it('mounts the island children from the template seed on first render', () => {
		const { container, vm } = setup();
		vm.render(h('div', { island: true }, [text('hello'), h('span', {}, [text('kid')])]));
		expect(container.innerHTML).toBe('<div>hello<span>kid</span></div>');
	});

	it('never emits `island` as a DOM attribute', () => {
		const { container, vm } = setup();
		vm.render(h('div', { island: true, id: 'x' }, [text('s')]));
		const div = container.firstChild;
		expect(div.hasAttribute('island')).toBe(false);
		expect(div.getAttribute('island')).toBe(null);
		expect(div.id).toBe('x'); // real attrs still land
	});

	it('carries old children forward: an external DOM mutation survives re-render', () => {
		const { container, vm } = setup();
		vm.render(h('div', { island: true }, [text('seed')]));
		const div = container.firstChild;

		// Simulate the browser / a third party owning the subtree: edit the text
		// node and splice in a node the vnode tree knows nothing about.
		div.firstChild.nodeValue = 'edited by browser';
		div.appendChild(document.createElement('b'));

		// Re-render with DIFFERENT island children — the patcher must not touch them.
		vm.render(h('div', { island: true }, [text('NEW from store')]));
		expect(container.firstChild).toBe(div); // same node
		expect(div.innerHTML).toBe('edited by browser<b></b>');

		// Carried-children invariant: a SECOND re-render (whose oldVnode children are
		// the ones carried forward, holding the live `el` links) still leaves it alone.
		vm.render(h('div', { island: true }, [text('NEWER'), h('em', {}, [text('x')])]));
		expect(container.firstChild).toBe(div);
		expect(div.innerHTML).toBe('edited by browser<b></b>');
	});

	it('patches attributes and listeners ON the island element itself', () => {
		const { container, vm } = setup();
		const fn1 = vi.fn();
		const fn2 = vi.fn();
		vm.render(h('div', { island: true, class: 'a', '@click': fn1 }, [text('seed')]));
		const div = container.firstChild;
		expect(div.className).toBe('a');

		// Browser edits the island internals.
		div.firstChild.nodeValue = 'edited';

		// Re-render: change class + swap the click handler; children ignored.
		vm.render(h('div', { island: true, class: 'b', '@click': fn2 }, [text('ignored')]));
		expect(div.className).toBe('b'); // attribute patched
		expect(div.firstChild.nodeValue).toBe('edited'); // children untouched

		div.click();
		expect(fn2).toHaveBeenCalledTimes(1); // swapped handler fires
		expect(fn1).not.toHaveBeenCalled(); // old handler gone
	});

	it('keyed island moves on reorder with its mutated DOM intact', () => {
		const { container, vm } = setup();
		vm.render(
			h('ul', {}, [
				h('li', { key: 'a', island: true }, [text('A')]),
				h('li', { key: 'b', island: true }, [text('B')]),
			])
		);
		const ul = container.firstChild;
		const liA = ul.children[0];
		const liB = ul.children[1];

		// External mutation inside island A.
		liA.firstChild.nodeValue = 'A-edited';
		liA.appendChild(document.createElement('i'));

		// Reorder to [B, A] with different seed children vnodes.
		vm.render(
			h('ul', {}, [
				h('li', { key: 'b', island: true }, [text('B2')]),
				h('li', { key: 'a', island: true }, [text('A2')]),
			])
		);

		expect(ul.children[0]).toBe(liB); // moved, same node identity
		expect(ul.children[1]).toBe(liA); // moved, same node identity
		expect(liA.textContent).toBe('A-edited'); // mutated DOM intact
		expect(liA.querySelector('i')).not.toBeNull();
	});

	it('a tag change replaces the node and re-seeds from the new template children', () => {
		const { container, vm } = setup();
		vm.render(h('div', { island: true }, [text('seed')]));
		const div = container.firstChild;
		div.firstChild.nodeValue = 'edited';

		vm.render(h('section', { island: true }, [text('fresh seed')]));
		const replaced = container.firstChild;
		expect(replaced).not.toBe(div);
		expect(replaced.tagName).toBe('SECTION');
		expect(replaced.textContent).toBe('fresh seed');
	});

	it('a key change replaces the node and re-seeds (the sanctioned island reset)', () => {
		const { container, vm } = setup();
		vm.render(h('div', { key: 'k1', island: true }, [text('seed')]));
		const div = container.firstChild;
		div.firstChild.nodeValue = 'edited';

		vm.render(h('div', { key: 'k2', island: true }, [text('fresh')]));
		expect(container.firstChild).not.toBe(div); // replaced
		expect(container.firstChild.textContent).toBe('fresh');
	});
});

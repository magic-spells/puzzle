// @vitest-environment jsdom
//
// A controlled input passed as SLOT CONTENT inside a cached row (D170, D147).
//
// `{#for t in todos}<Card><input value={ t.title } @change={ … }></Card>{/for}`:
// the compiler marks the site `ctrl` because the input sits in the Card's
// children, and those children are the PARENT's vnodes — the Card places them
// by reference through `<Children/>`. When the row comes back cached the patch
// stops at the Card vnode's identity short-circuit, so the Card never receives
// applyParentUpdate and never re-renders; the row's `controls` list is the only
// thing left to put the controlled value back after the user typed without
// committing. It has to reach through the component vnode into its slot content.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { listRows } from '../client-runtime/views/listBlock.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 20));
		await Promise.resolve();
	}
};

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

class Card extends PuzzleView {
	render() {
		return h('div', { class: 'card' }, [new ViewNode(SLOT_TAG, {}, [])]);
	}
}

class Row extends PuzzleView {
	render() {
		return h('div', { class: 'row' }, [text('own')]);
	}
}

function setup(factory) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const vm = new ViewManager(container, {});
	const view = new PuzzleView({});
	view.__dirty = 0;
	const meta = { key: (item) => item, ctrl: true };
	const render = () => vm.render(h('ul', {}, listRows(view, view, 0, ['a'], factory, meta)));
	return { container, render };
}

describe('a cached row re-asserts controls in its components’ slot content', () => {
	it('resets a typed-but-uncommitted input inside <Card> slot content', async () => {
		const { container, render } = setup((s) =>
			h(Card, { key: s.k }, [h('input', { class: 'bound', value: 'bound' }, [])])
		);
		render();
		await flush();

		const bound = container.querySelector('.bound');
		expect(bound.value).toBe('bound');
		bound.value = 'typed';

		// An unrelated parent re-render: the row is a cache hit.
		render();
		await flush();

		expect(container.querySelector('.bound')).toBe(bound);
		expect(bound.value).toBe('bound');
	});

	it("reaches a control nested under an element inside the slot content, not the component's own", async () => {
		const { container, render } = setup((s) =>
			h('li', { key: s.k }, [
				h(Card, {}, [h('label', {}, [h('input', { class: 'bound', type: 'checkbox', checked: true }, [])])]),
				h(Row, {}, []),
			])
		);
		render();
		await flush();

		const box = container.querySelector('.bound');
		expect(box.checked).toBe(true);
		box.checked = false;

		render();
		await flush();

		expect(box.checked).toBe(true);
		expect(container.querySelector('.row').textContent).toBe('own');
	});
});

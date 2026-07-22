// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const setup = () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { container, vm: new ViewManager(container) };
};

describe('ViewManager — mount & patch', () => {
	it('mounts a tree with elements, text, and attributes', () => {
		const { container, vm } = setup();
		vm.render(h('section', { class: 'app', id: 'root' }, [
			h('h1', {}, [text('Todos')]),
			text('plain'),
		]));

		expect(container.innerHTML).toBe('<section class="app" id="root"><h1>Todos</h1>plain</section>');
	});

	it('keeps patching forever — regression for the freeze-after-2-renders bug', () => {
		const { container, vm } = setup();
		// The prototype lost liveElement links after the first patch cycle;
		// render 5 generations and require every one to hit the DOM.
		for (let i = 1; i <= 5; i++) {
			vm.render(h('div', {}, [h('span', {}, [text(`gen ${i}`)])]));
			expect(container.textContent).toBe(`gen ${i}`);
		}
	});

	it('patches in place: unchanged elements keep their DOM node', () => {
		const { container, vm } = setup();
		vm.render(h('div', { class: 'a' }, [text('one')]));
		const el = container.firstChild;

		vm.render(h('div', { class: 'b' }, [text('two')]));
		expect(container.firstChild).toBe(el); // same node, mutated
		expect(el.className).toBe('b');
		expect(el.textContent).toBe('two');
	});

	it('replaces when the tag changes', () => {
		const { container, vm } = setup();
		vm.render(h('span', {}, [text('x')]));
		vm.render(h('em', {}, [text('x')]));
		expect(container.innerHTML).toBe('<em>x</em>');
	});

	it('adds and removes children at the tail (index alignment)', () => {
		const { container, vm } = setup();
		vm.render(h('ul', {}, [h('li', {}, [text('a')])]));
		vm.render(h('ul', {}, [h('li', {}, [text('a')]), h('li', {}, [text('b')])]));
		expect(container.querySelectorAll('li')).toHaveLength(2);

		vm.render(h('ul', {}, [h('li', {}, [text('a')])]));
		expect(container.querySelectorAll('li')).toHaveLength(1);
	});

	it('inserts correctly among text-node siblings — regression for children/childNodes indexing', () => {
		const { container, vm } = setup();
		vm.render(h('p', {}, [text('count: '), text('1')]));
		vm.render(h('p', {}, [text('count: '), h('b', {}, [text('2')]), text(' items')]));
		expect(container.querySelector('p').innerHTML).toBe('count: <b>2</b> items');
	});
});

describe('ViewManager — form bindings (properties, not attributes)', () => {
	it('sets input value as a property on first render — regression: prototype skipped it', () => {
		const { container, vm } = setup();
		vm.render(h('input', { type: 'text', value: 'hello' }));
		expect(container.querySelector('input').value).toBe('hello');
	});

	it('updates value by property so a live input actually changes', () => {
		const { container, vm } = setup();
		vm.render(h('input', { type: 'text', value: 'a' }));
		vm.render(h('input', { type: 'text', value: 'b' }));
		expect(container.querySelector('input').value).toBe('b');
	});

	it('checkbox unchecks with checked=false — regression: setAttribute("checked", false) was truthy', () => {
		const { container, vm } = setup();
		vm.render(h('input', { type: 'checkbox', checked: true }));
		const box = container.querySelector('input');
		expect(box.checked).toBe(true);

		vm.render(h('input', { type: 'checkbox', checked: false }));
		expect(box.checked).toBe(false);
	});

	it('boolean disabled toggles both property and attribute', () => {
		const { container, vm } = setup();
		vm.render(h('button', { disabled: true }, [text('Add')]));
		const btn = container.querySelector('button');
		expect(btn.disabled).toBe(true);
		expect(btn.hasAttribute('disabled')).toBe(true);

		vm.render(h('button', { disabled: false }, [text('Add')]));
		expect(btn.disabled).toBe(false);
		expect(btn.hasAttribute('disabled')).toBe(false);
	});

	it('false/null attribute values remove the attribute', () => {
		const { container, vm } = setup();
		vm.render(h('div', { 'data-x': 'yes', hidden: true }));
		vm.render(h('div', { 'data-x': null, hidden: false }));
		const el = container.firstChild;
		expect(el.hasAttribute('data-x')).toBe(false);
		expect(el.hasAttribute('hidden')).toBe(false);
	});

	it('re-asserts a controlled value against the LIVE DOM when the bound value is unchanged', () => {
		// Bug: user types into a controlled <input> whose keystrokes are NOT mirrored
		// back into state (@change / @keydown:enter binding, not @input). A later
		// re-render whose bound value is UNCHANGED ('' → reset to '') skipped the write
		// on a vnode-to-vnode compare, so the stale typed text stayed on screen.
		const { container, vm } = setup();
		vm.render(h('input', { type: 'text', value: '' }));
		const input = container.querySelector('input');

		// user types 'abc' directly; the app never mirrors it into state
		input.value = 'abc';

		// a reset action sets the bound value back to '' — but it was ALREADY ''
		vm.render(h('input', { type: 'text', value: '' }));
		expect(input.value).toBe(''); // live DOM re-asserted, not left at 'abc'
	});

	it('re-asserts a controlled checkbox `checked` against the LIVE DOM when unchanged', () => {
		const { container, vm } = setup();
		vm.render(h('input', { type: 'checkbox', checked: false }));
		const box = container.querySelector('input');

		// user clicks the box; an @change handler that never mirrored it into state
		box.checked = true;

		// re-render with the same bound value (false) must snap it back
		vm.render(h('input', { type: 'checkbox', checked: false }));
		expect(box.checked).toBe(false);
	});

	it('does NOT re-write value when the live DOM already matches — caret preservation', () => {
		// Per-keystroke echo (@input mirror): user types 'a', handler setData's 'a',
		// re-render arrives with bound 'a'. el.value is ALREADY 'a', so the live
		// compare must write NOTHING — writing would reset the caret.
		const { container, vm } = setup();
		vm.render(h('input', { type: 'text', value: 'a' }));
		const input = container.querySelector('input');

		// spy on the value SETTER (reads still go through the real getter)
		const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
		let writes = 0;
		Object.defineProperty(input, 'value', {
			configurable: true,
			get: desc.get,
			set(v) {
				writes++;
				desc.set.call(this, v);
			},
		});

		vm.render(h('input', { type: 'text', value: 'a' }));
		expect(writes).toBe(0); // no property SET occurred
		expect(input.value).toBe('a');
	});

	it('still writes value when the live DOM genuinely differs (controlled rejection resets it)', () => {
		const { container, vm } = setup();
		vm.render(h('input', { type: 'text', value: 'a' }));
		const input = container.querySelector('input');
		input.value = 'typed-then-rejected';
		vm.render(h('input', { type: 'text', value: 'a' }));
		expect(input.value).toBe('a');
	});
});

describe('ViewManager — events (@ attrs)', () => {
	it('attaches listeners and swaps handlers on patch without leaking the old one', () => {
		const { container, vm } = setup();
		const first = vi.fn();
		const second = vi.fn();

		vm.render(h('button', { '@click': first }, [text('go')]));
		container.querySelector('button').click();
		expect(first).toHaveBeenCalledTimes(1);

		vm.render(h('button', { '@click': second }, [text('go')]));
		container.querySelector('button').click();
		expect(first).toHaveBeenCalledTimes(1); // old handler gone
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('removes listeners when the @attr disappears', () => {
		const { container, vm } = setup();
		const fn = vi.fn();
		vm.render(h('button', { '@click': fn }, [text('go')]));
		vm.render(h('button', {}, [text('go')]));
		container.querySelector('button').click();
		expect(fn).not.toHaveBeenCalled();
	});

	it('receives the native event', () => {
		const { container, vm } = setup();
		let received;
		vm.render(h('button', { '@click': (e) => { received = e; } }, [text('go')]));
		container.querySelector('button').click();
		expect(received).toBeInstanceOf(Event);
	});
});

describe('ViewManager — keyed reconciliation', () => {
	const list = (keys) => h('ul', {}, keys.map((k) => h('li', { key: k }, [text(k)])));

	it('reorder MOVES existing DOM nodes instead of rewriting them', () => {
		const { container, vm } = setup();
		vm.render(list(['a', 'b', 'c']));
		const [elA, elB, elC] = container.querySelectorAll('li');

		vm.render(list(['c', 'a', 'b']));
		const after = [...container.querySelectorAll('li')];
		expect(after.map((n) => n.textContent)).toEqual(['c', 'a', 'b']);
		expect(after[0]).toBe(elC); // same nodes, moved
		expect(after[1]).toBe(elA);
		expect(after[2]).toBe(elB);
	});

	it('insert at head preserves the tail nodes — the todos filter case', () => {
		const { container, vm } = setup();
		vm.render(list(['b', 'c']));
		const [elB, elC] = container.querySelectorAll('li');

		vm.render(list(['a', 'b', 'c']));
		const after = [...container.querySelectorAll('li')];
		expect(after.map((n) => n.textContent)).toEqual(['a', 'b', 'c']);
		expect(after[1]).toBe(elB);
		expect(after[2]).toBe(elC);
	});

	it('removal from the middle keeps surrounding nodes and their state', () => {
		const { container, vm } = setup();
		vm.render(h('ul', {}, [
			h('li', { key: '1' }, [h('input', { type: 'checkbox', checked: true })]),
			h('li', { key: '2' }, [h('input', { type: 'checkbox', checked: false })]),
			h('li', { key: '3' }, [h('input', { type: 'checkbox', checked: true })]),
		]));
		const third = container.querySelectorAll('li')[2];

		vm.render(h('ul', {}, [
			h('li', { key: '1' }, [h('input', { type: 'checkbox', checked: true })]),
			h('li', { key: '3' }, [h('input', { type: 'checkbox', checked: true })]),
		]));
		const after = [...container.querySelectorAll('li')];
		expect(after).toHaveLength(2);
		expect(after[1]).toBe(third); // key 3 kept its DOM
		expect(after[1].querySelector('input').checked).toBe(true);
	});

	it('mixed keyed and unkeyed children reconcile', () => {
		const { container, vm } = setup();
		vm.render(h('div', {}, [
			h('h2', {}, [text('list')]),
			h('p', { key: 'x' }, [text('x')]),
		]));
		vm.render(h('div', {}, [
			h('h2', {}, [text('list!')]),
			h('p', { key: 'y' }, [text('y')]),
			h('p', { key: 'x' }, [text('x')]),
		]));
		expect(container.firstChild.innerHTML).toBe('<h2>list!</h2><p>y</p><p>x</p>');
	});

	it('warns (once) when sibling keys collide, and still renders', () => {
		const { container, vm } = setup();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			vm.render(h('ul', {}, [h('li', { key: '1' }, [text('a')])]));
			// two <li> siblings share key '1' — a user bug the keyed diff can't resolve
			vm.render(h('ul', {}, [
				h('li', { key: '1' }, [text('a')]),
				h('li', { key: '1' }, [text('b')]),
			]));
			expect(warn).toHaveBeenCalled();
			expect(String(warn.mock.calls[0][0])).toContain('duplicate key');
			expect(container.querySelectorAll('li').length).toBeGreaterThan(0); // no crash
		} finally {
			warn.mockRestore();
		}
	});
});

describe('ViewManager — clear', () => {
	it('removes the mounted tree and allows a fresh mount', () => {
		const { container, vm } = setup();
		vm.render(h('div', {}, [text('x')]));
		vm.clear();
		expect(container.innerHTML).toBe('');

		vm.render(h('div', {}, [text('y')]));
		expect(container.textContent).toBe('y');
	});
});

describe('ViewManager — select controlled value', () => {
	const option = (value, label = value) => h('option', { value }, [text(label)]);

	it('selects a NON-first option on initial mount (value set after options exist)', () => {
		const { container, vm } = setup();
		vm.render(h('select', { value: 'b' }, [option('a'), option('b'), option('c')]));
		const select = container.querySelector('select');
		expect(select.value).toBe('b');
		expect(select.selectedIndex).toBe(1);
	});

	it('preserves the selection when the option list is replaced but the value attr is unchanged', () => {
		const { container, vm } = setup();
		vm.render(h('select', { value: 'b' }, [option('a'), option('b'), option('c')]));
		const select = container.querySelector('select');
		expect(select.value).toBe('b');

		// Same value attr, but a fully rebuilt option list (b is now at a new index)
		vm.render(h('select', { value: 'b' }, [option('x'), option('a'), option('b')]));
		expect(select.value).toBe('b');
		expect(select.selectedIndex).toBe(2);
	});

	it('changing value and options together updates the selection', () => {
		const { container, vm } = setup();
		vm.render(h('select', { value: 'a' }, [option('a'), option('b')]));
		const select = container.querySelector('select');
		expect(select.value).toBe('a');

		vm.render(h('select', { value: 'z' }, [option('x'), option('y'), option('z')]));
		expect(select.value).toBe('z');
		expect(select.selectedIndex).toBe(2);
	});

	it('removing the selected option follows native browser fallback', () => {
		const { container, vm } = setup();
		vm.render(h('select', { value: 'b' }, [option('a'), option('b'), option('c')]));
		const select = container.querySelector('select');
		expect(select.value).toBe('b');

		// 'b' is gone; the value attr still says 'b' but no option matches — the
		// browser picks its native fallback. Pin jsdom's behaviour.
		vm.render(h('select', { value: 'b' }, [option('a'), option('c')]));
		// jsdom leaves nothing selected when the value matches no option.
		expect(select.selectedIndex).toBe(-1);
		expect(select.value).toBe('');
	});
});

describe('ViewManager — SVG namespace', () => {
	const SVG_NS = 'http://www.w3.org/2000/svg';
	const XHTML_NS = 'http://www.w3.org/1999/xhtml';

	it('creates <svg> and its descendants in the SVG namespace, siblings in HTML', () => {
		const { container, vm } = setup();
		vm.render(h('div', {}, [
			h('svg', { viewBox: '0 0 20 20' }, [
				h('path', { d: 'M1 1L2 2', 'fill-rule': 'evenodd' }),
			]),
			h('span', {}, [text('html sibling')]),
		]));

		const svg = container.querySelector('svg');
		const path = container.querySelector('path');
		expect(svg.namespaceURI).toBe(SVG_NS);
		expect(path.namespaceURI).toBe(SVG_NS); // inherited via the parent node
		expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
		expect(container.querySelector('span').namespaceURI).toBe(XHTML_NS);
	});

	it('children mounted DURING a patch inside an <svg> get the SVG namespace', () => {
		const { container, vm } = setup();
		vm.render(h('div', {}, [h('svg', {}, [h('circle', { key: 'a', r: '1' })])]));
		vm.render(h('div', {}, [
			h('svg', {}, [
				h('circle', { key: 'a', r: '1' }),
				h('circle', { key: 'b', r: '2' }), // new node, mounted by the patcher
			]),
		]));

		const circles = container.querySelectorAll('circle');
		expect(circles).toHaveLength(2);
		expect(circles[1].namespaceURI).toBe(SVG_NS);
	});

	it('<foreignObject> content returns to the HTML namespace', () => {
		const { container, vm } = setup();
		vm.render(h('svg', {}, [
			h('foreignObject', {}, [h('div', {}, [text('html island')])]),
		]));

		expect(container.querySelector('foreignObject').namespaceURI).toBe(SVG_NS);
		expect(container.querySelector('foreignObject > div').namespaceURI).toBe(XHTML_NS);
	});
});

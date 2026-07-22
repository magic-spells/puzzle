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

const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true }));

describe('ViewManager — event modifiers (@event:mod)', () => {
	it('prevent calls preventDefault', () => {
		const { container, vm } = setup();
		vm.render(h('form', { '@submit:prevent': vi.fn() }, []));
		const ev = new Event('submit', { cancelable: true });
		container.querySelector('form').dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
	});

	it('stop calls stopPropagation (event does not reach ancestor)', () => {
		const { container, vm } = setup();
		const onOuter = vi.fn();
		vm.render(h('div', { '@click': onOuter }, [h('button', { '@click:stop': vi.fn() }, [text('go')])]));
		container.querySelector('button').click();
		expect(onOuter).not.toHaveBeenCalled();
	});

	it('key filter gates on event.key and does NOT preventDefault on a non-matching key', () => {
		const { container, vm } = setup();
		const onEnter = vi.fn();
		vm.render(h('input', { '@keydown:enter:prevent': onEnter }, []));
		const input = container.querySelector('input');

		const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
		input.dispatchEvent(other);
		expect(onEnter).not.toHaveBeenCalled();
		expect(other.defaultPrevented).toBe(false); // native behaviour preserved

		const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
		input.dispatchEvent(enter);
		expect(onEnter).toHaveBeenCalledTimes(1);
		expect(enter.defaultPrevented).toBe(true);
	});

	it('space filter maps to " "', () => {
		const { container, vm } = setup();
		const onSpace = vi.fn();
		vm.render(h('input', { '@keydown:space': onSpace }, []));
		const input = container.querySelector('input');
		key(input, ' ');
		expect(onSpace).toHaveBeenCalledTimes(1);
		key(input, 'x');
		expect(onSpace).toHaveBeenCalledTimes(1);
	});

	it('backspace filter maps to "Backspace" (v1.13, D45)', () => {
		const { container, vm } = setup();
		const onBksp = vi.fn();
		vm.render(h('input', { '@keydown:backspace': onBksp }, []));
		const input = container.querySelector('input');
		key(input, 'Backspace');
		expect(onBksp).toHaveBeenCalledTimes(1);
		key(input, 'x');
		expect(onBksp).toHaveBeenCalledTimes(1); // other keys don't fire
	});

	it('delete filter maps to "Delete" and preserves native behaviour on other keys (v1.13, D45)', () => {
		const { container, vm } = setup();
		const onDel = vi.fn();
		vm.render(h('input', { '@keydown:delete:prevent': onDel }, []));
		const input = container.querySelector('input');

		const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
		input.dispatchEvent(other);
		expect(onDel).not.toHaveBeenCalled();
		expect(other.defaultPrevented).toBe(false); // non-matching key not prevented

		const del = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
		input.dispatchEvent(del);
		expect(onDel).toHaveBeenCalledTimes(1);
		expect(del.defaultPrevented).toBe(true);
	});

	it('once fires exactly once across a re-render / patch cycle', () => {
		const { container, vm } = setup();
		// Each render binds a FRESH handler closure (as the compiler emits), so the
		// per-patch handler swap must not reset the spent marker.
		const onceFn = vi.fn();
		vm.render(h('button', { '@click:once': () => onceFn() }, [text('go')]));
		const btn = container.querySelector('button');
		btn.click();
		btn.click();
		expect(onceFn).toHaveBeenCalledTimes(1);

		// re-render (patch swaps the wrapped handler) then click again
		vm.render(h('button', { '@click:once': () => onceFn() }, [text('go')]));
		container.querySelector('button').click();
		expect(onceFn).toHaveBeenCalledTimes(1); // still once EVER
	});

	it('once-spent marker clears on attr REMOVAL so a re-added @click:once fires again (FIX)', () => {
		const { container, vm } = setup();
		const fn = vi.fn();
		vm.render(h('button', { '@click:once': () => fn() }, [text('go')]));
		const btn = container.querySelector('button');
		btn.click();
		btn.click();
		expect(fn).toHaveBeenCalledTimes(1); // spent

		// attr disappears entirely → removeAttr must drop the spent marker too...
		vm.render(h('button', {}, [text('go')]));
		// ...then a later patch re-adds it: a fresh closure on the reused element fires
		vm.render(h('button', { '@click:once': () => fn() }, [text('go')]));
		container.querySelector('button').click();
		expect(fn).toHaveBeenCalledTimes(2); // NOT stuck at 1
	});

	it('once-spent marker clears when nulled via the inline-if path, so a re-add fires (FIX)', () => {
		const { container, vm } = setup();
		const fn = vi.fn();
		vm.render(h('button', { '@click:once': () => fn() }, [text('go')]));
		const btn = container.querySelector('button');
		btn.click();
		expect(fn).toHaveBeenCalledTimes(1); // spent

		// attr STAYS present but its value goes null (inline-if false) → setAttr's
		// else branch removes the listener; the spent marker must go with it...
		vm.render(h('button', { '@click:once': null }, [text('go')]));
		// ...then the inline-if flips true again on a later patch
		vm.render(h('button', { '@click:once': () => fn() }, [text('go')]));
		container.querySelector('button').click();
		expect(fn).toHaveBeenCalledTimes(2); // NOT stuck at 1
	});

	it('stacked modifiers run in canonical order (key-gate, prevent, stop, handler)', () => {
		const { container, vm } = setup();
		const order = [];
		const onOuter = () => order.push('outer');
		const handler = (e) => {
			order.push(`handler:prevented=${e.defaultPrevented}`);
		};
		// written order stop:prevent — canonical order must still preventDefault
		// before running the handler and stop propagation to the outer div.
		vm.render(
			h('div', { '@keydown': onOuter }, [
				h('input', { '@keydown:enter:stop:prevent': handler }, []),
			])
		);
		const input = container.querySelector('input');

		key(input, 'a'); // non-matching key: no handler, no prevent, propagates
		expect(order).toEqual(['outer']);

		order.length = 0;
		const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
		input.dispatchEvent(enter);
		expect(order).toEqual(['handler:prevented=true']); // stop → outer never fires
		expect(enter.defaultPrevented).toBe(true);
	});

	it('removeAttr detaches correctly when the key carries modifiers', () => {
		const { container, vm } = setup();
		const fn = vi.fn();
		vm.render(h('input', { '@keydown:enter:prevent': fn }, []));
		const input = container.querySelector('input');
		key(input, 'Enter');
		expect(fn).toHaveBeenCalledTimes(1);

		// attribute disappears → listener must detach (correct DOM event type)
		vm.render(h('input', {}, []));
		key(container.querySelector('input'), 'Enter');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('plain and modified bindings on the same event do not collide', () => {
		const { container, vm } = setup();
		const plain = vi.fn();
		vm.render(h('button', { '@click': plain }, [text('go')]));
		container.querySelector('button').click();
		expect(plain).toHaveBeenCalledTimes(1);
	});
});

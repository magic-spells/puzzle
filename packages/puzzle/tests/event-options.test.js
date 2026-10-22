// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';

let vm;
afterEach(() => {
	vm?.clear();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

function setup() {
	const container = document.createElement('div');
	document.body.append(container);
	vm = new ViewManager(container);
	return container;
}

describe('passive and capture event options (D187)', () => {
	it.each([
		['@wheel:passive', { passive: true, capture: false }],
		['@click:capture', { capture: true }],
		['@touchmove:passive:capture', { passive: true, capture: true }],
	])('passes options for %s', (binding, options) => {
		setup();
		const add = vi.spyOn(Element.prototype, 'addEventListener');
		vm.render(new ViewNode('div', { [binding]: vi.fn() }));
		expect(add).toHaveBeenCalledWith(binding.slice(1).split(':')[0], expect.any(Function), options);
	});

	it('captures before a descendant bubble handler', () => {
		const container = setup();
		const calls = [];
		vm.render(new ViewNode('div', { '@click:capture': () => calls.push('capture') }, [
			new ViewNode('button', { '@click': () => calls.push('button') }),
		]));
		container.querySelector('button').click();
		expect(calls).toEqual(['capture', 'button']);
	});

	it('a passive handler cannot prevent the default', () => {
		const container = setup();
		vm.render(new ViewNode('div', { '@wheel:passive': (event) => event.preventDefault() }));
		const event = new Event('wheel', { cancelable: true });
		container.firstChild.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it('replaces and nulls capture listeners using the matching capture flag', () => {
		const container = setup();
		const first = vi.fn(), second = vi.fn();
		vm.render(new ViewNode('button', { '@click:capture': first }));
		const button = container.firstChild;
		const remove = vi.spyOn(button, 'removeEventListener');
		vm.render(new ViewNode('button', { '@click:capture': second }));
		button.click();
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
		vm.render(new ViewNode('button', { '@click:capture': null }));
		button.click();
		expect(second).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledWith('click', expect.any(Function), true);
	});

	it('once spends capture listeners without resurrecting on patch', () => {
		const container = setup();
		const handler = vi.fn();
		const render = () => vm.render(new ViewNode('button', { '@click:once:capture': () => handler() }));
		render();
		container.firstChild.click();
		render();
		container.firstChild.click();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('outside passive listeners capture and detach on subtree removal', () => {
		setup();
		const add = vi.spyOn(document, 'addEventListener');
		const remove = vi.spyOn(document, 'removeEventListener');
		const handler = vi.fn();
		vm.render(new ViewNode('div', {}, [new ViewNode('span', { '@click:outside:passive': handler })]));
		expect(add).toHaveBeenCalledWith('click', expect.any(Function), { capture: true, passive: true });
		vm.clear();
		document.body.click();
		expect(handler).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith('click', expect.any(Function), { capture: true });
	});
});

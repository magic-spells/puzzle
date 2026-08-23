// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

// D58 (SPEC §28): ViewNode.keyOf is the runtime auto-key resolver the compiler
// emits for item-form {#for} rows. A store record keys by its model's
// primaryKey() (agreeing with `.primary()`); anything else keys by `.id`; a
// null/undefined result warns once and falls back to positional diffing.

// A model whose primary key is NOT the conventional `id`.
class Widget extends PuzzleModel {
	static schema = {
		main_id: Puzzle.string().primary(),
		label: Puzzle.string(),
	};
}

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

describe('ViewNode.keyOf — auto-key resolution (SPEC §28)', () => {
	it('keys a store record by its model primaryKey(), not .id', () => {
		const store = new Store({ widget: Widget });
		const w = store.createRecord('widget', { main_id: 'w-1', label: 'a' });

		expect(Widget.primaryKey()).toBe('main_id');
		expect(w.id).toBeUndefined();
		expect(ViewNode.keyOf(w)).toBe('w-1');
	});

	it('keys a plain object by .id', () => {
		expect(ViewNode.keyOf({ id: 42, name: 'row' })).toBe(42);
	});

	it('returns null and warns exactly once for a keyless object', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(ViewNode.keyOf({ name: 'no key here' })).toBe(null);
			expect(ViewNode.keyOf({ other: 'still no key' })).toBe(null);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0][0])).toContain('no usable key');
		} finally {
			warn.mockRestore();
		}
	});
});

describe('keyed reconciliation with custom-pk records (SPEC §28)', () => {
	// Compiled item-form loops emit `key: ViewNode.keyOf(item)`; a list of
	// custom-pk records must reconcile by main_id — reorders MOVE DOM nodes.
	it('reorder MOVES existing DOM nodes when keyed by ViewNode.keyOf', () => {
		const store = new Store({ widget: Widget });
		const a = store.createRecord('widget', { main_id: 'a', label: 'A' });
		const b = store.createRecord('widget', { main_id: 'b', label: 'B' });
		const c = store.createRecord('widget', { main_id: 'c', label: 'C' });

		const list = (items) =>
			h('ul', {}, items.map((r) => h('li', { key: ViewNode.keyOf(r) }, [text(r.label)])));

		const container = document.createElement('div');
		document.body.appendChild(container);
		const vm = new ViewManager(container);

		vm.render(list([a, b, c]));
		const [elA, elB, elC] = container.querySelectorAll('li');

		vm.render(list([c, a, b]));
		const after = [...container.querySelectorAll('li')];
		expect(after.map((n) => n.textContent)).toEqual(['C', 'A', 'B']);
		expect(after[0]).toBe(elC); // same nodes, moved — not rewritten
		expect(after[1]).toBe(elA);
		expect(after[2]).toBe(elB);
	});
});

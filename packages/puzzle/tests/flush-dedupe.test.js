// @vitest-environment jsdom
//
// One flush, one data() run (plan/Puzzle-Render-Upgrade.md §3.7, D170).
//
// A child that both RECEIVES a record prop and QUERIES that record is woken
// twice by a single store flush: once by its parent's applyParentUpdate (the
// parent is delivered first and re-renders inside the delivery loop), and once
// by its own onStoreChange later in that same loop. Both wake-ups carry the same
// data, so the second is pure waste — and before the revision-aware prop compare
// the first one did not even exist.
//
// The mechanism is D161's, extended by one case: `Store._flushSeq` publishes the
// sequence being delivered, a refresh started during delivery stamps it onto
// `_settleMark` when it commits, and the child's own `onStoreChange(seq)` takes
// the existing `seq <= _settleMark` early return.
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { mountView, settled } from '../client-runtime/testing/index.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string(),
	};
}

const KEY = { key: (item) => ViewNode.keyOf(item) };
const handles = [];
let dataRuns = {};

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	dataRuns = {};
});

/** A row that takes the record as a prop AND re-queries it — the D62 idiom. */
class Row extends PuzzleView {
	data() {
		const id = this.props.todo.id;
		dataRuns[id] = (dataRuns[id] ?? 0) + 1;
		// Subscribes this view to the record key in its own right, which is what
		// makes it a target of the very same flush that woke its parent.
		return { text: this.ctx.store.findOne('todo', id).text };
	}

	render() {
		return new ViewNode('li', { 'data-id': this.props.todo.id }, [
			new ViewNode('text', { value: this.getData().text }),
		]);
	}
}

class List extends PuzzleView {
	data() {
		return { todos: this.ctx.store.findMany('todo') };
	}

	render() {
		return new ViewNode(
			'ul',
			{},
			this.__list(
				this,
				0,
				this.getData().todos,
				(s) => new ViewNode(Row, { key: s.k, todo: s.item }, []),
				KEY
			)
		);
	}
}

describe('flush-sequence dedupe', () => {
	it('runs a prop-and-query child\'s data() exactly once per flush', async () => {
		const store = new Store({ todo: Todo });
		for (const id of ['a', 'b']) store.createRecord('todo', { id, text: id });
		const view = await mountView(List, { store });
		handles.push(view);
		dataRuns = {};

		store.findOne('todo', 'a').update({ text: 'changed' });
		await settled();

		// Without the stamp this is 2: the parent's prop push, then the child's own
		// notification re-running an evaluation whose result is already on screen.
		expect(dataRuns).toEqual({ a: 1 });
		expect(view.find('[data-id="a"]').textContent).toBe('changed');
	});

	it('stamps the delivering sequence onto the child that refreshed', async () => {
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: 'a', text: 'a' });
		const view = await mountView(List, { store });
		handles.push(view);

		store.findOne('todo', 'a').update({ text: 'changed' });
		await settled();

		const row = view.instance._vnodeTree().children[0].component;
		expect(row._settleMark).toBeGreaterThan(0);
		expect(row._settleMark).toBeLessThanOrEqual(store._notifySeq);
		// Outside a delivery loop the store advertises nothing, so an ordinary
		// refresh stamps nothing and can never suppress a later batch.
		expect(store._flushSeq).toBe(0);
	});

	it('still delivers to a child the parent did NOT refresh', async () => {
		const store = new Store({ todo: Todo });
		for (const id of ['a', 'b']) store.createRecord('todo', { id, text: id });
		const view = await mountView(List, { store });
		handles.push(view);
		dataRuns = {};

		// Two records in one batch: each row is prop-pushed for its own record and
		// must land exactly one data() run — the dedupe suppresses the redundant
		// second wake-up, never a first one.
		store.findOne('todo', 'a').update({ text: 'A!' });
		store.findOne('todo', 'b').update({ text: 'B!' });
		await settled();

		expect(dataRuns).toEqual({ a: 1, b: 1 });
		expect(view.find('[data-id="a"]').textContent).toBe('A!');
		expect(view.find('[data-id="b"]').textContent).toBe('B!');
	});
});

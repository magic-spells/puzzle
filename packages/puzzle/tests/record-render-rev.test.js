// @vitest-environment jsdom
//
// The record render revision (plan/Puzzle-Render-Upgrade.md §3.4, D170).
//
// A record mutates IN PLACE, so two readers holding the same reference cannot
// tell "unchanged" from "changed since I last looked". `Store._notify` stamps
// the notification sequence onto the record under a Symbol, and EVERY observable
// mutation path funnels through `_notify` — createRecord, update() via
// recordChanged, removeRecord, the adapter's upserts and the save reconciliation
// — so the revision advances with the notification and never independently of
// it. That is the invariant these tests exist to hold: a path that mutates a
// record without stamping it is a silently stale row.
//
// The consumer half is `propsEqual`, driven here through the REAL patch path: a
// child holding a record prop refreshes when that record's revision passes the
// snapshot it stored when props were last applied, and not otherwise.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { RENDER_REV } from '../client-runtime/renderRev.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { mountView, settled } from '../client-runtime/testing/index.js';

adapter.install();

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string(),
		completed: Puzzle.boolean().default(false),
	};
	static adapter = { endpoint: '/api/todos' };
}

const apiStore = () => new Store({ todo: Todo }, { apiURL: 'https://x.test/v1' });

const makeRes = ({ ok = true, status = 200, statusText = 'OK', body = '' } = {}) => ({
	ok,
	status,
	statusText,
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

const mockFetch = (...responses) => {
	const queue = responses.map((r) => makeRes(r));
	const fn = vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]));
	vi.stubGlobal('fetch', fn);
	return fn;
};

const handles = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the revision advances on every observable mutation', () => {
	it('stamps a created record with the sequence of its own notification', () => {
		const store = new Store({ todo: Todo });
		const todo = store.createRecord('todo', { id: 'a', text: 'A' });

		expect(todo[RENDER_REV]).toBe(store._notifySeq);
		expect(todo[RENDER_REV]).toBeGreaterThan(0);
	});

	it('advances on update(), and only for the record that changed', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a', text: 'A' });
		const b = store.createRecord('todo', { id: 'b', text: 'B' });
		const before = { a: a[RENDER_REV], b: b[RENDER_REV] };

		a.update({ text: 'A2' });

		expect(a[RENDER_REV]).toBeGreaterThan(before.a);
		expect(b[RENDER_REV]).toBe(before.b);
	});

	it('notifies a removal without stamping the record that left', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const seqBefore = store._notifySeq;
		const revBefore = a[RENDER_REV];

		a.destroy();

		// removeRecord deletes from the type map BEFORE notifying — deliberately,
		// so subscribers never see a store that still contains the record. A removed
		// record therefore keeps its last revision, which costs nothing: its row
		// leaves the list and the patcher unmounts it.
		expect(store._notifySeq).toBeGreaterThan(seqBefore);
		expect(a[RENDER_REV]).toBe(revBefore);
	});

	it('advances on an adapter upsert (loadMany over an existing record)', async () => {
		mockFetch({ body: [{ id: 'a', text: 'from server' }] });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'a', text: 'local' });
		const before = todo[RENDER_REV];

		await store.loadMany('todo');

		expect(todo.text).toBe('from server');
		expect(todo[RENDER_REV]).toBeGreaterThan(before);
	});

	it('advances on save reconciliation (a server-computed field lands)', async () => {
		mockFetch({ body: { id: 'a', text: 'x', completed: true } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'a', text: 'x' });
		const before = todo[RENDER_REV];

		await todo.save();

		expect(todo.completed).toBe(true);
		expect(todo[RENDER_REV]).toBeGreaterThan(before);
	});

	it('is invisible to payloads, JSON and key enumeration', () => {
		const store = new Store({ todo: Todo });
		const todo = store.createRecord('todo', { id: 'a', text: 'A' });

		// A Symbol key is why no reserved-name rule, schema assertion or payload
		// merge had to move to make room for this.
		expect(Object.keys(todo)).not.toContain('RENDER_REV');
		expect(Object.getOwnPropertyNames(todo)).toEqual(
			expect.not.arrayContaining([String(RENDER_REV)])
		);
		expect(JSON.parse(JSON.stringify(todo))).toEqual({
			id: 'a',
			text: 'A',
			completed: false,
		});
	});
});

describe('snapshot prop comparison through the real patch path', () => {
	let runs = 0;

	class Row extends PuzzleView {
		data() {
			runs++;
			return { text: this.props.todo.text };
		}

		render() {
			return new ViewNode('span', { class: 'row' }, [
				new ViewNode('text', { value: this.getData().text }),
			]);
		}
	}

	class Host extends PuzzleView {
		render() {
			return new ViewNode('div', {}, [
				new ViewNode(Row, { key: 'r', todo: this.props.todo }, []),
			]);
		}
	}

	it('refreshes the child on the record\'s own mutation, then re-arms the snapshot', async () => {
		const store = new Store({ todo: Todo });
		const todo = store.createRecord('todo', { id: 'a', text: 'first' });
		const view = await mountView(Host, { store, props: { todo } });
		handles.push(view);
		runs = 0;

		// A parent re-render that changes nothing: the record prop is the same
		// reference AND the same revision, so the bailout holds.
		view.instance.setData('tick', 1);
		await settled();
		expect(runs).toBe(0);

		// The record mutates in place — the reference is untouched, and before D170
		// this was invisible to the child forever (FLOW-REACTIVITY's durable
		// caveat). The advanced revision is what the child now sees.
		todo.update({ text: 'second' });
		view.instance.setData('tick', 2);
		await settled();
		expect(runs).toBe(1);
		expect(view.find('.row').textContent).toBe('second');

		// The snapshot was rewritten when those props were applied, so the NEXT
		// parent render bails out again rather than refreshing forever.
		view.instance.setData('tick', 3);
		await settled();
		expect(runs).toBe(1);
	});

	it('does not refresh a child whose record prop never changed', async () => {
		const store = new Store({ todo: Todo });
		const todo = store.createRecord('todo', { id: 'a', text: 'first' });
		const other = store.createRecord('todo', { id: 'b', text: 'other' });
		const view = await mountView(Host, { store, props: { todo } });
		handles.push(view);
		runs = 0;

		other.update({ text: 'moved' });
		view.instance.setData('tick', 1);
		await settled();

		// A record's revision is its OWN. A sibling's mutation moves the store's
		// sequence, not this record's.
		expect(runs).toBe(0);
	});
});

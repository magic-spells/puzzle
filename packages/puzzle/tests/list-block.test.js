// @vitest-environment jsdom
//
// Persistent list blocks (D170).
//
// An item-form `{#for}` compiles to `__l(this, owner, id, items, factory,
// meta)` — `listRows`, imported from the package root as `__l` only by a module
// that lowers a loop, so a loop-free app never carries this file. It keeps one
// ROW STATE per key across renders and returns the SAME
// vnode subtree for a row whose inputs did not change. These tests drive the
// block directly (the algorithm) and through a mounted view (the consequences
// the patcher sees), because the whole value of the feature is an object
// identity: a cached row is only free because `patch()` short-circuits on it.
//
// The oracle everywhere is the FACTORY: it records the key of every row it is
// asked to build, so "cached" means "the factory did not run and the same vnode
// object came back".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { listRows } from '../client-runtime/views/listBlock.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { devperfInstallSink } from '../client-runtime/devperf.js';
import { mountView, settled } from '../client-runtime/testing/index.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string(),
		done: Puzzle.boolean().default(false),
	};
}

class Author extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		name: Puzzle.string(),
	};
}

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string(),
		authorId: Puzzle.string(),
		author: Puzzle.belongsTo('author'),
	};

	// Not a schema field: the block can only see it is absent from the schema,
	// which is exactly why a site that reads it must stay conservative.
	get shout() {
		return String(this.title).toUpperCase();
	}
}

const KEY = { key: (item) => ViewNode.keyOf(item) };
const handles = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	vi.restoreAllMocks();
});

/** A bare view to host blocks — no DOM, no mount: `listRows` needs neither. */
function host() {
	const view = new PuzzleView({});
	view.__dirty = 0;
	return view;
}

/** A factory that logs every row it builds and returns a fresh row vnode. */
function recorder(built) {
	return (s) => {
		built.push(s.k);
		return new ViewNode('li', { key: s.k }, [new ViewNode('text', { value: String(s.i) })]);
	};
}

describe('list block — the row cache', () => {
	it('returns the SAME vnode object for a clean record row', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a', text: 'A' });
		const b = store.createRecord('todo', { id: 'b', text: 'B' });
		const view = host();
		const built = [];

		const first = listRows(view, view, 0, [a, b], recorder(built), KEY);
		const second = listRows(view, view, 0, [a, b], recorder(built), KEY);

		// Both rows built once, on the first pass; the second pass handed back the
		// very objects the first pass produced — which is what patch() skips.
		expect(built).toEqual(['a', 'b']);
		expect(second[0]).toBe(first[0]);
		expect(second[1]).toBe(first[1]);
	});

	it('rebuilds a row whose record revision advanced, and only that row', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a', text: 'A' });
		const b = store.createRecord('todo', { id: 'b', text: 'B' });
		const view = host();
		const built = [];
		const first = listRows(view, view, 0, [a, b], recorder(built), KEY);

		// The reference never moves — a record mutates in place — so the stored
		// render revision is the ONLY thing that can report this.
		a.update({ text: 'A2' });
		const second = listRows(view, view, 0, [a, b], recorder(built), KEY);

		expect(built).toEqual(['a', 'b', 'a']);
		expect(second[0]).not.toBe(first[0]);
		expect(second[1]).toBe(first[1]);
	});

	it('rebuilds when the same key carries a REPLACEMENT record', () => {
		const store = new Store({ todo: Todo });
		let a = store.createRecord('todo', { id: 'a', text: 'A' });
		const view = host();
		const built = [];
		const first = listRows(view, view, 0, [a], recorder(built), KEY);

		// Delete + recreate: same key, different object (walkthrough D).
		a.destroy();
		a = store.createRecord('todo', { id: 'a', text: 'again' });
		const second = listRows(view, view, 0, [a], recorder(built), KEY);

		expect(built).toEqual(['a', 'a']);
		expect(second[0]).not.toBe(first[0]);
	});

	it('dirties on the INDEX only when the body reads the counter', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const b = store.createRecord('todo', { id: 'b' });

		const plain = host();
		const plainBuilt = [];
		listRows(plain, plain, 0, [a, b], recorder(plainBuilt), KEY);
		listRows(plain, plain, 0, [b, a], recorder(plainBuilt), KEY);
		// A reorder moves DOM nodes; it does not change what a row RENDERS unless
		// the body prints the index.
		expect(plainBuilt).toEqual(['a', 'b']);

		const counting = host();
		const countingBuilt = [];
		const meta = { ...KEY, counter: true };
		listRows(counting, counting, 0, [a, b], recorder(countingBuilt), meta);
		listRows(counting, counting, 0, [b, a], recorder(countingBuilt), meta);
		expect(countingBuilt).toEqual(['a', 'b', 'b', 'a']);
	});

	it('dirties every row when a parent root the body reads changed', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const view = host();
		const built = [];
		const meta = { ...KEY, roots: 0b10 };

		listRows(view, view, 0, [a], recorder(built), meta);
		// A root this site does NOT read changed: the row stays cached.
		view.__dirty = 0b01;
		listRows(view, view, 0, [a], recorder(built), meta);
		expect(built).toEqual(['a']);

		// A root it DOES read changed.
		view.__dirty = 0b11;
		listRows(view, view, 0, [a], recorder(built), meta);
		expect(built).toEqual(['a', 'a']);
	});

	it('rebuilds every pass for a volatile site (a body reaching through `this`)', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const view = host();
		const built = [];
		const meta = { ...KEY, volatile: true };

		listRows(view, view, 0, [a], recorder(built), meta);
		listRows(view, view, 0, [a], recorder(built), meta);

		// `{ this.ctx.router.current.path }` in a row body depends on state neither
		// the root mask nor the record revision covers, so the site gives up caching.
		expect(built).toEqual(['a', 'a']);
	});

	it('caches primitive rows by value but never plain objects', () => {
		const view = host();
		const built = [];
		const meta = { key: (item) => item };
		listRows(view, view, 0, ['x', 'y'], recorder(built), meta);
		listRows(view, view, 0, ['x', 'y'], recorder(built), meta);
		expect(built).toEqual(['x', 'y']);

		const objects = host();
		const objectBuilt = [];
		const items = [{ id: 'p' }];
		listRows(objects, objects, 0, items, recorder(objectBuilt), KEY);
		listRows(objects, objects, 0, items, recorder(objectBuilt), KEY);
		// Same reference, no revision: a plain object can be mutated in place and
		// refresh()ed, so it is always dirty — today's cost, unchanged.
		expect(objectBuilt).toEqual(['p', 'p']);
	});

	it('keeps s.c and s.hN across the rebuilds of a plain-object row', () => {
		const view = host();
		const items = [{ id: 'p' }];
		const seen = [];
		const factory = (s) => {
			s.h0 ??= () => s.item;
			s.c[0] ??= new ViewNode('span', {}, []);
			seen.push({ handler: s.h0, cached: s.c[0] });
			return new ViewNode('li', { key: s.k }, [s.c[0]]);
		};

		listRows(view, view, 0, items, factory, KEY);
		listRows(view, view, 0, items, factory, KEY);

		// The ROW is rebuilt (walkthrough E) but its handler and its static subtree
		// come off the row state, so allocation drops to the dynamic vnodes.
		expect(seen).toHaveLength(2);
		expect(seen[1].handler).toBe(seen[0].handler);
		expect(seen[1].cached).toBe(seen[0].cached);
	});
});

describe('list block — dev counters', () => {
	it('reports rows cached, rows built and the conservative verdict', () => {
		const store = new Store({ author: Author, post: Post });
		const post = store.createRecord('post', { id: 'p1', title: 'hi' });
		const view = host();
		const events = [];
		const off = devperfInstallSink((event) => {
			if (event.type === 'list-rows') events.push(event);
		});
		try {
			listRows(view, view, 0, [post], recorder([]), KEY);
			listRows(view, view, 0, [post], recorder([]), KEY);
			// A second site reading a relation can never cache its record rows — the
			// counter is how an author finds out WHY a list is still slow.
			listRows(view, view, 1, [post], recorder([]), { ...KEY, fields: ['author'] });
			listRows(view, view, 1, [post], recorder([]), { ...KEY, fields: ['author'] });
		} finally {
			off();
		}

		expect(events.map((event) => [event.cached, event.built, event.conservative])).toEqual([
			[0, 1, 0],
			[1, 0, 0],
			[0, 1, 0],
			[0, 1, 1],
		]);
	});
});

describe('list block — keys', () => {
	it('builds a null-keyed row uncached, warning through ViewNode.keyOf only', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const view = host();
		const built = [];
		const items = [{ name: 'no key here' }];

		listRows(view, view, 0, items, recorder(built), KEY);
		listRows(view, view, 0, items, recorder(built), KEY);

		// Positional diffing, today's semantics — and no second voice: keyOf owns
		// the diagnostic and warns once per session.
		expect(built).toEqual([null, null]);
		expect(view.__lists[0].rows.size).toBe(0);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain('no usable key');
	});

	it('builds the DUPLICATE of a key uncached and warns once', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const view = host();
		const built = [];

		const first = listRows(view, view, 0, [a, a], recorder(built), KEY);
		const second = listRows(view, view, 0, [a, a], recorder(built), KEY);

		// The first occurrence owns the row state; the second can never be cached
		// (one state cannot describe two positions), so it is rebuilt every pass.
		expect(built).toEqual(['a', 'a', 'a']);
		expect(second[0]).toBe(first[0]);
		expect(second[1]).not.toBe(first[1]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain('duplicate key');
	});
});

describe('list block — conservative sites', () => {
	const conservativeCases = [
		['a relation', { fields: ['author'] }],
		['a computed getter', { fields: ['shout'] }],
		['a deep path', { deep: true }],
	];

	for (const [what, extra] of conservativeCases) {
		it(`never caches a record row for a site reading ${what}`, () => {
			const store = new Store({ author: Author, post: Post });
			store.createRecord('author', { id: 'u1', name: 'Ada' });
			const post = store.createRecord('post', { id: 'p1', title: 'hi', authorId: 'u1' });
			const view = host();
			const built = [];
			const meta = { ...KEY, ...extra };

			listRows(view, view, 0, [post], recorder(built), meta);
			listRows(view, view, 0, [post], recorder(built), meta);

			// The record's own revision says nothing about a related record or a
			// getter's inputs, so the row cache may not speak for them.
			expect(built).toEqual(['p1', 'p1']);
		});
	}

	it('still caches when every declared field is a plain schema field', () => {
		const store = new Store({ author: Author, post: Post });
		const post = store.createRecord('post', { id: 'p1', title: 'hi' });
		const view = host();
		const built = [];
		const meta = { ...KEY, fields: ['title', 'id'] };

		listRows(view, view, 0, [post], recorder(built), meta);
		listRows(view, view, 0, [post], recorder(built), meta);

		expect(built).toEqual(['p1']);
	});
});

describe('list block — row lifetime', () => {
	it('drops the rows a pass did not visit, and rebuilds them if they return', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const b = store.createRecord('todo', { id: 'b' });
		const view = host();
		const built = [];

		listRows(view, view, 0, [a, b], recorder(built), KEY);
		listRows(view, view, 0, [a], recorder(built), KEY);
		expect(view.__lists[0].rows.size).toBe(1);

		listRows(view, view, 0, [a, b], recorder(built), KEY);
		expect(built).toEqual(['a', 'b', 'b']);
	});

	it('keeps its rows while the site is NOT VISITED (an {#if} around the loop)', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const view = host();
		const built = [];
		const other = [];
		const first = listRows(view, view, 0, [a], recorder(built), KEY);

		// Two renders in which the enclosing branch was false: site 0 is not called
		// at all while the rest of the template renders (site 1 stands in for it),
		// so nothing expires (walkthrough G). Dropping happens only inside a pass,
		// and memory stays bounded by what the site last showed.
		listRows(view, view, 1, [{ id: 'z' }], recorder(other), KEY);
		listRows(view, view, 1, [{ id: 'z' }], recorder(other), KEY);
		expect(view.__lists[0].rows.size).toBe(1);

		const revisited = listRows(view, view, 0, [a], recorder(built), KEY);

		expect(built).toEqual(['a']);
		expect(revisited[0]).toBe(first[0]);
	});

	it('keys a NESTED list per outer row and lets it die with that row', () => {
		const store = new Store({ todo: Todo });
		const a = store.createRecord('todo', { id: 'a' });
		const b = store.createRecord('todo', { id: 'b' });
		const view = host();
		const inner = [];
		const rows = new Map();

		const render = (items) =>
			listRows(
				view,
				view,
				0,
				items,
				(s) => {
					rows.set(s.k, s);
					// The compiler passes the ROW as the owner for a nested site.
					const kids = listRows(view, s, 1, [{ id: s.k + '-1' }], (t) => {
						inner.push(t.k);
						return new ViewNode('li', { key: t.k }, []);
					}, KEY);
					return new ViewNode('ul', { key: s.k }, kids);
				},
				{ ...KEY, volatile: true }
			);

		render([a, b]);
		expect(inner).toEqual(['a-1', 'b-1']);
		// Each row owns its own block — separate site tables, not one shared by id.
		expect(rows.get('a').__lists[1]).not.toBe(rows.get('b').__lists[1]);

		render([a]);
		// b's row state is gone, and its nested block went with it.
		expect(view.__lists[0].rows.has('b')).toBe(false);
		expect(rows.get('b').__lists[1].rows.size).toBe(1); // detached, unreachable
	});
});

describe('list block — controlled values in a cached row', () => {
	it('collects controls when meta.ctrl and re-asserts a drifted value', async () => {
		const store = new Store({ todo: Todo });
		const todo = store.createRecord('todo', { id: 'a', text: 'typed' });
		const meta = { ...KEY, ctrl: true };

		class Form extends PuzzleView {
			data() {
				return { todos: this.ctx.store.findMany('todo') };
			}

			render() {
				return new ViewNode(
					'form',
					{},
					listRows(
						this,
						this,
						0,
						this.getData().todos,
						(s) =>
							new ViewNode('div', { key: s.k }, [
								new ViewNode('input', { type: 'text', value: s.item.text }, []),
							]),
						meta
					)
				);
			}
		}

		const view = await mountView(Form, { store });
		handles.push(view);
		const input = view.find('input');
		expect(input.value).toBe('typed');

		// The user typed without committing (a change-committed field, an IME
		// composition): the live DOM now disagrees with state. A clean pass returns
		// the cached vnode, so the ONLY thing that can correct this is the control
		// list patch() re-asserts on the identity short-circuit.
		input.value = 'drifted';
		view.instance.setData('tick', 1);
		await settled();

		expect(input.value).toBe('typed');
	});
});

describe('list block — component rows', () => {
	let dataRuns = {};

	class Row extends PuzzleView {
		data() {
			const id = this.props.todo.id;
			dataRuns[id] = (dataRuns[id] ?? 0) + 1;
			return { text: this.props.todo.text };
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
				listRows(
					this,
					this,
					0,
					this.getData().todos,
					(s) =>
						new ViewNode(
							Row,
							{
								key: s.k,
								todo: s.item,
								remove: (s.h0 ??= () => this.ctx.store.findOne('todo', s.item.id)),
							},
							[]
						),
					KEY
				)
			);
		}
	}

	it('leaves a clean row\'s child alone and refreshes a dirty one exactly once', async () => {
		const store = new Store({ todo: Todo });
		for (const id of ['a', 'b', 'c']) store.createRecord('todo', { id, text: id });
		const view = await mountView(List, { store });
		handles.push(view);
		dataRuns = {};

		store.findOne('todo', 'b').update({ text: 'changed' });
		await settled();

		// The cached `remove` handler is the whole point: with a fresh closure per
		// row per render (D62's inline arm) all three children would re-run data().
		expect(dataRuns).toEqual({ b: 1 });
		expect(view.find('[data-id="b"]').textContent).toBe('changed');
		expect(view.findAll('li')).toHaveLength(3);
	});
});

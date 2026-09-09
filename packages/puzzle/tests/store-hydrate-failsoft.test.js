// Regression: startup hydration must be fail-soft (store.js _load / modelFor).
//
// Two halves of one crash. `modelFor()` was `this.models[type] || PuzzleModel` —
// a prototype-chain lookup on a plain object literal, so a persisted blob keyed
// "constructor" resolved Object (truthy) as the "model class" and the next
// Model.primaryKey() threw. And `_load()` guarded only getItem + JSON.parse,
// calling _hydrateAll OUTSIDE the try — so that TypeError escaped the Store
// constructor and therefore PuzzleApp construction: a blank page that survived
// reload, because the bad blob was never cleared. _instantiate's own doc already
// promised the opposite ("a corrupt storage blob can't crash startup").
//
// The dev HMR restore (_hydrateAll with { replace: true }) is deliberately NOT
// covered by the new guard — it is a developer-facing path and still throws.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
	};
}

// A model whose primaryKey() throws — stands in for any hydration failure the
// per-record guards inside _hydrateAll cannot recognise.
class Exploding extends PuzzleModel {
	static primaryKey() {
		throw new Error('boom (primaryKey)');
	}
}

// Minimal Storage-like stub returning a fixed serialized blob.
const stubStorage = (raw) => ({
	getItem: () => raw,
	setItem: () => {},
});

const loadFrom = (models, raw) => new Store(models, { storage: stubStorage(raw) });

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Store — model lookup ignores the Object prototype chain', () => {
	it('resolves inherited keys to PuzzleModel, not Object/Function', () => {
		const store = new Store({ todo: Todo });

		expect(store.modelFor('todo')).toBe(Todo);
		// Before the own-property check these returned Object and Function
		// respectively — neither has primaryKey(), so the next call threw.
		expect(store.modelFor('constructor')).toBe(PuzzleModel);
		expect(store.modelFor('toString')).toBe(PuzzleModel);
		expect(store.modelFor('hasOwnProperty')).toBe(PuzzleModel);
		expect(store.modelFor('nope')).toBe(PuzzleModel); // ordinary unknown type
	});
});

describe('Store — a corrupt storage blob cannot crash startup', () => {
	it('constructs over a "constructor"-keyed blob without throwing', () => {
		let store;
		expect(() => {
			store = loadFrom({ todo: Todo }, '{"constructor":[{"id":1}]}');
		}).not.toThrow();

		// The bogus key is treated as an ordinary unregistered type (generic
		// PuzzleModel), never as the Object constructor.
		expect(store.modelFor('constructor')).toBe(PuzzleModel);
		expect(store.findMany('todo')).toEqual([]);
	});

	it('registered types still hydrate alongside a "constructor" key', () => {
		const store = loadFrom(
			{ todo: Todo },
			'{"todo":[{"id":"t1","text":"ship it"}],"constructor":[{"id":1}]}'
		);

		const todos = store.findMany('todo');
		expect(todos).toHaveLength(1);
		expect(todos[0]).toBeInstanceOf(Todo);
		expect(todos[0].text).toBe('ship it');
	});

	it('degrades to a console warning when hydration itself throws', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		let store;
		expect(() => {
			store = loadFrom({ boom: Exploding }, '{"boom":[{"id":"b1"}]}');
		}).not.toThrow();

		expect(warn).toHaveBeenCalledWith(
			'[puzzle] ignoring corrupt persisted store:',
			expect.any(Error)
		);
		expect(store.recordsByType.get('boom')?.size ?? 0).toBe(0);
	});

	it('still hydrates a normal blob, provenance marker included', () => {
		const store = loadFrom(
			{ todo: Todo },
			'{"todo":[{"id":"t1","text":"a","__synced":false},{"id":"t2","text":"b"}]}'
		);

		const todos = store.findMany('todo');
		expect(todos.map((t) => t.id)).toEqual(['t1', 't2']);
		expect(todos.map((t) => t.text)).toEqual(['a', 'b']);
		expect('__synced' in todos[0]).toBe(false); // stripped back off the fields
		expect(todos[0]._synced).toBe(false); // marker honored
		expect(todos[1]._synced).toBe(true); // no marker → predates the session
	});

	it('the HMR restore path keeps propagating hydration errors', () => {
		const store = new Store({ boom: Exploding });
		// _hydrateAll is shared with the dev store restore (§27, D57), which is
		// developer-facing: only _load()'s call site is fail-soft.
		expect(() => store._hydrateAll({ boom: [{ id: 'b1' }] }, { replace: true })).toThrow(
			/boom \(primaryKey\)/
		);
	});
});

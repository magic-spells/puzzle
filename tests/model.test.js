import { describe, it, expect, vi } from 'vitest';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { Store } from '../client-runtime/datastore/store.js';

// Mirror of the canonical examples/todos model (examples/todos/app/models/todo.js)
class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required().min(1, 'Todo text cannot be empty'),
		completed: Puzzle.boolean().default(false),
		createdAt: Puzzle.date().default(() => new Date()),
	};

	get isActive() {
		return !this.completed;
	}

	toggle() {
		return this.update({ completed: !this.completed });
	}
}

describe('Puzzle field builders', () => {
	it('accumulate descriptors through chained modifiers', () => {
		const field = Puzzle.string().required('Name required').min(2, 'Too short').max(50);
		expect(field.def).toMatchObject({
			type: 'string',
			required: true,
			requiredMessage: 'Name required',
		});
		expect(field.def.validate).toEqual([
			{ rule: 'min', value: 2, message: 'Too short' },
			{ rule: 'max', value: 50, message: undefined },
		]);
	});

	it('primary() implies required', () => {
		expect(Puzzle.string().primary().def).toMatchObject({ primary: true, required: true });
	});

	it('oneOf and custom validate rules are stored (enforcement deferred in v1)', () => {
		const role = Puzzle.string().oneOf(['admin', 'member'], 'Bad role');
		expect(role.def.validate[0]).toMatchObject({ rule: 'oneOf', value: ['admin', 'member'] });

		const fn = v => v.includes('@');
		const email = Puzzle.string().validate(fn, 'Invalid email');
		expect(email.def.validate[0]).toMatchObject({ rule: 'custom', value: fn });
	});

	it('every SPEC §7 type constructor exists', () => {
		for (const type of ['string', 'number', 'boolean', 'date', 'array', 'object']) {
			expect(Puzzle[type]().def.type).toBe(type);
		}
	});
});

describe('PuzzleModel', () => {
	it('normalizedSchema collapses builders to plain descriptors', () => {
		const schema = Todo.normalizedSchema();
		expect(schema.completed).toMatchObject({ type: 'boolean', default: false });
		expect(schema.id).toMatchObject({ type: 'string', primary: true });
	});

	it('primaryKey finds the .primary() field, defaulting to id', () => {
		expect(Todo.primaryKey()).toBe('id');

		class Post extends PuzzleModel {
			static schema = { slug: Puzzle.string().primary() };
		}
		expect(Post.primaryKey()).toBe('slug');

		class Bare extends PuzzleModel {}
		expect(Bare.primaryKey()).toBe('id');
	});

	it('applyDefaults fills missing fields, invoking function defaults per record', () => {
		const a = Todo.applyDefaults({ text: 'ship v1' });
		expect(a.completed).toBe(false);
		expect(a.createdAt).toBeInstanceOf(Date);
		expect(a.text).toBe('ship v1');

		// provided values are never overwritten
		const b = Todo.applyDefaults({ text: 'x', completed: true });
		expect(b.completed).toBe(true);

		// function defaults produce fresh values per call
		const c1 = Todo.applyDefaults({ text: 'x' });
		const c2 = Todo.applyDefaults({ text: 'y' });
		expect(c1.createdAt).not.toBe(c2.createdAt);
	});

	it('non-function object/array defaults are deep-cloned per record (no shared reference)', () => {
		class Doc extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				tags: Puzzle.array().default([]),
				meta: Puzzle.object().default({ nested: { seen: false } }),
			};
		}

		const a = Doc.applyDefaults({ id: 'a' });
		const b = Doc.applyDefaults({ id: 'b' });

		// Distinct instances, not the same reference — nor the descriptor's literal.
		expect(a.tags).not.toBe(b.tags);
		expect(a.meta).not.toBe(b.meta);
		expect(a.meta.nested).not.toBe(b.meta.nested); // deep, not shallow

		// Mutating one record's default must not leak into another — or a later one.
		a.tags.push('x');
		a.meta.nested.seen = true;
		const c = Doc.applyDefaults({ id: 'c' });
		expect(b.tags).toEqual([]);
		expect(b.meta.nested.seen).toBe(false);
		expect(c.tags).toEqual([]);
		expect(c.meta.nested.seen).toBe(false);

		// The schema descriptor's own literal is untouched by the mutation.
		expect(Doc.normalizedSchema().tags.default).toEqual([]);
	});

	it('primitive defaults pass through unchanged; function defaults still invoked per record', () => {
		const invocations = [];
		class Prim extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				count: Puzzle.number().default(0),
				active: Puzzle.boolean().default(true),
				label: Puzzle.string().default('n/a'),
				stamp: Puzzle.number().default(() => (invocations.push(1), invocations.length)),
			};
		}
		const a = Prim.applyDefaults({ id: 'a' });
		expect(a).toMatchObject({ count: 0, active: true, label: 'n/a', stamp: 1 });
		const b = Prim.applyDefaults({ id: 'b' });
		expect(b.stamp).toBe(2); // function default re-invoked per record
	});

	it('records are instances of the model class — getters and methods work', () => {
		const todo = new Todo(Todo.applyDefaults({ id: 't1', text: 'write tests' }));
		expect(todo).toBeInstanceOf(Todo);
		expect(todo).toBeInstanceOf(PuzzleModel);
		expect(todo.isActive).toBe(true);

		todo.toggle();
		expect(todo.completed).toBe(true);
		expect(todo.isActive).toBe(false);
	});

	it('update merges the patch and returns the record for chaining', () => {
		const todo = new Todo({ id: 't1', text: 'a', completed: false });
		const result = todo.update({ text: 'b' });
		expect(result).toBe(todo);
		expect(todo.text).toBe('b');
		expect(todo.completed).toBe(false);
	});

	it('update/destroy notify the owning store when attached', () => {
		const store = { recordChanged: vi.fn(), removeRecord: vi.fn(), modelFor: () => Todo };
		const todo = new Todo({ id: 't1', text: 'a', completed: false });
		todo._store = store;
		Object.defineProperty(todo, '_type', { value: 'todo', enumerable: false });

		todo.toggle();
		expect(store.recordChanged).toHaveBeenCalledWith(todo);

		todo.destroy();
		expect(store.removeRecord).toHaveBeenCalledWith(todo);
	});

	it('update/destroy are safe with no store attached', () => {
		const todo = new Todo({ id: 't1', text: 'a', completed: false });
		expect(() => todo.toggle().destroy()).not.toThrow();
	});

	// Minimal store stand-in for the pk-immutability guard: update() reads
	// this._store.modelFor(this._type).primaryKey() before applying the patch.
	function attachToStore(record, type, modelClass) {
		const store = {
			recordChanged: vi.fn(),
			removeRecord: vi.fn(),
			modelFor: vi.fn(() => modelClass),
		};
		record._store = store;
		Object.defineProperty(record, '_type', { value: type, enumerable: false });
		return store;
	}

	it('rejects changing the default "id" primary key on a store-attached record', () => {
		const todo = new Todo({ id: 't1', text: 'a', completed: false });
		attachToStore(todo, 'todo', Todo);
		expect(() => todo.update({ id: 'x' })).toThrow(/primary key "id"/);
		expect(todo.id).toBe('t1'); // unchanged
	});

	it('rejects changing a custom .primary() field on a store-attached record', () => {
		class Post extends PuzzleModel {
			static schema = { slug: Puzzle.string().primary(), title: Puzzle.string() };
		}
		const post = new Post({ slug: 'hello', title: 'Hi' });
		attachToStore(post, 'post', Post);
		expect(() => post.update({ slug: 'x' })).toThrow(/primary key "slug"/);
		expect(post.slug).toBe('hello');
	});

	it('allows setting the primary key to its current value (no-op)', () => {
		const todo = new Todo({ id: 't1', text: 'a', completed: false });
		const store = attachToStore(todo, 'todo', Todo);
		expect(() => todo.update({ id: 't1', text: 'b' })).not.toThrow();
		expect(todo.text).toBe('b');
		expect(store.recordChanged).toHaveBeenCalledWith(todo);
	});

	it('updates non-pk fields normally on a store-attached record', () => {
		const todo = new Todo({ id: 't1', text: 'a', completed: false });
		const store = attachToStore(todo, 'todo', Todo);
		todo.update({ text: 'b', completed: true });
		expect(todo.text).toBe('b');
		expect(todo.completed).toBe(true);
		expect(store.recordChanged).toHaveBeenCalledWith(todo);
	});

	it('lets a store-less record update any field, including the primary key', () => {
		const todo = new Todo({ id: 't1', text: 'a', completed: false });
		expect(() => todo.update({ id: 'x', text: 'b' })).not.toThrow();
		expect(todo.id).toBe('x');
		expect(todo.text).toBe('b');
	});

	it('framework lifecycle state is non-enumerable: excluded from serialization and rendering', () => {
		const todo = new Todo({ id: 't1', text: 'a' });
		todo._store = { recordChanged() {}, removeRecord() {} };
		expect(Object.keys(todo)).not.toContain('_store');
		expect(Object.keys(todo)).not.toContain('_deleted');
		expect(JSON.parse(JSON.stringify(todo))).toEqual({ id: 't1', text: 'a' });
	});

	// Prototype-pollution guard: JSON.parse produces a literal "__proto__" as a
	// real OWN key, and the store's shape guards only reject null/array/non-object,
	// so a payload like {"id":1,"__proto__":{}} reaches the constructor. A naive
	// Object.assign would hit Object.prototype's __proto__ SETTER and re-prototype
	// the record, severing every PuzzleModel method (update/save/validate/toJSON).
	describe('prototype-pollution safety (Object.assign __proto__ hole)', () => {
		it('constructing from data with an own __proto__ key keeps methods intact', () => {
			// JSON.parse (not an object literal — `{__proto__:...}` is proto syntax,
			// not an own key) produces __proto__ as a real OWN enumerable property.
			const todo = new Todo(JSON.parse('{"id":1,"__proto__":{}}'));
			// prototype not swapped — still a Todo with its methods
			expect(Object.getPrototypeOf(todo)).toBe(Todo.prototype);
			expect(todo).toBeInstanceOf(Todo);
			expect(typeof todo.update).toBe('function');
			expect(typeof todo.save).toBe('function');
			expect(typeof todo.validate).toBe('function');
			expect(typeof todo.toJSON).toBe('function');
			// the dangerous key is dropped, real data preserved
			expect(todo.id).toBe(1);
			expect(Object.keys(todo)).not.toContain('__proto__');
		});

		it('the JSON.parse variant with a populated __proto__ is also neutralized', () => {
			const parsed = JSON.parse('{"id":1,"__proto__":{"x":1}}');
			const todo = new Todo(parsed);
			expect(Object.getPrototypeOf(todo)).toBe(Todo.prototype);
			expect(typeof todo.update).toBe('function');
			expect(todo.id).toBe(1);
			// the injected accessor value never landed on the record
			expect(todo.x).toBeUndefined();
			// and Object.prototype was not polluted
			expect(({}).x).toBeUndefined();
		});

		it('update() with a JSON-derived __proto__ patch cannot re-prototype the record', () => {
			const todo = new Todo({ id: 't1', text: 'a' });
			todo.update(JSON.parse('{"text":"b","__proto__":{"pwned":1}}'));
			expect(Object.getPrototypeOf(todo)).toBe(Todo.prototype);
			expect(typeof todo.update).toBe('function');
			expect(todo.text).toBe('b');
			expect(todo.pwned).toBeUndefined();
		});
	});
});

describe('PuzzleModel.validate() / createRecord() parity (D48)', () => {
	it('accepts an omitted or null primary key, but still reports other required fields', () => {
		expect(Todo.validate({ text: 'ready' })).toEqual({ valid: true, errors: [] });
		expect(Todo.validate({ id: null, text: 'ready' })).toEqual({ valid: true, errors: [] });
		expect(Todo.validate({ id: 't1', text: 'ready' })).toEqual({ valid: true, errors: [] });

		expect(Todo.validate({}).errors).toEqual([
			{ field: 'text', rule: 'required', message: '"text" is required' },
		]);
	});

	it('matches createRecord acceptance across generated, supplied, and invalid values', () => {
		const cases = [
			{ text: 'generated' },
			{ id: null, text: 'generated from null' },
			{ id: 'provided', text: 'provided' },
			{ id: '', text: 'empty pk stays invalid' },
			{ id: 'missing-text' },
			{ text: '' },
		];

		for (const data of cases) {
			const store = new Store({ todo: Todo });
			let createAccepted = true;
			try {
				store.createRecord('todo', data);
			} catch {
				createAccepted = false;
			}
			expect(Todo.validate(data).valid, JSON.stringify(data)).toBe(createAccepted);
		}
	});

	it('supports partial validation through the public { fields } option', () => {
		expect(Todo.validate({ text: '' }, { fields: ['completed'] })).toEqual({
			valid: true,
			errors: [],
		});
		expect(Todo.validate({ text: '' }, { fields: ['text'] }).errors).toEqual([
			{ field: 'text', rule: 'required', message: '"text" is required' },
		]);
	});
});

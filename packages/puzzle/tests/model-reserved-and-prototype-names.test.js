import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

// upsert() is part of the server-sync capability, not core Store (D157), and
// save/delete only count as method names once it is installed.
adapter.install();

afterEach(() => {
	vi.restoreAllMocks();
});

// Two names the record shape had already spoken for, in ways nothing checked.
//
// The registration guard rejected schema fields that collide with a model
// METHOD, because such a field can never hold data — every merge path drops it.
// But that is not the only way a name can be unusable, and the guard covered
// only one of them.

// ---- reserved internal field names ------------------------------------------

describe('schema fields naming a reserved record field', () => {
	// MERGE_SKIP drops these on update / upsert / save response / hydration, and
	// nothing shadows anything, so the method walk never saw them. A schema could
	// declare `_type` and register perfectly cleanly — then the field could never
	// hold data: `required` failed forever and save() rejected without ever
	// dispatching a request, with no diagnostic naming the field.
	//
	// These are not hypothetical names. `_type` is Sanity's field convention and
	// `_deleted` is CouchDB/PouchDB's, so they arrive in real payloads.
	const RESERVED = ['_type', '_synced', '_deleted', '_store'];

	it.each(RESERVED)('registering a model with a "%s" field throws, naming the field', (name) => {
		class Doc extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), [name]: Puzzle.string() };
		}
		expect(() => new Store({ doc: Doc })).toThrow(
			new RegExp(`model "doc" declares schema entry "${name}".*reserved record field`, 's')
		);
	});

	it('says WHY, so the message points at the failure it prevents', () => {
		class Doc extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), _type: Puzzle.string().required() };
		}
		// The symptom without this guard is a save() that rejects with no request
		// sent, so the message has to connect the name to that.
		expect(() => new Store({ doc: Doc })).toThrow(/never hold data/);
		expect(() => new Store({ doc: Doc })).toThrow(/required rule on it fails forever/);
		expect(() => new Store({ doc: Doc })).toThrow(/Rename the field/);
	});

	it('the pollution family is rejected by name too', () => {
		for (const name of ['__proto__', 'constructor', 'prototype']) {
			class Doc extends PuzzleModel {
				// Object literal syntax would make `__proto__` re-prototype the schema
				// itself rather than declare a field, so define it explicitly.
				static schema = Object.defineProperty(
					{ id: Puzzle.string().primary() },
					name,
					{ value: Puzzle.string(), enumerable: true, configurable: true }
				);
			}
			expect(() => new Store({ doc: Doc })).toThrow(/reserved record field/);
		}
	});

	it('is exactly the trap it closes: the field could never have held data', () => {
		// Same model, minus the registration guard — assembled by hand so the test
		// shows the failure the throw prevents rather than asserting it abstractly.
		class Doc extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), _type: Puzzle.string().required() };
		}
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const record = new Doc({ id: 'd1' });
		record.update({ _type: 'article' });

		expect(record._type).toBeUndefined();
		expect(record.validate()).toEqual({
			valid: false,
			errors: [{ field: '_type', rule: 'required', message: '"_type" is required' }],
		});
	});

	it('an ordinary underscore-prefixed field is untouched', () => {
		// The rule is a fixed list, not a prefix — apps name fields this way.
		class Doc extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				_internal: Puzzle.string(),
				_id: Puzzle.string(),
				_rev: Puzzle.string(),
			};
		}
		expect(() => new Store({ doc: Doc })).not.toThrow();
		const store = new Store({ doc: Doc });
		const record = store.upsert('doc', { id: 'd1', _internal: 'kept', _id: 'x', _rev: '1-a' });
		expect(record._internal).toBe('kept');
		expect(record._rev).toBe('1-a');
	});
});

// ---- Object.prototype's methods ---------------------------------------------

describe('payload keys naming an Object.prototype method', () => {
	const model = () =>
		class Item extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), name: Puzzle.string() };
		};

	it('a "toString" payload key does not blank the render', () => {
		// The collision walk used to stop BEFORE Object.prototype, on the premise
		// that its dangerous names were covered by POLLUTION_SKIP — which holds
		// only the three re-prototyping names. So `toString` landed as an own DATA
		// property, the record lost its only callable primitive conversion, and
		// `String(record)` threw "Cannot convert object to primitive value" —
		// blanking any template that interpolates the whole record.
		const Model = model();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const record = new Model({ id: 'i1', name: 'widget', toString: 'shadowed' });

		expect(Object.prototype.hasOwnProperty.call(record, 'toString')).toBe(false);
		expect(typeof record.toString).toBe('function');
		expect(() => String(record)).not.toThrow();
		expect(String(record)).toBe('[object Object]');
		expect(`${record}`).toBe('[object Object]');
		expect(record.name).toBe('widget');
		expect(warn.mock.calls.map(([m]) => m)).toContainEqual(
			expect.stringMatching(/"toString" collides with a method on model "Item"/)
		);
	});

	it('"valueOf" is the other half of the conversion pair', () => {
		const Model = model();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const record = new Model({ id: 'i1', valueOf: 'shadowed' });

		expect(() => `${record}`).not.toThrow();
		expect(() => Number(record)).not.toThrow();
		expect(record.valueOf()).toBe(record);
	});

	it('both at once — the shape that guarantees the TypeError', () => {
		// With only one shadowed, ToPrimitive falls through to the other. Both
		// shadowed leaves nothing callable at all.
		const Model = model();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const record = new Model({ id: 'i1', name: 'widget', toString: 'a', valueOf: 'b' });

		expect(() => String(record)).not.toThrow();
		expect(record.toJSON()).toEqual({ id: 'i1', name: 'widget' });
	});

	it('covers the rest of Object.prototype under one rule, not a name list', () => {
		const Model = model();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const record = new Model({
			id: 'i1',
			hasOwnProperty: true,
			isPrototypeOf: 1,
			propertyIsEnumerable: 'x',
			toLocaleString: null,
		});

		for (const key of ['hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
			expect(typeof record[key]).toBe('function');
		}
		// The framework itself calls hasOwnProperty on records.
		expect(Object.prototype.hasOwnProperty.call(record, 'id')).toBe(true);
	});

	it('every write path drops them, not just construction', () => {
		const Model = model();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = new Store({ item: Model });

		const upserted = store.upsert('item', { id: 'i1', name: 'a', toString: 'nope' });
		expect(typeof upserted.toString).toBe('function');

		upserted.update({ name: 'b', valueOf: 'nope' });
		expect(upserted.name).toBe('b');
		expect(typeof upserted.valueOf).toBe('function');
		expect(() => String(upserted)).not.toThrow();
	});

	it('the schema guard agrees with the collision walk', () => {
		// The two walks have to reach the same conclusion about what "is a method".
		// If registration stopped short of Object.prototype while assignment did
		// not, a schema field named `toString` would register cleanly and then
		// never hold data — the reserved-field trap above, in a second costume.
		class Broken extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), toString: Puzzle.string() };
		}
		expect(() => new Store({ broken: Broken })).toThrow(
			/model "broken" declares schema entry "toString".*method on Broken/s
		);

		class AlsoBroken extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), valueOf: Puzzle.string() };
		}
		expect(() => new Store({ broken: AlsoBroken })).toThrow(/"valueOf"/);
	});

	it('an own data property that legitimately shadows an inherited one still assigns', () => {
		// The walk returns the FIRST descriptor it finds, so an own property that
		// already shadows a prototype name stays assignable — extending the walk
		// must not change that.
		const Model = model();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const record = new Model({ id: 'i1' });
		Object.defineProperty(record, 'toLocaleString', {
			value: 'already own',
			writable: true,
			enumerable: true,
			configurable: true,
		});
		record.update({ toLocaleString: 'reassigned' });
		expect(record.toLocaleString).toBe('reassigned');
	});
});

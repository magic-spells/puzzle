import { describe, it, expect, vi } from 'vitest';
import { PuzzleModel, Puzzle, PuzzleValidationError } from '../client-runtime/model.js';
import { Store } from '../client-runtime/datastore/store.js';
import * as pkg from '../client-runtime/index.js';

// A model exercising every rule kind, in a fixed schema-declaration order so
// error-order assertions are meaningful (constellation/doc/DOC-SPEC.md §20, D48).
class User extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		name: Puzzle.string().required().min(2, 'Name too short'),
		age: Puzzle.number().min(0).max(120),
		role: Puzzle.string().oneOf(['admin', 'member'], 'Bad role'),
		email: Puzzle.string().validate((v) => v.includes('@'), 'Invalid email'),
		tags: Puzzle.array().max(3),
		bio: Puzzle.string().min(5), // non-required with a rule
	};
}

const makeStore = (options) => new Store({ user: User }, options);

// A "valid" data object for User — override individual fields per test.
const valid = (over = {}) => ({
	id: 'u1',
	name: 'Ann',
	age: 30,
	role: 'admin',
	email: 'a@b.com',
	tags: ['x'],
	...over,
});

describe('PuzzleValidationError', () => {
	it('carries the errors array and takes its message from the first error', () => {
		const err = new PuzzleValidationError([
			{ field: 'name', rule: 'required', message: 'first' },
			{ field: 'age', rule: 'min', message: 'second' },
		]);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('PuzzleValidationError');
		expect(err.message).toBe('first');
		expect(err.errors).toHaveLength(2);
	});

	it('is exported from the package root', () => {
		expect(pkg.PuzzleValidationError).toBe(PuzzleValidationError);
	});
});

describe('Model.validate — each rule fails and passes (non-throwing)', () => {
	it('required fails on undefined, null, and empty string; passes otherwise', () => {
		for (const bad of [undefined, null, '']) {
			const { valid: ok, errors } = User.validate(valid({ name: bad }));
			expect(ok).toBe(false);
			expect(errors.find((e) => e.field === 'name').rule).toBe('required');
		}
		expect(User.validate(valid({ name: 'ok' })).valid).toBe(true);
	});

	it('required uses the default message when none is given', () => {
		class Bare extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), title: Puzzle.string().required() };
		}
		const { errors } = Bare.validate({ id: 'x' });
		expect(errors).toEqual([{ field: 'title', rule: 'required', message: '"title" is required' }]);
	});

	it('min/max on strings & arrays compare .length', () => {
		expect(User.validate(valid({ name: 'a' })).errors).toEqual([
			{ field: 'name', rule: 'min', message: 'Name too short' },
		]);
		const tooMany = User.validate(valid({ tags: ['a', 'b', 'c', 'd'] }));
		expect(tooMany.errors).toEqual([
			{ field: 'tags', rule: 'max', message: '"tags" length must be at most 3' },
		]);
		expect(User.validate(valid({ tags: ['a', 'b', 'c'] })).valid).toBe(true);
	});

	it('min/max on numbers compare value', () => {
		expect(User.validate(valid({ age: -1 })).errors).toEqual([
			{ field: 'age', rule: 'min', message: '"age" must be at least 0' },
		]);
		expect(User.validate(valid({ age: 200 })).errors).toEqual([
			{ field: 'age', rule: 'max', message: '"age" must be at most 120' },
		]);
		expect(User.validate(valid({ age: 0 })).valid).toBe(true);
		expect(User.validate(valid({ age: 120 })).valid).toBe(true);
	});

	it('min/max on dates compare value', () => {
		class Event extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				at: Puzzle.date().min(new Date('2020-01-01')),
			};
		}
		expect(Event.validate({ id: 'e', at: new Date('2019-01-01') }).valid).toBe(false);
		expect(Event.validate({ id: 'e', at: new Date('2021-01-01') }).valid).toBe(true);
	});

	it('a NaN-ish min/max value passes instead of throwing', () => {
		// NaN is still typeof number, so it is not a type mismatch — the comparison
		// is just incomparable and passes (never a throw).
		expect(User.validate(valid({ age: NaN })).valid).toBe(true);
	});

	it('a number-typed field measures the VALUE, not a string length (type-aware bounds)', () => {
		// age is number().min(0).max(120): a form-bound string like "150" must NOT
		// satisfy max(120) by its 3-char length. Each bound reports the type mismatch,
		// so a wrong-typed value against a two-bound field fails BOTH rules.
		expect(User.validate(valid({ age: '150' })).errors).toEqual([
			{ field: 'age', rule: 'min', message: '"age" must be a number' },
			{ field: 'age', rule: 'max', message: '"age" must be a number' },
		]);
		// "5" and a non-numeric "abc" behave identically — it is a type problem, not
		// a length/bound comparison.
		expect(User.validate(valid({ age: '5' })).valid).toBe(false);
		expect(User.validate(valid({ age: 'abc' })).valid).toBe(false);

		// A single-bound number field pins the exact rule + type message.
		class Score extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), pts: Puzzle.number().max(120) };
		}
		expect(Score.validate({ id: 's', pts: '150' }).errors).toEqual([
			{ field: 'pts', rule: 'max', message: '"pts" must be a number' },
		]);

		// A real number still measures as a bound, not a type error.
		expect(User.validate(valid({ age: 150 })).errors).toEqual([
			{ field: 'age', rule: 'max', message: '"age" must be at most 120' },
		]);
		expect(User.validate(valid({ age: 30 })).valid).toBe(true);
	});

	it('a date-typed field compares by time; a non-Date (ISO string) is a type mismatch', () => {
		class Event extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				at: Puzzle.date().min(new Date('2020-01-01')),
			};
		}
		// Date instance compares by getTime() as before.
		expect(Event.validate({ id: 'e', at: new Date('2021-01-01') }).valid).toBe(true);
		// An ISO string is not a Date → type mismatch, not a lexical length compare.
		expect(Event.validate({ id: 'e', at: '2021-01-01' }).errors).toEqual([
			{ field: 'at', rule: 'min', message: '"at" must be a date' },
		]);
	});

	it('type-aware bounds still let absent (null/undefined) values pass', () => {
		class Person extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				age: Puzzle.number().min(0).max(120), // non-required
			};
		}
		expect(Person.validate({ id: 'p', age: undefined }).valid).toBe(true);
		expect(Person.validate({ id: 'p', age: null }).valid).toBe(true);
	});

	it('string().min keeps LENGTH semantics (type-aware change is number/date only)', () => {
		class Note extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), body: Puzzle.string().min(3) };
		}
		expect(Note.validate({ id: 'n', body: 'ab' }).errors).toEqual([
			{ field: 'body', rule: 'min', message: '"body" length must be at least 3' },
		]);
		expect(Note.validate({ id: 'n', body: 'abcd' }).valid).toBe(true);
	});

	it('oneOf is strict === membership', () => {
		expect(User.validate(valid({ role: 'ghost' })).errors).toEqual([
			{ field: 'role', rule: 'oneOf', message: 'Bad role' },
		]);
		expect(User.validate(valid({ role: 'member' })).valid).toBe(true);
		// default message
		class Pick extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), n: Puzzle.number().oneOf([1, 2]) };
		}
		expect(Pick.validate({ id: 'p', n: 3 }).errors[0].message).toBe('"n" must be one of: 1, 2');
	});

	it('custom validate: falsy return invalid; default message applies', () => {
		expect(User.validate(valid({ email: 'nope' })).errors).toEqual([
			{ field: 'email', rule: 'custom', message: 'Invalid email' },
		]);
		expect(User.validate(valid({ email: 'a@b' })).valid).toBe(true);

		class Widget extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), n: Puzzle.number().validate((v) => v > 0) };
		}
		expect(Widget.validate({ id: 'w', n: -1 }).errors[0].message).toBe('"n" is invalid');
	});

	it('a THROWING custom validator propagates (broken validator = programming error)', () => {
		class Boom extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				n: Puzzle.number().validate(() => {
					throw new Error('validator bug');
				}),
			};
		}
		expect(() => Boom.validate({ id: 'b', n: 1 })).toThrow('validator bug');
	});
});

describe('Model.validate — collection, short-circuit, and skip semantics', () => {
	it('collects all failing fields in schema-declaration order', () => {
		const { errors } = User.validate({
			// id missing (but not required beyond primary — pk is required),
			name: 'a', // min fails
			age: -5, // min fails
			role: 'nope', // oneOf fails
			email: 'x', // custom fails
			tags: [1, 2, 3, 4], // max fails
		});
		expect(errors.map((e) => e.field)).toEqual(['id', 'name', 'age', 'role', 'email', 'tags']);
		expect(errors[0].rule).toBe('required'); // id is .primary() → required
	});

	it('required short-circuits a field: only one error for a missing required field', () => {
		// name is required + min(2); an empty value must yield ONLY the required error.
		const { errors } = User.validate(valid({ name: '' }));
		const nameErrors = errors.filter((e) => e.field === 'name');
		expect(nameErrors).toHaveLength(1);
		expect(nameErrors[0].rule).toBe('required');
	});

	it('a non-required field that is undefined/null skips its remaining rules', () => {
		// bio is non-required with min(5): undefined and null both pass.
		expect(User.validate(valid({ bio: undefined })).valid).toBe(true);
		expect(User.validate(valid({ bio: null })).valid).toBe(true);
		// but a present-yet-short value still fails min
		expect(User.validate(valid({ bio: 'hi' })).errors).toEqual([
			{ field: 'bio', rule: 'min', message: '"bio" length must be at least 5' },
		]);
	});
});

describe('record.validate — current field values, non-throwing', () => {
	it('returns { valid, errors } for the record as it stands', () => {
		const rec = new User(valid());
		expect(rec.validate()).toEqual({ valid: true, errors: [] });

		const bad = new User(valid({ name: 'a' }));
		const res = bad.validate();
		expect(res.valid).toBe(false);
		expect(res.errors[0]).toMatchObject({ field: 'name', rule: 'min' });
	});
});

describe('createRecord enforcement (SPEC §20)', () => {
	it('throws PuzzleValidationError and inserts nothing on invalid data', () => {
		const store = makeStore();
		expect(() => store.createRecord('user', valid({ name: '' }))).toThrow(PuzzleValidationError);
		expect(store.findMany('user')).toEqual([]);
	});

	it('a failed create does not notify subscribers', async () => {
		const store = makeStore();
		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findMany('user'));

		expect(() => store.createRecord('user', valid({ role: 'nope' }))).toThrow(PuzzleValidationError);

		// flush any (there should be none) pending notifications
		store.flush();
		await new Promise((r) => setTimeout(r, 5));
		expect(component.onStoreChange).not.toHaveBeenCalled();
		expect(store.findMany('user')).toEqual([]);
	});

	it('a failed create does not persist', () => {
		const data = new Map();
		const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
		const store = makeStore({ storage });
		expect(() => store.createRecord('user', valid({ email: 'bad' }))).toThrow(PuzzleValidationError);
		expect(data.get('puzzle-store')).toBeUndefined(); // never written
	});

	it('auto-generated primary key satisfies required on primary()', () => {
		// name/age/etc present, id omitted → pk generated, must pass required.
		const store = makeStore();
		const rec = store.createRecord('user', valid({ id: undefined }));
		expect(typeof rec.id).toBe('string');
		expect(rec.id.length).toBeGreaterThan(0);
		expect(store.findMany('user')).toHaveLength(1);
	});

	it('valid data still creates and returns the record', () => {
		const store = makeStore();
		const rec = store.createRecord('user', valid());
		expect(rec).toBeInstanceOf(User);
		expect(store.findOne('user', 'u1')).toBe(rec);
	});
});

describe('update enforcement (SPEC §20)', () => {
	it('throws and leaves the record untouched on an invalid patch', () => {
		const store = makeStore();
		const rec = store.createRecord('user', valid());
		expect(() => rec.update({ name: '' })).toThrow(PuzzleValidationError);
		expect(rec.name).toBe('Ann'); // untouched
	});

	it('validates ONLY the patched fields — an invalid untouched field does not block an unrelated update', () => {
		// Build a record whose email is invalid, bypassing createRecord validation
		// (hydration path is exempt), then update an unrelated valid field.
		const store = makeStore();
		const rec = store._instantiate('user', valid({ email: 'no-at-sign' })); // no validate flag
		expect(rec.email).toBe('no-at-sign'); // in the store, invalid field and all
		// updating `name` (valid) must succeed despite the invalid untouched email
		expect(() => rec.update({ name: 'Annette' })).not.toThrow();
		expect(rec.name).toBe('Annette');
	});

	it('runs on store-less records too — the rules live on the class', () => {
		const rec = new User(valid());
		expect(() => rec.update({ role: 'nope' })).toThrow(PuzzleValidationError);
		expect(rec.role).toBe('admin'); // untouched
		expect(() => rec.update({ role: 'member' })).not.toThrow();
		expect(rec.role).toBe('member');
	});

	it('the pk-immutability check still runs first (before validation)', () => {
		const store = makeStore();
		const rec = store.createRecord('user', valid());
		// changing the pk throws the immutability error, not a validation error
		expect(() => rec.update({ id: 'x', name: '' })).toThrow(/primary key "id"/);
		expect(rec.id).toBe('u1');
	});

	it('returns the record on a successful (valid) update for chaining', () => {
		const rec = new User(valid());
		expect(rec.update({ name: 'Annie' })).toBe(rec);
		expect(rec.name).toBe('Annie');
	});
});

describe('exempt read paths accept data that would fail validation (SPEC §20)', () => {
	it('_upsert (loadAll/loadOne) skips validation', async () => {
		const fetchFn = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => [{ id: 's1', name: '', role: 'ghost', email: 'no-at' }],
		}));
		vi.stubGlobal('fetch', fetchFn);

		class ApiUser extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				name: Puzzle.string().required().min(2),
				role: Puzzle.string().oneOf(['admin', 'member']),
				email: Puzzle.string().validate((v) => v.includes('@')),
			};
			static adapter = { endpoint: '/api/users' };
		}
		const store = new Store({ user: ApiUser }, { apiURL: 'https://x.test' });

		await expect(store.loadAll('user')).resolves.toHaveLength(1);
		expect(store.findOne('user', 's1').name).toBe(''); // invalid data landed
		vi.unstubAllGlobals();
	});

	it('storage hydration skips validation', () => {
		const data = new Map();
		const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
		storage.setItem(
			'puzzle-store',
			JSON.stringify({ user: [{ id: 'h1', name: '', role: 'ghost', email: 'bad' }] })
		);
		let store;
		expect(() => {
			store = makeStore({ storage });
		}).not.toThrow();
		expect(store.findOne('user', 'h1').name).toBe(''); // hydrated despite being invalid
	});
});

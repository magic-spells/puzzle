import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel, PuzzleValidationError } from '../client-runtime/model.js';

adapter.install();

// readBody() consumes text(), so responses mirror the network boundary rather
// than stubbing a private reconciliation method.
const response = (body = '') => ({
	ok: true,
	status: 200,
	statusText: 'OK',
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// ---- Bug A: payload keys that name a model method ---------------------------

describe('payload keys colliding with a model method', () => {
	const permissionModel = () =>
		class Doc extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				name: Puzzle.string(),
			};
			static adapter = { endpoint: '/docs' };
		};

	it('construction drops a payload key naming a PuzzleModel method and keeps the method callable', () => {
		const Model = permissionModel();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// `update`/`delete` here are ordinary server permission flags.
		const record = new Model({ id: 'd1', name: 'spec', update: true, delete: false });

		expect(typeof record.update).toBe('function');
		expect(Object.prototype.hasOwnProperty.call(record, 'update')).toBe(false);
		expect(record.name).toBe('spec');
		expect(() => record.update({ name: 'spec2' })).not.toThrow();
		expect(record.name).toBe('spec2');
		expect(warn.mock.calls.map(([message]) => message)).toContainEqual(
			expect.stringMatching(/"update" collides with a method on model "Doc"/)
		);
	});

	it('a shadowed toJSON would break persistence — the key is dropped instead, warned once', () => {
		const Model = permissionModel();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const record = new Model({ id: 'd1', name: 'spec', toJSON: 'nope' });
		expect(record.toJSON()).toEqual({ id: 'd1', name: 'spec' });
		expect(JSON.parse(JSON.stringify(record))).toEqual({ id: 'd1', name: 'spec' });

		// Warn-once is per (model class, key), across records and write paths.
		new Model({ id: 'd2', toJSON: 'nope' });
		record.update({ toJSON: 'nope' });
		const toJSONWarnings = warn.mock.calls.filter(([m]) => m.includes('"toJSON"'));
		expect(toJSONWarnings).toHaveLength(1);
		expect(toJSONWarnings[0][0]).toMatch(/collides with a method on model "Doc"/);
	});

	it('a user-defined subclass method is protected too, and update() still applies the real fields', () => {
		class Task extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
			toggle() {
				return 'toggled';
			}
		}
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const record = new Task({ id: 't1', title: 'a' });

		record.update({ title: 'b', toggle: 'server-flag' });
		expect(record.title).toBe('b');
		expect(record.toggle()).toBe('toggled');
	});

	it('a server payload naming a method never lands through loadMany or a save response', async () => {
		const Model = permissionModel();
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response([{ id: 'd1', name: 'server', update: true }]))
			.mockResolvedValueOnce(response({ id: 'd1', name: 'saved', delete: false }));
		vi.stubGlobal('fetch', fetch);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const store = new Store({ doc: Model }, { apiURL: 'https://example.test' });
		await store.loadMany('doc');
		const record = store.findOne('doc', 'd1');
		expect(record.name).toBe('server');
		expect(typeof record.update).toBe('function');

		await expect(record.save()).resolves.toBe(record);
		expect(record.name).toBe('saved');
		expect(record._synced).toBe(true);
		expect(typeof record.delete).toBe('function');
	});

	it('an own data property that already shadows an inherited name stays assignable', () => {
		class Loose extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		const record = new Loose({ id: 'l1' });
		// Not a method anywhere on the chain: a plain field named `status` merges.
		record.update({ status: 'a' });
		record.update({ status: 'b' });
		expect(record.status).toBe('b');
	});

	it('D49 relationship accessors are getters WITH setters and keep their setter behavior', () => {
		class User extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		class Post extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				authorId: Puzzle.string(),
				author: Puzzle.belongsTo('user'),
			};
		}
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = new Store({ user: User, post: Post });
		const user = store.createRecord('user', { id: 'u1' });
		const post = store.createRecord('post', { id: 'p1', authorId: 'u1' });

		// The relationship resolves through the store, and an embedded payload
		// hits D49's warn-once no-op setter — NOT the method-collision skip.
		expect(post.author).toBe(user);
		post.update({ author: { id: 'u2' } });
		expect(post.author).toBe(user);
		expect(Object.prototype.hasOwnProperty.call(post, 'author')).toBe(false);
		expect(warn.mock.calls.map(([m]) => m)).toContainEqual(
			expect.stringMatching(/"author" is a relationship on model "post"/)
		);
		expect(warn.mock.calls.map(([m]) => m)).not.toContainEqual(
			expect.stringMatching(/"author" collides with a method/)
		);
	});
});

describe('schema fields colliding with a model method', () => {
	it('registering a model whose schema field names a PuzzleModel method throws', () => {
		class Broken extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				update: Puzzle.boolean(),
			};
		}
		expect(() => new Store({ broken: Broken })).toThrow(
			/model "broken" declares schema entry "update".*method on Broken/s
		);
	});

	it('the check covers author-defined methods and relationship entries', () => {
		class WithMethod extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), archive: Puzzle.boolean() };
			archive() {
				return true;
			}
		}
		expect(() => new Store({ thing: WithMethod })).toThrow(/"archive"/);

		class RelCollision extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), validate: Puzzle.hasMany('thing') };
		}
		expect(() => new Store({ rel: RelCollision })).toThrow(/"validate"/);
		// The bad relationship never reached the prototype.
		expect(typeof RelCollision.prototype.validate).toBe('function');
	});

	it('adapter verbs count as methods once the capability is installed', () => {
		class Doc extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), save: Puzzle.boolean() };
		}
		expect(() => new Store({ doc: Doc })).toThrow(/"save"/);
	});

	it('ordinary schemas — including computed getters and relationships — register fine', () => {
		class Post extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				title: Puzzle.string(),
				authorId: Puzzle.string(),
				author: Puzzle.belongsTo('user'),
			};
			get slug() {
				return String(this.title).toLowerCase();
			}
		}
		class User extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		expect(() => new Store({ post: Post, user: User })).not.toThrow();
	});
});

// ---- Bug B: JSON-sourced date fields ----------------------------------------

describe('date fields hydrated from JSON', () => {
	const eventModel = () =>
		class Event extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				title: Puzzle.string(),
				// The bound is what reaches the type gate in checkBound.
				startsAt: Puzzle.date().min(new Date('2000-01-01T00:00:00.000Z')),
				day: Puzzle.date(),
			};
			static adapter = { endpoint: '/events' };
		};

	it('a date-typed field with a min/max rule is the configuration that rejects a raw string', () => {
		class Bounded extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				bounded: Puzzle.date().min(new Date('2000-01-01T00:00:00.000Z')),
				plain: Puzzle.date(),
				plainRequired: Puzzle.date().required(),
			};
		}
		const raw = {
			id: 'x',
			bounded: '2026-08-16T10:00:00.000Z',
			plain: '2026-08-16T10:00:00.000Z',
			plainRequired: '2026-08-16T10:00:00.000Z',
		};
		const { errors } = Bounded.validate(raw);
		expect(errors).toEqual([
			{ field: 'bounded', rule: 'min', message: '"bounded" must be a date' },
		]);
	});

	it('upsert revives an ISO datetime string so save() validates and dispatches', async () => {
		const Model = eventModel();
		const fetch = vi.fn(async () => response({ id: 'e1', startsAt: '2026-08-16T10:00:00.000Z' }));
		vi.stubGlobal('fetch', fetch);
		const store = new Store({ event: Model }, { apiURL: 'https://example.test' });

		const record = store.upsert('event', {
			id: 'e1',
			title: 'launch',
			startsAt: '2026-08-16T10:00:00.000Z',
		});
		expect(record.startsAt).toBeInstanceOf(Date);
		expect(record.startsAt.toISOString()).toBe('2026-08-16T10:00:00.000Z');
		expect(record.validate().valid).toBe(true);

		await expect(record.save()).resolves.toBe(record);
		expect(fetch).toHaveBeenCalledTimes(1);
		// Serialization back out is Date#toJSON — the ISO string again.
		expect(JSON.parse(fetch.mock.calls[0][1].body).startsAt).toBe('2026-08-16T10:00:00.000Z');
	});

	it('without coercion the very first save would reject — loadMany now leaves a saveable record', async () => {
		const Model = eventModel();
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response([{ id: 'e1', title: 'a', startsAt: '2026-08-16T10:00:00.000Z' }]))
			.mockResolvedValueOnce(response({ id: 'e1', title: 'b' }));
		vi.stubGlobal('fetch', fetch);
		const store = new Store({ event: Model }, { apiURL: 'https://example.test' });

		await store.loadMany('event');
		const record = store.findOne('event', 'e1');
		expect(record.startsAt).toBeInstanceOf(Date);

		record.update({ title: 'b' });
		await expect(record.save()).resolves.toBe(record);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('a save response echoing a date string revives it too', async () => {
		const Model = eventModel();
		const fetch = vi.fn(async () =>
			response({ id: 'e1', title: 'server', startsAt: '2026-09-01T08:30:00.000Z' })
		);
		vi.stubGlobal('fetch', fetch);
		const store = new Store({ event: Model }, { apiURL: 'https://example.test' });
		const record = store.createRecord('event', {
			id: 'e1',
			title: 'local',
			startsAt: new Date('2026-08-16T10:00:00.000Z'),
		});

		await expect(record.save()).resolves.toBe(record);
		expect(record.startsAt).toBeInstanceOf(Date);
		expect(record.startsAt.toISOString()).toBe('2026-09-01T08:30:00.000Z');
	});

	it('a bare YYYY-MM-DD becomes LOCAL midnight (D114), not UTC midnight', () => {
		const Model = eventModel();
		const store = new Store({ event: Model });
		const record = store.upsert('event', { id: 'e1', day: '2026-07-24' });

		expect(record.day).toBeInstanceOf(Date);
		expect(record.day.getFullYear()).toBe(2026);
		expect(record.day.getMonth()).toBe(6);
		expect(record.day.getDate()).toBe(24);
		expect(record.day.getHours()).toBe(0);
		expect(record.day.getTime()).toBe(new Date(2026, 6, 24).getTime());
	});

	it('epoch millis revive; unparseable values are left exactly as they arrived', () => {
		const Model = eventModel();
		const store = new Store({ event: Model });
		const ms = Date.UTC(2026, 6, 24, 12);

		const numeric = store.upsert('event', { id: 'e1', day: ms });
		expect(numeric.day).toBeInstanceOf(Date);
		expect(numeric.day.getTime()).toBe(ms);

		// "2026-02-31" names a day that doesn't exist (D114) — no silent March roll.
		const bad = store.upsert('event', { id: 'e2', day: '2026-02-31', startsAt: 'not a date' });
		expect(bad.day).toBe('2026-02-31');
		expect(bad.startsAt).toBe('not a date');
		expect(bad.validate().valid).toBe(false);

		// Non-date-typed and absent fields are untouched.
		const plain = store.upsert('event', { id: 'e3', title: '2026-07-24' });
		expect(plain.title).toBe('2026-07-24');
		expect(Object.prototype.hasOwnProperty.call(plain, 'day')).toBe(false);
	});

	it('a storage round trip restores Date instances', () => {
		const Model = eventModel();
		const memory = new Map();
		const storage = {
			getItem: (key) => memory.get(key) ?? null,
			setItem: (key, value) => memory.set(key, value),
		};
		const store = new Store({ event: Model }, { storage });
		store.createRecord('event', {
			id: 'e1',
			title: 'launch',
			startsAt: new Date('2026-08-16T10:00:00.000Z'),
			day: new Date(2026, 6, 24),
		});
		store.flush();

		const restored = new Store({ event: Model }, { storage });
		const record = restored.findOne('event', 'e1');
		expect(record.startsAt).toBeInstanceOf(Date);
		expect(record.startsAt.toISOString()).toBe('2026-08-16T10:00:00.000Z');
		expect(record.day).toBeInstanceOf(Date);
		expect(record.validate().valid).toBe(true);
	});
});

// ---- Bug C: reserved keys in an update() patch -------------------------------

describe('update() with reserved keys in the patch', () => {
	const todoModel = () =>
		class Todo extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				title: Puzzle.string(),
				done: Puzzle.boolean(),
			};
		};

	it('applies every legitimate key, skips the reserved ones, and notifies once', () => {
		const Model = todoModel();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = new Store({ todo: Model });
		const record = store.createRecord('todo', { id: 't1', title: 'a', done: false });
		const changed = vi.spyOn(store, 'recordChanged');

		expect(() =>
			record.update({ title: 'b', _type: 'hacked', done: true, _store: null })
		).not.toThrow();

		// Both sides of the reserved key landed — no mid-loop abort.
		expect(record.title).toBe('b');
		expect(record.done).toBe(true);
		expect(record._type).toBe('todo');
		expect(record._store).toBe(store);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(store.findOne('todo', 't1')).toBe(record);
		expect(warn.mock.calls.map(([m]) => m)).toContainEqual(
			expect.stringMatching(/"_type" is a reserved record field on model "Todo"/)
		);
	});

	it('_synced and _deleted cannot be forged through a patch', () => {
		const Model = todoModel();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = new Store({ todo: Model });
		const record = store.createRecord('todo', { id: 't1', title: 'a' });

		record.update({ _synced: true, _deleted: true, title: 'b' });
		expect(record._synced).toBe(false);
		expect(record._deleted).toBe(false);
		expect(record.title).toBe('b');
	});

	it('primary-key immutability is unchanged', () => {
		const Model = todoModel();
		const store = new Store({ todo: Model });
		const record = store.createRecord('todo', { id: 't1', title: 'a' });

		expect(() => record.update({ id: 't2' })).toThrow(/primary keys are immutable/);
		expect(() => record.update({ id: 't1', title: 'b' })).not.toThrow();
		expect(record.title).toBe('b');
		expect(() => record.update({ title: 42 })).not.toThrow();
	});

	it('validation still runs before any assignment', () => {
		class Strict extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				title: Puzzle.string().required(),
				count: Puzzle.number().max(3),
			};
		}
		const record = new Strict({ id: 's1', title: 'a', count: 1 });
		expect(() => record.update({ count: 9, title: 'b' })).toThrow(PuzzleValidationError);
		expect(record.count).toBe(1);
		expect(record.title).toBe('a');
	});

	it('D125: a skipped reserved key is not revision-stamped, and real edits still win over a stale response', async () => {
		class Doc extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				title: Puzzle.string(),
				note: Puzzle.string(),
			};
			static adapter = { endpoint: '/docs' };
		}
		let record;
		const fetch = vi.fn(async () => {
			// Edited while the request is in flight — after its revision boundary was
			// captured. A patch carrying a reserved key must still stamp the fields
			// that landed, or the response would clobber the local edit.
			record.update({ title: 'typed-during-flight', _type: 'nope' });
			return response({ id: 'd1', title: 'server', note: 'server-note' });
		});
		vi.stubGlobal('fetch', fetch);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const store = new Store({ doc: Doc }, { apiURL: 'https://example.test' });
		record = store.createRecord('doc', { id: 'd1', title: 'local', note: 'local-note' });
		await record.save();

		expect(record.title).toBe('typed-during-flight'); // local edit preserved (D125)
		expect(record.note).toBe('server-note'); // untouched field merges
		expect(record._type).toBe('doc');
	});
});

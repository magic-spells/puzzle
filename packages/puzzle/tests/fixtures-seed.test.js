import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle, PuzzleValidationError } from '../client-runtime/model.js';
import { installFixtures } from '../client-runtime/fixtures/index.js';

// Schema-driven fixtures (v1.57, D95): `store.seed()` generates believable
// records straight from the declared schema — no second declaration, no faker.
// Generation is deterministic (a seeded mulberry32 the /fixtures module keeps per
// Store, D98), and every record goes through the NORMAL createRecord path, so
// defaults (D48), validation (§20) and pk assignment behave exactly as in
// production.
//
// `seed()` is ATTACHED by installFixtures() — the core Store does not have it —
// so every test here installs the module first and detaches afterwards.

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
		body: Puzzle.string(),
		email: Puzzle.string(),
		website: Puzzle.string(),
		priority: Puzzle.number().min(1).max(5),
		score: Puzzle.number(),
		done: Puzzle.boolean(),
		status: Puzzle.string().oneOf(['open', 'blocked', 'done']),
		createdAt: Puzzle.date(),
		tags: Puzzle.array(),
		meta: Puzzle.object(),
	};
}

// An AUTHOR-supplied primary key (`.primary().required()`) — the one pk shape
// fixtures must generate, because createRecord rejects it when blank.
class Page extends PuzzleModel {
	static schema = {
		slug: Puzzle.string().primary().required(),
		title: Puzzle.string().required(),
	};
}

class User extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), name: Puzzle.string().required() };
}

class Comment extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		author: Puzzle.belongsTo('user'),
	};
}

class Reply extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		writer: Puzzle.belongsTo('user', { key: 'ownerId' }),
	};
}

const MODELS = { todo: Todo, page: Page, user: User, comment: Comment, reply: Reply };
const newStore = (options) => new Store(MODELS, options);

/** Fixture data minus the auto-generated pk (see the determinism note below). */
const withoutId = (record) => {
	const { id, ...rest } = record.toJSON();
	return rest;
};

let uninstall;

beforeEach(() => {
	uninstall = installFixtures();
});

afterEach(() => {
	uninstall();
	vi.restoreAllMocks();
});

describe('seed() — the three call shapes', () => {
	it('a count generates that many records, inserted and returned', () => {
		const store = newStore();
		const records = store.seed('todo', 5);

		expect(records).toHaveLength(5);
		expect(store.findMany('todo')).toHaveLength(5);
		for (const record of records) {
			expect(record).toBeInstanceOf(Todo);
			expect(store.findOne('todo', record.id)).toBe(record);
		}
	});

	it('defaults to one record', () => {
		expect(newStore().seed('todo')).toHaveLength(1);
	});

	it('a count of 0 creates nothing', () => {
		const store = newStore();
		expect(store.seed('todo', 0)).toEqual([]);
		expect(store.findMany('todo')).toEqual([]);
	});

	it('overrides are fixed on every record; the rest is generated', () => {
		const records = newStore().seed('todo', 4, { done: false, title: 'Fixed' });

		for (const record of records) {
			expect(record.done).toBe(false);
			expect(record.title).toBe('Fixed');
			expect(typeof record.body).toBe('string');
		}
		// The generated fields still vary — overrides pin fields, not the record.
		expect(new Set(records.map((r) => r.body)).size).toBeGreaterThan(1);
	});

	it('explicit shapes fill their gaps from the schema', () => {
		const records = newStore().seed('todo', [{ title: 'a' }, { title: 'b', priority: 5 }]);

		expect(records.map((r) => r.title)).toEqual(['a', 'b']);
		expect(records[1].priority).toBe(5);
		expect(typeof records[0].priority).toBe('number');
		expect(typeof records[0].status).toBe('string');
	});

	it('an explicit shape wins over a blanket override', () => {
		const records = newStore().seed('todo', [{ title: 'shape' }], { title: 'blanket' });
		expect(records[0].title).toBe('shape');
	});

	it('rejects a count that is not a non-negative integer', () => {
		const store = newStore();
		expect(() => store.seed('todo', -1)).toThrow(/record count or an array/);
		expect(() => store.seed('todo', 2.5)).toThrow(/record count or an array/);
		expect(() => store.seed('todo', 'five')).toThrow(/record count or an array/);
	});
});

describe('seed() — determinism', () => {
	// The auto-generated primary key is the ONE non-deterministic field: fixtures
	// deliberately leave it to the Store's existing _genId (Math.random + Date.now),
	// per D95 "let the existing pk machinery assign them". Everything else is
	// byte-identical, and a test that needs stable ids passes them explicitly.
	it('two identically constructed stores generate identical records', () => {
		const a = newStore().seed('todo', 6).map(withoutId);
		const b = newStore().seed('todo', 6).map(withoutId);
		expect(a).toEqual(b);
	});

	it('an author-supplied primary key IS deterministic, ids included', () => {
		const a = newStore().seed('page', 3).map((r) => r.toJSON());
		const b = newStore().seed('page', 3).map((r) => r.toJSON());
		expect(a).toEqual(b);
		expect(a.map((r) => r.slug)).toEqual(['page-1', 'page-2', 'page-3']);
	});

	it('a different installFixtures seed generates different data', () => {
		installFixtures({ seed: 1 });
		const a = newStore().seed('todo', 4).map(withoutId);
		installFixtures({ seed: 2 });
		const b = newStore().seed('todo', 4).map(withoutId);
		expect(a).not.toEqual(b);

		// …and the same explicit seed reproduces it exactly.
		installFixtures({ seed: 1 });
		const c = newStore().seed('todo', 4).map(withoutId);
		expect(c).toEqual(a);
	});

	it('resetFixtureSeed() replays the sequence', () => {
		const store = newStore();
		const first = store.seed('page', 3).map((r) => r.toJSON());
		for (const record of store.findMany('page')) record.destroy();

		store.resetFixtureSeed();
		const replayed = store.seed('page', 3).map((r) => r.toJSON());
		expect(replayed).toEqual(first);
	});

	it('resetFixtureSeed(seed) switches to another fixed seed', () => {
		const store = newStore();
		store.resetFixtureSeed(99);
		const a = store.seed('todo', 3).map(withoutId);

		// A store created under an install seeded the same way generates the same data.
		installFixtures({ seed: 99 });
		const other = newStore();
		expect(other.seed('todo', 3).map(withoutId)).toEqual(a);
	});

	it('successive seed() calls keep generating fresh records, not repeats', () => {
		const store = newStore();
		const first = store.seed('page', 2);
		const second = store.seed('page', 2);
		expect(second.map((r) => r.slug)).toEqual(['page-3', 'page-4']);
		expect(new Set([...first, ...second].map((r) => r.title)).size).toBeGreaterThan(1);
	});

	it('never touches Math.random() or Date.now()', () => {
		// The Store's pk generator is the only legitimate user of either, so this
		// runs against the author-supplied-pk model where _genId is never called.
		const store = newStore();
		vi.spyOn(Math, 'random').mockImplementation(() => {
			throw new Error('fixtures must not use Math.random()');
		});
		vi.spyOn(Date, 'now').mockImplementation(() => {
			throw new Error('fixtures must not use Date.now()');
		});

		expect(() => store.seed('page', 5)).not.toThrow();
	});
});

describe('seed() — field generation honors the schema', () => {
	it('generates a usable value for every declared type', () => {
		const [record] = newStore().seed('todo', 1);

		expect(typeof record.title).toBe('string');
		expect(record.title.length).toBeGreaterThan(0);
		expect(typeof record.score).toBe('number');
		expect(typeof record.done).toBe('boolean');
		expect(record.createdAt).toBeInstanceOf(Date);
		expect(record.tags).toEqual([]);
		expect(record.meta).toEqual({});
	});

	it('.oneOf() is never violated', () => {
		const records = newStore().seed('todo', 60);
		const allowed = new Set(['open', 'blocked', 'done']);
		for (const record of records) expect(allowed.has(record.status)).toBe(true);
		// …and it actually varies rather than pinning the first option.
		expect(new Set(records.map((r) => r.status)).size).toBeGreaterThan(1);
	});

	it('.min()/.max() bound numbers', () => {
		for (const record of newStore().seed('todo', 60)) {
			expect(record.priority).toBeGreaterThanOrEqual(1);
			expect(record.priority).toBeLessThanOrEqual(5);
		}
	});

	it('.min()/.max() bound string LENGTH (§20 measures strings by length)', () => {
		class Coded extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), code: Puzzle.string().min(12).max(16) };
		}
		for (const record of new Store({ coded: Coded }).seed('coded', 40)) {
			expect(record.code.length).toBeGreaterThanOrEqual(12);
			expect(record.code.length).toBeLessThanOrEqual(16);
		}
	});

	it('dates are epoch-derived, not clock-derived', () => {
		// Fixed 30-day window before the fixture epoch (2026-01-01Z) — a clock-based
		// value would drift with the machine's date.
		const epoch = Date.UTC(2026, 0, 1);
		for (const record of newStore().seed('todo', 30)) {
			expect(record.createdAt.getTime()).toBeGreaterThanOrEqual(epoch - 30 * 86400000);
			expect(record.createdAt.getTime()).toBeLessThanOrEqual(epoch);
		}
	});

	it('field names shape the value where it is cheap', () => {
		const [record] = newStore().seed('todo', 1);
		expect(record.email).toMatch(/^[a-z]+\.\d+@example\.com$/);
		expect(record.website).toMatch(/^https:\/\/example\.com\//);
		expect(record.title).toMatch(/^[A-Z]/); // title-cased words
		expect(record.body).toMatch(/\.$/); // a sentence
	});

	it('emails stay distinct across a batch', () => {
		const emails = newStore().seed('todo', 8).map((r) => r.email);
		expect(new Set(emails).size).toBe(8);
	});

	it('every generated record passes Model.validate()', () => {
		for (const record of newStore().seed('todo', 40)) {
			expect(record.validate()).toEqual({ valid: true, errors: [] });
		}
		for (const record of newStore().seed('page', 10)) {
			expect(Page.validate(record.toJSON())).toEqual({ valid: true, errors: [] });
		}
	});
});

describe('seed() — defaults and primary keys', () => {
	it('.default() wins over generation, including a function default', () => {
		const calls = [];
		class Defaulted extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				status: Puzzle.string().default('open'),
				count: Puzzle.number().default(0),
				tags: Puzzle.array().default([]),
				stamp: Puzzle.date().default(() => {
					calls.push(1);
					return new Date(0);
				}),
			};
		}
		const records = new Store({ defaulted: Defaulted }).seed('defaulted', 3);

		for (const record of records) {
			expect(record.status).toBe('open');
			expect(record.count).toBe(0);
			expect(record.stamp.getTime()).toBe(0);
		}
		expect(calls).toHaveLength(3); // resolved per record by applyDefaults
		// Object/array defaults are deep-cloned per record (never shared).
		records[0].tags.push('x');
		expect(records[1].tags).toEqual([]);
	});

	it('an auto-generated pk is left to the Store, not invented here', () => {
		const ids = newStore().seed('todo', 5).map((r) => r.id);
		expect(new Set(ids).size).toBe(5);
		for (const id of ids) expect(typeof id).toBe('string');
	});

	it('an override can pin the pk', () => {
		const [record] = newStore().seed('todo', [{ id: 't-1' }]);
		expect(record.id).toBe('t-1');
	});

	it('a numeric author-supplied pk counts up', () => {
		class Ticket extends PuzzleModel {
			static schema = {
				number: Puzzle.number().primary().required(),
				title: Puzzle.string().required(),
			};
		}
		const records = new Store({ ticket: Ticket }).seed('ticket', 3);
		expect(records.map((r) => r.number)).toEqual([1, 2, 3]);
	});

	it('seeded records are LOCAL — unsynced, exactly like a hand-typed create', () => {
		const [record] = newStore().seed('todo', 1);
		expect(record._synced).toBe(false);
	});

	it('a generated value that violates a custom validator still throws (no silent pass)', () => {
		class Strict extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				token: Puzzle.string().validate((v) => v === 'only-this', 'bad token'),
			};
		}
		const store = new Store({ strict: Strict });
		// A custom predicate is opaque to generation — the documented fix is an
		// override, and the failure is the normal D48 throw, not a quiet bad record.
		expect(() => store.seed('strict', 1)).toThrow(PuzzleValidationError);
		expect(store.seed('strict', 1, { token: 'only-this' })).toHaveLength(1);
	});
});

describe('seed() — belongsTo wiring (D49)', () => {
	it('wires the FK to a real existing parent so the relationship resolves', () => {
		const store = newStore();
		const users = store.seed('user', 3);
		const comments = store.seed('comment', 6);

		// FK by convention is `<relationshipName>Id` — `author` → `authorId` (D49).
		const userIds = new Set(users.map((u) => u.id));
		for (const comment of comments) {
			expect(userIds.has(comment.authorId)).toBe(true);
			expect(comment.author).toBe(store.findOne('user', comment.authorId));
		}
	});

	it('leaves the FK unset when the target type has no records', () => {
		const store = newStore();
		const [comment] = store.seed('comment', 1);

		expect(comment.authorId).toBeUndefined();
		expect(comment.author).toBeNull();
		// …and it did NOT recursively invent a parent.
		expect(store.findMany('user')).toEqual([]);
	});

	it('honors a { key } foreign-key override', () => {
		const store = newStore();
		store.seed('user', 2);
		const [reply] = store.seed('reply', 1);

		expect(reply.writerId).toBeUndefined();
		expect(typeof reply.ownerId).toBe('string');
		expect(reply.writer).toBe(store.findOne('user', reply.ownerId));
	});

	it('an override pins the FK', () => {
		const store = newStore();
		const [user] = store.seed('user', 1);
		const [comment] = store.seed('comment', [{ authorId: user.id }]);
		expect(comment.authorId).toBe(user.id);
	});

	it('wiring does not subscribe the caller to the parent collection', () => {
		// seed() reads recordsByType directly, so seeding inside a tracked data()
		// cannot silently subscribe the component to every parent type.
		const store = newStore();
		store.seed('user', 2);
		const subscriber = { onStoreChange: () => {} };
		store.withTracking(subscriber, () => store.seed('comment', 2));
		expect(store.keysBySubscriber.get(subscriber) ?? new Set()).toEqual(new Set());
	});
});

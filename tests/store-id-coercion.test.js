import { describe, it, expect, vi, afterEach } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

// D112: the record Map was the only type-sensitive identity in the datastore —
// subscription keys (`type + ' ' + id`) and adapter URLs already string-coerce, so
// a string route param missed the record a numeric-id JSON payload created while
// the subscription still fired. The Map KEY normalizes; record fields never do.

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
	};
}

const makeStore = (options) => new Store({ post: Post }, options);

// Fresh relationship classes per suite: getter install mutates the prototype, so
// sharing them across suites would bleed (mirrors tests/relationships.test.js).
function makeRelClasses() {
	class User extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			name: Puzzle.string().required(),
			articles: Puzzle.hasMany('article'), // infers userId from the owner type
		};
	}
	class Article extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			title: Puzzle.string().required(),
			userId: Puzzle.string(),
			authorId: Puzzle.string(),
			author: Puzzle.belongsTo('user'), // infers authorId
		};
	}
	return { User, Article };
}

const relStore = () => {
	const { User, Article } = makeRelClasses();
	return new Store({ user: User, article: Article });
};

// A Response-shaped mock (same idiom as tests/adapter-write.test.js): readBody()
// reads via res.text(), so text is the source of truth.
const makeRes = ({ ok = true, status = 200, statusText = 'OK', body = '' } = {}) => ({
	ok,
	status,
	statusText,
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

const roundTripStorage = () => {
	const data = new Map();
	return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Store — id key normalization (D112)', () => {
	it('findOne resolves a numeric-id record by either type, and the field keeps its number', () => {
		const store = makeStore();
		const post = store.upsert('post', { id: 1, title: 'server-sourced' });

		expect(store.findOne('post', 1)).toBe(post);
		expect(store.findOne('post', '1')).toBe(post); // the route-param spelling
		expect(post.id).toBe(1); // field untouched — still exactly the server's number
	});

	it('findOne resolves a string-id record by a numeric id, and the field keeps its string', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: '7', title: 'locally created' });

		expect(store.findOne('post', '7')).toBe(post);
		expect(store.findOne('post', 7)).toBe(post);
		expect(post.id).toBe('7');
	});

	it('the subscription key and the Map key agree — a notified subscriber can now read the record', () => {
		const store = makeStore();
		const subscriber = vi.fn();

		// A component's data() asking for the route param '1' before anything loaded.
		const initial = store.withTracking(subscriber, () => store.findOne('post', '1'));
		expect(initial).toBeNull();

		store.upsert('post', { id: 1, title: 'arrived' }); // numeric pk from JSON
		store.flush();

		// The notify always fired (concat already string-coerced); before D112 the
		// follow-up lookup still missed.
		expect(subscriber).toHaveBeenCalledTimes(1);
		expect(store.findOne('post', '1')?.title).toBe('arrived');
	});

	it('findOne is still exact — a differently-spelled id does not match, and null is safe', () => {
		const store = makeStore();
		store.upsert('post', { id: 1, title: 'x' });

		expect(store.findOne('post', '01')).toBeNull();
		expect(store.findOne('post', null)).toBeNull();
	});
});

describe('Store — id key normalization across relationships (D112)', () => {
	it('hasMany resolves a numeric owner pk against string FKs', () => {
		const store = relStore();
		const user = store.upsert('user', { id: 1, name: 'Ada' });
		store.createRecord('article', { id: 'a1', title: 'one', userId: '1' });
		store.createRecord('article', { id: 'a2', title: 'two', userId: '1' });
		store.createRecord('article', { id: 'a3', title: 'other', userId: '2' });

		expect(user.articles.map((a) => a.id)).toEqual(['a1', 'a2']);
	});

	it('hasMany resolves a string owner pk against numeric FKs', () => {
		const store = relStore();
		const user = store.createRecord('user', { id: '1', name: 'Ada' });
		store.upsert('article', { id: 'a1', title: 'one', userId: 1 });
		store.upsert('article', { id: 'a2', title: 'other', userId: 2 });

		expect(user.articles.map((a) => a.id)).toEqual(['a1']);
	});

	it('belongsTo resolves a string FK against a numeric author pk', () => {
		const store = relStore();
		const author = store.upsert('user', { id: 1, name: 'Ada' });
		const article = store.createRecord('article', { id: 'a1', title: 'one', authorId: '1' });

		expect(article.author).toBe(author);
	});

	it('belongsTo still short-circuits a null FK instead of resolving a "null" record', () => {
		const store = relStore();
		store.createRecord('user', { id: 'null', name: 'trap' });
		const article = store.createRecord('article', { id: 'a1', title: 'one', authorId: null });

		expect(article.author).toBeNull();
	});
});

describe('Store — id key normalization unifies duplicates (D112)', () => {
	it('a string-spelled explicit pk is a duplicate of the numeric-keyed record', () => {
		const store = makeStore();
		store.upsert('post', { id: 1, title: 'first' });

		expect(() => store.createRecord('post', { id: '1', title: 'second' })).toThrow(
			/duplicate primary key "1" for model "post"/
		);
		expect(store.findMany('post')).toHaveLength(1);
	});

	it('a string-spelled upsert updates the numeric-keyed record in place', () => {
		const store = makeStore();
		const original = store.upsert('post', { id: 1, title: 'first' });

		const updated = store.upsert('post', { id: '1', title: 'updated' });

		expect(updated).toBe(original); // same instance, no duplicate row
		expect(store.findMany('post')).toHaveLength(1);
		expect(original.title).toBe('updated');
	});

	it('removeRecord evicts a numeric-keyed record for both id spellings', () => {
		const store = makeStore();
		const post = store.upsert('post', { id: 1, title: 'x' });

		post.destroy();

		expect(store.findOne('post', '1')).toBeNull();
		expect(store.findOne('post', 1)).toBeNull();
		expect(store.findMany('post')).toHaveLength(0);
	});
});

describe('Store — id key normalization on the write path (D112)', () => {
	class ApiPost extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			title: Puzzle.string().required(),
		};
		static adapter = adapter({ endpoint: '/api/posts' });
	}

	it('a numeric pk echo for a string-keyed record is not a pk change', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = new Store({ post: ApiPost }, { apiURL: 'https://x.test/v1' });
		// The D98 seam: intercept the request after _fetch has built it.
		store._network = vi.fn(async () => makeRes({ body: { id: 5, title: 'echoed' } }));

		const post = store.createRecord('post', { id: '5', title: 'local' }); // unsynced → POST
		await post.save();

		expect(
			warn.mock.calls.filter(([msg]) => String(msg).includes('primary keys are immutable'))
		).toHaveLength(0);
		expect(store.findOne('post', '5')).toBe(post);
		expect(store.findOne('post', 5)).toBe(post);
		expect(store.findMany('post')).toHaveLength(1);
		expect(post._synced).toBe(true);
		expect(post.title).toBe('echoed'); // the rest of the body still merged
	});
});

describe('Store — id key normalization survives persistence (D112)', () => {
	it('a hydrated numeric-id record is found by its string id', () => {
		const storage = roundTripStorage();
		const store1 = makeStore({ storage });
		store1.upsert('post', { id: 1, title: 'persisted' });
		store1.flush(); // persistence is batched into flush()

		const store2 = makeStore({ storage });
		const revived = store2.findOne('post', '1');
		expect(revived).not.toBeNull();
		expect(revived.title).toBe('persisted');
		expect(revived.id).toBe(1); // field kept its type through the round trip
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	adapter,
	hydrateReadState,
	PuzzleAdapterError,
	serializeReadState,
} from '../client-runtime/datastore/adapter.js';
import { Store } from '../client-runtime/datastore/store.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

const API = 'https://x.test';

// A tracked evaluation, spelled the way PuzzleView's settle loop spells it: one
// request map per pass, handed to withTracking. Returns { value, requests }.
function trackedPass(store, fn, subscriber = {}) {
	const requests = new Map();
	const value = store.withTracking(subscriber, fn, false, {}, requests);
	return { value, requests };
}

/** Await one pass's requests, then run fn again — the loop's core, by hand. */
async function settle(store, fn, subscriber = {}) {
	let rounds = 0;
	for (;;) {
		const { value, requests } = trackedPass(store, fn, subscriber);
		if (requests.size === 0) return { value, rounds };
		rounds++;
		await Promise.all(requests.values());
	}
}

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: status === 404 ? 'Not Found' : status === 500 ? 'Server Error' : 'OK',
	text: async () => (body === undefined ? '' : JSON.stringify(body)),
	json: async () => body,
});

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
		authorId: Puzzle.string(),
	};
	static adapter = { endpoint: '/api/posts' };
}

class User extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		name: Puzzle.string().required(),
	};
	static adapter = { endpoint: '/api/users' };
}

/** A model with no server surface at all — the fixture-app shape. */
class Note extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		body: Puzzle.string(),
	};
}

const makeStore = (models = { post: Post, user: User, note: Note }) =>
	new Store(models, { apiURL: API, adapter: { d: undefined } });

let fetchMock;

beforeEach(() => {
	fetchMock = vi.fn(async () => json([]));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('D161 — tracked queries fault, untracked ones never do', () => {
	it('an untracked findOne/findMany is a pure local snapshot', async () => {
		const store = makeStore();
		expect(store.findOne('post', 'p1')).toBeNull();
		expect(store.findMany('post')).toEqual([]);
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('a tracked hit returns synchronously and queues nothing', () => {
		const store = makeStore();
		store.createRecord('post', { id: 'p1', title: 'local' });
		// The collection is not complete, so findMany still owes a load; findOne of a
		// present record owes nothing.
		const { value, requests } = trackedPass(store, () => store.findOne('post', 'p1'));
		expect(value.title).toBe('local');
		expect(requests.size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('a tracked miss returns null, queues one request, and settles to the record', async () => {
		fetchMock.mockImplementation(async () => json({ id: 'p1', title: 'from server' }));
		const store = makeStore();

		const first = trackedPass(store, () => store.findOne('post', 'p1'));
		expect(first.value).toBeNull();
		expect([...first.requests.keys()]).toEqual(['post p1']);
		await Promise.all(first.requests.values());

		const second = trackedPass(store, () => store.findOne('post', 'p1'));
		expect(second.requests.size).toBe(0);
		expect(second.value.title).toBe('from server');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(`${API}/api/posts/p1`);
	});

	it('a nullish id returns null without building a request', async () => {
		const store = makeStore();
		const { value, requests } = trackedPass(store, () => [
			store.findOne('post', null),
			store.findOne('post', undefined),
		]);
		expect(value).toEqual([null, null]);
		expect(requests.size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('a model with no resolvable read verb stays local for that query shape', async () => {
		class WriteOnly extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
			static adapter = { create: async () => ({ id: 'x' }) };
		}
		const store = makeStore({ note: Note, writeOnly: WriteOnly });
		const { requests } = trackedPass(store, () => [
			store.findOne('note', 'n1'),
			store.findMany('note'),
			store.findOne('writeOnly', 'w1'),
			store.findMany('writeOnly'),
		]);
		expect(requests.size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('faults through a custom model verb with no endpoint — but an app-wide default alone never does', async () => {
		const modelLoad = vi.fn(async () => [{ id: 'a1', title: 'model' }]);
		class Article extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
			static adapter = { loadMany: modelLoad };
		}
		const defaultLoad = vi.fn(async () => [{ id: 'b1', title: 'app default' }]);
		const store = new Store(
			{ article: Article, bare: class Bare extends PuzzleModel {} },
			{ apiURL: API, adapter: { d: { loadMany: defaultLoad } } }
		);

		await settle(store, () => [store.findMany('article'), store.findMany('bare')]);

		expect(modelLoad).toHaveBeenCalledTimes(1);
		// `bare` declares no adapter of its own. An app-wide dialect says HOW this
		// app talks to its server, not WHICH models are server-backed, so a tracked
		// find on it stays pure-local — "No adapter, no read verb ⇒ nothing changes"
		// (SKILL.md), and there is no `endpoint` for the dialect to address anyway.
		expect(defaultLoad).not.toHaveBeenCalled();
		expect(store.findOne('article', 'a1').title).toBe('model');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('numeric and string ids share one request; one pass asking twice asks once', async () => {
		fetchMock.mockImplementation(async () => json({ id: 7, title: 'seven' }));
		class NumPost extends PuzzleModel {
			static schema = { id: Puzzle.number().primary(), title: Puzzle.string() };
			static adapter = { endpoint: '/api/posts' };
		}
		const store = makeStore({ post: NumPost });

		const { requests } = trackedPass(store, () => [
			store.findOne('post', 7),
			store.findOne('post', '7'),
			store.findOne('post', 7),
		]);
		expect(requests.size).toBe(1);
		await Promise.all(requests.values());
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('two concurrent views share one in-flight request but keep separate pending maps', async () => {
		let release;
		fetchMock.mockImplementation(
			() => new Promise((resolve) => (release = () => resolve(json({ id: 'p1', title: 'x' }))))
		);
		const store = makeStore();

		const a = trackedPass(store, () => store.findOne('post', 'p1'), { id: 'a' });
		const b = trackedPass(store, () => store.findOne('post', 'p1'), { id: 'b' });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(a.requests).not.toBe(b.requests);
		expect(a.requests.get('post p1')).toBe(b.requests.get('post p1'));
		release();
		await Promise.all([...a.requests.values(), ...b.requests.values()]);
	});

	it('a request map never leaks past its evaluation', () => {
		const store = makeStore();
		trackedPass(store, () => store.findOne('post', 'p1'));
		expect(store._requests).toBeNull();
		store.findOne('post', 'p2'); // untracked, after a tracked run
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('D161 — negative cache', () => {
	it('a normalized 404 becomes absence: the batch resolves and no second request goes out', async () => {
		fetchMock.mockImplementation(async () => json({ error: 'gone' }, 404));
		const store = makeStore();

		const { value, rounds } = await settle(store, () => store.findOne('post', 'ghost'));
		expect(value).toBeNull();
		expect(rounds).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const again = trackedPass(store, () => store.findOne('post', 'ghost'));
		expect(again.requests.size).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a 500 rejects the run, poisons nothing, and stays retryable', async () => {
		fetchMock.mockImplementation(async () => json({ error: 'boom' }, 500));
		const store = makeStore();

		const first = trackedPass(store, () => store.findOne('post', 'p1'));
		const error = await Promise.all(first.requests.values()).catch((err) => err);
		expect(error).toBeInstanceOf(PuzzleAdapterError);
		expect(error.status).toBe(500);

		fetchMock.mockImplementation(async () => json({ id: 'p1', title: 'ok now' }));
		const { value } = await settle(store, () => store.findOne('post', 'p1'));
		expect(value.title).toBe('ok now');
	});

	it('an author-thrown object carrying status 404 is not absence', async () => {
		class Odd extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
			static adapter = {
				loadOne: async () => {
					throw Object.assign(new Error('nope'), { status: 404 });
				},
			};
		}
		const store = makeStore({ odd: Odd });
		const { requests } = trackedPass(store, () => store.findOne('odd', 'o1'));
		await expect(Promise.all(requests.values())).rejects.toThrow('nope');

		// Not recorded as absent: the next tracked pass tries again.
		const again = trackedPass(store, () => store.findOne('odd', 'o1'));
		expect(again.requests.size).toBe(1);
		await Promise.all(again.requests.values()).catch(() => {});
	});

	it('createRecord, upsert and hydration each clear a recorded absence', async () => {
		fetchMock.mockImplementation(async () => json({}, 404));
		const store = makeStore();
		await settle(store, () => [
			store.findOne('post', 'p1'),
			store.findOne('post', 'p2'),
			store.findOne('post', 'p3'),
		]);
		expect(serializeReadState(store).absent).toEqual(['post p1', 'post p2', 'post p3']);

		store.createRecord('post', { id: 'p1', title: 'created' });
		store.upsert('post', { id: 'p2', title: 'upserted' });
		store._hydrateAll({ post: [{ id: 'p3', title: 'hydrated' }] });

		expect(serializeReadState(store).absent).toEqual([]);
	});

	it('a confirmed delete() records absence; a local destroy() does not', async () => {
		fetchMock.mockImplementation(async () => json(undefined, 204));
		const store = makeStore();
		const kept = store.upsert('post', { id: 'p1', title: 'a' });
		const dropped = store.upsert('post', { id: 'p2', title: 'b' });

		await kept.delete();
		dropped.destroy();

		expect(serializeReadState(store).absent).toEqual(['post p1']);
	});

	it('an explicit loadOne bypasses the negative cache and its outcome refreshes the entry', async () => {
		fetchMock.mockImplementation(async () => json({}, 404));
		const store = makeStore();
		await settle(store, () => store.findOne('post', 'p1'));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await expect(store.loadOne('post', 'p1')).rejects.toBeInstanceOf(PuzzleAdapterError);
		expect(fetchMock).toHaveBeenCalledTimes(2); // the cache did not suppress it

		fetchMock.mockImplementation(async () => json({ id: 'p1', title: 'back' }));
		await store.loadOne('post', 'p1');
		expect(serializeReadState(store).absent).toEqual([]);
	});

	it('evicts the oldest entry past 1000 so a later query can refetch', async () => {
		fetchMock.mockImplementation(async () => json({}, 404));
		const store = makeStore();
		for (let i = 0; i < 1001; i++) {
			// eslint-disable-next-line no-await-in-loop
			await settle(store, () => store.findOne('post', `p${i}`));
		}
		const absent = serializeReadState(store).absent;
		expect(absent).toHaveLength(1000);
		expect(absent).not.toContain('post p0');

		const calls = fetchMock.mock.calls.length;
		trackedPass(store, () => store.findOne('post', 'p0'));
		expect(fetchMock.mock.calls.length).toBe(calls + 1);
	});
});

describe('D161 — loadOne identity guard', () => {
	it('rejects a response for a different record before it mutates the store', async () => {
		fetchMock.mockImplementation(async () => json({ id: 'other', title: 'wrong record' }));
		const store = makeStore();

		await expect(store.loadOne('post', 'p1')).rejects.toThrow(
			/returned a record with primary key "other"/
		);
		expect(store.findOne('post', 'other')).toBeNull();
		expect(store.findOne('post', 'p1')).toBeNull();
	});

	it('accepts a numeric response id for a string request (recordKey normalization)', async () => {
		class NumPost extends PuzzleModel {
			static schema = { id: Puzzle.number().primary(), title: Puzzle.string() };
			static adapter = { endpoint: '/api/posts' };
		}
		fetchMock.mockImplementation(async () => json({ id: 7, title: 'seven' }));
		const store = makeStore({ post: NumPost });
		await expect(store.loadOne('post', '7')).resolves.toMatchObject({ title: 'seven' });
	});
});

describe('D161 — collection completeness', () => {
	it('a successful no-options load completes the type, empty response included', async () => {
		const store = makeStore();
		await settle(store, () => store.findMany('post'));
		expect(serializeReadState(store).complete).toEqual(['post']);

		const again = trackedPass(store, () => store.findMany('post'));
		expect(again.requests.size).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('local records, loadOne, createRecord, upsert and hydration do not complete a type', async () => {
		fetchMock.mockImplementation(async () => json({ id: 'p1', title: 'one' }));
		const store = makeStore();
		store.createRecord('post', { id: 'local', title: 'l' });
		store.upsert('post', { id: 'p9', title: 'u' });
		store._hydrateAll({ post: [{ id: 'p8', title: 'h' }] });
		await store.loadOne('post', 'p1');

		expect(serializeReadState(store).complete).toEqual([]);
		const { requests } = trackedPass(store, () => store.findMany('post'));
		expect(requests.size).toBe(1);
		await Promise.all(requests.values()).catch(() => {});
	});

	it('an options-bearing loadMany stays partial — {} included', async () => {
		const store = makeStore();
		await store.loadMany('post', { page: 2 });
		await store.loadMany('post', {});
		expect(serializeReadState(store).complete).toEqual([]);

		await store.loadMany('post');
		expect(serializeReadState(store).complete).toEqual(['post']);
	});

	it('a failed collection load clears the in-flight entry without completing the type', async () => {
		fetchMock.mockImplementation(async () => json({ error: 'x' }, 500));
		const store = makeStore();
		const first = trackedPass(store, () => store.findMany('post'));
		await Promise.all(first.requests.values()).catch(() => {});
		expect(serializeReadState(store).complete).toEqual([]);

		fetchMock.mockImplementation(async () => json([{ id: 'p1', title: 'retry' }]));
		const { value } = await settle(store, () => store.findMany('post'));
		expect(value.map((post) => post.id)).toEqual(['p1']);
	});

	it('a complete collection answers a tracked findOne miss locally, with no request', async () => {
		fetchMock.mockImplementation(async () => json([{ id: 'p1', title: 'a' }]));
		const store = makeStore();
		await store.loadMany('post');
		expect(serializeReadState(store).complete).toEqual(['post']);
		fetchMock.mockClear();

		// The stale-link case: an id the complete load did not return. The collection
		// already proved it absent, so this must never become a detail GET.
		const { value, requests } = trackedPass(store, () => store.findOne('post', 'missing-id'));
		expect(value).toBeNull();
		expect(requests.size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('an options-bearing loadMany leaves a tracked findOne still faulting', async () => {
		fetchMock.mockImplementation(async () => json([{ id: 'p1', title: 'a' }]));
		const store = makeStore();
		await store.loadMany('post', { page: 1 });
		expect(serializeReadState(store).complete).toEqual([]);

		fetchMock.mockImplementation(async () => json({ id: 'p2', title: 'faulted' }));
		const { value } = await settle(store, () => store.findOne('post', 'p2'));
		expect(value.title).toBe('faulted');
	});

	it('loadOne stays the force-refresh escape hatch after the type is complete', async () => {
		fetchMock.mockImplementation(async () => json([]));
		const store = makeStore();
		await store.loadMany('post');
		fetchMock.mockClear();

		fetchMock.mockImplementation(async () => json({ id: 'p1', title: 'forced' }));
		await expect(store.loadOne('post', 'p1')).resolves.toMatchObject({ title: 'forced' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(`${API}/api/posts/p1`);
	});

	it('several filtered queries share one collection request and filter locally', async () => {
		fetchMock.mockImplementation(async () =>
			json([
				{ id: 'p1', title: 'a', authorId: 'u1' },
				{ id: 'p2', title: 'b', authorId: 'u2' },
			])
		);
		const store = makeStore();
		const { value } = await settle(store, () => ({
			mine: store.findMany('post', { filter: (post) => post.authorId === 'u1' }),
			yours: store.findMany('post', { filter: (post) => post.authorId === 'u2' }),
		}));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(value.mine.map((post) => post.id)).toEqual(['p1']);
		expect(value.yours.map((post) => post.id)).toEqual(['p2']);
	});
});

describe('D161 — relationships stay local', () => {
	class RelPost extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			authorId: Puzzle.string(),
			author: Puzzle.belongsTo('user'),
		};
		static adapter = { endpoint: '/api/posts' };
	}
	class RelUser extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			name: Puzzle.string(),
			posts: Puzzle.hasMany('post', { key: 'authorId' }),
		};
		static adapter = { endpoint: '/api/users' };
	}

	it('belongsTo and hasMany subscribe without issuing a request, and stay reactive', () => {
		const store = new Store({ post: RelPost, user: RelUser }, { apiURL: API });
		const post = store.upsert('post', { id: 'p1', authorId: 'u1' });
		const subscriber = {};

		const { value, requests } = trackedPass(store, () => post.author, subscriber);
		expect(value).toBeNull();
		expect(requests.size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
		// The subscription key is recorded, so the record landing later notifies.
		expect(store.subscribersByKey.get('user u1')?.has(subscriber)).toBe(true);

		const user = store.upsert('user', { id: 'u1', name: 'Ada' });
		expect(post.author).toBe(user);
		expect(trackedPass(store, () => user.posts).requests.size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('D161 — static / HMR read-state seam', () => {
	it('serializes and re-adopts collection-complete and negative state', async () => {
		fetchMock.mockImplementation(async (url) =>
			String(url).endsWith('/api/posts') ? json([]) : json({}, 404)
		);
		const build = makeStore();
		await settle(build, () => [build.findMany('post'), build.findOne('user', 'ghost')]);
		const envelope = serializeReadState(build);
		expect(envelope).toEqual({ v: 1, complete: ['post'], absent: ['user ghost'] });

		const browser = makeStore();
		hydrateReadState(browser, envelope);
		const { requests } = trackedPass(browser, () => [
			browser.findMany('post'),
			browser.findOne('user', 'ghost'),
		]);
		expect(requests.size).toBe(0);
	});

	it('drops a transferred absence whose record is present', () => {
		const browser = makeStore();
		browser.upsert('user', { id: 'u1', name: 'Ada' });
		hydrateReadState(browser, { v: 1, complete: [], absent: ['user u1'] });
		expect(serializeReadState(browser).absent).toEqual([]);
	});

	it('ignores an envelope from an unknown version', () => {
		const store = makeStore();
		hydrateReadState(store, { v: 99, complete: ['post'], absent: [] });
		expect(serializeReadState(store).complete).toEqual([]);
	});
});

describe('D161 — loadAll migration guards', () => {
	it('store.loadAll() throws and names loadMany', () => {
		const store = makeStore();
		expect(() => store.loadAll('post')).toThrow(/store\.loadAll\(\) no longer exists/);
		expect(() => store.loadAll('post')).toThrow(/renamed 'loadMany'/);
	});

	it('a model declaring an own loadAll key throws at Store init', () => {
		class Legacy extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
			static adapter = { endpoint: '/api/legacy', loadAll: async () => [] };
		}
		expect(() => new Store({ legacy: Legacy })).toThrow(
			/model 'legacy' declares adapter\.loadAll/
		);
	});

	it('adapter.defaults({ loadAll }) throws immediately', () => {
		expect(() => adapter.defaults({ loadAll: async () => [] })).toThrow(
			/adapter\.defaults\(\{ loadAll \}\)/
		);
	});

	it('the verb binding rejects an inherited loadAll before treating it as a custom function', () => {
		class Base extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		const store = makeStore({ base: Base });
		// Assigned after construction, so the init guard cannot have seen it.
		Base.adapter = { endpoint: '/api/base', loadAll: async () => [] };
		expect(() => store.adapter('base')).toThrow(/renamed 'loadMany'/);
	});

	it('warns once when the imperative loaders run inside a tracked evaluation', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = makeStore();
		await store.withTracking({}, async () => {
			await store.loadMany('post').catch(() => {});
			await store.loadMany('post').catch(() => {});
			await store.loadOne('post', 'p1').catch(() => {});
		});

		const messages = warn.mock.calls.map(([message]) => message).filter((m) => /store\./.test(m));
		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatch(/store\.loadMany\(\).*use store\.findMany\(\)/);
		expect(messages[1]).toMatch(/store\.loadOne\(\).*use store\.findOne\(\)/);

		// The internal fault path uses the un-warned loaders.
		warn.mockClear();
		await settle(store, () => store.findMany('user'));
		expect(warn.mock.calls.filter(([m]) => /store\./.test(m))).toHaveLength(0);
	});
});

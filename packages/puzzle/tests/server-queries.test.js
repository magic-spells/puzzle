// @vitest-environment jsdom
//
// D193 server queries: query keys on findMany, store.invalidate(), and the
// write status on save()/delete(). Store-level tests drive a tracked pass by
// hand, the way auto-fetching-finds.test.js does; the view-level tests mount a
// real PuzzleView so the settle loop does the waiting.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	adapter,
	hydrateReadState,
	PuzzleAdapterError,
	serializeReadState,
} from '../client-runtime/datastore/adapter.js';
import { Store } from '../client-runtime/datastore/store.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { installFixtures } from '../client-runtime/fixtures/index.js';

adapter.install();

const API = 'https://x.test';

// a tracked evaluation: one request map per pass, read through the subscriber's handle
function trackedPass(store, fn, subscriber = {}) {
	const requests = new Map();
	const handle = store._handleFor(subscriber) ?? store;
	const value = store.withTracking(subscriber, () => fn(handle), false, {}, requests);
	return { value, requests };
}

// await one pass's requests, then run again, until a pass queues nothing
async function settle(store, fn, subscriber = {}) {
	let rounds = 0;
	for (;;) {
		const { value, requests } = trackedPass(store, fn, subscriber);
		if (requests.size === 0) return { value, rounds };
		rounds++;
		await Promise.all(requests.values());
	}
}

// a Response-shaped object, the shape every adapter test uses
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
		published: Puzzle.boolean().default(false),
	};
	static adapter = { endpoint: '/api/posts' };
}

const makeStore = (models = { post: Post }) => new Store(models, { apiURL: API, adapter });

// a tiny paginated api over an ordered post list: ?page=n (2 per page) answers
// { records, meta }, a bare collection GET answers the array, /:id one post
function servePosts(posts) {
	const calls = [];
	const fetchMock = vi.fn(async (url, init = {}) => {
		const u = new URL(String(url));
		calls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`);
		const id = u.pathname.split('/')[3];
		if (init.method === 'PUT') {
			const body = JSON.parse(init.body);
			const i = posts.findIndex((p) => p.id === id);
			posts[i] = { ...posts[i], ...body };
			return json(posts[i]);
		}
		if (id) {
			const post = posts.find((p) => p.id === id);
			return post ? json(post) : json({ error: 'missing' }, 404);
		}
		const page = u.searchParams.get('page');
		if (page === null) return json(posts);
		const start = (Number(page) - 1) * 2;
		const records = posts.slice(start, start + 2);
		return json({ records, meta: { page: Number(page), nextPage: start + 2 < posts.length ? Number(page) + 1 : null } });
	});
	vi.stubGlobal('fetch', fetchMock);
	return { calls, fetchMock };
}

const fivePosts = () => [
	{ id: 'p1', title: 'One' },
	{ id: 'p2', title: 'Two' },
	{ id: 'p3', title: 'Three' },
	{ id: 'p4', title: 'Four' },
	{ id: 'p5', title: 'Five' },
];

beforeEach(() => {
	document.body.innerHTML = '';
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('D193 query keys', () => {
	it('a tracked query read fetches once, passing the query to loadMany as its options', async () => {
		const { calls } = servePosts(fivePosts());
		const store = makeStore();
		const read = (s) => s.findMany('post', { query: { page: 2 } });

		const { value, rounds } = await settle(store, read);

		expect(rounds).toBe(1);
		expect(calls).toEqual(['GET /api/posts?page=2']);
		expect(value.map((p) => p.id)).toEqual(['p3', 'p4']);
		expect(value.meta).toEqual({ page: 2, nextPage: 3 });
	});

	it('keeps each page as its own entry, in the server order, sharing records with findOne', async () => {
		servePosts(fivePosts());
		const store = makeStore();
		await settle(store, (s) => s.findMany('post', { query: { page: 1 } }));
		await settle(store, (s) => s.findMany('post', { query: { page: 2 } }));

		const page1 = store.findMany('post', { query: { page: 1 } });
		const page2 = store.findMany('post', { query: { page: 2 } });
		expect(page1.map((p) => p.id)).toEqual(['p1', 'p2']);
		expect(page2.map((p) => p.id)).toEqual(['p3', 'p4']);
		// one record table: findOne sees a row any page loaded, without a request
		expect(store.findOne('post', 'p3')).toBe(page2[0]);
		// a no-query read is still the whole local collection
		expect(store.findMany('post')).toHaveLength(4);
	});

	it('meta is non-enumerable and frozen; filter applies on top of a query', async () => {
		servePosts(fivePosts());
		const store = makeStore();
		await settle(store, (s) => s.findMany('post', { query: { page: 1 } }));

		const rows = store.findMany('post', { query: { page: 1 }, filter: (p) => p.id === 'p2' });
		expect(rows.map((p) => p.id)).toEqual(['p2']);
		expect(Object.keys(rows)).toEqual(['0']);
		expect(Object.isFrozen(rows.meta)).toBe(true);
		expect([...rows]).toHaveLength(1);
	});

	it('spells equal queries alike: key order and nullish entries do not make a new entry', async () => {
		const { calls } = servePosts(fivePosts());
		const store = makeStore();
		await settle(store, (s) => s.findMany('post', { query: { page: 1, q: null } }));
		const { requests } = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }));

		expect(requests.size).toBe(0);
		expect(calls).toHaveLength(1);
	});

	it('dedupes one query read by two views into one request', async () => {
		const { calls } = servePosts(fivePosts());
		const store = makeStore();
		const a = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }), {});
		const b = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }), {});

		await Promise.all([...a.requests.values(), ...b.requests.values()]);
		expect(calls).toEqual(['GET /api/posts?page=1']);
	});

	it('an untracked query read is a local snapshot: cached rows or [] and never a request', async () => {
		const { fetchMock } = servePosts(fivePosts());
		const store = makeStore();

		expect(store.findMany('post', { query: { page: 1 } })).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('an empty query is no query: it loads the whole collection once', async () => {
		const { calls } = servePosts(fivePosts());
		const store = makeStore();
		const { value } = await settle(store, (s) => s.findMany('post', { query: {} }));

		expect(calls).toEqual(['GET /api/posts']);
		expect(value).toHaveLength(5);
	});

	it('throws on a query value with no stable spelling, naming the key', () => {
		const store = makeStore();
		expect(() => trackedPass(store, (s) => s.findMany('post', { query: { since: new Date() } }))).toThrow(
			/query key "since"/
		);
		expect(() => trackedPass(store, (s) => s.findMany('post', { query: { page: NaN } }))).toThrow(/"page"/);
	});

	it('an explicit loadMany with options fills the same cache a tracked read hits', async () => {
		const { calls } = servePosts(fivePosts());
		const store = makeStore();
		await store.loadMany('post', { page: 3 });

		const { value, requests } = trackedPass(store, (s) => s.findMany('post', { query: { page: 3 } }));
		expect(requests.size).toBe(0);
		expect(value.map((p) => p.id)).toEqual(['p5']);
		expect(calls).toHaveLength(1);
	});

	it('rejects a { records, meta } answer whose meta is not an object', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ records: [], meta: 'nope' })));
		const store = makeStore();
		await expect(store.loadMany('post', { page: 1 })).rejects.toThrow(/meta to be a JSON object/);
	});

	it('evicts the least recently used query past 200 entries', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json([])));
		const store = makeStore();
		for (let page = 1; page <= 201; page++) await store.loadMany('post', { page });

		const evicted = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }));
		const kept = trackedPass(store, (s) => s.findMany('post', { query: { page: 201 } }));
		expect(evicted.requests.size).toBe(1);
		expect(kept.requests.size).toBe(0);
	});

	it('warns once per type when an adapter-free store gets a query', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class Local extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		const store = new Store({ localonly: Local });
		store.findMany('localonly', { query: { page: 1 } });
		store.findMany('localonly', { query: { page: 2 } });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(/needs the adapter capability/);
	});
});

describe('D193 invalidate()', () => {
	it('marks without fetching; the next tracked read refetches and replaces the rows', async () => {
		const posts = fivePosts();
		const { calls } = servePosts(posts);
		const store = makeStore();
		await settle(store, (s) => s.findMany('post', { query: { page: 1 } }));

		store.invalidate('post');
		expect(calls).toHaveLength(1); // invalidate itself sends nothing

		posts.splice(0, 1); // the server dropped p1, so page 1 is now p2, p3
		const stale = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }));
		// the pass that queued the refetch still sees the old rows
		expect(stale.value.map((p) => p.id)).toEqual(['p1', 'p2']);
		await Promise.all(stale.requests.values());

		const fresh = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }));
		expect(fresh.requests.size).toBe(0);
		expect(fresh.value.map((p) => p.id)).toEqual(['p2', 'p3']);
		expect(calls).toEqual(['GET /api/posts?page=1', 'GET /api/posts?page=1']);
	});

	it('type-wide: clears LOADED, refetches the collection and stale synced records', async () => {
		const { calls } = servePosts(fivePosts());
		const store = makeStore();
		await settle(store, (s) => s.findMany('post'));
		const local = store.createRecord('post', { id: 'draft', title: 'Local only' });

		store.invalidate('post');
		const { requests } = trackedPass(store, (s) => [
			s.findMany('post'),
			s.findOne('post', 'p2'),
			s.findOne('post', 'draft'),
		]);

		expect([...requests.keys()].sort()).toEqual(['post', 'post p2']);
		await Promise.all(requests.values());
		expect(store.findOne('post', 'draft')).toBe(local);
		expect(calls.slice(1).sort()).toEqual(['GET /api/posts', 'GET /api/posts/p2']);
	});

	it('one query: only that key refetches', async () => {
		servePosts(fivePosts());
		const store = makeStore();
		await settle(store, (s) => s.findMany('post', { query: { page: 1 } }));
		await settle(store, (s) => s.findMany('post', { query: { page: 2 } }));

		store.invalidate('post', { query: { page: 2 } });
		const one = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }));
		const two = trackedPass(store, (s) => s.findMany('post', { query: { page: 2 } }));
		expect(one.requests.size).toBe(0);
		expect([...two.requests.keys()]).toEqual(['post?[["page",2]]']);
	});

	it('one record: refetches it, and a 404 removes it so the next pass reads null', async () => {
		const posts = fivePosts();
		servePosts(posts);
		const store = makeStore();
		await settle(store, (s) => s.findOne('post', 'p1'));

		store.invalidate('post', 'p1');
		posts.splice(0, 1);
		const { value } = await settle(store, (s) => s.findOne('post', 'p1'));
		expect(value).toBeNull();
	});

	it('a response dispatched before the invalidation does not make the entry fresh', async () => {
		let release;
		const gate = new Promise((resolve) => (release = resolve));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await gate;
				return json({ records: [{ id: 'p1', title: 'One' }] });
			})
		);
		const store = makeStore();
		const first = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }));
		store.invalidate('post');
		release();
		await Promise.all(first.requests.values());

		// the rows landed, but the entry is still stale, so the next read refetches
		const next = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }));
		expect(next.value.map((p) => p.id)).toEqual(['p1']);
		expect(next.requests.size).toBe(1);
	});

	it('notifies the views reading the type, and a failed refetch leaves it stale for a retry', async () => {
		let fail = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => (fail ? json({ error: 'down' }, 500) : json({ records: [{ id: 'p1', title: 'One' }] })))
		);
		const store = makeStore();
		const seen = vi.fn();
		const view = { onStoreChange: seen };
		await settle(store, (s) => s.findMany('post', { query: { page: 1 } }), view);

		store.invalidate('post');
		store.flush();
		expect(seen).toHaveBeenCalled();

		fail = true;
		const failed = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }), view);
		await expect(Promise.all(failed.requests.values())).rejects.toBeInstanceOf(PuzzleAdapterError);
		const retry = trackedPass(store, (s) => s.findMany('post', { query: { page: 1 } }), view);
		expect(retry.requests.size).toBe(1);
	});
});

describe('D193 write status', () => {
	it('the save promise carries pending and error', async () => {
		servePosts(fivePosts());
		const store = makeStore();
		const post = await store.loadOne('post', 'p1');

		const save = post.update({ title: 'Uno' }).save();
		expect(save.pending).toBe(true);
		expect(save.error).toBeNull();
		await save;
		expect(save.pending).toBe(false);
		expect(save.error).toBeNull();
	});

	it('a failed save records its error on the promise and in syncStatus', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url, init = {}) =>
				init.method === 'PUT' ? json({ error: 'nope' }, 500) : json({ id: 'p1', title: 'One' })
			)
		);
		const store = makeStore();
		const post = await store.loadOne('post', 'p1');

		const save = post.save();
		await expect(save).rejects.toBeInstanceOf(PuzzleAdapterError);
		expect(save.pending).toBe(false);
		expect(save.error).toBeInstanceOf(PuzzleAdapterError);
		expect(store.syncStatus(post).pending).toBeNull();
		expect(store.syncStatus(post).error).toBe(save.error);
	});

	it('syncStatus names the running write and notifies the record at each flip', async () => {
		servePosts(fivePosts());
		const store = makeStore();
		const post = await store.loadOne('post', 'p1');
		const seen = [];
		const view = { onStoreChange: () => seen.push(store.syncStatus(post).pending) };
		trackedPass(store, (s) => s.syncStatus(post), view);
		expect(store.syncStatus(post)).toEqual({ pending: null, error: null });

		const save = post.save();
		const del = post.delete();
		await Promise.resolve();
		await Promise.resolve();
		expect(store.syncStatus(post).pending).toBe('save');
		await save;
		await del;
		expect(store.syncStatus(post).pending).toBeNull();
		store.flush();
		expect(seen.length).toBeGreaterThan(0);
	});

	it('a write decided up front still carries the two properties', async () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'x', title: 'X' });
		post.destroy();
		const save = post.save();
		expect(save.pending).toBe(false);
		await expect(save).rejects.toThrow(/deleted record/);
		expect(save.error).toBeInstanceOf(Error);
	});
});

describe('D193 read-state serialization', () => {
	it('round-trips query entries (rows and meta) through the envelope', async () => {
		servePosts(fivePosts());
		const source = makeStore();
		await settle(source, (s) => s.findMany('post', { query: { page: 1 } }));
		const envelope = JSON.parse(JSON.stringify(serializeReadState(source)));
		expect(envelope.queries).toHaveLength(1);

		const target = makeStore();
		target.upsert('post', [
			{ id: 'p1', title: 'One' },
			{ id: 'p2', title: 'Two' },
		]);
		hydrateReadState(target, envelope);
		const { value, requests } = trackedPass(target, (s) => s.findMany('post', { query: { page: 1 } }));
		expect(requests.size).toBe(0);
		expect(value.map((p) => p.id)).toEqual(['p1', 'p2']);
		expect(value.meta).toEqual({ page: 1, nextPage: 2 });
	});

	it('drops a hydrated entry whose key does not match its own type and query', () => {
		const store = makeStore();
		hydrateReadState(store, {
			v: 1,
			queries: [['post?[["page",9]]', 'post', { page: 1 }, ['p1'], null]],
		});
		expect(serializeReadState(store).queries).toBeUndefined();
	});

	it('leaves the envelope unchanged when there are no queries', () => {
		expect(serializeReadState(makeStore())).toEqual({ v: 1, complete: [], loaded: [], absent: [] });
	});
});

describe('D193 mock pagination', () => {
	let uninstall;
	beforeEach(() => {
		uninstall = installFixtures();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => uninstall());

	const mockStore = () => {
		class MockPost extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
			static adapter = {
				endpoint: '/api/posts',
				mock: { data: Array.from({ length: 5 }, (_, i) => ({ id: `m${i + 1}`, title: `T${i + 1}` })) },
			};
		}
		return new Store({ post: MockPost }, { apiURL: API, adapter });
	};

	it('serves ?page and ?limit as { records, meta }', async () => {
		const store = mockStore();
		const { value } = await settle(store, (s) => s.findMany('post', { query: { page: 2, limit: 2 } }));
		expect(value.map((p) => p.id)).toEqual(['m3', 'm4']);
		expect(value.meta).toEqual({ page: 2, limit: 2, total: 5, nextPage: 3, nextCursor: 'm4' });
	});

	it('serves an after cursor, ending with null cursors on the last page', async () => {
		const store = mockStore();
		const { value } = await settle(store, (s) => s.findMany('post', { query: { after: 'm3', limit: 5 } }));
		expect(value.map((p) => p.id)).toEqual(['m4', 'm5']);
		expect(value.meta.nextCursor).toBeNull();
		expect(value.meta.page).toBeNull();
	});

	it('still answers a bare collection GET with the plain array', async () => {
		const store = mockStore();
		const records = await store.loadMany('post');
		expect(records).toHaveLength(5);
	});
});

describe('D193 in a mounted view', () => {
	const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
	const text = (value) => new ViewNode('text', { value });
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('invalidate keeps the old rows on screen until the refetch commits', async () => {
		const posts = fivePosts();
		let release = null;
		const fetchMock = vi.fn(async (url) => {
			if (release) await new Promise((resolve) => (release = resolve));
			const page = posts.slice(0, 2);
			return json({ records: page, meta: { page: 1 } });
		});
		vi.stubGlobal('fetch', fetchMock);
		const store = makeStore();
		class List extends PuzzleView {
			data() {
				return { posts: this.ctx.store.findMany('post', { query: { page: 1 } }) };
			}
			render() {
				return h('ul', {}, this.getData().posts.map((p) => h('li', {}, [text(p.title)])));
			}
		}
		const el = document.createElement('div');
		document.body.appendChild(el);
		await new List({ store, router: null, formatters: null }).mount(el);
		expect(el.textContent).toBe('OneTwo');

		// hold the refetch open, change the server, invalidate
		release = () => {};
		posts[0] = { id: 'p1', title: 'Uno' };
		store.invalidate('post');
		store.flush();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await tick();
		expect(el.textContent).toBe('OneTwo'); // still the old rows

		release();
		await vi.waitFor(() => expect(el.textContent).toBe('UnoTwo'));
	});

	it('a query-only change of params fetches the new page and caches the old one', async () => {
		const { calls } = servePosts(fivePosts());
		const store = makeStore();
		class List extends PuzzleView {
			data() {
				const page = this.getState().page ?? 1;
				return { posts: this.ctx.store.findMany('post', { query: { page } }) };
			}
			render() {
				return h('p', {}, [text(this.getData().posts.map((p) => p.id).join(','))]);
			}
		}
		const el = document.createElement('div');
		document.body.appendChild(el);
		const view = new List({ store, router: null, formatters: null });
		await view.mount(el);
		expect(el.textContent).toBe('p1,p2');

		view.setState('page', 2);
		await vi.waitFor(() => expect(el.textContent).toBe('p3,p4'));

		view.setState('page', 1);
		await vi.waitFor(() => expect(el.textContent).toBe('p1,p2'));
		expect(calls).toEqual(['GET /api/posts?page=1', 'GET /api/posts?page=2']);
	});
});

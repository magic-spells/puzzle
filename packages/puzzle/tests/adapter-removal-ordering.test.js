// @vitest-environment jsdom
// R1: a removal supersedes reads dispatched before it, including collection rows.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter, hydrateReadState, serializeReadState } from '../client-runtime/datastore/adapter.js';
import { Store } from '../client-runtime/datastore/store.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function gate() {
	const calls = [];
	const dispatched = deferred();
	return {
		calls,
		dispatched: dispatched.promise,
		verb() {
			const call = deferred();
			calls.push(call);
			dispatched.resolve();
			return call.promise;
		},
	};
}

function setup() {
	const one = gate();
	const many = gate();
	const deletion = gate();
	class Post extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			title: Puzzle.string().required(),
		};
		static adapter = {
			loadOne: () => one.verb(),
			loadMany: () => many.verb(),
			delete: () => deletion.verb(),
		};
	}
	const data = new Map();
	const storage = {
		getItem: (key) => data.get(key) ?? null,
		setItem: vi.fn((key, value) => data.set(key, value)),
	};
	const store = new Store({ post: Post }, { adapter, storage });
	const post = store.upsert('post', { id: 'p1', title: 'original' });
	store.flush();
	const notify = vi.spyOn(store, '_notify');
	const persist = vi.spyOn(store, '_persist');
	return { store, post, one, many, deletion, storage, notify, persist };
}

async function deletePost({ post, deletion, store }) {
	const deleting = post.delete();
	await deletion.dispatched;
	expect(store.findMany('post')).toContain(post); // removal waits for the ack
	deletion.calls[0].resolve();
	await deleting;
	store.flush();
}

function expectGone({ store, post }) {
	expect(store.findOne('post', 'p1')).toBeNull();
	expect(store.findMany('post')).not.toContain(post);
	expect(store.findMany('post').map((record) => record.id)).not.toContain('p1');
	expect(post._deleted).toBe(true);
	expect(post._store).toBeNull();
	expect(post.title).toBe('original');
	expect(serializeReadState(store).absent).toEqual(['post p1']);
}

afterEach(() => vi.restoreAllMocks());

describe('removal ordering', () => {
	it('drops a late loadOne after an acknowledged DELETE, including notifications and persistence', async () => {
		const ctx = setup();
		const { store, post, one, notify, persist, storage } = ctx;
		const loading = store.loadOne('post', 'p1');
		await deletePost(ctx);
		expectGone(ctx);
		expect(notify).toHaveBeenCalledExactlyOnceWith('post', 'p1');
		persist.mockClear();
		storage.setItem.mockClear();

		one.calls[0].resolve({ id: 'p1', title: 'stale' });
		await loading;
		store.flush();

		expectGone(ctx);
		expect(store.findMany('post')).toEqual([]);
		expect(post._synced).toBe(true);
		expect(notify).toHaveBeenCalledTimes(1);
		expect(persist).not.toHaveBeenCalled();
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(JSON.parse(storage.getItem('puzzle-store')).post).toEqual([]);
	});

	it('skips the deleted loadMany row while merging other existing and new rows', async () => {
		const ctx = setup();
		const { store, post, many, notify } = ctx;
		const other = store.createRecord('post', { id: 'p2', title: 'local' });
		store.flush();
		notify.mockClear();
		const loading = store.loadMany('post');
		await deletePost(ctx);

		many.calls[0].resolve([
			{ id: 'p1', title: 'stale' },
			{ id: 'p2', title: 'updated' },
			{ id: 'p3', title: 'new' },
		]);
		await loading;
		store.flush();

		expectGone(ctx);
		expect(store.findMany('post').map((record) => record.id)).toEqual(['p2', 'p3']);
		expect(store.findOne('post', 'p2')).toBe(other);
		expect(other.title).toBe('updated');
		expect(other._synced).toBe(true);
		expect(store.findOne('post', 'p3')._synced).toBe(true);
		expect(post._synced).toBe(true);
		expect(notify.mock.calls).toEqual([['post', 'p1'], ['post', 'p2'], ['post', 'p3']]);
	});

	it('accepts a fresh loadOne dispatched after removal and clears absence', async () => {
		const ctx = setup();
		const { store, post, one, notify } = ctx;
		const stale = store.loadOne('post', 'p1');
		await deletePost(ctx);
		const fresh = store.loadOne('post', 'p1');
		one.calls[1].resolve({ id: 'p1', title: 'fresh' });
		await fresh;
		one.calls[0].resolve({ id: 'p1', title: 'stale' });
		await stale;
		store.flush();

		const returned = store.findOne('post', 'p1');
		expect(returned).not.toBe(post);
		expect(returned.title).toBe('fresh');
		expect(returned._synced).toBe(true);
		expect(store.findMany('post')).toEqual([returned]);
		expect(serializeReadState(store).absent).toEqual([]);
		expect(notify.mock.calls).toEqual([['post', 'p1'], ['post', 'p1']]);
	});

	it('changes nothing when every loadMany row was removed', async () => {
		const ctx = setup();
		const { store, post, many, notify, storage } = ctx;
		const loading = store.loadMany('post');
		await deletePost(ctx);
		storage.setItem.mockClear();
		many.calls[0].resolve([{ id: 'p1', title: 'stale' }]);
		const returned = await loading;
		store.flush();

		expectGone(ctx);
		expect(returned).toEqual([]);
		expect(store.findMany('post')).toEqual([]);
		expect(post._synced).toBe(true);
		expect(notify).toHaveBeenCalledExactlyOnceWith('post', 'p1');
		// The load flags the store dirty either way; what matters is that the write
		// it flushes still says the record is gone.
		expect(JSON.parse(storage.getItem('puzzle-store')).post).toEqual([]);
	});

	it('preserves the absence stamp when a tracked miss touches the LRU entry', async () => {
		const ctx = setup();
		const { store, one, notify } = ctx;
		const stale = store.loadOne('post', 'p1');
		await deletePost(ctx);
		const fresh = store.loadOne('post', 'p1');
		const other = store.loadOne('post', 'p2'); // advances seq beyond the fresh read
		const requests = new Map();
		store._faultOne('post', 'p1', requests);
		expect(requests.size).toBe(0);
		expect(one.calls).toHaveLength(3);
		one.calls[0].resolve({ id: 'p1', title: 'stale' });
		await stale;
		expectGone(ctx);
		one.calls[1].resolve({ id: 'p1', title: 'fresh' });
		one.calls[2].resolve({ id: 'p2', title: 'other' });
		await Promise.all([fresh, other]);

		expect(store.findMany('post').map((record) => record.id)).toEqual(['p1', 'p2']);
		expect(store.findOne('post', 'p1').title).toBe('fresh');
		expect(store.findMany('post').every((record) => record._synced)).toBe(true);
		expect(serializeReadState(store).absent).toEqual([]);
		expect(notify.mock.calls).toEqual([['post', 'p1'], ['post', 'p1'], ['post', 'p2']]);
	});

	it('allows an imperative upsert to restore an absent identity without a read generation', async () => {
		const ctx = setup();
		const { store, notify } = ctx;
		await deletePost(ctx);
		const restored = store.upsert('post', { id: 'p1', title: 'imperative' });

		expect(store.findOne('post', 'p1')).toBe(restored);
		expect(store.findMany('post')).toEqual([restored]);
		expect(restored.title).toBe('imperative');
		expect(restored._synced).toBe(true);
		expect(serializeReadState(store).absent).toEqual([]);
		expect(notify.mock.calls).toEqual([['post', 'p1'], ['post', 'p1']]);
	});

	it.each(['destroy', 'removeRecord', 'unsynced delete'])('%s supersedes a late loadOne', async (path) => {
		const ctx = setup();
		const { store, post, one, deletion, notify } = ctx;
		if (path === 'unsynced delete') post._synced = false;
		const loading = store.loadOne('post', 'p1');
		if (path === 'destroy') post.destroy();
		else if (path === 'removeRecord') store.removeRecord(post);
		else await post.delete();
		expectGone(ctx);

		one.calls[0].resolve({ id: 'p1', title: 'stale' });
		await loading;
		store.flush();

		expectGone(ctx);
		expect(store.findMany('post')).toEqual([]);
		expect(post._synced).toBe(path !== 'unsynced delete');
		expect(notify).toHaveBeenCalledExactlyOnceWith('post', 'p1');
		expect(deletion.calls).toHaveLength(0);
	});

	it('preserves the record and records no absence when DELETE rejects', async () => {
		const { store, post, one, deletion, notify } = setup();
		const loading = store.loadOne('post', 'p1');
		const deleting = post.delete();
		const rejected = expect(deleting).rejects.toThrow('offline');
		await deletion.dispatched;
		deletion.calls[0].reject(new Error('offline'));
		await rejected;

		expect(store.findMany('post')).toEqual([post]);
		expect(post.title).toBe('original');
		expect(post._synced).toBe(true);
		expect(serializeReadState(store).absent).toEqual([]);
		expect(notify).not.toHaveBeenCalled();
		one.calls[0].resolve({ id: 'p1', title: 'loaded' });
		await loading;
		expect(store.findOne('post', 'p1')).toBe(post);
		expect(post.title).toBe('loaded');
		expect(post._synced).toBe(true);
		expect(serializeReadState(store).absent).toEqual([]);
		expect(notify).toHaveBeenCalledExactlyOnceWith('post', 'p1');
	});

	it('keeps an explicitly recreated record unsynced and untouched by a stale GET', async () => {
		const ctx = setup();
		const { store, one, notify } = ctx;
		const loading = store.loadOne('post', 'p1');
		await deletePost(ctx);
		const recreated = store.createRecord('post', { id: 'p1', title: 'recreated' });
		expect(serializeReadState(store).absent).toEqual([]);
		expect(recreated._synced).toBe(false);

		one.calls[0].resolve({ id: 'p1', title: 'stale' });
		await loading;
		store.flush();

		expect(store.findOne('post', 'p1')).toBe(recreated);
		expect(store.findMany('post')).toEqual([recreated]);
		expect(recreated.title).toBe('recreated');
		expect(recreated._synced).toBe(false);
		expect(serializeReadState(store).absent).toEqual([]);
		expect(notify.mock.calls).toEqual([['post', 'p1'], ['post', 'p1']]);
	});

	it('hydrates absent keys without blocking a later explicit read', async () => {
		const { store, post, one, notify } = setup();
		post.destroy();
		const envelope = serializeReadState(store);
		expect(envelope).toEqual({ v: 1, complete: [], loaded: [], absent: ['post p1'] });
		const hydrated = new Store(store.models, { adapter });
		hydrateReadState(hydrated, envelope);
		expect(serializeReadState(hydrated)).toEqual(envelope);
		const hydratedNotify = vi.spyOn(hydrated, '_notify');

		const loading = hydrated.loadOne('post', 'p1');
		one.calls[0].resolve({ id: 'p1', title: 'fresh' });
		await loading;

		const returned = hydrated.findOne('post', 'p1');
		expect(hydrated.findMany('post')).toEqual([returned]);
		expect(returned.title).toBe('fresh');
		expect(returned._synced).toBe(true);
		expect(serializeReadState(hydrated).absent).toEqual([]);
		expect(hydratedNotify).toHaveBeenCalledExactlyOnceWith('post', 'p1');
		expect(notify).toHaveBeenCalledTimes(1);
	});
});

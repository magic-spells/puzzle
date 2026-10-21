// D184 — store.observe(): a function linked straight onto a `type` or
// `type id` subscription key, outside any view. No withTracking, so no
// transactional reset and no fetch; delivery is the ordinary batched flush, at
// most once per flush, isolated like every other subscriber.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Store } from '../client-runtime/datastore/store.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

class Task extends PuzzleModel {
	static schema = {
		id: Puzzle.number().primary(),
		title: Puzzle.string(),
	};
}

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string(),
	};
	static adapter = { endpoint: '/api/posts' };
}

const makeStore = () => new Store({ task: Task });

describe('store.observe (D184)', () => {
	it('a type observation fires on create, update and remove', () => {
		const store = makeStore();
		const fn = vi.fn();
		store.observe('task', fn);

		const t = store.createRecord('task', { id: 1, title: 'a' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenLastCalledWith(); // no arguments

		t.update({ title: 'b' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(2);

		t.destroy();
		store.flush();
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('a record observation fires on its own create, update and remove only', () => {
		const store = makeStore();
		const fn = vi.fn();
		// The record does not exist yet; the id is spelled as a string while the
		// primary key is a number — the key matches findOne's.
		store.observe('task', '7', fn);

		store.createRecord('task', { id: 8, title: 'other' });
		store.flush();
		expect(fn).not.toHaveBeenCalled();

		const t = store.createRecord('task', { id: 7, title: 'mine' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);

		store.findOne('task', 8).update({ title: 'still other' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);

		t.update({ title: 'changed' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(2);

		t.destroy();
		store.flush();
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('is called at most once per flush however many records changed', () => {
		const store = makeStore();
		const fn = vi.fn();
		store.observe('task', fn);
		for (let i = 0; i < 5; i++) store.createRecord('task', { id: i });
		store.findOne('task', 2).update({ title: 'x' });
		expect(fn).not.toHaveBeenCalled(); // nothing before the flush
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('stop() removes exactly that observation and is idempotent', () => {
		const store = makeStore();
		const fn = vi.fn();
		const stop = store.observe('task', fn);
		stop();
		stop();
		store.createRecord('task', { id: 1 });
		store.flush();
		expect(fn).not.toHaveBeenCalled();
		// Nothing left behind in either index.
		expect(store.subscribersByKey.size).toBe(0);
		expect(store.keysBySubscriber.size).toBe(0);
	});

	it('observing the same function twice gives two independent observations', () => {
		const store = makeStore();
		const fn = vi.fn();
		const stopType = store.observe('task', fn);
		store.observe('task', 1, fn);

		store.createRecord('task', { id: 1 });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(2); // one per observation

		stopType();
		store.findOne('task', 1).update({ title: 'x' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(3); // the record observation survives
	});

	it('isolates a throwing observer from the rest of the batch', () => {
		const store = makeStore();
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const after = vi.fn();
		store.observe('task', () => {
			throw new Error('boom');
		});
		store.observe('task', after);
		store.createRecord('task', { id: 1 });
		store.flush();
		expect(after).toHaveBeenCalledTimes(1);
		expect(err).toHaveBeenCalledWith('[puzzle] store subscriber failed:', expect.any(Error));
		err.mockRestore();
	});

	it('stop() inside a callback stops later deliveries, including a sibling in the same batch', () => {
		const store = makeStore();
		let stopSecond;
		const first = vi.fn(() => stopSecond());
		const second = vi.fn();
		store.observe('task', first);
		stopSecond = store.observe('task', second);
		const self = vi.fn(() => stopSelf());
		const stopSelf = store.observe('task', self);

		store.createRecord('task', { id: 1 });
		store.flush();
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).not.toHaveBeenCalled(); // stopped earlier in this same flush
		expect(self).toHaveBeenCalledTimes(1);

		store.createRecord('task', { id: 2 });
		store.flush();
		expect(first).toHaveBeenCalledTimes(2);
		expect(self).toHaveBeenCalledTimes(1);
	});

	it('is independent of the tracking scope it is called from', () => {
		const store = makeStore();
		const view = { onStoreChange: vi.fn() };
		const fn = vi.fn();
		// Observing inside a tracked run neither subscribes the tracking target nor
		// is dropped when that target's subscriptions reset or go away.
		store.withTracking(view, () => {
			store.observe('task', fn);
		});
		expect(store.keysBySubscriber.has(view)).toBe(false);
		store.unsubscribe(view);
		store.createRecord('task', { id: 1 });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);
		expect(view.onStoreChange).not.toHaveBeenCalled();
	});

	it('throws a plain Error on invalid arguments', () => {
		const store = makeStore();
		expect(() => store.observe('task')).toThrow(/store\.observe/);
		expect(() => store.observe(1, () => {})).toThrow(/store\.observe/);
		expect(() => store.observe('task', 1, 'nope')).toThrow(/store\.observe/);
		expect(() => store.observe('task', null, () => {})).toThrow(/store\.observe/);
	});

	describe('on an adapter app', () => {
		let fetchMock;
		beforeEach(() => {
			fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '[]', json: async () => [] }));
			vi.stubGlobal('fetch', fetchMock);
		});
		afterEach(() => vi.unstubAllGlobals());

		const makeAdapterStore = () =>
			new Store({ post: Post }, { apiURL: 'https://x.test', adapter: { d: undefined } });

		it('never fetches, for a missing collection or a missing record', async () => {
			const store = makeAdapterStore();
			const fn = vi.fn();
			store.observe('post', fn);
			store.observe('post', 'p1', fn);
			await Promise.resolve();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('works through a view\'s per-view store handle, without fetching', async () => {
			const store = makeAdapterStore();
			const view = {};
			const handle = store._handleFor(view);
			expect(handle).not.toBe(store);
			const fn = vi.fn();
			// Called inside the view's own tracked run, where a findOne miss WOULD fault.
			const requests = new Map();
			let stop;
			store.withTracking(view, () => {
				stop = handle.observe('post', 'p1', fn);
			}, false, {}, requests);
			expect(requests.size).toBe(0);
			await Promise.resolve();
			expect(fetchMock).not.toHaveBeenCalled();

			store._upsert('post', { id: 'p1', title: 'hi' });
			store.flush();
			expect(fn).toHaveBeenCalledTimes(1);
			stop();
			store.findOne('post', 'p1').update({ title: 'again' });
			store.flush();
			expect(fn).toHaveBeenCalledTimes(1);
		});
	});
});

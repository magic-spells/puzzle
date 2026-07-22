import { describe, it, expect, vi } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};

	toggle() {
		return this.update({ completed: !this.completed });
	}
}

const makeStore = (options) => new Store({ todo: Todo }, options);

describe('Store — records & models (SPEC §8)', () => {
	it('createRecord instantiates the registered model class with defaults and a generated primary key', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { text: 'ship v1' });

		expect(todo).toBeInstanceOf(Todo);
		expect(todo.completed).toBe(false); // schema default applied
		expect(typeof todo.id).toBe('string'); // pk generated
		expect(todo.id.length).toBeGreaterThan(0);
	});

	it('respects a caller-provided primary key and honors non-id .primary() fields', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		expect(store.findOne('todo', 't1')).toBe(todo);

		class Post extends PuzzleModel {
			static schema = { slug: Puzzle.string().primary() };
		}
		const store2 = new Store({ post: Post });
		const post = store2.createRecord('post', { slug: 'hello-world' });
		expect(store2.findOne('post', 'hello-world')).toBe(post);
	});

	it('falls back to base PuzzleModel for unregistered types', () => {
		const store = makeStore();
		const thing = store.createRecord('thing', { name: 'generic' });
		expect(thing).toBeInstanceOf(PuzzleModel);
		expect(store.findMany('thing')).toHaveLength(1);
	});

	it('findMany returns all records; the filter option narrows them', () => {
		const store = makeStore();
		store.createRecord('todo', { text: 'a' });
		store.createRecord('todo', { text: 'b', completed: true });

		expect(store.findMany('todo')).toHaveLength(2);
		expect(store.findMany('todo', { filter: (t) => !t.completed })).toHaveLength(1);
		expect(store.findMany('todo', { filter: (t) => !t.completed })[0].text).toBe('a');
	});

	it('findOne returns null for missing records, never undefined', () => {
		expect(makeStore().findOne('todo', 'nope')).toBeNull();
	});

	it('record.destroy() removes the record before subscribers are notified', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		let seenDuringNotify;
		store.withTracking(() => {}, () => store.findMany('todo'));
		store.withTracking(
			() => { seenDuringNotify = store.findMany('todo').length; },
			() => store.findMany('todo')
		);

		todo.destroy();
		store.flush();
		expect(seenDuringNotify).toBe(0); // removal happened first (CODE_REVIEW fix)
		expect(store.findOne('todo', 't1')).toBeNull();
	});
});

describe('Store — duplicate primary keys', () => {
	it('createRecord throws on a duplicate explicit key, leaving the original attached and live', () => {
		const store = makeStore();
		const original = store.createRecord('todo', { id: 't1', text: 'first' });

		expect(() => store.createRecord('todo', { id: 't1', text: 'second' })).toThrow(
			/duplicate primary key "t1" for model "todo"/
		);

		// The original is untouched: still the one and only record, still attached.
		expect(store.findMany('todo')).toHaveLength(1);
		expect(store.findOne('todo', 't1')).toBe(original);
		expect(original.text).toBe('first');

		// And still fully wired to the store — its update() still notifies.
		store.flush();
		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findOne('todo', 't1'));
		original.update({ text: 'edited' });
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
		expect(store.findOne('todo', 't1').text).toBe('edited');
	});

	it('throws on a duplicate custom .primary() key too', () => {
		class Post extends PuzzleModel {
			static schema = { slug: Puzzle.string().primary() };
		}
		const store = new Store({ post: Post });
		store.createRecord('post', { slug: 'hello-world' });

		expect(() => store.createRecord('post', { slug: 'hello-world' })).toThrow(
			/duplicate primary key "hello-world" for model "post" — a record with that slug already exists/
		);
		expect(store.findMany('post')).toHaveLength(1);
	});

	it('_upsert with an existing key updates in place, preserving object identity', () => {
		const store = makeStore();
		const original = store.createRecord('todo', { id: 't1', text: 'first' });

		const upserted = store._upsert('todo', { id: 't1', text: 'updated' });
		expect(upserted).toBe(original); // same instance, updated in place
		expect(store.findMany('todo')).toHaveLength(1); // no duplicate
		expect(original.text).toBe('updated');
	});

	it('hydration keeps one record when the storage blob holds duplicate pks, without throwing', () => {
		const data = new Map();
		const storage = {
			getItem: (k) => data.get(k) ?? null,
			setItem: (k, v) => data.set(k, v),
		};
		storage.setItem(
			'puzzle-store',
			JSON.stringify({
				todo: [
					{ id: 't1', text: 'first', completed: false },
					{ id: 't1', text: 'second', completed: true },
				],
			})
		);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		let store;
		expect(() => {
			store = makeStore({ storage });
		}).not.toThrow();

		expect(store.findMany('todo')).toHaveLength(1);
		const todo = store.findOne('todo', 't1');
		expect(todo.text).toBe('first'); // first record wins
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe('Store — subscriptions & reactivity (SPEC §8)', () => {
	it('queries inside withTracking auto-subscribe; record changes notify', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { text: 'x' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findMany('todo'));

		todo.toggle();
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('createRecord notifies collection subscribers — new todos appear', () => {
		const store = makeStore();
		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findMany('todo'));

		store.createRecord('todo', { text: 'new' });
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('findOne subscribers are only notified for THAT record', () => {
		const store = makeStore();
		const t1 = store.createRecord('todo', { id: 't1', text: 'a' });
		const t2 = store.createRecord('todo', { id: 't2', text: 'b' });
		store.flush();

		const watcher = { onStoreChange: vi.fn() };
		store.withTracking(watcher, () => store.findOne('todo', 't1'));

		t2.update({ text: 'changed' });
		store.flush();
		expect(watcher.onStoreChange).not.toHaveBeenCalled();

		t1.update({ text: 'changed' });
		store.flush();
		expect(watcher.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('queries outside any tracking scope subscribe nothing', () => {
		const store = makeStore();
		store.findMany('todo'); // event-handler style read
		expect(store.subscribersByKey.get('todo')?.size ?? 0).toBe(0);
	});

	it('a flush notifies each subscriber exactly once, however many records changed', () => {
		const store = makeStore();
		const a = store.createRecord('todo', { text: 'a' });
		const b = store.createRecord('todo', { text: 'b' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findMany('todo'));

		a.toggle();
		b.toggle();
		a.update({ text: 'a2' });
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('re-tracking resets subscriptions to only the queries actually made', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		store.createRecord('other', { id: 'o1' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		// first data() run queries todos
		store.withTracking(component, () => store.findMany('todo'));
		// second run no longer does
		store.withTracking(component, () => store.findMany('other'));

		todo.toggle();
		store.flush();
		expect(component.onStoreChange).not.toHaveBeenCalled();
	});

	it('unsubscribe stops all notifications (component destroy)', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { text: 'x' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findMany('todo'));
		store.unsubscribe(component);

		todo.toggle();
		store.flush();
		expect(component.onStoreChange).not.toHaveBeenCalled();
	});

	it('supports async data() — queries after await still subscribe', async () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		await store.withTracking(component, async () => {
			await Promise.resolve(); // simulate awaited fetch
			return store.findOne('todo', 't1');
		});

		todo.toggle();
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('function subscribers are invoked directly', () => {
		const store = makeStore();
		const fn = vi.fn();
		store.withTracking(fn, () => store.findMany('todo'));

		store.createRecord('todo', { text: 'x' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('overlapping async tracked evals each subscribe their OWN subscriber (serialized tracking)', async () => {
		const store = makeStore();

		let releaseA;
		let releaseB;
		const gateA = new Promise((r) => (releaseA = r));
		const gateB = new Promise((r) => (releaseB = r));

		const A = { onStoreChange: vi.fn() };
		const B = { onStoreChange: vi.fn() };

		// Start both scopes overlapping: each reads "todo", awaits its gate,
		// then reads "user". Without serialization the post-await "user" read
		// would attribute to the wrong subscriber.
		const pA = store.withTracking(A, async () => {
			store.findMany('todo');
			await gateA;
			store.findMany('user');
		});
		const pB = store.withTracking(B, async () => {
			store.findMany('todo');
			await gateB;
			store.findMany('user');
		});

		// Let both scopes begin, then release in interleaved order.
		releaseB();
		releaseA();
		await Promise.all([pA, pB]);

		// A owns both keys, B owns both keys, no cross-subscription.
		expect(store.subscribersByKey.get('todo')?.has(A)).toBe(true);
		expect(store.subscribersByKey.get('user')?.has(A)).toBe(true);
		expect(store.subscribersByKey.get('todo')?.has(B)).toBe(true);
		expect(store.subscribersByKey.get('user')?.has(B)).toBe(true);

		expect(store.keysBySubscriber.get(A)).toEqual(new Set(['todo', 'user']));
		expect(store.keysBySubscriber.get(B)).toEqual(new Set(['todo', 'user']));

		// Tracking is cleared once both scopes settle.
		expect(store._tracking).toBeFalsy();
		expect(store._asyncTrackingChain).toBeNull();
	});

	it('a sync eval runs inline while an async eval is suspended (not deferred)', async () => {
		const store = makeStore();

		let releaseA;
		const gateA = new Promise((r) => (releaseA = r));
		const A = { onStoreChange: vi.fn() };
		const B = { onStoreChange: vi.fn() };

		// Start async eval A: it reads "todo", awaits its gate, then reads "user".
		const pA = store.withTracking(
			A,
			async () => {
				store.findMany('todo');
				await gateA;
				store.findMany('user');
			},
			true
		);

		// With A suspended at its await, run a SYNC eval for B. It must run inline
		// and return its value synchronously, not a deferred promise.
		const bResult = store.withTracking(B, () => store.findMany('post'));
		expect(Array.isArray(bResult)).toBe(true); // ran inline (not a promise)
		expect(bResult && typeof bResult.then === 'function').toBe(false);
		// B's subscription is live immediately.
		expect(store.subscribersByKey.get('post')?.has(B)).toBe(true);

		// Now release A: its post-await query attributes to A, not B.
		releaseA();
		await pA;
		expect(store.subscribersByKey.get('todo')?.has(A)).toBe(true);
		expect(store.subscribersByKey.get('user')?.has(A)).toBe(true);
		expect(store.subscribersByKey.get('user')?.has(B)).toBe(false);
		expect(store.keysBySubscriber.get(B)).toEqual(new Set(['post']));
		expect(store._asyncTrackingChain).toBeNull();
	});

	it('expectsAsync defers the whole eval until the chain settles (single invocation)', async () => {
		const store = makeStore();

		let releaseChain;
		const gate = new Promise((r) => (releaseChain = r));
		// An async eval to hold the chain in flight.
		const inFlight = store.withTracking(
			{ onStoreChange: vi.fn() },
			async () => {
				store.findMany('todo');
				await gate;
			},
			true
		);

		let count = 0;
		const deferred = store.withTracking(
			{ onStoreChange: vi.fn() },
			async () => {
				count++;
				return store.findMany('user');
			},
			true
		);

		// Deferred behind the chain: fn has not run yet.
		expect(count).toBe(0);

		releaseChain();
		await inFlight;
		await deferred;

		expect(count).toBe(1); // ran exactly once, overall
		expect(store._asyncTrackingChain).toBeNull();
	});

	it('a sync-shaped fn returning a promise while a chain is in flight is dropped and retried behind it', async () => {
		const store = makeStore();

		let releaseChain;
		const gate = new Promise((r) => (releaseChain = r));
		const inFlight = store.withTracking(
			{ onStoreChange: vi.fn() },
			async () => {
				store.findMany('todo');
				await gate;
			},
			true
		);

		let invocations = 0;
		const S = { onStoreChange: vi.fn() };
		// A SYNC-shaped fn (expectsAsync omitted → false) that nonetheless returns
		// a raw Promise which queries the store after a tick.
		const p = store.withTracking(S, () => {
			invocations++;
			return new Promise((resolve) => {
				setTimeout(() => {
					store.findMany('user');
					resolve('done');
				}, 0);
			});
		});

		releaseChain();
		await inFlight;
		await p;

		expect(invocations).toBe(2); // first invocation dropped, retried behind the chain
		expect(store.subscribersByKey.get('user')?.has(S)).toBe(true);
		expect(store.keysBySubscriber.get(S)).toEqual(new Set(['user']));
		expect(store._asyncTrackingChain).toBeNull();
	});

	it('a destroyed subscriber suspended at an await does not re-subscribe on resume', async () => {
		// FIX: a view whose async data() sits at an await is destroyed mid-flight;
		// the resumed eval's post-await queries must NOT re-add it after
		// unsubscribe() dropped its keys (permanent-retention leak).
		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.createRecord('user', { id: 'u1' }); // unregistered → base model, fine
		store.flush();

		let releaseGate;
		const gate = new Promise((r) => (releaseGate = r));

		// View-like subscriber reporting destruction via isDestroyed (the store's
		// liveness probe), mirroring PuzzleView.
		const view = {
			_destroyed: false,
			get isDestroyed() { return this._destroyed; },
			onStoreChange: vi.fn(),
		};

		const p = store.withTracking(
			view,
			async () => {
				store.findMany('todo'); // subscribes BEFORE the await
				await gate;
				store.findOne('user', 'u1'); // resumes AFTER destroy — must NOT subscribe
			},
			true
		);

		// Destroy mid-await: flip the flag and unsubscribe (what PuzzleView.destroy does).
		view._destroyed = true;
		store.unsubscribe(view);

		releaseGate();
		await p;

		// Zero entries in BOTH subscription maps.
		expect(store.keysBySubscriber.has(view)).toBe(false);
		expect(store.subscribersByKey.get('todo')?.has(view) ?? false).toBe(false);
		expect(store.subscribersByKey.get('user u1')?.has(view) ?? false).toBe(false);
		expect(store._tracking).toBeFalsy();
		expect(store._asyncTrackingChain).toBeNull();

		// Later store changes never call its onStoreChange.
		store.findOne('todo', 't1').update({ text: 'changed' });
		store.findOne('user', 'u1').update({ name: 'y' });
		store.flush();
		expect(view.onStoreChange).not.toHaveBeenCalled();
	});

	it('a destroyed subscriber deferred behind an in-flight async chain never subscribes when its retry fires', async () => {
		// FIX: the deferred-retry path re-enters withTracking fresh; a subscriber
		// destroyed while queued must be caught by the entry liveness probe.
		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.createRecord('user', { id: 'u1' });
		store.flush();

		// Hold an async chain in flight.
		let releaseChain;
		const gate = new Promise((r) => (releaseChain = r));
		const holder = { onStoreChange: vi.fn() };
		const inFlight = store.withTracking(
			holder,
			async () => { store.findMany('todo'); await gate; },
			true
		);

		// A second async eval for `view` DEFERS behind the chain (expectsAsync=true).
		const view = {
			_destroyed: false,
			get isDestroyed() { return this._destroyed; },
			onStoreChange: vi.fn(),
		};
		const deferred = store.withTracking(
			view,
			async () => { store.findOne('user', 'u1'); return store.findMany('todo'); },
			true
		);

		// Destroy the view WHILE it is still queued (its fn has not run yet).
		view._destroyed = true;
		store.unsubscribe(view); // no keys held yet

		releaseChain();
		await inFlight;
		await deferred;

		// The retry hit the entry probe: fn ran untracked, so no key subscribed view.
		expect(store.keysBySubscriber.has(view)).toBe(false);
		expect(store.subscribersByKey.get('user u1')?.has(view) ?? false).toBe(false);
		expect(store.subscribersByKey.get('todo')?.has(view) ?? false).toBe(false);
		expect(store._asyncTrackingChain).toBeNull();

		// holder still owns its subscription; view never notifies.
		expect(store.subscribersByKey.get('todo')?.has(holder)).toBe(true);
		store.findOne('user', 'u1').update({ name: 'z' });
		store.flush();
		expect(view.onStoreChange).not.toHaveBeenCalled();
	});

	it('unsubscribe removes an emptied key from subscribersByKey (no unbounded growth)', () => {
		const store = makeStore();
		const component = { onStoreChange: vi.fn() };

		store.withTracking(component, () => store.findOne('todo', 't1'));
		expect(store.subscribersByKey.has('todo t1')).toBe(true);

		store.unsubscribe(component);
		// The now-empty key set is deleted rather than left as a dangling Set.
		expect(store.subscribersByKey.has('todo t1')).toBe(false);
	});

	it("a tracked eval that THROWS keeps the subscriber's last-good subscriptions", () => {
		const store = makeStore();
		store.createRecord('todo', { id: 'ok', text: 'ok' });
		store.flush();
		const view = { onStoreChange: vi.fn() };

		// good refresh: subscribe to record 'ok'
		store.withTracking(view, () => store.findOne('todo', 'ok'));
		expect(store.keysBySubscriber.get(view)).toEqual(new Set(['todo ok']));

		// a refresh whose data() throws AFTER querying a different record
		expect(() =>
			store.withTracking(view, () => {
				store.findOne('todo', 'bad');
				throw new Error('boom');
			})
		).toThrow('boom');

		// last-good sub survives; the failed query's partial sub is rolled back
		expect(store.keysBySubscriber.get(view)).toEqual(new Set(['todo ok']));
		expect(store.subscribersByKey.has('todo bad')).toBe(false);
		expect(store._tracking).toBeFalsy();

		// the still-subscribed record still notifies the mounted view
		store.findOne('todo', 'ok').update({ text: 'changed' });
		store.flush();
		expect(view.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('a tracked eval that REJECTS keeps last-good subs and clears the async chain', async () => {
		const store = makeStore();
		store.createRecord('todo', { id: 'ok', text: 'ok' });
		store.flush();
		const view = { onStoreChange: vi.fn() };

		store.withTracking(view, () => store.findOne('todo', 'ok'));
		expect(store.keysBySubscriber.get(view)).toEqual(new Set(['todo ok']));

		await expect(
			store.withTracking(view, async () => {
				store.findOne('todo', 'bad');
				await Promise.resolve();
				throw new Error('async boom');
			})
		).rejects.toThrow('async boom');

		expect(store.keysBySubscriber.get(view)).toEqual(new Set(['todo ok']));
		expect(store.subscribersByKey.has('todo bad')).toBe(false);
		expect(store._asyncTrackingChain).toBeNull();
		expect(store._tracking).toBeFalsy();
	});

	it('a successful eval after a failed one replaces subscriptions normally', () => {
		const store = makeStore();
		const view = { onStoreChange: vi.fn() };

		store.withTracking(view, () => store.findMany('todo'));
		expect(store.keysBySubscriber.get(view)).toEqual(new Set(['todo']));

		expect(() =>
			store.withTracking(view, () => {
				store.findMany('other');
				throw new Error('x');
			})
		).toThrow();
		// the failed eval rolled back only its own add; the original stands
		expect(store.keysBySubscriber.get(view)).toEqual(new Set(['todo']));

		// a later successful eval swaps to its new query set
		store.withTracking(view, () => store.findMany('other'));
		expect(store.keysBySubscriber.get(view)).toEqual(new Set(['other']));
	});

	it('notifications are batched asynchronously when flush() is not forced', async () => {
		const store = makeStore();
		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findMany('todo'));

		store.createRecord('todo', { text: 'x' });
		expect(component.onStoreChange).not.toHaveBeenCalled(); // not synchronous

		await new Promise((r) => setTimeout(r, 10));
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('a synchronously throwing subscriber is logged and does NOT abort the rest of the flush', () => {
		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const thrower = vi.fn(() => {
			throw new Error('subscriber boom');
		});
		const later = vi.fn();
		// thrower subscribes first, so it runs first in the shared 'todo' key's set
		store.withTracking(thrower, () => store.findMany('todo'));
		store.withTracking(later, () => store.findMany('todo'));

		store.findOne('todo', 't1').update({ text: 'y' });
		expect(() => store.flush()).not.toThrow(); // throw contained, not propagated
		expect(thrower).toHaveBeenCalledTimes(1);
		expect(later).toHaveBeenCalledTimes(1); // reached despite the earlier throw
		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] store subscriber failed:',
			expect.any(Error)
		);
		errSpy.mockRestore();
	});

	it('a function subscriber returning a rejected promise is logged (no unhandled rejection)', async () => {
		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rejecter = vi.fn(() => Promise.reject(new Error('async subscriber boom')));
		store.withTracking(rejecter, () => store.findMany('todo'));

		store.findOne('todo', 't1').update({ text: 'y' });
		store.flush();
		await new Promise((r) => setTimeout(r, 0)); // let the rejection settle

		expect(rejecter).toHaveBeenCalledTimes(1);
		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] store subscriber failed:',
			expect.any(Error)
		);
		errSpy.mockRestore();
	});

	it('dedup survives: a subscriber matching multiple pending keys still runs once per flush', () => {
		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'a' });
		store.createRecord('todo', { id: 't2', text: 'b' });
		store.flush();

		const fn = vi.fn();
		// subscribe to both record keys AND the collection key
		store.withTracking(fn, () => {
			store.findMany('todo');
			store.findOne('todo', 't1');
			store.findOne('todo', 't2');
		});

		// change both records → several pending keys all resolve to the same fn
		store.findOne('todo', 't1').update({ text: 'a2' });
		store.findOne('todo', 't2').update({ text: 'b2' });
		store.flush();
		expect(fn).toHaveBeenCalledTimes(1);
	});
});

describe('Store — optional persistence', () => {
	const fakeStorage = () => {
		const data = new Map();
		return {
			getItem: (k) => data.get(k) ?? null,
			setItem: (k, v) => data.set(k, v),
		};
	};

	it('round-trips records through storage, rehydrating real model instances', () => {
		const storage = fakeStorage();
		const store = makeStore({ storage });
		store.createRecord('todo', { id: 't1', text: 'persist me', completed: true });
		store.flush(); // persistence is batched into flush() — force the write now

		const revived = makeStore({ storage });
		const todo = revived.findOne('todo', 't1');
		expect(todo).toBeInstanceOf(Todo);
		expect(todo.text).toBe('persist me');
		expect(todo.completed).toBe(true);
		expect(() => todo.toggle()).not.toThrow(); // instance methods survive
	});

	it('ignores corrupt storage content', () => {
		const storage = fakeStorage();
		storage.setItem('puzzle-store', '{not json');
		expect(() => makeStore({ storage })).not.toThrow();
		expect(makeStore({ storage }).findMany('todo')).toHaveLength(0);
	});

	it('hydrates as empty (no throw) when the persisted JSON is not a plain object', () => {
		// 'null' parses fine but Object.entries(null) would throw; arrays/primitives
		// would iterate garbage — all must fail-soft to an empty store (FIX).
		for (const blob of ['null', '[1]', '"str"', '42', 'true']) {
			const storage = fakeStorage();
			storage.setItem('puzzle-store', blob);
			let store;
			expect(() => { store = makeStore({ storage }); }).not.toThrow();
			expect(store.findMany('todo')).toHaveLength(0);
		}
	});

	it('hydration skips non-object records within a type, keeping only the good ones (no throw)', () => {
		// A null/string/array entry mixed into a type's array would slip through
		// _instantiate as a garbage record; each is skipped fail-soft (FIX).
		const storage = fakeStorage();
		storage.setItem(
			'puzzle-store',
			JSON.stringify({ todo: [null, 'bad', ['x'], { id: 'good', text: 'kept' }] })
		);
		let store;
		expect(() => { store = makeStore({ storage }); }).not.toThrow();
		expect(store.findMany('todo')).toHaveLength(1);
		expect(store.findOne('todo', 'good').text).toBe('kept');
	});

	it('does not persist when no storage is configured', () => {
		const store = makeStore();
		expect(() => store.createRecord('todo', { text: 'x' })).not.toThrow();
	});
});

describe('Store — server read path (D21)', () => {
	class ApiTodo extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			text: Puzzle.string().required(),
			completed: Puzzle.boolean().default(false),
		};
		static adapter = { endpoint: '/api/todos' };
	}

	const apiStore = () => new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1' });

	const mockFetch = (payload, ok = true, status = 200) => {
		const fn = vi.fn(async () => ({
			ok,
			status,
			statusText: ok ? 'OK' : 'Server Error',
			json: async () => payload,
		}));
		vi.stubGlobal('fetch', fn);
		return fn;
	};

	it('loadAll fetches apiURL + endpoint and creates real model instances', async () => {
		const fetchSpy = mockFetch([
			{ id: 't1', text: 'from server', completed: true },
			{ id: 't2', text: 'also server' },
		]);
		const store = apiStore();

		const records = await store.loadAll('todo');
		expect(fetchSpy).toHaveBeenCalledWith('https://x.test/v1/api/todos');
		expect(records).toHaveLength(2);
		expect(store.findOne('todo', 't1')).toBeInstanceOf(ApiTodo);
		expect(store.findOne('todo', 't2').completed).toBe(false); // schema default applied
		vi.unstubAllGlobals();
	});

	it('loadAll upserts: matching primary keys update in place, no duplicates', async () => {
		mockFetch([{ id: 't1', text: 'server version' }]);
		const store = apiStore();
		const local = store.createRecord('todo', { id: 't1', text: 'local version' });

		await store.loadAll('todo');
		expect(store.findMany('todo')).toHaveLength(1); // no dupe
		expect(store.findOne('todo', 't1')).toBe(local); // same instance, updated
		expect(local.text).toBe('server version');
		vi.unstubAllGlobals();
	});

	it('loaded data notifies subscribed components', async () => {
		mockFetch([{ id: 't1', text: 'x' }]);
		const store = apiStore();
		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findMany('todo'));

		await store.loadAll('todo');
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it('loadOne fetches endpoint/id and upserts the single record', async () => {
		const fetchSpy = mockFetch({ id: 't9', text: 'just one' });
		const store = apiStore();

		const record = await store.loadOne('todo', 't9');
		expect(fetchSpy).toHaveBeenCalledWith('https://x.test/v1/api/todos/t9');
		expect(record.text).toBe('just one');
		expect(store.findOne('todo', 't9')).toBe(record);
		vi.unstubAllGlobals();
	});

	it('loadOne rejects on a null body and inserts nothing', async () => {
		mockFetch(null); // 200 with a null body
		const store = apiStore();
		await expect(store.loadOne('todo', 't9')).rejects.toThrow(
			/loadOne\('todo', id\) expected a JSON object/
		);
		expect(store.findMany('todo')).toHaveLength(0);
		vi.unstubAllGlobals();
	});

	it('loadOne rejects on an array body and inserts nothing', async () => {
		mockFetch([{ id: 't9', text: 'x' }]); // wrong shape: an array
		const store = apiStore();
		await expect(store.loadOne('todo', 't9')).rejects.toThrow(/expected a JSON object/);
		expect(store.findMany('todo')).toHaveLength(0);
		vi.unstubAllGlobals();
	});

	it('loadAll rejects on any non-object element and inserts nothing (whole response)', async () => {
		mockFetch([null, 'bad', { id: 'good', text: 'x' }]); // one null, one string, one good
		const store = apiStore();
		await expect(store.loadAll('todo')).rejects.toThrow(
			/loadAll\('todo'\) expected an array of JSON objects/
		);
		// the per-element guard runs up front, before any upsert — not even the
		// good element half-applies from a mid-array failure
		expect(store.findMany('todo')).toHaveLength(0);
		vi.unstubAllGlobals();
	});

	it('rejects with a clear message when the model declares no adapter', async () => {
		mockFetch([]);
		const store = makeStore(); // Todo has no static adapter
		await expect(store.loadAll('todo')).rejects.toThrow(/no adapter declared for 'todo'/);
		vi.unstubAllGlobals();
	});

	it('rejects on non-OK responses with the status', async () => {
		mockFetch(null, false, 503);
		const store = apiStore();
		await expect(store.loadAll('todo')).rejects.toThrow(/503/);
		vi.unstubAllGlobals();
	});
});

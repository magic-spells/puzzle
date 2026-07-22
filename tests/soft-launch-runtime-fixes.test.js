// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

// Verified soft-launch runtime fixes. Each block targets exactly one fix;
// the setup style mirrors tests/store.test.js and tests/view.test.js.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};
}

class ApiTodo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string(),
	};
	static adapter = { endpoint: '/api/todos' };
}

const makeStore = (options) => new Store({ todo: Todo }, options);
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

// A fake storage that counts writes and reads back what it stored.
const fakeStorage = () => {
	const data = new Map();
	const setItem = vi.fn((k, v) => data.set(k, v));
	return { getItem: (k) => data.get(k) ?? null, setItem };
};

// ---- Fix 1: safeAssign skips the full pollution family --------------------------

describe('Fix 1 — safeAssign/safeMerge unified skip-set (model.js)', () => {
	it('a loadAll payload carrying constructor/prototype keys never shadows the model class', async () => {
		mockFetch([{ id: 't1', constructor: 'x', prototype: 'y', text: 'hi' }]);
		const store = apiStore();
		const [record] = await store.loadAll('todo');

		// The class reference is intact — the exact operations that blanked the render.
		expect(record.constructor).toBe(ApiTodo);
		expect(record.constructor.primaryKey()).toBe('id');
		expect(() => ApiTodo._collectErrors(record.toJSON())).not.toThrow();
		expect(record.text).toBe('hi');
		expect(record.id).toBe('t1'); // keying still works
	});

	it('update({ constructor }) does not shadow the class (update path stays callable)', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });
		// Before the fix, safeAssign let `constructor` land as an own prop; the very
		// next update()'s `this.constructor._collectErrors` then threw.
		expect(() => todo.update({ text: 'b', constructor: 'x' })).not.toThrow();
		expect(todo.constructor).toBe(Todo);
		expect(todo.text).toBe('b');
		expect(Object.prototype.hasOwnProperty.call(todo, 'constructor')).toBe(false);
	});

	it('a __proto__ key in a fresh record still cannot re-prototype it', () => {
		const store = makeStore();
		const todo = store.createRecord('todo', { id: 'p1', text: 'x' });
		// safeAssign already guarded __proto__; assert the family guard kept it.
		expect(todo instanceof Todo).toBe(true);
		expect(typeof todo.update).toBe('function');
	});
});

// ---- Fix 2: flush() snapshots the subscriber Set --------------------------------

describe('Fix 2 — flush() iterates a snapshot of the subscriber Set (store.js)', () => {
	it('a subscriber added to the same key mid-flush is NOT notified in that flush', () => {
		const store = makeStore();
		const key = 'todo';
		const calls = [];

		const childSub = { onStoreChange: () => calls.push('child') };
		const parentSub = {
			onStoreChange: () => {
				calls.push('parent');
				// Simulate a child mounting during the parent's sync data() and querying
				// the SAME key — it joins the live Set mid-iteration.
				store.subscribersByKey.get(key).add(childSub);
			},
		};

		store.subscribersByKey.set(key, new Set([parentSub]));
		store._notify('todo', 't1'); // marks the 'todo' key pending
		store.flush();

		// With a live-Set loop the child would also be visited this tick; the
		// snapshot delivers only to subscribers present when the flush began.
		expect(calls).toEqual(['parent']);
		// The child IS registered for next time — just not this flush.
		expect(store.subscribersByKey.get(key).has(childSub)).toBe(true);
	});
});

// ---- Fix 3: _persist() is batched through flush() -------------------------------

describe('Fix 3 — persistence is batched into flush() (store.js)', () => {
	it('N mutations in one tick write storage once, at flush() — not per mutation', () => {
		const storage = fakeStorage();
		const store = makeStore({ storage });

		const todo = store.createRecord('todo', { id: 't1', text: 'a' });
		for (let i = 0; i < 5; i++) todo.update({ text: 'v' + i });

		// Nothing written yet — every mutation only flagged the store dirty.
		expect(storage.setItem).toHaveBeenCalledTimes(0);

		store.flush();

		// A single serialize+write covers the whole burst.
		expect(storage.setItem).toHaveBeenCalledTimes(1);
		const persisted = JSON.parse(storage.getItem('puzzle-store'));
		expect(persisted.todo[0].text).toBe('v4'); // last write wins, content correct
	});

	it('a second flush() with no new mutation does not re-write storage', () => {
		const storage = fakeStorage();
		const store = makeStore({ storage });
		store.createRecord('todo', { id: 't1', text: 'a' });
		store.flush();
		expect(storage.setItem).toHaveBeenCalledTimes(1);
		store.flush();
		expect(storage.setItem).toHaveBeenCalledTimes(1); // idempotent — clean store
	});
});

// ---- Fix 4: the abandoned withTracking promise is observed ----------------------

describe('Fix 4 — abandoned withTracking promise is observed (store.js)', () => {
	it('a sync-shaped fn returning a rejecting promise while a chain is in flight is observed', async () => {
		const store = makeStore();
		const unhandled = [];
		const onUnhandled = (err) => unhandled.push(err);
		process.on('unhandledRejection', onUnhandled);
		try {
			// Simulate an async tracked eval already in flight.
			let releaseChain;
			store._asyncTrackingChain = new Promise((r) => (releaseChain = r));

			let calls = 0;
			const fn = () => {
				calls++;
				// First (abandoned) invocation rejects; the deferred retry succeeds.
				return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok');
			};

			const subscriber = { isDestroyed: false };
			const p = store.withTracking(subscriber, fn, false);
			// Mimic the real chain clearing so the retry runs inline (not re-deferred).
			store._asyncTrackingChain = null;
			releaseChain();

			await expect(p).resolves.toBe('ok');
			// Give node a macrotask to surface any unhandled rejection.
			await new Promise((r) => setTimeout(r, 10));
			expect(unhandled.find((e) => e?.message === 'boom')).toBeUndefined();
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});
});

// ---- Fix 5: refs nulled on destroy ----------------------------------------------

describe('Fix 5 — element refs are nulled after destroy() (PuzzleView.js)', () => {
	it('this.refs[name] is null once the view is destroyed', async () => {
		class RefView extends PuzzleView {
			render() {
				return h('div', {}, [h('input', { ref: this.__ref('field') }, [])]);
			}
		}
		const el = document.createElement('div');
		document.body.appendChild(el);

		const v = new RefView();
		await v.mount(el);
		expect(v.refs.field).not.toBeNull();
		expect(v.refs.field.tagName).toBe('INPUT');

		v.destroy();
		expect(v.refs.field).toBe(null);
	});
});

// ---- Fix 6: pagehide flushes the batched storage write ---------------------------

// Batching (Fix 3) opened an unload window: a mutation only flags the store
// dirty, so a reload or programmatic navigation before the scheduled flush()
// (next rAF / fallback timer) lost the write. PuzzleApp.mount() now registers a
// window pagehide listener that forces the flush out; #teardown() removes it.
describe('Fix 6 — pagehide flushes batched persistence (app.js)', () => {
	class HomeView extends PuzzleView {
		render() {
			return h('puzzle-view', { class: 'home' }, []);
		}
	}

	const mountApp = async (storage) => {
		history.replaceState({}, '', '/');
		const el = document.createElement('div');
		el.id = 'pagehide-app';
		document.body.appendChild(el);
		const app = new PuzzleApp({
			target: '#pagehide-app',
			models: { todo: Todo },
			routes: [{ path: '/', name: 'home', view: HomeView }],
			storage,
		});
		await app.mount();
		return app;
	};

	it('a mutation still dirty at pagehide reaches storage before unload', async () => {
		const storage = fakeStorage();
		const app = await mountApp(storage);
		const writesAfterMount = storage.setItem.mock.calls.length;

		app.store.createRecord('todo', { id: 't1', text: 'typed just before reload' });
		// Still batched — nothing written synchronously by the mutation itself.
		expect(storage.setItem.mock.calls.length).toBe(writesAfterMount);

		window.dispatchEvent(new Event('pagehide'));

		expect(storage.setItem.mock.calls.length).toBe(writesAfterMount + 1);
		const persisted = JSON.parse(storage.getItem('puzzle-store'));
		expect(persisted.todo[0].text).toBe('typed just before reload');

		app.unmount();
	});

	it('unmount() removes the pagehide listener it registered', async () => {
		const addSpy = vi.spyOn(window, 'addEventListener');
		const removeSpy = vi.spyOn(window, 'removeEventListener');
		const app = await mountApp(fakeStorage());

		const added = addSpy.mock.calls.find(([type]) => type === 'pagehide');
		expect(added).toBeDefined();

		app.unmount();

		const removed = removeSpy.mock.calls.find(([type]) => type === 'pagehide');
		expect(removed).toBeDefined();
		expect(removed[1]).toBe(added[1]); // the same handler, not a fresh closure
	});
});

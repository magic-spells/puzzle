// @vitest-environment jsdom
//
// v1.25 — state-preserving dev reload (constellation/doc/DOC-SPEC.md §27, D57).
//
// `puzzle dev`'s injected client calls window.__PUZZLE_APP__.__devSnapshot()
// right before location.reload(); the freshly booted app restores the one-shot
// sessionStorage blob at the end of mount(). These tests exercise the runtime
// half end-to-end (unbundled, so __PUZZLE_DEV__ is undefined → DEV = true) plus
// the JSON-safe view-state filter in isolation.
//
// Runtime note: unbundled under vitest there is no esbuild Define, so the DEV
// guard's `typeof __PUZZLE_DEV__ === 'undefined'` probe evaluates to true and
// every hook is live — exactly the dev-build behavior.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { safeState } from '../client-runtime/devstate.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const HMR_KEY = '__puzzleHMR';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};
}

// A routed view that reads its own local state back through getData() (the
// documented read-back idiom) and derives a store query. data() does NOT re-run
// on setData, so the restored setData state shows through directly.
let lastEditor = null;
class EditorView extends PuzzleView {
	data() {
		const s = this.getData();
		return {
			draft: s.draft ?? '',
			pinned: s.pinned ?? false,
			todos: this.ctx.store.findMany('todo'),
		};
	}
	mounted() {
		lastEditor = this;
	}
	render() {
		return h('puzzle-view', { class: 'editor' }, [text(this.getData().draft)]);
	}
}

const routes = [{ path: '/', name: 'home', view: EditorView }];

// A view whose visible content is DERIVED from a store query — no setData state of
// its own. Proves the two-phase restore (Change D): phase 1 transplants the store
// records BEFORE navigation #0, so this view's first render already shows them
// (the masked bug the old single-phase restore left empty until the next mutation).
let lastStoreView = null;
class StoreListView extends PuzzleView {
	data() {
		const todos = this.ctx.store.findMany('todo');
		return { todos, count: todos.length };
	}
	mounted() {
		lastStoreView = this;
	}
	render() {
		const { todos } = this.getData();
		return h(
			'ul',
			{},
			todos.map((t) => h('li', { key: t.id }, [text(t.text)]))
		);
	}
}
const storeRoutes = [{ path: '/', name: 'home', view: StoreListView }];
function makeStoreApp(extra = {}) {
	const app = new PuzzleApp({ target: '#app', routes: storeRoutes, models: { todo: Todo }, ...extra });
	apps.push(app);
	return app;
}

const container = () => {
	const el = document.createElement('div');
	el.id = 'app';
	document.body.appendChild(el);
	return el;
};

let apps = [];
function make() {
	const app = new PuzzleApp({ target: '#app', routes, models: { todo: Todo } });
	apps.push(app);
	return app;
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
	sessionStorage.clear();
	window.__PUZZLE_APP__ = undefined;
	lastEditor = null;
	lastStoreView = null;
});

afterEach(() => {
	apps.forEach((a) => a.unmount());
	apps = [];
	sessionStorage.clear();
});

describe('HMR dev reload — snapshot/restore transplant (§27, D57)', () => {
	it('transplants store records and view form state across a snapshot → unmount → fresh mount', async () => {
		container();
		const app = make();
		await app.mount();

		// Runtime store records + local form state.
		app.store.createRecord('todo', { id: 't1', text: 'ship v1.25' });
		app.store.createRecord('todo', { id: 't2', text: 'write tests', completed: true });
		lastEditor.setData({ draft: 'half-typed message', pinned: true });

		// The dev client's pre-reload snapshot, then the reload (modeled as
		// unmount + a brand-new app with the same config).
		app.__devSnapshot();
		app.unmount();

		container();
		const fresh = make();
		await fresh.mount();

		// Store contents survived (validation-exempt hydration).
		const todos = fresh.store.findMany('todo');
		expect(todos).toHaveLength(2);
		expect(fresh.store.findOne('todo', 't1').text).toBe('ship v1.25');
		expect(fresh.store.findOne('todo', 't2').completed).toBe(true);

		// The view's local setData state was restored onto the fresh instance.
		expect(lastEditor.getData().draft).toBe('half-typed message');
		expect(lastEditor.getData().pinned).toBe(true);
	});

	it('is one-shot: the blob is deleted on restore and a second fresh mount cold-starts', async () => {
		container();
		const app = make();
		await app.mount();
		lastEditor.setData({ draft: 'keep me' });
		app.__devSnapshot();
		expect(sessionStorage.getItem(HMR_KEY)).not.toBeNull(); // written
		app.unmount();

		container();
		const fresh = make();
		await fresh.mount();
		expect(lastEditor.getData().draft).toBe('keep me'); // restored
		expect(sessionStorage.getItem(HMR_KEY)).toBeNull(); // one-shot: deleted

		// A subsequent boot with no snapshot cold-starts (no stale restore).
		fresh.unmount();
		container();
		const cold = make();
		await cold.mount();
		expect(lastEditor.getData().draft).toBe(''); // default, nothing restored
	});

	it('discards a snapshot older than ~10s (a manual F5 cold-starts), deleting it', async () => {
		sessionStorage.setItem(
			HMR_KEY,
			JSON.stringify({
				t: Date.now() - 20_000, // stale
				store: { todo: [{ id: 't1', text: 'stale', completed: false }] },
				views: [{ key: 'EditorView:0', data: { draft: 'stale draft' } }],
			})
		);

		container();
		const app = make();
		await app.mount();

		expect(lastEditor.getData().draft).toBe(''); // expired → not restored
		expect(app.store.findMany('todo')).toHaveLength(0); // store not hydrated
		expect(sessionStorage.getItem(HMR_KEY)).toBeNull(); // still deleted (one-shot)
	});

	it('cold-starts fail-soft on a corrupt blob and still deletes it', async () => {
		sessionStorage.setItem(HMR_KEY, '{not valid json,,,');

		container();
		const app = make();
		await expect(app.mount()).resolves.toBe(app); // no throw
		expect(lastEditor.getData().draft).toBe('');
		expect(sessionStorage.getItem(HMR_KEY)).toBeNull();
	});

	it('cold-starts fail-soft on a well-formed-JSON blob with wrong shapes', async () => {
		sessionStorage.setItem(
			HMR_KEY,
			JSON.stringify({ t: Date.now(), store: 'not-an-object', views: 'not-an-array' })
		);

		container();
		const app = make();
		await expect(app.mount()).resolves.toBe(app);
		expect(lastEditor.getData().draft).toBe('');
		expect(app.store.findMany('todo')).toHaveLength(0);
		expect(sessionStorage.getItem(HMR_KEY)).toBeNull();
	});

	it('publishes window.__PUZZLE_APP__ on mount and clears it on unmount', async () => {
		container();
		const app = make();
		await app.mount();
		expect(window.__PUZZLE_APP__).toBe(app);

		app.unmount();
		expect(window.__PUZZLE_APP__).toBeNull();
	});

	it('does not throw when sessionStorage is unavailable', async () => {
		container();
		const app = make();
		await app.mount();
		lastEditor.setData({ draft: 'x' });

		const desc = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
		try {
			Object.defineProperty(window, 'sessionStorage', {
				configurable: true,
				get() {
					throw new Error('sessionStorage unavailable');
				},
			});
			expect(() => app.__devSnapshot()).not.toThrow();
		} finally {
			Object.defineProperty(window, 'sessionStorage', desc);
		}
	});
});

describe('HMR dev reload — two-phase restore (§27, D57; Change D)', () => {
	it('a view rendering findMany results shows the restored records in its FIRST paint (store restored before nav #0)', async () => {
		// THE masked bug: the old single-phase restore hydrated the store AFTER
		// router.start(), so a view that queried during navigation #0 rendered
		// empty/stale until the next mutation. Phase 1 now transplants the store
		// BEFORE start() — the first paint must already show the records, with no
		// flush and no store mutation after mount.
		// One container for both apps: `target: '#app'` resolves via querySelector,
		// which finds the FIRST #app — unmount() empties it but leaves it in the DOM.
		const el = container();
		const app = makeStoreApp();
		await app.mount();
		app.store.createRecord('todo', { id: 't1', text: 'restored-one' });
		app.store.createRecord('todo', { id: 't2', text: 'restored-two' });
		app.__devSnapshot();
		app.unmount();

		const fresh = makeStoreApp();
		await fresh.mount();

		// Immediately after mount() resolves — nav #0's data() saw the records.
		const items = el.querySelectorAll('li');
		expect(items).toHaveLength(2);
		expect(el.textContent).toContain('restored-one');
		expect(el.textContent).toContain('restored-two');
	});

	it('a primitive derived from a store query is recomputed, not restored as local state', async () => {
		container();
		const app = makeStoreApp();
		await app.mount();
		app.store.createRecord('todo', { id: 't1', text: 'a' });
		app.store.createRecord('todo', { id: 't2', text: 'b' });
		app.__devSnapshot();

		// The snapshot serializes ONLY the local setData layer (Change C's
		// _localState reader): data()-derived values — `count`, `todos` — must not
		// be pinned into the blob as if they were local drafts.
		const blob = JSON.parse(sessionStorage.getItem(HMR_KEY));
		const entry = blob.views.find((v) => v.key === 'StoreListView:0');
		expect(entry).toBeTruthy();
		expect('count' in entry.data).toBe(false);
		expect('todos' in entry.data).toBe(false);

		app.unmount();
		container();
		const fresh = makeStoreApp();
		await fresh.mount();

		// count was RECOMPUTED against the transplanted store...
		expect(lastStoreView.getData().count).toBe(2);
		// ...and stays live-derived: a post-restore mutation updates it (a pinned
		// local value would have gone stale here).
		fresh.store.createRecord('todo', { id: 't3', text: 'c' });
		fresh.store.flush();
		expect(lastStoreView.getData().count).toBe(3);
	});

	it('HMR snapshot records override duplicate-pk records loaded from configured persistence', async () => {
		// A `storage:`-configured app hydrates persisted records during Store
		// construction — BEFORE phase 1 runs. For a duplicate primary key the HMR
		// snapshot must WIN (replace mode overwrites fields in place), or the just-
		// edited session's state would lose to an older persisted copy on reload.
		const backing = new Map();
		const fakeStorage = {
			getItem: (k) => backing.get(k) ?? null,
			setItem: (k, v) => backing.set(k, v),
			removeItem: (k) => backing.delete(k),
		};
		backing.set(
			'puzzle-store',
			JSON.stringify({
				todo: [{ id: 't1', text: 'persisted-stale', completed: false, __synced: true }],
			})
		);
		sessionStorage.setItem(
			HMR_KEY,
			JSON.stringify({
				t: Date.now(),
				store: { todo: [{ id: 't1', text: 'hmr-fresh', completed: true, __synced: false }] },
				views: [],
			})
		);

		const el = container();
		const app = makeStoreApp({ storage: fakeStorage });
		await app.mount();

		// One record, the snapshot's fields, visible in the first paint.
		expect(app.store.findMany('todo')).toHaveLength(1);
		const rec = app.store.findOne('todo', 't1');
		expect(rec.text).toBe('hmr-fresh');
		expect(rec.completed).toBe(true);
		// Provenance marker respected in replace mode too (§22, D50): the snapshot
		// says never-synced, overriding the persisted copy's synced=true.
		expect(rec._synced).toBe(false);
		expect(el.textContent).toContain('hmr-fresh');
		expect(el.textContent).not.toContain('persisted-stale');
	});

	it('normal persistence hydration keeps skip-duplicate behavior (no HMR blob involved)', async () => {
		// Regression guard for the _hydrateAll mode split: _load still hydrates in
		// SKIP mode — a duplicate pk inside the persisted blob keeps the FIRST record.
		const backing = new Map();
		const fakeStorage = {
			getItem: (k) => backing.get(k) ?? null,
			setItem: (k, v) => backing.set(k, v),
			removeItem: (k) => backing.delete(k),
		};
		backing.set(
			'puzzle-store',
			JSON.stringify({
				todo: [
					{ id: 't1', text: 'first-wins', completed: false, __synced: true },
					{ id: 't1', text: 'dup-skipped', completed: true, __synced: true },
				],
			})
		);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			container();
			const app = makeStoreApp({ storage: fakeStorage });
			await app.mount();
			expect(app.store.findMany('todo')).toHaveLength(1);
			expect(app.store.findOne('todo', 't1').text).toBe('first-wins');
			expect(warn).toHaveBeenCalled(); // the skip-dup warning still fires
		} finally {
			warn.mockRestore();
		}
	});

	it('local drafts still survive alongside the store transplant (both phases land)', async () => {
		container();
		const app = make(); // EditorView: local draft + a store query
		await app.mount();
		app.store.createRecord('todo', { id: 't1', text: 'in-store' });
		lastEditor.setData({ draft: 'mid-edit draft' });
		app.__devSnapshot();
		app.unmount();

		container();
		const fresh = make();
		await fresh.mount();
		expect(fresh.store.findOne('todo', 't1').text).toBe('in-store'); // phase 1
		expect(lastEditor.getData().draft).toBe('mid-edit draft'); // phase 2
	});
});

describe('HMR view-state filter — safeState (§27, D57)', () => {
	it('keeps JSON-safe primitives, nested plain objects, and plain arrays', () => {
		const out = safeState({
			draft: 'hello',
			count: 42,
			open: true,
			nothing: null,
			tags: ['a', 'b', 3],
			nested: { x: 1, y: { z: [true, false] } },
		});
		expect(out).toEqual({
			draft: 'hello',
			count: 42,
			open: true,
			nothing: null,
			tags: ['a', 'b', 3],
			nested: { x: 1, y: { z: [true, false] } },
		});
	});

	it('drops store records (class instances) by omitting the key', () => {
		const store = new (class extends Object {})();
		class Rec {
			constructor() {
				this.id = 't1';
			}
		}
		const out = safeState({ draft: 'keep', record: new Rec(), store });
		expect(out).toEqual({ draft: 'keep' });
		expect('record' in out).toBe(false);
		expect('store' in out).toBe(false);
	});

	it('drops functions, symbols, DOM nodes, and non-finite numbers by omitting the key', () => {
		const out = safeState({
			ok: 1,
			fn: () => {},
			sym: Symbol('s'),
			node: document.createElement('div'),
			nan: NaN,
			inf: Infinity,
		});
		expect(out).toEqual({ ok: 1 });
	});

	it('drops an array that holds a droppable element (positional shape cannot survive omissions)', () => {
		const out = safeState({ good: [1, 2], bad: [1, () => {}, 3] });
		expect(out).toEqual({ good: [1, 2] });
		expect('bad' in out).toBe(false);
	});

	it('is cycle-safe: a self-referential object does not loop and the cycle key is dropped', () => {
		const a = { name: 'a' };
		a.self = a;
		const out = safeState({ wrap: a, plain: 'v' });
		// `plain` survives; `wrap` recurses (name kept, self-cycle dropped).
		expect(out.plain).toBe('v');
		expect(out.wrap).toEqual({ name: 'a' });
	});

	it('caps deep nesting rather than recursing without bound', () => {
		let deep = { v: 'bottom' };
		for (let i = 0; i < 20; i++) deep = { child: deep };
		// Should not throw; the over-cap subtree is dropped, leaving a shallow shell.
		expect(() => safeState(deep)).not.toThrow();
	});
});

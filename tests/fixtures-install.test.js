// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp, PuzzleView, ViewNode } from '../client-runtime/index.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { installFixtures } from '../client-runtime/fixtures/index.js';

// D98/D157: fixtures + the adapter mock are a DETACHABLE module. /fixtures
// imports the adapter runtime so Store._network exists; installFixtures()
// attaches seed()/resetFixtureSeed(), replaces _network, and wraps
// PuzzleApp.mount so the fixtures config's setup() runs before navigation #0.
// These tests cover the attach/detach contract itself — generation and the mock's
// behavior live in fixtures-seed.test.js and mock-adapter.test.js.

const API = 'https://x.test/v1';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

/** A fresh model class per store, so mock collection state never leaks between tests. */
const modelWith = (mock) => {
	class MockTodo extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			text: Puzzle.string().required(),
		};
		static adapter = { endpoint: '/api/todos', mock };
	}
	return MockTodo;
};

const storeWith = (mock) => new Store({ todo: modelWith(mock) }, { apiURL: API });

let uninstalls;

beforeEach(() => {
	uninstalls = [];
	// The mock's one-time advisory would otherwise noise up every mocked test.
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	for (const uninstall of uninstalls.splice(0).reverse()) uninstall();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** installFixtures + auto-detach, so a failing assertion cannot leak a patch. */
const install = (config) => {
	const uninstall = installFixtures(config);
	uninstalls.push(uninstall);
	return uninstall;
};

describe('install / uninstall — fixture patches are fully detached', () => {
	it('uninstall() restores the installed adapter _network and REMOVES the two attached methods', () => {
		const originalNetwork = Store.prototype._network;
		const originalMount = PuzzleApp.prototype.mount;
		expect(Store.prototype.seed).toBeUndefined();

		const uninstall = installFixtures();
		expect(typeof Store.prototype.seed).toBe('function');
		expect(typeof Store.prototype.resetFixtureSeed).toBe('function');
		expect(Store.prototype._network).not.toBe(originalNetwork);
		expect(PuzzleApp.prototype.mount).not.toBe(originalMount);

		uninstall();

		// seed()/resetFixtureSeed() never existed on the core Store — deleted, not
		// restored to some no-op, so `typeof store.seed` stays an honest probe.
		expect(Store.prototype.seed).toBeUndefined();
		expect(Store.prototype.resetFixtureSeed).toBeUndefined();
		expect(new Store({}).seed).toBeUndefined();
		expect(Store.prototype._network).toBeTypeOf('function');
		if (originalNetwork) expect(Store.prototype._network).toBe(originalNetwork);
		expect(PuzzleApp.prototype.mount).toBe(originalMount);
	});

	it('uninstall() is idempotent', () => {
		const originalNetwork = Store.prototype._network;
		const uninstall = installFixtures();
		uninstall();
		expect(() => uninstall()).not.toThrow();
		expect(Store.prototype._network).toBeTypeOf('function');
		if (originalNetwork) expect(Store.prototype._network).toBe(originalNetwork);
	});

	it('an un-mocked type still reaches the real network through the original _network', async () => {
		install();
		const fetchSpy = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			text: async () => '[]',
			json: async () => [],
		}));
		vi.stubGlobal('fetch', fetchSpy);

		await storeWith(undefined).loadAll('todo');

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0][0]).toBe(`${API}/api/todos`);
	});

	it('a second install replaces the config and uninstall still restores the TRUE originals', async () => {
		const originalNetwork = Store.prototype._network;
		const originalMount = PuzzleApp.prototype.mount;

		installFixtures({ seed: 1, mock: { todo: { data: [{ id: 'a', text: 'first' }] } } });
		installFixtures({ seed: 2, mock: { todo: { data: [{ id: 'b', text: 'second' }] } } });

		// The live config is the second one…
		const store = storeWith(undefined);
		expect((await store.loadAll('todo')).map((r) => r.id)).toEqual(['b']);

		// …and ONE uninstall (the originals were captured once) puts the core back.
		installFixtures({}); // a third install must not re-capture the patched members
		const uninstall = installFixtures({});
		uninstall();

		expect(Store.prototype._network).toBe(originalNetwork);
		expect(PuzzleApp.prototype.mount).toBe(originalMount);
		expect(Store.prototype.seed).toBeUndefined();
	});
});

describe('mock config — model block and fixtures file merge per key', () => {
	it('the fixtures file wins per key over the model adapter.mock', async () => {
		vi.useFakeTimers();
		// The model declares latency; the file overrides failRate only — the merged
		// config must keep the model's latency AND take the file's failure.
		install({ mock: { todo: { failRate: 1 } } });
		const store = storeWith({ data: [{ id: 't1', text: 'a' }], latency: 400 });

		let outcome = null;
		const pending = store.loadAll('todo').then(
			() => (outcome = 'ok'),
			() => (outcome = 'fail')
		);

		await vi.advanceTimersByTimeAsync(399);
		expect(outcome).toBeNull(); // the model's latency survived the merge
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(outcome).toBe('fail'); // the file's failRate won
		vi.useRealTimers();
	});

	it('a fixtures-file entry mocks a model that declares no adapter.mock at all', async () => {
		install({ mock: { todo: { data: [{ id: 't1', text: 'from the file' }] } } });
		const fetchSpy = vi.fn(() => {
			throw new Error('[test] fetch must not be called for a mocked model');
		});
		vi.stubGlobal('fetch', fetchSpy);

		const records = await storeWith(undefined).loadAll('todo');

		expect(records.map((r) => r.text)).toEqual(['from the file']);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('a model block alone still works with no fixtures-file mock', async () => {
		install();
		const records = await storeWith({ data: [{ id: 't1', text: 'from the model' }] }).loadAll(
			'todo'
		);
		expect(records.map((r) => r.text)).toEqual(['from the model']);
	});
});

describe('setup(app) — beforeMount timing, before navigation #0', () => {
	class Home extends PuzzleView {
		data() {
			return { items: this.ctx.store.findMany('note') };
		}

		render() {
			const { items } = this.getData();
			return h(
				'ul',
				{ class: 'notes' },
				items.map((item) => h('li', { key: item.id }, [text(item.title)]))
			);
		}
	}

	class Note extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			title: Puzzle.string().required(),
		};
	}

	const bootApp = async (config = {}) => {
		const container = document.createElement('div');
		const app = new PuzzleApp({
			models: { note: Note },
			routes: [{ path: '/', view: Home }],
			routerMode: 'memory',
			target: container,
			...config,
		});
		await app.mount();
		return { app, container };
	};

	it('records seeded in setup() are visible to the FIRST data()', async () => {
		install({
			setup(app) {
				app.store.seed('note', 3);
			},
		});

		const { app, container } = await bootApp();

		// Navigation #0 already rendered them — no second render was needed.
		expect(container.querySelectorAll('.notes li')).toHaveLength(3);
		app.unmount();
	});

	it('the app’s own beforeMount runs BEFORE setup()', async () => {
		const order = [];
		install({
			async setup() {
				order.push('setup');
			},
		});

		const { app } = await bootApp({
			async beforeMount() {
				order.push('beforeMount');
			},
		});

		expect(order).toEqual(['beforeMount', 'setup']);
		app.unmount();
	});

	it('an async setup() is awaited before navigation #0', async () => {
		install({
			async setup(app) {
				await Promise.resolve();
				app.store.seed('note', 2);
			},
		});

		const { app, container } = await bootApp();
		expect(container.querySelectorAll('.notes li')).toHaveLength(2);
		app.unmount();
	});

	it('a re-mount runs setup once per mount, never stacking wrappers', async () => {
		let calls = 0;
		install({
			setup() {
				calls += 1;
			},
		});

		const { app } = await bootApp();
		expect(calls).toBe(1);

		app.unmount();
		await app.mount();
		expect(calls).toBe(2); // 2, not 3 — the composed hook was reused

		app.unmount();
	});

	it('a config with no setup mounts normally', async () => {
		install({ seed: 7 });
		const { app, container } = await bootApp();
		expect(container.querySelector('.notes')).not.toBeNull();
		app.unmount();
	});
});

describe('installFixtures() argument validation', () => {
	it('rejects a non-object config', () => {
		expect(() => installFixtures(null)).toThrow(TypeError);
		expect(() => installFixtures('seed')).toThrow(/installFixtures/);
		expect(() => installFixtures([])).toThrow(/installFixtures/);
	});

	it('rejects a non-function setup and a non-object mock', () => {
		expect(() => installFixtures({ setup: 'go' })).toThrow(/config.setup/);
		expect(() => installFixtures({ mock: [] })).toThrow(/config.mock/);
	});

	it('a rejected config never patches the core', () => {
		expect(() => installFixtures(null)).toThrow();
		expect(Store.prototype.seed).toBeUndefined();
	});
});

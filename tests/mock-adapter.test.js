import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleAdapterError } from '../client-runtime/datastore/adapter.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { installFixtures } from '../client-runtime/fixtures/index.js';

// Adapter mock (v1.57, D95): `static adapter = { endpoint, mock: {…} }` is served
// from memory by the /fixtures module's replacement of Store._network — the ONE
// seam the opt-in adapter installs (D98/D157). That placement is the whole design:
// loadAll/loadOne/save/delete/request run completely unmodified, so these tests
// exercise the real D21 read path and the real D50 write path (pk adoption, the
// _synced flip, the identity re-checks).

const API = 'https://x.test/v1';

/** A fresh model class per store, so mock collection state never leaks between tests. */
const modelWith = (mock, schema) => {
	class MockTodo extends PuzzleModel {
		static schema = schema || {
			id: Puzzle.string().primary(),
			text: Puzzle.string().required(),
			done: Puzzle.boolean().default(false),
		};
		static adapter = { endpoint: '/api/todos', mock };
	}
	return MockTodo;
};

const storeWith = (mock, options, schema) =>
	new Store({ todo: modelWith(mock, schema) }, { apiURL: API, ...options });

let fetchSpy;
let uninstall;

beforeEach(() => {
	// Interception only exists while the /fixtures module is attached (D98).
	uninstall = installFixtures();
	// Any call is a bug: a mocked model must never reach the network.
	fetchSpy = vi.fn(() => {
		throw new Error('[test] fetch must not be called for a mocked model');
	});
	vi.stubGlobal('fetch', fetchSpy);
	// The one-time "served by its adapter mock" advisory is asserted in its own
	// test; silence it everywhere else so the suite output stays readable.
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	uninstall();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('interception — no network, real verbs', () => {
	it('loadAll serves the mock collection and never calls fetch', async () => {
		const store = storeWith({ data: [{ id: 't1', text: 'a' }, { id: 't2', text: 'b' }] });

		const records = await store.loadAll('todo');

		expect(records.map((r) => r.text)).toEqual(['a', 'b']);
		expect(store.findMany('todo')).toHaveLength(2);
		expect(fetchSpy).not.toHaveBeenCalled();
		// Loaded through the real D21 path → server-sourced, so a save() PUTs.
		expect(records[0]._synced).toBe(true);
	});

	it('deep-clones mock.data, so the fixture array a test passes in is never mutated', async () => {
		const fixtures = [{ id: 't1', text: 'a', done: false }];
		const store = storeWith({ data: fixtures });

		const [record] = await store.loadAll('todo');
		record.update({ text: 'changed' });
		await record.save(); // PUT merges into the mock's own copy

		expect(fixtures).toEqual([{ id: 't1', text: 'a', done: false }]);
		// A second store built on the same array still sees the original.
		const other = storeWith({ data: fixtures });
		expect((await other.loadAll('todo'))[0].text).toBe('a');
	});

	it('collection state persists across calls within a store', async () => {
		const store = storeWith({ data: [{ id: 't1', text: 'a' }] });
		const created = store.createRecord('todo', { id: 't2', text: 'b' });

		await created.save(); // POST inserts into the mock collection
		const list = await store.loadAll('todo');

		expect(list.map((r) => r.id).sort()).toEqual(['t1', 't2']);
	});

	it('an empty/omitted data block starts from an empty collection', async () => {
		const store = storeWith({});
		expect(await store.loadAll('todo')).toEqual([]);
	});

	it('a model with no mock block still goes to the network', async () => {
		const store = storeWith(undefined);
		await expect(store.loadAll('todo')).rejects.toThrow('[test] fetch must not be called');
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});

describe('default CRUD — all five shapes, end to end', () => {
	it('GET /:id resolves a record; a missing one is a real 404 on the D21 read path', async () => {
		const store = storeWith({ data: [{ id: 't1', text: 'a' }] });

		const record = await store.loadOne('todo', 't1');
		expect(record.text).toBe('a');

		await expect(store.loadOne('todo', 'nope')).rejects.toThrow(
			"[puzzle] load 'todo' failed: 404 Not Found"
		);
	});

	it('POST inserts and answers 201 with the created object (the _synced flip)', async () => {
		const store = storeWith({ data: [] });
		const record = store.createRecord('todo', { id: 't1', text: 'a' });
		expect(record._synced).toBe(false);

		await record.save();

		expect(record._synced).toBe(true);
		expect((await store.loadAll('todo')).map((r) => r.id)).toEqual(['t1']);
	});

	it('POST assigns a primary key when the body carries none', async () => {
		const store = storeWith({ data: [] });

		const created = await store.request('todo', '', { method: 'POST', body: { text: 'a' } });

		expect(created).toEqual({ text: 'a', id: 'mock-1' });
	});

	it('PUT merges and answers 200 with the merged object', async () => {
		const store = storeWith({ data: [{ id: 't1', text: 'a', done: false }] });
		const [record] = await store.loadAll('todo');

		record.update({ done: true });
		await record.save(); // synced → PUT

		const reloaded = await store.request('todo', '/t1');
		expect(reloaded).toEqual({ id: 't1', text: 'a', done: true });
	});

	it('PUT on a missing id is a 404 PuzzleAdapterError and leaves local state dirty', async () => {
		const store = storeWith({ data: [] });
		const record = store.createRecord('todo', { id: 'ghost', text: 'a' });
		record._synced = true; // pretend it came from the server → PUT

		await expect(record.save()).rejects.toMatchObject({
			name: 'PuzzleAdapterError',
			status: 404,
		});
		expect(store.findOne('todo', 'ghost')).toBe(record);
	});

	it('DELETE answers a bodiless 204 and removes from both sides', async () => {
		const store = storeWith({ data: [{ id: 't1', text: 'a' }, { id: 't2', text: 'b' }] });
		const [first] = await store.loadAll('todo');

		await first.delete();

		expect(store.findOne('todo', 't1')).toBeNull();
		expect((await store.loadAll('todo')).map((r) => r.id)).toEqual(['t2']);
	});

	it('DELETE of an unknown id 404s — which D50 treats as already gone', async () => {
		const store = storeWith({ data: [] });
		const record = store.createRecord('todo', { id: 'ghost', text: 'a' });

		await expect(record.delete()).resolves.toBe(record);
		expect(store.findOne('todo', 'ghost')).toBeNull();
	});

	it('a numeric primary key resolves through the string URL segment', async () => {
		const schema = {
			id: Puzzle.number().primary(),
			text: Puzzle.string().required(),
		};
		const store = storeWith({ data: [{ id: 1, text: 'a' }] }, undefined, schema);

		const record = await store.loadOne('todo', 1);
		expect(record.text).toBe('a');

		record.update({ text: 'b' });
		await record.save();
		expect((await store.request('todo', '/1')).text).toBe('b');
	});

	it('an unroutable custom path 404s rather than pretending to succeed', async () => {
		const store = storeWith({ data: [] });
		await expect(store.request('todo', '/t1/archive', { method: 'POST' })).rejects.toMatchObject({
			name: 'PuzzleAdapterError',
			status: 404,
		});
	});
});

describe('pk adoption — the D50 first-save re-key, driven by the mock response', () => {
	it('a POST response carrying a different id re-keys the store atomically', async () => {
		// The default CRUD honors a client-supplied key, so the server-assigns-its-own
		// case is expressed through the handler — still the real save() path.
		const store = storeWith({
			data: [],
			handler({ method, body, collection }) {
				if (method !== 'POST') return null;
				const assigned = { ...body, id: 'srv-9' };
				collection.set(assigned.id, assigned);
				return { status: 201, body: assigned };
			},
		});
		const record = store.createRecord('todo', { text: 'a' });
		const localId = record.id;

		await record.save();

		expect(record.id).toBe('srv-9');
		expect(record._synced).toBe(true);
		expect(store.findOne('todo', 'srv-9')).toBe(record);
		expect(store.findOne('todo', localId)).toBeNull();
	});
});

describe('latency — the knob that makes skeletons developable', () => {
	/** Advance fake timers 1ms at a time; returns the tick the promise settled on. */
	const settleTick = async (promise) => {
		let settled = -1;
		let tick = 0;
		promise.then(
			() => {
				settled = tick;
			},
			() => {
				settled = tick;
			}
		);
		for (; tick <= 2000; tick++) {
			await vi.advanceTimersByTimeAsync(tick === 0 ? 0 : 1);
			if (settled >= 0) return settled;
		}
		return -1;
	};

	it('a fixed latency actually delays the response', async () => {
		vi.useFakeTimers();
		const store = storeWith({ data: [{ id: 't1', text: 'a' }], latency: 400 });

		let settled = false;
		const pending = store.loadAll('todo').then((r) => {
			settled = true;
			return r;
		});

		await vi.advanceTimersByTimeAsync(399);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toBe(true);
		expect((await pending)[0].text).toBe('a');
	});

	it('a [min, max] range lands inside the range and replays identically', async () => {
		vi.useFakeTimers();
		const first = await settleTick(storeWith({ data: [], latency: [300, 500] }).loadAll('todo'));
		const second = await settleTick(storeWith({ data: [], latency: [300, 500] }).loadAll('todo'));

		expect(first).toBeGreaterThanOrEqual(300);
		expect(first).toBeLessThanOrEqual(500);
		expect(second).toBe(first); // seeded PRNG → same store config, same delay
	});

	it('no latency resolves without a timer at all', async () => {
		vi.useFakeTimers();
		const store = storeWith({ data: [{ id: 't1', text: 'a' }] });
		// No timer is advanced anywhere in this test — a mock that always armed a
		// setTimeout would hang here under fake timers.
		expect(await store.loadAll('todo')).toHaveLength(1);
	});

	it('a throwing handler with latency rejects instead of leaving the request pending', async () => {
		vi.useFakeTimers();
		const store = storeWith({
			data: [],
			latency: 50,
			handler() {
				throw new Error('handler blew up');
			},
		});
		const pending = expect(store.request('todo', '/explode')).rejects.toThrow('handler blew up');

		await vi.advanceTimersByTimeAsync(50);
		await pending;
	});
});

describe('failure — the only supported way to make data() reject on purpose', () => {
	it('fail: true rejects writes with a real PuzzleAdapterError', async () => {
		const store = storeWith({ data: [], fail: true });
		const record = store.createRecord('todo', { id: 't1', text: 'a' });

		const error = await record.save().catch((e) => e);

		expect(error).toBeInstanceOf(PuzzleAdapterError);
		expect(error.status).toBe(500);
		expect(error.statusText).toBe('Internal Server Error');
		expect(error.body).toEqual({ error: `[puzzle] mock failure for POST ${API}/api/todos` });
		// Local state stays dirty — retry is calling save() again (D50).
		expect(record._synced).toBe(false);
	});

	it('fail: true rejects reads through the D21 error path', async () => {
		const store = storeWith({ data: [{ id: 't1', text: 'a' }], fail: true });
		await expect(store.loadAll('todo')).rejects.toThrow(
			"[puzzle] load 'todo' failed: 500 Internal Server Error"
		);
	});

	it('fail: true rejects delete() and keeps the record', async () => {
		const store = storeWith({ data: [], fail: true });
		const record = store.createRecord('todo', { id: 't1', text: 'a' });
		record._synced = true; // a never-synced delete() skips the network entirely

		await expect(record.delete()).rejects.toBeInstanceOf(PuzzleAdapterError);
		expect(store.findOne('todo', 't1')).toBe(record);
	});

	it('failRate: 1 fails every request', async () => {
		const store = storeWith({ data: [], failRate: 1 });
		const record = store.createRecord('todo', { id: 't1', text: 'a' });

		await expect(record.save()).rejects.toBeInstanceOf(PuzzleAdapterError);
		await expect(store.loadAll('todo')).rejects.toThrow(/500/);
	});

	it('failRate: 0 never fails', async () => {
		const store = storeWith({ data: [], failRate: 0 });
		for (let i = 0; i < 20; i++) await store.loadAll('todo');
	});

	it('a partial failRate is reproducible from the seed', async () => {
		const run = async () => {
			const store = storeWith({ data: [], failRate: 0.5 });
			const outcomes = [];
			for (let i = 0; i < 24; i++) {
				outcomes.push(await store.loadAll('todo').then(() => 'ok', () => 'fail'));
			}
			return outcomes;
		};

		const a = await run();
		const b = await run();
		expect(a).toEqual(b);
		expect(a).toContain('ok');
		expect(a).toContain('fail');
	});

	it('a different install seed produces a different failure sequence', async () => {
		const run = async (seed) => {
			installFixtures({ seed });
			const store = storeWith({ data: [], failRate: 0.5 });
			const outcomes = [];
			for (let i = 0; i < 24; i++) {
				outcomes.push(await store.loadAll('todo').then(() => 'ok', () => 'fail'));
			}
			return outcomes;
		};
		expect(await run(1)).not.toEqual(await run(2));
	});

	it('failure resolves a non-ok response — it never rejects the fetch itself', async () => {
		// Proven by the shape: PuzzleAdapterError carries a parsed body, which only
		// exists because the failure travelled the normal response path.
		const store = storeWith({ data: [], fail: true });
		const error = await store.request('todo', '/x').catch((e) => e);
		expect(error).toBeInstanceOf(PuzzleAdapterError);
		expect(error.body.error).toMatch(/mock failure for GET/);
	});
});

describe('handler — the custom-path escape hatch', () => {
	it('serves an arbitrary request() path and can mutate the live collection', async () => {
		const store = storeWith({
			data: [{ id: 't1', text: 'a', done: false }],
			handler({ method, path, collection }) {
				if (method !== 'POST' || !path.endsWith('/archive')) return null;
				const id = path.split('/')[1];
				const record = collection.get(id);
				if (!record) return { status: 404, body: { error: 'no such todo' } };
				record.archived = true;
				return { status: 200, body: record };
			},
		});

		const archived = await store.request('todo', '/t1/archive', { method: 'POST' });

		expect(archived).toEqual({ id: 't1', text: 'a', done: false, archived: true });
		// The mutation stuck: the default GET now reports it too.
		expect((await store.request('todo', '/t1')).archived).toBe(true);
	});

	it('a falsy return falls through to the default CRUD', async () => {
		const seen = [];
		const store = storeWith({
			data: [{ id: 't1', text: 'a' }],
			handler(request) {
				seen.push(`${request.method} ${request.path}`);
				return null;
			},
		});

		const records = await store.loadAll('todo');

		expect(records).toHaveLength(1);
		expect(seen).toEqual(['GET ']);
	});

	it('receives the parsed body and the full url; status defaults to 200', async () => {
		let received = null;
		const store = storeWith({
			data: [],
			handler(request) {
				received = request;
				return { body: { ok: true } };
			},
		});

		const result = await store.request('todo', '/bulk', {
			method: 'POST',
			body: { ids: [1, 2] },
		});

		expect(result).toEqual({ ok: true });
		expect(received.method).toBe('POST');
		expect(received.url).toBe(`${API}/api/todos/bulk`);
		expect(received.path).toBe('/bulk');
		expect(received.body).toEqual({ ids: [1, 2] });
		expect(received.collection).toBeInstanceOf(Map);
	});

	it('an omitted body is an empty response — request() resolves null', async () => {
		const store = storeWith({ data: [], handler: () => ({ status: 204 }) });
		await expect(store.request('todo', '/ping')).resolves.toBeNull();
	});

	it('a failure short-circuits the handler entirely', async () => {
		const handler = vi.fn(() => ({ status: 200, body: {} }));
		const store = storeWith({ data: [], fail: true, handler });

		await expect(store.request('todo', '/x')).rejects.toBeInstanceOf(PuzzleAdapterError);
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('composition with beforeRequest (D91)', () => {
	it('the hook still fires in mock mode, with the init it would have sent', async () => {
		const calls = [];
		const store = storeWith(
			{ data: [{ id: 't1', text: 'a' }] },
			{
				beforeRequest: (init, context) => {
					init.headers = { ...(init.headers || {}), Authorization: 'Bearer t' };
					calls.push({ init, context: { ...context } });
				},
			}
		);

		await store.loadAll('todo');
		await store.createRecord('todo', { id: 't2', text: 'b' }).save();

		expect(calls).toHaveLength(2);
		expect(calls[0].context).toEqual({ type: 'todo', method: 'GET', url: `${API}/api/todos` });
		expect(calls[0].init.headers.Authorization).toBe('Bearer t');
		expect(calls[1].context.method).toBe('POST');
		expect(JSON.parse(calls[1].init.body)).toMatchObject({ id: 't2', text: 'b' });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('a throwing hook still rejects before the mock is ever consulted', async () => {
		const store = storeWith(
			{ data: [{ id: 't1', text: 'a' }] },
			{
				beforeRequest: () => {
					throw new Error('session expired');
				},
			}
		);
		await expect(store.loadAll('todo')).rejects.toThrow('session expired');
	});
});

describe('production posture — one advisory warning per model', () => {
	it('warns once, naming the endpoint that is NOT being called', async () => {
		console.warn.mockRestore();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = storeWith({ data: [{ id: 't1', text: 'a' }] });

		await store.loadAll('todo');
		await store.loadOne('todo', 't1');
		await store.request('todo', '/t1');

		const mockWarnings = warn.mock.calls.filter(([message]) =>
			message.includes('is served by its adapter mock')
		);
		expect(mockWarnings).toHaveLength(1);
		expect(mockWarnings[0][0]).toBe(
			"[puzzle] model 'todo' is served by its adapter mock — no request reaches /api/todos"
		);
	});
});

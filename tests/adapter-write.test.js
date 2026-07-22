import { describe, it, expect, vi, afterEach } from 'vitest';
import { Store, PuzzleAdapterError } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle, PuzzleValidationError } from '../client-runtime/model.js';
import * as pkg from '../client-runtime/index.js';

// Adapter write sync (constellation/doc/DOC-SPEC.md §22, D50): explicit
// save()/delete()/request() verbs, local-first, validate-before-sync.

class ApiTodo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};
	static adapter = { endpoint: '/api/todos' };

	// The documented store.request() idiom: wrap it in an instance method.
	archive() {
		return this._store.request('todo', `/${this.id}/archive`, { method: 'POST' });
	}
}

const apiStore = () => new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1' });

// A Response-shaped mock: readBody() reads via res.text(), so text is the source
// of truth. `body` may be a string (used verbatim) or any value (JSON-stringified).
const makeRes = ({ ok = true, status = 200, statusText = 'OK', body = '' } = {}) => ({
	ok,
	status,
	statusText,
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	// The D21 read path (loadAll/loadOne) reads via res.json(); provide it too so
	// the same mock serves both read and write paths.
	json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

// Queue of responses; each fetch call pops the next (last repeats).
const mockFetch = (...responses) => {
	const queue = responses.map((r) => (r instanceof Object && 'text' in r ? r : makeRes(r)));
	const fn = vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]));
	vi.stubGlobal('fetch', fn);
	return fn;
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('adapter write sync — package surface', () => {
	it('exports PuzzleAdapterError from the package root', () => {
		expect(pkg.PuzzleAdapterError).toBe(PuzzleAdapterError);
		const err = new PuzzleAdapterError(500, 'Server Error', { m: 1 });
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('PuzzleAdapterError');
		expect(err.status).toBe(500);
		expect(err.statusText).toBe('Server Error');
		expect(err.body).toEqual({ m: 1 });
	});
});

describe('save() — POST vs PUT', () => {
	it('POSTs to apiURL+endpoint on a first save (never-synced record)', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'ship v1.18' });

		await todo.save();

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://x.test/v1/api/todos');
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('application/json');
		expect(JSON.parse(init.body)).toEqual({ id: 't1', text: 'ship v1.18', completed: false });
	});

	it('PUTs to endpoint/:id on the second save (now synced)', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save(); // POST
		todo.update({ completed: true });
		await todo.save(); // PUT

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const [url, init] = fetchSpy.mock.calls[1];
		expect(url).toBe('https://x.test/v1/api/todos/t1');
		expect(init.method).toBe('PUT');
		expect(JSON.parse(init.body).completed).toBe(true);
	});

	it('encodeURIComponent-encodes the pk in the PUT URL', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'a b/c', text: 'x' });
		await todo.save();
		await todo.save();
		expect(fetchSpy.mock.calls[1][0]).toBe('https://x.test/v1/api/todos/a%20b%2Fc');
	});
});

describe('save() — validate before sync', () => {
	it('rejects with PuzzleValidationError and never calls fetch when invalid', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		// Construct an invalid record without tripping createRecord's validation:
		// hand-instantiate and attach so text (required) is empty.
		const bad = store.createRecord('todo', { id: 't1', text: 'ok' });
		// Clear the required field directly (bypass update's per-field validate).
		bad.text = '';

		await expect(bad.save()).rejects.toBeInstanceOf(PuzzleValidationError);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('save() — non-OK response', () => {
	it('rejects with PuzzleAdapterError carrying status + parsed body; record stays dirty', async () => {
		mockFetch({ ok: false, status: 422, statusText: 'Unprocessable', body: { error: 'nope' } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await expect(todo.save()).rejects.toMatchObject({
			name: 'PuzzleAdapterError',
			status: 422,
			body: { error: 'nope' },
		});
		// Local state untouched, still un-synced → a retry POSTs again.
		expect(todo._synced).toBe(false);
		expect(store.findOne('todo', 't1')).toBe(todo);
	});
});

describe('save() — 2xx response merge', () => {
	it('merges a JSON-object response (server-computed field lands) and notifies subscribers', async () => {
		mockFetch({ body: { id: 't1', text: 'x', completed: false, serverStamp: 'abc' } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		const sub = { onStoreChange: vi.fn() };
		store.withTracking(sub, () => store.findOne('todo', 't1'));

		await todo.save();
		store.flush();

		expect(todo.serverStamp).toBe('abc');
		expect(todo._synced).toBe(true);
		expect(sub.onStoreChange).toHaveBeenCalled();
	});

	it('keeps local state on a 204/empty body (no merge) and marks synced', async () => {
		mockFetch({ status: 204, statusText: 'No Content', body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'local' });

		await todo.save();
		expect(todo.text).toBe('local');
		expect(todo._synced).toBe(true);
	});

	it('a 2xx body carrying id:null merges the rest and keeps the local pk (no index desync)', async () => {
		mockFetch({ body: { id: null, title: 'x', text: 'renamed' } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		const sub = { onStoreChange: vi.fn() };
		store.withTracking(sub, () => store.findOne('todo', 't1'));
		const notifySpy = vi.spyOn(store, '_notify');

		await todo.save();

		expect(todo.id).toBe('t1'); // local pk kept, not blanked to null
		expect(todo.text).toBe('renamed'); // rest merged
		expect(store.findOne('todo', 't1')).toBe(todo); // map still finds it
		expect(notifySpy).not.toHaveBeenCalledWith('todo', null); // never notified under null
		store.flush();
		expect(sub.onStoreChange).toHaveBeenCalled(); // notified under the real pk
	});
});

describe('save() — server pk adoption', () => {
	it('re-keys atomically on a first save whose response carries a different pk', async () => {
		mockFetch({ body: { id: 'server-99', text: 'x', completed: false } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'temp-1', text: 'x' });

		const sub = { onStoreChange: vi.fn() };
		store.withTracking(sub, () => {
			store.findOne('todo', 'temp-1');
			store.findMany('todo');
		});

		await todo.save();

		expect(store.findOne('todo', 'temp-1')).toBeNull(); // old key gone
		expect(store.findOne('todo', 'server-99')).toBe(todo); // new key resolves
		expect(todo.id).toBe('server-99');

		store.flush();
		expect(sub.onStoreChange).toHaveBeenCalled(); // notified on old + new keys
	});

	it('warns and ignores a differing pk on an update-save, merging the rest', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockFetch(
			{ body: '' }, // first save POST
			{ body: { id: 'other', text: 'renamed', completed: true } } // update PUT
		);
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		await todo.save(); // synced
		await todo.save(); // update-save with mismatched pk

		expect(warn).toHaveBeenCalled();
		expect(todo.id).toBe('t1'); // pk unchanged
		expect(todo.text).toBe('renamed'); // rest merged
		expect(store.findOne('todo', 't1')).toBe(todo);
		expect(store.findOne('todo', 'other')).toBeNull();
	});
});

describe('save() — concurrent in-flight guard', () => {
	it('two immediate save()s on a new record → one POST then one PUT, correctly keyed', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		// Both fired before either resolves: the second must wait and re-evaluate
		// wasSynced AFTER the first settles — POST-then-PUT, never a double-create.
		const [r1, r2] = await Promise.all([todo.save(), todo.save()]);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
		expect(fetchSpy.mock.calls[0][0]).toBe('https://x.test/v1/api/todos');
		expect(fetchSpy.mock.calls[1][1].method).toBe('PUT');
		expect(fetchSpy.mock.calls[1][0]).toBe('https://x.test/v1/api/todos/t1');
		expect(r1).toBe(todo);
		expect(r2).toBe(todo);
		expect(store.findOne('todo', 't1')).toBe(todo);
		expect(todo._synced).toBe(true);
	});

	it('a rejected first save() does not block the second: first caller rejects, second succeeds', async () => {
		const fetchSpy = mockFetch(
			{ ok: false, status: 500, statusText: 'Server Error', body: 'boom' }, // first
			{ body: '' } // second
		);
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		const p1 = todo.save();
		const p2 = todo.save();

		await expect(p1).rejects.toMatchObject({ name: 'PuzzleAdapterError', status: 500 });
		await expect(p2).resolves.toBe(todo); // ran behind the failed first, succeeded
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(store.findOne('todo', 't1')).toBe(todo);
		expect(todo._synced).toBe(true);
	});
});

describe('save() — synced provenance from read/hydrate paths', () => {
	it('a record from loadAll/_upsert is synced → first save() PUTs', async () => {
		const fetchSpy = mockFetch(
			{ body: [{ id: 't1', text: 'from server' }] }, // loadAll GET
			{ body: '' } // save PUT
		);
		const store = apiStore();
		const [record] = await store.loadAll('todo');
		expect(record._synced).toBe(true);

		record.update({ completed: true });
		await record.save();
		expect(fetchSpy.mock.calls[1][1].method).toBe('PUT');
		expect(fetchSpy.mock.calls[1][0]).toBe('https://x.test/v1/api/todos/t1');
	});

	it('a record from public upsert is synced → first save() PUTs', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const record = store.upsert('todo', { id: 'u1', text: 'custom action response' });

		await record.save();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0][1].method).toBe('PUT');
		expect(fetchSpy.mock.calls[0][0]).toBe('https://x.test/v1/api/todos/u1');
	});

	it('a hydrated-from-storage record is synced → first save() PUTs', async () => {
		const blob = JSON.stringify({ todo: [{ id: 'h1', text: 'hydrated', completed: false }] });
		const storage = {
			getItem: () => blob,
			setItem: () => {},
		};
		const fetchSpy = mockFetch({ body: '' });
		const store = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		const record = store.findOne('todo', 'h1');
		expect(record._synced).toBe(true);

		await record.save();
		expect(fetchSpy.mock.calls[0][1].method).toBe('PUT');
	});
});

describe('save() — persisted synced provenance round-trips (§22, D50)', () => {
	// A real round-tripping storage: setItem persists, getItem reads it back, so a
	// second Store over the same backing map rehydrates exactly what the first wrote.
	const roundTripStorage = () => {
		const data = new Map();
		return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
	};

	it('a locally-created never-saved record persists as UNSYNCED → save() POSTs after reload', async () => {
		const storage = roundTripStorage();
		const store1 = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		store1.createRecord('todo', { id: 't1', text: 'x' }); // _synced false, persisted
		store1.flush(); // persistence is batched into flush() — force the write now

		const fetchSpy = mockFetch({ body: '' });
		const store2 = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		const revived = store2.findOne('todo', 't1');
		expect(revived._synced).toBe(false); // provenance survived → still needs a POST

		await revived.save();
		expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
		expect(fetchSpy.mock.calls[0][0]).toBe('https://x.test/v1/api/todos');
	});

	it('a server-loaded record persists as SYNCED → save() PUTs after reload', async () => {
		const storage = roundTripStorage();
		const fetchSpy = mockFetch(
			{ body: [{ id: 's1', text: 'srv' }] }, // loadAll GET
			{ body: '' } // save PUT after reload
		);
		const store1 = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		await store1.loadAll('todo'); // _synced true → persisted with the marker
		store1.flush(); // persistence is batched into flush() — force the write now

		const store2 = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		const revived = store2.findOne('todo', 's1');
		expect(revived._synced).toBe(true);

		await revived.save();
		expect(fetchSpy.mock.calls[1][1].method).toBe('PUT');
		expect(fetchSpy.mock.calls[1][0]).toBe('https://x.test/v1/api/todos/s1');
	});

	it('an OLD-format blob without the __synced marker hydrates as synced (back-compat)', async () => {
		const blob = JSON.stringify({ todo: [{ id: 'h1', text: 'hydrated', completed: false }] });
		const storage = { getItem: () => blob, setItem: () => {} };
		const fetchSpy = mockFetch({ body: '' });
		const store = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		const record = store.findOne('todo', 'h1');
		expect(record._synced).toBe(true); // no marker → default synced, unchanged behavior

		await record.save();
		expect(fetchSpy.mock.calls[0][1].method).toBe('PUT');
	});

	it('the __synced marker persists but never leaks into toJSON()/server payloads', async () => {
		const storage = roundTripStorage();
		const store = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush(); // persistence is batched into flush() — force the write now

		const persisted = JSON.parse(storage.getItem('puzzle-store'));
		expect(persisted.todo[0]).toHaveProperty('__synced', false); // rides out-of-band
		expect('__synced' in todo.toJSON()).toBe(false); // but not a field
	});
});

describe('save() — mid-flight save-boundary hardening (§22, D50)', () => {
	it('a record destroyed while its first POST is in flight is never resurrected', async () => {
		let resolveFetch;
		const fetchSpy = vi.fn(() => new Promise((r) => (resolveFetch = r)));
		vi.stubGlobal('fetch', fetchSpy);

		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		const notifySpy = vi.spyOn(store, '_notify');

		const savePromise = todo.save();
		todo.destroy(); // removeRecord mid-flight — notifies once for the removal
		const notifiesAfterRemoval = notifySpy.mock.calls.length;

		// Let the serialized save chain reach _saveRecordNow's fetch (it runs a
		// microtask later), so resolveFetch is wired before we release the response.
		await new Promise((r) => setTimeout(r, 0));
		resolveFetch(makeRes({ body: { id: 't1', text: 'x', completed: false } }));
		await expect(savePromise).resolves.toBe(todo); // resolves with the detached record

		expect(store.findOne('todo', 't1')).toBeNull(); // NOT re-inserted
		expect(todo._synced).toBe(false); // provenance not flipped
		// No reconciliation notify beyond the removal's — the merge path was skipped.
		expect(notifySpy.mock.calls.length).toBe(notifiesAfterRemoval);
	});

	it('a server-assigned pk that collides with an existing record rejects (plain Error), changing nothing', async () => {
		mockFetch({ body: { id: 'existing', text: 'from server', completed: true } });
		const store = apiStore();
		const existing = store.createRecord('todo', { id: 'existing', text: 'i was here' });
		existing._synced = true; // already server-known, indexed under 'existing'
		const fresh = store.createRecord('todo', { id: 'temp-1', text: 'new' });

		const err = await fresh.save().catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(PuzzleAdapterError); // HTTP succeeded; local reconcile failed
		expect(err.message).toMatch(/already belongs to a different record/);

		// Both records and their keys are intact.
		expect(store.findOne('todo', 'existing')).toBe(existing);
		expect(existing.text).toBe('i was here'); // not overwritten by the server body
		expect(existing._synced).toBe(true);
		expect(store.findOne('todo', 'temp-1')).toBe(fresh);
		expect(fresh.id).toBe('temp-1'); // pk not adopted
		expect(fresh._synced).toBe(false); // still un-synced (retryable)
	});
});

describe('delete()', () => {
	it('removes locally + notifies on a 2xx', async () => {
		mockFetch({ status: 200, body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		const sub = { onStoreChange: vi.fn() };
		store.withTracking(sub, () => store.findMany('todo'));

		await todo.delete();
		expect(store.findOne('todo', 't1')).toBeNull();
		store.flush();
		expect(sub.onStoreChange).toHaveBeenCalled();
	});

	it('removes locally on a 404 (idempotent, already gone)', async () => {
		mockFetch({ ok: false, status: 404, statusText: 'Not Found', body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await todo.delete();
		expect(store.findOne('todo', 't1')).toBeNull();
	});

	it('rejects with PuzzleAdapterError on a 500 and keeps the record', async () => {
		mockFetch({ ok: false, status: 500, statusText: 'Server Error', body: 'boom' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await expect(todo.delete()).rejects.toMatchObject({ name: 'PuzzleAdapterError', status: 500, body: 'boom' });
		expect(store.findOne('todo', 't1')).toBe(todo);
	});

	it('DELETEs endpoint/:id (encoded)', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'a/b', text: 'x' });
		await todo.delete();
		expect(fetchSpy).toHaveBeenCalledWith('https://x.test/v1/api/todos/a%2Fb', { method: 'DELETE' });
	});

	it('a second delete on the same removed instance resolves without another request', async () => {
		const fetchSpy = mockFetch({ body: '' }, { body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await todo.save();
		await todo.delete();
		await expect(todo.delete()).resolves.toBe(todo);

		expect(store.findMany('todo')).toEqual([]);
		expect(fetchSpy).toHaveBeenCalledTimes(2); // POST + first DELETE only
	});

	it('destroy() marks the instance removed, so a later delete resolves locally', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		todo.destroy();
		await expect(todo.delete()).resolves.toBe(todo);
		expect(todo._deleted).toBe(true);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('save() after delete rejects clearly without resurrecting via POST', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await todo.delete();
		await expect(todo.save()).rejects.toThrow(/cannot save a deleted record/);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // DELETE only
		expect(store.findMany('todo')).toEqual([]);
	});

	it('an in-flight delete of A never evicts a newer B that reused A\'s id (identity guard)', async () => {
		let resolveFetch;
		const fetchSpy = vi.fn(() => new Promise((r) => (resolveFetch = r)));
		vi.stubGlobal('fetch', fetchSpy);

		const store = apiStore();
		const a = store.createRecord('todo', { id: 't1', text: 'A' });

		const delPromise = a.delete(); // DELETE in flight; requestKey 't1' captured
		a.destroy(); // A removed locally
		const b = store.createRecord('todo', { id: 't1', text: 'B' }); // reuse the id

		// Let the deleteRecord await settle its wiring before releasing the response.
		await new Promise((r) => setTimeout(r, 0));
		resolveFetch(makeRes({ status: 200, body: '' }));
		await expect(delPromise).resolves.toBe(a); // resolves with the detached record

		// B is still in the store — the stale delete's removeRecord was skipped because
		// the map no longer holds A at 't1'.
		expect(store.findOne('todo', 't1')).toBe(b);
		expect(b.text).toBe('B');
	});
});

describe('safe record merge — server/storage JSON never re-prototypes or hijacks a record (FIX 6)', () => {
	// JSON.parse produces a LITERAL own "__proto__" property (an object literal can't —
	// `{ __proto__: … }` sets the prototype), so these payloads are raw JSON strings.
	const evilUpsert =
		'{"id":"t1","text":"from server","__proto__":{"polluted":true},"_store":"hijacked","_type":"user"}';

	it('upsert of an existing record: keeps its prototype/methods, no pollution, _store intact', async () => {
		mockFetch({ body: evilUpsert });
		const store = apiStore();
		const original = store.createRecord('todo', { id: 't1', text: 'local' });

		const merged = await store.loadOne('todo', 't1');

		expect(merged).toBe(original); // updated in place
		expect(merged).toBeInstanceOf(ApiTodo); // prototype not severed
		expect(Object.getPrototypeOf(merged)).toBe(ApiTodo.prototype);
		expect(typeof merged.update).toBe('function'); // PuzzleModel methods survive
		expect(merged.text).toBe('from server'); // ordinary field merged
		expect(merged._store).toBe(store); // reserved key not clobbered
		expect(merged._type).toBe('todo'); // reserved key not clobbered
		expect(merged._synced).toBe(true); // upsert marks synced
		expect({}.polluted).toBeUndefined(); // Object.prototype untouched
	});

	it('save reconciliation: a server body with __proto__/_store merges safely', async () => {
		mockFetch({
			body: '{"id":"t1","text":"reconciled","__proto__":{"polluted":true},"_store":"hijacked"}',
		});
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'local' }); // unsynced → POST

		await todo.save();

		expect(todo).toBeInstanceOf(ApiTodo);
		expect(Object.getPrototypeOf(todo)).toBe(ApiTodo.prototype);
		expect(typeof todo.save).toBe('function');
		expect(todo.text).toBe('reconciled');
		expect(todo._store).toBe(store);
		expect(todo._synced).toBe(true);
		expect({}.polluted).toBeUndefined();
	});

	it('hydration replace: a stored blob with __proto__/_store overwrites in place safely', () => {
		const store = apiStore();
		const original = store.createRecord('todo', { id: 't1', text: 'local' });

		const data = JSON.parse(
			'{"todo":[{"id":"t1","text":"hydrated","__proto__":{"polluted":true},"_store":"hijacked"}]}'
		);
		store._hydrateAll(data, { replace: true });

		expect(store.findOne('todo', 't1')).toBe(original); // identity preserved
		expect(original).toBeInstanceOf(ApiTodo);
		expect(Object.getPrototypeOf(original)).toBe(ApiTodo.prototype);
		expect(typeof original.update).toBe('function');
		expect(original.text).toBe('hydrated');
		expect(original._store).toBe(store);
		expect({}.polluted).toBeUndefined();
	});
});

describe('store.request()', () => {
	it('happy path: prefixes endpoint, JSON-encodes body, resolves parsed JSON', async () => {
		const fetchSpy = mockFetch({ body: { ok: true } });
		const store = apiStore();
		const result = await store.request('todo', '/t1/archive', { method: 'POST', body: { reason: 'done' } });

		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://x.test/v1/api/todos/t1/archive');
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('application/json');
		expect(JSON.parse(init.body)).toEqual({ reason: 'done' });
		expect(result).toEqual({ ok: true });
	});

	it('resolves null on a 204/empty body', async () => {
		mockFetch({ status: 204, body: '' });
		const store = apiStore();
		await expect(store.request('todo', '/t1/ping')).resolves.toBeNull();
	});

	it('merges caller headers and omits Content-Type when no body', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		await store.request('todo', '/x', { headers: { Authorization: 'Bearer z' } });
		const init = fetchSpy.mock.calls[0][1];
		expect(init.headers.Authorization).toBe('Bearer z');
		expect(init.headers['Content-Type']).toBeUndefined();
		expect(init.method).toBe('GET');
	});

	it('rejects with PuzzleAdapterError on a non-OK response', async () => {
		mockFetch({ ok: false, status: 403, statusText: 'Forbidden', body: { denied: true } });
		const store = apiStore();
		await expect(store.request('todo', '/x')).rejects.toMatchObject({
			name: 'PuzzleAdapterError',
			status: 403,
			body: { denied: true },
		});
	});

	it('the wrap-in-instance-method idiom works', async () => {
		const fetchSpy = mockFetch({ body: { archived: true } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't7', text: 'x' });
		const res = await todo.archive();
		expect(fetchSpy.mock.calls[0][0]).toBe('https://x.test/v1/api/todos/t7/archive');
		expect(res).toEqual({ archived: true });
	});
});

describe('no-adapter and store-less rejections', () => {
	it('save() on a model without an adapter rejects with the D21-style message', async () => {
		class Plain extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), text: Puzzle.string() };
		}
		const store = new Store({ plain: Plain }, { apiURL: 'https://x.test' });
		const fetchSpy = mockFetch({ body: '' });
		const rec = store.createRecord('plain', { id: 'p1', text: 'x' });
		await expect(rec.save()).rejects.toThrow(/no adapter declared for 'plain'/);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('save() on a store-less record rejects asynchronously (no sync throw)', async () => {
		const rec = new ApiTodo({ id: 'x', text: 'y' });
		const p = rec.save(); // must not throw synchronously
		expect(p).toBeInstanceOf(Promise);
		await expect(p).rejects.toThrow(/store-less record/);
	});

	it('delete() on a store-less record rejects asynchronously', async () => {
		const rec = new ApiTodo({ id: 'x', text: 'y' });
		await expect(rec.delete()).rejects.toThrow(/never added/);
	});

	it('request() rejects when the model declares no adapter', async () => {
		class Plain extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		const store = new Store({ plain: Plain });
		await expect(store.request('plain', '/x')).rejects.toThrow(/no adapter declared for 'plain'/);
	});
});

describe('framework lifecycle flags stay private; destroy() remains local-only', () => {
	it('_synced is absent from toJSON() and the persisted storage blob', async () => {
		let saved = null;
		const storage = { getItem: () => null, setItem: (_k, v) => (saved = v) };
		const fetchSpy = mockFetch({ body: { id: 't1', text: 'x', completed: false } });
		const store = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await todo.save(); // sets _synced true, then _persist() (batched)
		store.flush(); // persistence is batched into flush() — force the write now
		expect(todo._synced).toBe(true);
		expect('_synced' in todo.toJSON()).toBe(false);
		expect(saved).not.toBeNull();
		expect(JSON.parse(saved).todo[0]).not.toHaveProperty('_synced');
		expect(fetchSpy).toHaveBeenCalled();
	});

	it('destroy() removes locally and makes NO network call', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		todo.destroy();
		expect(store.findOne('todo', 't1')).toBeNull();
		expect(todo._deleted).toBe(true);
		expect('_deleted' in todo.toJSON()).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter, PuzzleAdapterError } from '../client-runtime/datastore/adapter.js';
import {
	PuzzleModel,
	Puzzle,
	PuzzleValidationError,
	recordMutationRevision,
} from '../client-runtime/model.js';
import * as pkg from '../client-runtime/index.js';

adapter.install();

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
	// Keep json() too so this remains a complete Response-shaped test double.
	json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

// Queue of responses; each fetch call pops the next (last repeats).
const mockFetch = (...responses) => {
	const queue = responses.map((r) => (r instanceof Object && 'text' in r ? r : makeRes(r)));
	const fn = vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]));
	vi.stubGlobal('fetch', fn);
	return fn;
};

const deferred = () => {
	let resolve;
	const promise = new Promise((r) => (resolve = r));
	return { promise, resolve };
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('adapter write sync — package surface', () => {
	it('keeps prototype installation capability-gated (module import alone is inert)', async () => {
		vi.resetModules();
		const { Store: FreshStore } = await import('../client-runtime/datastore/store.js');
		expect(FreshStore.prototype.loadMany).toBeUndefined();

		const { adapter: freshAdapter } = await import('../client-runtime/datastore/adapter.js');
		expect(FreshStore.prototype.loadMany).toBeUndefined();

		freshAdapter.install();
		expect(FreshStore.prototype.loadMany).toBeTypeOf('function');
	});

	it('exports PuzzleAdapterError only from the adapter subpath', () => {
		expect(pkg.PuzzleAdapterError).toBeUndefined();
		const err = new PuzzleAdapterError(500, 'Server Error', { m: 1 });
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('PuzzleAdapterError');
		expect(err.status).toBe(500);
		expect(err.statusText).toBe('Server Error');
		expect(err.body).toEqual({ m: 1 });
	});

	it('exports one frozen capability and installs idempotently', () => {
		const loadMany = Store.prototype.loadMany;
		expect(Object.isFrozen(adapter)).toBe(true);
		adapter.install();
		expect(Store.prototype.loadMany).toBe(loadMany);
	});
});

describe('adapter read response bodies', () => {
	it('loadMany reports its shape guard for a 204 response', async () => {
		mockFetch(new Response(null, { status: 204 }));

		await expect(apiStore().loadMany('todo')).rejects.toThrow(
			"[puzzle] loadMany('todo') expected a JSON array from the server"
		);
	});

	it('loadOne reports its shape guard for an empty 200 response', async () => {
		mockFetch(new Response('', { status: 200 }));

		await expect(apiStore().loadOne('todo', 't1')).rejects.toThrow(
			"[puzzle] loadOne('todo', id) expected a JSON object from the server"
		);
	});

	it('loadMany reports its shape guard for a non-JSON 200 response', async () => {
		mockFetch(new Response('<html>not JSON</html>', { status: 200 }));

		await expect(apiStore().loadMany('todo')).rejects.toThrow(
			"[puzzle] loadMany('todo') expected a JSON array from the server"
		);
	});

	it('loadMany and loadOne still accept valid JSON responses', async () => {
		mockFetch(
			new Response(JSON.stringify([{ id: 't1', text: 'all' }]), { status: 200 }),
			new Response(JSON.stringify({ id: 't2', text: 'one' }), { status: 200 })
		);
		const store = apiStore();

		const records = await store.loadMany('todo');
		const record = await store.loadOne('todo', 't2');

		expect(records.map((item) => item.toJSON())).toEqual([
			{ id: 't1', text: 'all', completed: false },
		]);
		expect(record.toJSON()).toEqual({ id: 't2', text: 'one', completed: false });
	});

	it('loadMany rejects a pk-less element before storing any response records', async () => {
		mockFetch({
			body: [
				{ id: 't1', text: 'valid but must not land' },
				{ text: 'missing id' },
			],
		});
		const store = apiStore();

		await expect(store.loadMany('todo')).rejects.toThrow(
			`[puzzle] loadMany('todo') requires primary key "id" on every record`
		);
		expect(store.findMany('todo')).toEqual([]);
	});

	it('loadOne rejects a pk-less server object', async () => {
		mockFetch({ body: { text: 'missing id' } });
		const store = apiStore();

		await expect(store.loadOne('todo', 't1')).rejects.toThrow(
			`[puzzle] loadOne('todo', id) requires primary key "id" on the record`
		);
		expect(store.findMany('todo')).toEqual([]);
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

	it('rejects a non-nullish response whose primary key is null', async () => {
		mockFetch({ body: { id: null, title: 'x', text: 'renamed' } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await expect(todo.save()).rejects.toThrow(/requires primary key "id"/);
		expect(todo.id).toBe('t1');
		expect(todo.text).toBe('x');
		expect(todo._synced).toBe(false);
	});

	// D158 contract: a write response is a pk-bearing JSON object or nothing.
	// A 2xx body that is neither is a broken transport, not a silent success —
	// the record stays un-synced, so the caller sees the failure and a retry
	// re-sends the create rather than the record drifting as "saved".
	it('rejects a non-object 2xx body (plain-text "OK") and leaves the record un-synced', async () => {
		mockFetch({ body: 'OK' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		// NOT a PuzzleAdapterError: the HTTP write succeeded — only the response
		// shape is unusable — matching the pk-collision guard's reasoning.
		await expect(todo.save()).rejects.toThrow(/expected a JSON object or nullish response/);
		expect(todo._synced).toBe(false);
	});

	it('rejects a 2xx object body carrying no primary key', async () => {
		mockFetch({ body: { ok: true } });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		await expect(todo.save()).rejects.toThrow(/requires primary key "id"/);
		expect(todo._synced).toBe(false);
	});

	it('accepts a JSON null body as the "no echo" response', async () => {
		mockFetch({ body: 'null' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'local' });

		await todo.save();
		expect(todo.text).toBe('local');
		expect(todo._synced).toBe(true);
	});
});

describe('save() — response reconciliation preserves in-flight edits', () => {
	it('a single POST preserves a local edit made after dispatch', async () => {
		const gate = deferred();
		const fetchSpy = vi.fn(() => gate.promise);
		vi.stubGlobal('fetch', fetchSpy);
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'A' });

		const saving = todo.save();
		await Promise.resolve(); // let _saveRecordNow serialize and dispatch A
		expect(JSON.parse(fetchSpy.mock.calls[0][1].body).text).toBe('A');

		todo.update({ text: 'B' });
		gate.resolve(makeRes({ body: { id: 't1', text: 'A', completed: false } }));
		await saving;

		expect(todo.text).toBe('B');
		expect(todo._synced).toBe(true);
	});

	it('a single PUT preserves a local edit made after dispatch', async () => {
		const gate = deferred();
		const fetchSpy = vi.fn(() => gate.promise);
		vi.stubGlobal('fetch', fetchSpy);
		const store = apiStore();
		const todo = store.upsert('todo', { id: 't1', text: 'A', completed: false });

		const saving = todo.save();
		await Promise.resolve(); // let _saveRecordNow serialize and dispatch A
		expect(fetchSpy.mock.calls[0][1].method).toBe('PUT');

		todo.update({ text: 'B' });
		gate.resolve(makeRes({ body: { id: 't1', text: 'A', completed: false } }));
		await saving;

		expect(todo.text).toBe('B');
	});

	it('a queued save sends the newer local value after the first response reconciles', async () => {
		const first = deferred();
		const sent = [];
		const fetchSpy = vi.fn((_url, init) => {
			const body = JSON.parse(init.body);
			sent.push({ method: init.method, body });
			if (sent.length === 1) return first.promise;
			return Promise.resolve(makeRes({ body }));
		});
		vi.stubGlobal('fetch', fetchSpy);
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'A' });

		const firstSave = todo.save();
		await Promise.resolve(); // first POST has captured A
		todo.update({ text: 'B' });
		const queuedSave = todo.save();

		first.resolve(makeRes({ body: { id: 't1', text: 'A', completed: false } }));
		await Promise.all([firstSave, queuedSave]);

		expect(sent.map(({ method, body }) => ({ method, text: body.text }))).toEqual([
			{ method: 'POST', text: 'A' },
			{ method: 'PUT', text: 'B' },
		]);
		expect(todo.text).toBe('B');
	});

	it('still merges server-computed fields that were untouched locally', async () => {
		const gate = deferred();
		vi.stubGlobal('fetch', vi.fn(() => gate.promise));
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'A' });

		const saving = todo.save();
		await Promise.resolve();
		todo.update({ text: 'B' });
		gate.resolve(
			makeRes({ body: { id: 't1', text: 'A', completed: false, serverRevision: 7 } })
		);
		await saving;

		expect(todo.text).toBe('B');
		expect(todo.serverRevision).toBe(7);
	});

	it('keeps the 204/empty path unchanged when an edit happens in flight', async () => {
		const gate = deferred();
		vi.stubGlobal('fetch', vi.fn(() => gate.promise));
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'A' });

		const saving = todo.save();
		await Promise.resolve();
		todo.update({ text: 'B' });
		gate.resolve(makeRes({ status: 204, statusText: 'No Content', body: '' }));
		await saving;

		expect(todo.text).toBe('B');
		expect(todo._synced).toBe(true);
	});
});

// Construction no longer stamps a local-mutation revision — only update() does.
// The stamp cost every hydrated record an array, a closure, a {current, fields}
// state object and a Map entry per field, for data ONLY save()-response
// reconciliation reads; a record loaded and never saved paid all of it for
// nothing. An unstamped record reports revision 0, and safeMerge's filter then
// tests `(fields.get(key) ?? 0) <= 0` → true for every field — the same verdict
// stamping every constructor field at revision 1 and capturing requestRevision 1
// produced. This matrix is the proof, one case per boundary the change touches.
//
// These are equivalence tests: they pass identically with the constructor stamp
// restored (verified). What they fail on is the protection itself — drop
// safeMerge's throughRevision filter and cases 3 and 4 go red. The one assertion
// that IS specific to the change is the revision-invariant test at the end.
describe('save() — reconciliation with an unstamped constructor (D125 matrix)', () => {
	// 1. Nothing local has changed since dispatch, so the response is wholly
	//    authoritative — including over fields the constructor itself set.
	it('construct → save: the response merges every server field', async () => {
		mockFetch({
			body: { id: 't1', text: 'from-server', completed: true, serverRevision: 7 },
		});
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'local' });

		await todo.save();

		expect(todo.text).toBe('from-server'); // a constructor-set field still yields
		expect(todo.completed).toBe(true);
		expect(todo.serverRevision).toBe(7); // a field the record never had
		expect(todo._synced).toBe(true);
	});

	// 2. The edit happened BEFORE dispatch, so the server saw it and its echo wins
	//    — the same as case 1, and untouched fields merge alongside it. (The edit
	//    that must survive is the mid-flight one; that is case 3.)
	it('construct → update → save: untouched fields merge and the pre-dispatch edit takes the echo', async () => {
		const fetchSpy = mockFetch({
			body: { id: 't1', text: 'server-normalized', completed: true, serverRevision: 9 },
		});
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'A' });

		todo.update({ text: 'B' });
		await todo.save();

		// The request carried the update, so the response is authoritative over it.
		expect(JSON.parse(fetchSpy.mock.calls[0][1].body).text).toBe('B');
		expect(todo.text).toBe('server-normalized');
		expect(todo.completed).toBe(true); // untouched → merged
		expect(todo.serverRevision).toBe(9); // untouched → merged
	});

	// 3. THE case the revision machinery exists for (finding O-1): the edit lands
	//    after the body was serialized, so the server never saw it and its response
	//    must not roll it back — while every field the user did NOT touch merges.
	//    D158 routes this case through an AUTHOR update transport to prove the guard
	//    belongs to framework reconciliation, not the generated PUT implementation.
	it('save → update mid-flight: an overridden update never overwrites the mid-flight edit', async () => {
		const gate = deferred();
		const sent = [];
		class CustomUpdateTodo extends ApiTodo {
			static adapter = {
				endpoint: '/api/todos',
				update(_fetch, record) {
					sent.push(record.toJSON());
					return gate.promise;
				},
			};
		}
		const store = new Store({ todo: CustomUpdateTodo }, { apiURL: 'https://x.test/v1' });
		const todo = store.upsert('todo', { id: 't1', text: 'A', completed: false });

		const saving = todo.save();
		await Promise.resolve(); // author update captured text 'A'
		expect(sent[0].text).toBe('A');
		todo.update({ text: 'B' });

		gate.resolve({ id: 't1', text: 'A', completed: true, serverRevision: 3 });
		await saving;

		expect(todo.text).toBe('B'); // mid-flight edit survives
		expect(todo.completed).toBe(true); // untouched → server wins
		expect(todo.serverRevision).toBe(3);
		expect(todo._synced).toBe(true);
	});

	// 4. Identity is the store's to change, not the user's: the server-assigned pk
	//    merges with NO throughRevision, so it lands even while a sibling field is
	//    being held back by a mid-flight edit.
	it('save → update mid-flight: a server-assigned pk is still adopted unconditionally', async () => {
		const gate = deferred();
		vi.stubGlobal('fetch', vi.fn(() => gate.promise));
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'temp-1', text: 'A' });

		const saving = todo.save();
		await Promise.resolve();
		todo.update({ text: 'B' });

		gate.resolve(
			makeRes({ body: { id: 'server-99', text: 'A', completed: true } })
		);
		await saving;

		expect(todo.id).toBe('server-99'); // adoption is unconditional
		expect(todo.text).toBe('B'); // mid-flight edit still held back
		expect(todo.completed).toBe(true);
		expect(store.findOne('todo', 'server-99')).toBe(todo);
		expect(store.findOne('todo', 'temp-1')).toBeNull();
	});

	// 5. The path that used to pay for all of this and read none of it. A record
	//    that never saves must behave exactly as before: updates apply, and the
	//    server-authoritative merge sites (upsert/hydrate — no throughRevision)
	//    stay server-authoritative, since no revision can leak into them.
	it('a record never saved behaves identically: updates apply and upsert stays authoritative', async () => {
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'A' });

		todo.update({ text: 'B', completed: true });
		expect(todo.text).toBe('B');
		expect(todo.completed).toBe(true);

		// upsert merges without a revision boundary — server wins even over the
		// field just edited locally.
		const same = store.upsert('todo', { id: 't1', text: 'server', completed: false });
		expect(same).toBe(todo);
		expect(todo.text).toBe('server');
		expect(todo.completed).toBe(false);
		expect(store.findOne('todo', 't1')).toBe(todo);
	});

	// The invariant the change actually introduces, asserted directly: restore the
	// constructor stamp and this is the test that goes red.
	it('reports revision 0 for a constructed record and advances only on update()', () => {
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'A' });
		expect(recordMutationRevision(todo)).toBe(0);

		todo.update({ text: 'B' });
		expect(recordMutationRevision(todo)).toBe(1);

		todo.update({ completed: true });
		expect(recordMutationRevision(todo)).toBe(2);

		// A store-less record constructed directly takes the same path.
		expect(recordMutationRevision(new ApiTodo({ id: 'x', text: 'y' }))).toBe(0);
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
	it('a record from loadMany/_upsert is synced → first save() PUTs', async () => {
		const fetchSpy = mockFetch(
			{ body: [{ id: 't1', text: 'from server' }] }, // loadMany GET
			{ body: '' } // save PUT
		);
		const store = apiStore();
		const [record] = await store.loadMany('todo');
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
			{ body: [{ id: 's1', text: 'srv' }] }, // loadMany GET
			{ body: '' } // save PUT after reload
		);
		const store1 = new Store({ todo: ApiTodo }, { apiURL: 'https://x.test/v1', storage });
		await store1.loadMany('todo'); // _synced true → persisted with the marker
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
		// Let the serialized save chain reach _saveRecordNow's fetch (it runs a
		// microtask later) BEFORE the removal, so the POST is genuinely in flight —
		// a record removed before its request is dispatched never sends one at all.
		await new Promise((r) => setTimeout(r, 0));
		todo.destroy(); // removeRecord mid-flight — notifies once for the removal
		const notifiesAfterRemoval = notifySpy.mock.calls.length;

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
	// These exercise the SERVER delete path, so each record is marked synced: a
	// never-synced record short-circuits to a local removal with no request (§22).
	it('removes locally + notifies on a 2xx', async () => {
		mockFetch({ status: 200, body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		todo._synced = true;
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
		todo._synced = true;

		await todo.delete();
		expect(store.findOne('todo', 't1')).toBeNull();
	});

	it('rejects with PuzzleAdapterError on a 500 and keeps the record', async () => {
		mockFetch({ ok: false, status: 500, statusText: 'Server Error', body: 'boom' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		todo._synced = true;

		await expect(todo.delete()).rejects.toMatchObject({ name: 'PuzzleAdapterError', status: 500, body: 'boom' });
		expect(store.findOne('todo', 't1')).toBe(todo);
	});

	it('DELETEs endpoint/:id (encoded)', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'a/b', text: 'x' });
		todo._synced = true;
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
		todo._synced = true;

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
		a._synced = true;

		const delPromise = a.delete();
		// Let the chained delete reach its fetch first: requestKey 't1' is captured
		// when the link RUNS, and only then is the DELETE genuinely in flight.
		await new Promise((r) => setTimeout(r, 0));
		a.destroy(); // A removed locally
		const b = store.createRecord('todo', { id: 't1', text: 'B' }); // reuse the id

		resolveFetch(makeRes({ status: 200, body: '' }));
		await expect(delPromise).resolves.toBe(a); // resolves with the detached record

		// B is still in the store — the stale delete's removeRecord was skipped because
		// the map no longer holds A at 't1'.
		expect(store.findOne('todo', 't1')).toBe(b);
		expect(b.text).toBe('B');
	});
});

describe('save()/delete() — cross-verb write serialization (§22, D50)', () => {
	// One chain per record covers BOTH verbs: a delete can no longer overtake an
	// in-flight save (server orphan / silently-nothing-deleted), and a queued save
	// can no longer resurrect a record that was removed while it waited.

	// A fetch double that holds the first matching method open until the gate opens,
	// so a later verb is provably queued rather than merely slower.
	const gatedFetch = (gatedMethod, gatedResponse) => {
		const gate = deferred();
		const fn = vi.fn(async (_url, init) => {
			if (init.method === gatedMethod) {
				await gate.promise;
				return makeRes(gatedResponse);
			}
			return makeRes({ status: 204, body: '' });
		});
		vi.stubGlobal('fetch', fn);
		return { fetchSpy: fn, open: gate.resolve };
	};

	it('a delete() fired during a first save() DELETEs the SERVER-assigned id, not the client one', async () => {
		const { fetchSpy, open } = gatedFetch('POST', {
			body: { id: 'server-9', text: 'x', completed: false },
		});
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 'temp-1', text: 'x' });

		const savePromise = todo.save();
		const deletePromise = todo.delete(); // same tick, behind the POST
		open();

		await expect(savePromise).resolves.toBe(todo);
		await expect(deletePromise).resolves.toBe(todo);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
		expect(fetchSpy.mock.calls[1][1].method).toBe('DELETE');
		// The URL proves the delete read the post-reconciliation pk: it was built
		// AFTER the POST adopted 'server-9', so the created row is the row removed.
		expect(fetchSpy.mock.calls[1][0]).toBe('https://x.test/v1/api/todos/server-9');
		expect(store.findOne('todo', 'server-9')).toBeNull();
		expect(store.findOne('todo', 'temp-1')).toBeNull();
		expect(todo._deleted).toBe(true);
	});

	it('delete() on a never-synced record removes it locally with NO request', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		const sub = { onStoreChange: vi.fn() };
		store.withTracking(sub, () => store.findMany('todo'));

		// The server has never seen this record, so there is nothing to DELETE — and a
		// 4xx from a doomed request would strand it locally.
		await expect(todo.delete()).resolves.toBe(todo);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(store.findOne('todo', 't1')).toBeNull();
		expect(todo._deleted).toBe(true);
		store.flush();
		expect(sub.onStoreChange).toHaveBeenCalled(); // removal notifies as usual
	});

	it('a queued save() whose record was removed out of band rejects instead of re-POSTing', async () => {
		const { fetchSpy, open } = gatedFetch('POST', { body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		const first = todo.save();
		const queued = todo.save();
		await new Promise((r) => setTimeout(r, 0)); // the POST is dispatched and held
		todo.destroy(); // local removal while the first POST is still in flight
		open();

		await expect(first).resolves.toBe(todo); // reconciliation skipped, resolves detached
		// Same rejection a fresh save() on a removed record gives — the queued caller
		// cannot tell whether it discovered the removal before or after it was queued.
		await expect(queued).rejects.toThrow(/cannot save a deleted record/);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // the POST only; no resurrecting write
		expect(store.findMany('todo')).toEqual([]);
	});

	it('save(); save(); delete() issues POST, PUT, DELETE in that order', async () => {
		const { fetchSpy, open } = gatedFetch('POST', { body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		const first = todo.save();
		const second = todo.save();
		const deletePromise = todo.delete();
		open();

		await expect(first).resolves.toBe(todo);
		await expect(second).resolves.toBe(todo); // ran while the record was still live
		await expect(deletePromise).resolves.toBe(todo);

		expect(fetchSpy.mock.calls.map((call) => call[1].method)).toEqual([
			'POST',
			'PUT',
			'DELETE',
		]);
		expect(store.findMany('todo')).toEqual([]);
	});

	it('two concurrent delete()s issue exactly one DELETE and both resolve', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });
		todo._synced = true; // server-known → delete() is a real request

		const [a, b] = await Promise.all([todo.delete(), todo.delete()]);

		expect(a).toBe(todo);
		expect(b).toBe(todo); // idempotent: the queued one finds the record already gone
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(store.findMany('todo')).toEqual([]);
	});

	it('a queued delete() does not inherit the prior save()\'s rejection', async () => {
		const fetchSpy = mockFetch(
			{ ok: false, status: 500, statusText: 'Server Error', body: 'boom' }, // POST
			{ body: '' }
		);
		const store = apiStore();
		const todo = store.createRecord('todo', { id: 't1', text: 'x' });

		const savePromise = todo.save();
		const deletePromise = todo.delete();

		await expect(savePromise).rejects.toMatchObject({ name: 'PuzzleAdapterError', status: 500 });
		// Each caller observes only its own promise. The failed create also left the
		// record server-unknown, so the delete is local-only.
		await expect(deletePromise).resolves.toBe(todo);
		expect(fetchSpy).toHaveBeenCalledTimes(1); // the failed POST only
		expect(store.findMany('todo')).toEqual([]);
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
	it('save() on a model without an adapter names the missing create verb', async () => {
		class Plain extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), text: Puzzle.string() };
		}
		const store = new Store({ plain: Plain }, { apiURL: 'https://x.test' });
		const fetchSpy = mockFetch({ body: '' });
		const rec = store.createRecord('plain', { id: 'p1', text: 'x' });
		await expect(rec.save()).rejects.toThrow(/no adapter create\(\) declared for 'plain'/);
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

	it('request() rejects when the model declares no endpoint', async () => {
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

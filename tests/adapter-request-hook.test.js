// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

// Adapter request hook (constellation/doc/DOC-SPEC.md, v1.55, D91): one
// synchronous `beforeRequest(init, { type, method, url })` in front of EVERY
// adapter fetch — the D21 read path (loadAll/loadOne) and the D50 write verbs
// (save/delete/request) alike — so auth headers, credentials, and AbortSignals
// attach in one place instead of forcing apps off the adapter design entirely.

class ApiTodo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};
	static adapter = { endpoint: '/api/todos' };
}

const API = 'https://x.test/v1';

// Same Response-shaped mock + queue idiom as tests/adapter-write.test.js:
// readBody() reads via res.text(), the read path via res.json().
const makeRes = ({ ok = true, status = 200, statusText = 'OK', body = '' } = {}) => ({
	ok,
	status,
	statusText,
	text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

const mockFetch = (...responses) => {
	const queue = responses.map((r) => (r instanceof Object && 'text' in r ? r : makeRes(r)));
	const fn = vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]));
	vi.stubGlobal('fetch', fn);
	return fn;
};

// A store with the hook wired; `beforeRequest: undefined` exercises the no-hook path.
const hookedStore = (beforeRequest) => new Store({ todo: ApiTodo }, { apiURL: API, beforeRequest });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('beforeRequest — fires for every adapter verb with the right context', () => {
	it('loadAll: GET the collection endpoint', async () => {
		mockFetch({ body: [{ id: 't1', text: 'a' }] });
		const calls = [];
		const store = hookedStore((init, ctx) => calls.push(ctx));

		await store.loadAll('todo');

		expect(calls).toEqual([{ type: 'todo', method: 'GET', url: `${API}/api/todos` }]);
	});

	it('loadOne: GET endpoint/:id (the encoded URL the request actually uses)', async () => {
		mockFetch({ body: { id: 'a b', text: 'a' } });
		const calls = [];
		const store = hookedStore((init, ctx) => calls.push(ctx));

		await store.loadOne('todo', 'a b');

		expect(calls).toEqual([{ type: 'todo', method: 'GET', url: `${API}/api/todos/a%20b` }]);
	});

	it('save(): POST on a first save, PUT on the next', async () => {
		mockFetch({ body: '' });
		const calls = [];
		const store = hookedStore((init, ctx) => calls.push(ctx));
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();
		await todo.save();

		expect(calls).toEqual([
			{ type: 'todo', method: 'POST', url: `${API}/api/todos` },
			{ type: 'todo', method: 'PUT', url: `${API}/api/todos/t1` },
		]);
	});

	it('delete(): DELETE endpoint/:id', async () => {
		mockFetch({ body: '' });
		const calls = [];
		const store = hookedStore((init, ctx) => calls.push(ctx));
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });
		todo._synced = true; // a never-synced delete() skips the network entirely

		await todo.delete();

		expect(calls).toEqual([{ type: 'todo', method: 'DELETE', url: `${API}/api/todos/t1` }]);
	});

	it('request(): the caller-chosen method and the prefixed path', async () => {
		mockFetch({ body: '' });
		const calls = [];
		const store = hookedStore((init, ctx) => calls.push(ctx));

		await store.request('todo', '/t1/archive', { method: 'POST', body: { reason: 'done' } });

		expect(calls).toEqual([{ type: 'todo', method: 'POST', url: `${API}/api/todos/t1/archive` }]);
	});

	it('runs once per request, before fetch, with the init fetch will receive', async () => {
		const order = [];
		const fetchSpy = vi.fn(async () => {
			order.push('fetch');
			return makeRes({ body: [] });
		});
		vi.stubGlobal('fetch', fetchSpy);
		const store = hookedStore((init) => {
			order.push('hook');
			init.headers = { Authorization: 'Bearer t' };
		});

		await store.loadAll('todo');

		expect(order).toEqual(['hook', 'fetch']);
		expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer t');
	});
});

describe('beforeRequest — mutate in place OR return a replacement', () => {
	it('mutating init in place attaches headers/credentials on the read path', async () => {
		const fetchSpy = mockFetch({ body: [] });
		const store = hookedStore((init) => {
			init.headers = { ...(init.headers || {}), Authorization: 'Bearer abc' };
			init.credentials = 'include';
		});

		await store.loadAll('todo');

		const init = fetchSpy.mock.calls[0][1];
		expect(init.method).toBe('GET');
		expect(init.headers).toEqual({ Authorization: 'Bearer abc' });
		expect(init.credentials).toBe('include');
	});

	it('mutating in place merges with the write path headers the store already set', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore((init) => {
			init.headers.Authorization = 'Bearer abc';
		});
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();

		const init = fetchSpy.mock.calls[0][1];
		expect(init.headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: 'Bearer abc',
		});
	});

	it('a returned object replaces init (method/body still carried over)', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore((init) => ({
			...init,
			headers: { ...init.headers, Authorization: 'Bearer abc' },
			credentials: 'include',
			mode: 'cors',
			cache: 'no-store',
		}));
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();

		const init = fetchSpy.mock.calls[0][1];
		expect(init.credentials).toBe('include');
		expect(init.mode).toBe('cors');
		expect(init.cache).toBe('no-store');
		expect(init.headers.Authorization).toBe('Bearer abc');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ id: 't1', text: 'a', completed: false });
	});

	it('a replacement that drops method/body gets both re-stamped', async () => {
		const fetchSpy = mockFetch({ body: '' });
		// Deliberately hostile: a bare object with none of the original fields.
		const store = hookedStore(() => ({ credentials: 'include' }));
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();

		const init = fetchSpy.mock.calls[0][1];
		expect(init.credentials).toBe('include');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ id: 't1', text: 'a', completed: false });
	});

	// The re-stamp below writes method/body, so the replacement it writes into must
	// be one the STORE owns — `Object.freeze({ ...init, headers })` is the natural
	// shape of a spread-style hook and must not TypeError out of the data layer.
	it('a FROZEN replacement is copied, not written into — save() completes', async () => {
		const fetchSpy = mockFetch({ body: '' });
		let returned = null;
		const store = hookedStore((init) => {
			returned = Object.freeze({
				...init,
				headers: { ...init.headers, Authorization: 'Bearer t' },
			});
			return returned;
		});
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();

		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe(`${API}/api/todos`);
		expect(init).not.toBe(returned); // a copy the store owns, not the app's object
		expect(init.headers.Authorization).toBe('Bearer t');
		expect(init.headers['Content-Type']).toBe('application/json');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ id: 't1', text: 'a', completed: false });
		expect(todo._synced).toBe(true);
	});

	it('a FROZEN replacement on the read path completes (body is deleted off the copy)', async () => {
		const fetchSpy = mockFetch({ body: [{ id: 't1', text: 'a' }] });
		const store = hookedStore((init) =>
			Object.freeze({ ...init, headers: { Authorization: 'Bearer t' } })
		);

		const todos = await store.loadAll('todo');

		const init = fetchSpy.mock.calls[0][1];
		expect(init.method).toBe('GET');
		expect(init.headers).toEqual({ Authorization: 'Bearer t' });
		expect('body' in init).toBe(false);
		expect(todos.map((t) => t.id)).toEqual(['t1']);
	});

	it('a getter-only method on the replacement is flattened, then re-stamped', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore((init) => ({
			...init,
			get method() {
				return 'DELETE';
			},
		}));
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();

		expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
	});

	it('a non-object return (undefined/null/false) keeps the mutated original', async () => {
		const fetchSpy = mockFetch({ body: [] });
		const store = hookedStore((init) => {
			init.credentials = 'omit';
			return null;
		});

		await store.loadAll('todo');

		expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit' });
	});
});

describe('beforeRequest — cannot change what the request IS', () => {
	// The D50 write path captures `requestKey = record[pk]` BEFORE the await and
	// reconciles against exactly that key afterwards; a hook that flipped the verb
	// or rewrote the body would silently desync identity re-checks and pk adoption.
	it('a hook that rewrites method/body is overridden on the write path', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore((init) => {
			init.method = 'DELETE';
			init.body = JSON.stringify({ hacked: true });
		});
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();

		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe(`${API}/api/todos`);
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ id: 't1', text: 'a', completed: false });
	});

	it('a hook that adds a body to a GET is overridden (no body reaches fetch)', async () => {
		const fetchSpy = mockFetch({ body: [] });
		const store = hookedStore((init) => {
			init.method = 'POST';
			init.body = 'sneaky';
		});

		await store.loadAll('todo');

		const init = fetchSpy.mock.calls[0][1];
		expect(init.method).toBe('GET');
		expect('body' in init).toBe(false);
	});

	it('a hook that rewrites the DELETE verb is overridden', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore((init) => {
			init.method = 'GET';
		});
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });
		todo._synced = true; // a never-synced delete() skips the network entirely

		await todo.delete();

		expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE');
		expect(store.findOne('todo', 't1')).toBeNull();
	});

	it('the URL is out of reach — the hook never sees a writable one', async () => {
		const fetchSpy = mockFetch({ body: [] });
		const store = hookedStore((init, ctx) => {
			init.url = 'https://evil.test/steal';
			try {
				ctx.url = 'https://evil.test/steal';
			} catch {
				/* frozen context: strict-mode assignment throws, which is the point */
			}
		});

		await store.loadAll('todo');

		expect(fetchSpy.mock.calls[0][0]).toBe(`${API}/api/todos`);
	});
});

describe('beforeRequest — the context argument is frozen', () => {
	it('Object.isFrozen(context) is true and writes do not take', async () => {
		mockFetch({ body: [] });
		let captured = null;
		const store = hookedStore((init, ctx) => {
			captured = ctx;
		});

		await store.loadAll('todo');

		expect(Object.isFrozen(captured)).toBe(true);
		expect(() => {
			'use strict';
			captured.type = 'other';
		}).toThrow(TypeError);
		expect(captured.type).toBe('todo');
	});
});

describe('beforeRequest — a throwing hook rejects the operation', () => {
	it('loadAll rejects with the thrown error and never fetches', async () => {
		const fetchSpy = mockFetch({ body: [] });
		const store = hookedStore(() => {
			throw new Error('no auth token');
		});

		await expect(store.loadAll('todo')).rejects.toThrow('no auth token');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('save() rejects, no request is made, and the record stays unsynced', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore(() => {
			throw new Error('session expired');
		});
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await expect(todo.save()).rejects.toThrow('session expired');
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(todo._synced).toBeFalsy();
	});

	it('delete() rejects and the record stays', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore(() => {
			throw new Error('session expired');
		});
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });
		todo._synced = true; // a never-synced delete() skips the network entirely

		await expect(todo.delete()).rejects.toThrow('session expired');
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(store.findOne('todo', 't1')).toBe(todo);
	});

	it('request() rejects', async () => {
		mockFetch({ body: '' });
		const store = hookedStore(() => {
			throw new Error('session expired');
		});
		await expect(store.request('todo', '/x')).rejects.toThrow('session expired');
	});
});

describe('beforeRequest — an AbortSignal attached by the hook actually aborts', () => {
	it('aborting mid-flight rejects the in-flight load', async () => {
		// A fetch that honors the signal (the mock stands in for the real one).
		const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(url, init) =>
					new Promise((resolve, reject) => {
						const signal = init?.signal;
						if (!signal) return; // no signal arrived → hangs, and the test times out
						if (signal.aborted) return reject(abortError());
						signal.addEventListener('abort', () => reject(abortError()));
					})
			)
		);
		const controller = new AbortController();
		const store = hookedStore((init) => {
			init.signal = controller.signal;
		});

		const pending = store.loadAll('todo');
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('an already-aborted signal rejects the save immediately', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url, init) => {
				if (init?.signal?.aborted) {
					throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
				}
				return makeRes({ body: '' });
			})
		);
		const controller = new AbortController();
		controller.abort();
		const store = hookedStore((init) => {
			init.signal = controller.signal;
		});
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await expect(todo.save()).rejects.toMatchObject({ name: 'AbortError' });
		expect(todo._synced).toBeFalsy();
	});
});

describe('no hook configured — requests are byte-identical to before (regression guard)', () => {
	it('store.beforeRequest is null when absent or not a function', () => {
		expect(new Store({ todo: ApiTodo }, { apiURL: API }).beforeRequest).toBeNull();
		expect(hookedStore(undefined).beforeRequest).toBeNull();
		expect(hookedStore('Bearer abc').beforeRequest).toBeNull();
		expect(hookedStore({}).beforeRequest).toBeNull();
		const fn = () => {};
		expect(hookedStore(fn).beforeRequest).toBe(fn);
	});

	it('a non-function config value is ignored, not invoked', async () => {
		const fetchSpy = mockFetch({ body: [] });
		const store = hookedStore('Bearer abc');
		await store.loadAll('todo');
		expect(fetchSpy).toHaveBeenCalledWith(`${API}/api/todos`, { method: 'GET' });
	});

	it('loadAll / loadOne pass exactly (url, { method: GET })', async () => {
		const fetchSpy = mockFetch({ body: [] }, { body: { id: 't1', text: 'a' } });
		const store = hookedStore(undefined);

		await store.loadAll('todo');
		await store.loadOne('todo', 't1');

		expect(fetchSpy.mock.calls[0]).toEqual([`${API}/api/todos`, { method: 'GET' }]);
		expect(fetchSpy.mock.calls[1]).toEqual([`${API}/api/todos/t1`, { method: 'GET' }]);
	});

	it('save() passes exactly (url, { method, headers, body })', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore(undefined);
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });

		await todo.save();

		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe(`${API}/api/todos`);
		// Exactly three init keys — nothing added, nothing dropped.
		expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'method']);
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(JSON.parse(init.body)).toEqual({ id: 't1', text: 'a', completed: false });
	});

	it('delete() passes exactly (url, { method: DELETE })', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore(undefined);
		const todo = store.createRecord('todo', { id: 't1', text: 'a' });
		todo._synced = true; // a never-synced delete() skips the network entirely

		await todo.delete();

		expect(fetchSpy.mock.calls[0]).toEqual([`${API}/api/todos/t1`, { method: 'DELETE' }]);
	});

	it('request() passes exactly the init it built', async () => {
		const fetchSpy = mockFetch({ body: '' });
		const store = hookedStore(undefined);

		await store.request('todo', '/t1/archive', {
			method: 'POST',
			body: { reason: 'done' },
			headers: { 'X-Trace': '1' },
		});

		expect(fetchSpy.mock.calls[0]).toEqual([
			`${API}/api/todos/t1/archive`,
			{
				method: 'POST',
				headers: { 'X-Trace': '1', 'Content-Type': 'application/json' },
				body: JSON.stringify({ reason: 'done' }),
			},
		]);
	});
});

describe('PuzzleApp config threading (v1.55, D91)', () => {
	class HomeView extends PuzzleView {
		render() {
			return new ViewNode('puzzle-view', {}, []);
		}
	}

	const container = () => {
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		return el;
	};

	let app = null;

	beforeEach(() => {
		history.replaceState({}, '', '/');
		document.body.innerHTML = '';
	});

	afterEach(() => {
		app?.unmount();
		app = null;
	});

	const boot = async (extra) => {
		container();
		app = new PuzzleApp({
			target: '#app',
			apiURL: API,
			models: { todo: ApiTodo },
			routes: [{ path: '/', name: 'home', view: HomeView }],
			...extra,
		});
		await app.mount();
		return app;
	};

	it('config.beforeRequest reaches the store and runs on adapter reads', async () => {
		const fetchSpy = mockFetch({ body: [{ id: 't1', text: 'a' }] });
		const hook = vi.fn((init) => {
			init.headers = { Authorization: 'Bearer app' };
		});
		await boot({ beforeRequest: hook });

		await app.store.loadAll('todo');

		expect(app.store.beforeRequest).toBe(hook);
		expect(hook).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer app');
	});

	it('omitting it leaves the Store default (null) — the conditional-pass convention', async () => {
		mockFetch({ body: [] });
		await boot({});
		expect(app.store.beforeRequest).toBeNull();
	});
});

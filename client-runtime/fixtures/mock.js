/**
 * Mock adapter (v1.57, D95) — an in-memory REST server behind the model's own
 * `static adapter = { endpoint, mock: { … } }` declaration, or behind the
 * fixtures file's `mock` block.
 *
 * Part of the detachable `/fixtures` module (D98): nothing in the core runtime
 * imports this file. Interception happens in `Store._network` — the seam the
 * adapter capability installs — which `installFixtures()` replaces on the prototype. That
 * placement is the entire point of the design: `loadMany` / `loadOne` / `save()` /
 * `delete()` / `request()` run COMPLETELY UNMODIFIED, so what a mocked app
 * exercises is the real D21 read path and the real D50 write path (pk adoption,
 * the `_synced` flip, the identity re-checks), not a parallel test-only code path.
 *
 * That is also why `_fetch` must hand back a Response-SHAPED object: its callers
 * use `res.ok`, `res.status`, `res.statusText`, `res.json()` (_fetchAdapter) and
 * `res.text()` (readBody). Only those five. The real `Response` constructor is
 * deliberately NOT used — it is not uniformly available across the Node/jsdom
 * environments this has to run in. Because it fails `instanceof Response`, the
 * stand-in carries RESPONSE_BRAND so the adapter's `isResponse()` normalizes an
 * author verb that returns the enhanced fetch's result (the D158 idiom) exactly
 * as it would a real one — a brand, not a duck-type on `ok`/`status`, which user
 * data could match.
 *
 * Two knobs exist because the runtime has no other way to reach these states:
 * `latency` makes `<puzzle-skeleton>` and its D39/D52 anti-flash minimum
 * developable (a localhost API answering in 2ms never shows a skeleton), and
 * `fail`/`failRate` are the ONLY supported way to make a `data()` reject on
 * purpose — which D52 tells authors to handle, with nothing to trigger it.
 */

import { stateFor } from './state.js';

// Registry symbol, NOT an import from the adapter: `/fixtures` and `/adapter` are
// separately bundled subpaths, so a shared module reference would drag one into
// the other's graph. Symbol.for makes the two agree by key instead.
const RESPONSE_BRAND = Symbol.for('puzzle.response');

// Only the statuses this module emits; anything else reports an empty text,
// which is what a Response with an unknown status effectively gives you anyway.
const STATUS_TEXT = {
	200: 'OK',
	201: 'Created',
	204: 'No Content',
	400: 'Bad Request',
	404: 'Not Found',
	500: 'Internal Server Error',
};

// Warn-once per model CLASS. A mock block is developer-authored, but a stale one
// is exactly the failure mode nobody notices ("why is my data wrong?"), so the
// runtime says so once per session. Not env-gated: production builds drop
// console.* by default (build.dropConsole), and the framework's advisory
// warnings are dev-mode-only by design — see the D95 production-posture note.
const WARNED = new WeakSet();

/**
 * A minimal Response stand-in: exactly the surface store.js reads. `json()`
 * re-parses the serialized text on every call, so a caller that mutates the
 * parsed body can never reach back into the mock's own collection.
 */
export function mockResponse(status, body) {
	const text = body === undefined ? '' : JSON.stringify(body);
	return {
		[RESPONSE_BRAND]: true,
		ok: status >= 200 && status < 300,
		status,
		statusText: STATUS_TEXT[status] || '',
		text: async () => text,
		// Matches the real thing: json() on an empty body rejects.
		json: async () => JSON.parse(text),
	};
}

const notFound = (method, url) =>
	mockResponse(404, { error: `[puzzle] mock: no record for ${method} ${url}` });

/**
 * The mock's live collection for `type`, lazily built from the mock config's
 * `data` on first use and then owned by the store's fixture state — a `save()`
 * followed by a `loadMany()` MUST see the new record. Deep-cloned at init so the
 * fixture array a test passes in is never mutated underneath it.
 */
function mockCollection(state, type, config, pk) {
	if (!state.mockCollections) state.mockCollections = new Map();
	const existing = state.mockCollections.get(type);
	if (existing) return existing;

	const collection = new Map();
	const seedData = Array.isArray(config.data) ? config.data : [];
	for (const entry of seedData) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const copy = structuredClone(entry);
		if (copy[pk] == null) copy[pk] = nextMockId(state);
		collection.set(copy[pk], copy);
	}
	state.mockCollections.set(type, collection);
	return collection;
}

/** Server-assigned key for a POST (or a fixture) that arrives without one. */
function nextMockId(state) {
	state.mockIdN += 1;
	return `mock-${state.mockIdN}`;
}

/**
 * Resolve a URL id segment against the collection's real key. URL segments are
 * always strings while a pk is often a number, so `/api/todos/1` has to find the
 * record keyed under `1`.
 */
function resolveKey(collection, id) {
	if (collection.has(id)) return id;
	const asNumber = Number(id);
	if (id !== '' && !Number.isNaN(asNumber) && collection.has(asNumber)) return asNumber;
	return undefined;
}

/** The request path relative to `apiURL + endpoint` — '' for the collection. */
function requestPath(store, endpoint, url) {
	const base = store.apiURL + endpoint;
	return url.startsWith(base) ? url.slice(base.length) : url;
}

/** decodeURIComponent, but a malformed escape yields the raw segment (never a throw). */
function safeDecode(segment) {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** JSON init bodies parse; anything else passes through raw. */
function parseBody(raw) {
	if (typeof raw !== 'string') return raw;
	if (raw === '') return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

/**
 * Latency for one request: a number, or a deterministic pick inside `[min, max]`.
 * Drawn from the seeded stream, like everything else, so a run replays exactly.
 */
function latencyFor(config, rand) {
	const { latency } = config;
	if (Array.isArray(latency)) {
		const [min = 0, max = 0] = latency;
		if (!(max > min)) return Math.max(0, min);
		return Math.max(0, Math.round(min + rand() * (max - min)));
	}
	return typeof latency === 'number' && latency > 0 ? latency : 0;
}

/**
 * Default CRUD, dispatched on method + URL shape. Shaped so the REAL D50 write
 * path is exercised: POST answers 201 with the stored object (that body is what
 * drives pk adoption and the `_synced` flip), PUT answers the merged object, and
 * DELETE answers a bodiless 204.
 */
function defaultCrud({ method, path, body, collection, pk, state, url }) {
	const pathname = path.split('?')[0];
	const isCollection = pathname === '' || pathname === '/';
	const segment = isCollection ? null : pathname.slice(1);
	// A deeper path (`/1/archive`) is a custom route — only `handler` can serve it.
	const id = segment !== null && !segment.includes('/') ? safeDecode(segment) : null;

	if (method === 'GET') {
		if (isCollection) return mockResponse(200, [...collection.values()]);
		if (id === null) return notFound(method, url);
		const key = resolveKey(collection, id);
		return key === undefined ? notFound(method, url) : mockResponse(200, collection.get(key));
	}

	if (method === 'POST' && isCollection) {
		if (!isPlainObject(body)) {
			return mockResponse(400, { error: '[puzzle] mock: POST expects a JSON object body' });
		}
		const record = { ...body };
		if (record[pk] == null) record[pk] = nextMockId(state);
		collection.set(record[pk], record);
		return mockResponse(201, record);
	}

	if (method === 'PUT' && id !== null) {
		const key = resolveKey(collection, id);
		if (key === undefined) return notFound(method, url);
		if (!isPlainObject(body)) {
			return mockResponse(400, { error: '[puzzle] mock: PUT expects a JSON object body' });
		}
		const current = collection.get(key);
		// The stored pk wins: a PUT never re-keys the collection.
		const merged = { ...current, ...body, [pk]: current[pk] };
		collection.set(key, merged);
		return mockResponse(200, merged);
	}

	if (method === 'DELETE' && id !== null) {
		const key = resolveKey(collection, id);
		if (key === undefined) return notFound(method, url);
		collection.delete(key);
		return mockResponse(204, undefined);
	}

	return notFound(method, url);
}

/**
 * Serve one adapter request from the merged mock config (v1.57, D95). Called by
 * the `/fixtures` module's `_network` replacement, i.e. AFTER `beforeRequest` has
 * run — the hook still fires in mock mode (a test can assert it fired and inspect
 * the init), there is simply no network at the end of it.
 *
 * Every random draw happens SYNCHRONOUSLY here, before the delay: with concurrent
 * requests in flight, drawing the failure roll after an await would make the
 * outcome depend on timer interleaving, and a "deterministic" failure that moves
 * when a test gets slower is not deterministic at all.
 *
 * A failure resolves a non-ok 500 rather than rejecting the fetch, so it flows
 * through the real error paths — `PuzzleAdapterError` for every verb, reads
 * included (D161) — instead of surfacing as a network exception the
 * store has no contract for.
 *
 * @param {Store}  store
 * @param {string} type    registry type name (from the frozen request context)
 * @param {object} config  the model's `adapter.mock` block merged with the
 *   fixtures file's `mock[type]` entry (the file wins per key)
 * @param {string} url     the fully built request URL
 * @param {object} init    the fetch init, post-hook
 * @returns {Promise<object>} a Response-shaped object (ok/status/statusText/text/json)
 */
export function mockFetch(store, type, config, url, init) {
	const Model = store.modelFor(type);
	if (!WARNED.has(Model)) {
		WARNED.add(Model);
		console.warn(
			`[puzzle] model '${type}' is served by its adapter mock — no request reaches ${Model.adapter?.endpoint}`
		);
	}

	const state = stateFor(store);
	const pk = Model.primaryKey();
	const collection = mockCollection(state, type, config, pk);
	const wait = latencyFor(config, state.mockRand);
	// `fail: true` forces every request (no draw); failRate only draws when it is
	// actually in use, so turning it on later cannot shift an existing sequence.
	const failed =
		config.fail === true ||
		(typeof config.failRate === 'number' && config.failRate > 0 && state.mockRand() < config.failRate);

	const method = String(init.method || 'GET').toUpperCase();
	const path = requestPath(store, Model.adapter?.endpoint || '', url);
	const body = parseBody(init.body);

	const respond = () => {
		if (failed) {
			return mockResponse(500, { error: `[puzzle] mock failure for ${method} ${url}` });
		}
		if (typeof config.handler === 'function') {
			// Escape hatch for the arbitrary paths request() can build — without it
			// a custom endpoint cannot be mocked at all. A falsy return falls through.
			const handled = config.handler({ method, url, path, body, collection });
			if (handled) return mockResponse(handled.status ?? 200, handled.body);
		}
		return defaultCrud({ method, path, body, collection, pk, state, url });
	};

	if (wait <= 0) return Promise.resolve(respond());
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			try {
				resolve(respond());
			} catch (err) {
				reject(err);
			}
		}, wait);
	});
}

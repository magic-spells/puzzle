import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Store } from '../client-runtime/datastore/store.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

const API = 'https://x.test';

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: status === 404 ? 'Not Found' : 'OK',
	text: async () => (body === undefined ? '' : JSON.stringify(body)),
	json: async () => body,
});

/** One tracked pass, spelled the way PuzzleView's settle loop spells it. */
function trackedPass(store, fn, subscriber = {}) {
	const requests = new Map();
	const value = store.withTracking(subscriber, fn, false, {}, requests);
	return { value, requests };
}

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
	};
	static adapter = { endpoint: '/api/posts' };
}

/** Purely local: no `static adapter` at all — the local-first model shape. */
class Note extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), body: Puzzle.string() };
}

/** Server-backed for WRITES only: no endpoint, and no authored read verb. */
class Draft extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), body: Puzzle.string() };
	static adapter = { create: async () => ({ id: 'd1', body: 'saved' }) };
}

/** No endpoint, but an authored read verb — D161 says this one may fault. */
const authoredLoadMany = vi.fn(async () => [{ id: 'm1', body: 'authored' }]);
class Memo extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), body: Puzzle.string() };
	static adapter = { loadMany: authoredLoadMany };
}

/** The app-wide dialect the scaffold's `app/adapter.js` comment teaches. */
const endpointDialect = () =>
	adapter.defaults({
		loadMany: async (fetch, _options, { endpoint }) =>
			(await (await fetch(API + endpoint)).json()).data,
		loadOne: async (fetch, id, { endpoint }) =>
			(await (await fetch(`${API}${endpoint}/${id}`)).json()).data,
	});

const makeStore = (capability) =>
	new Store(
		{ post: Post, note: Note, draft: Draft, memo: Memo },
		{ apiURL: API, adapter: capability }
	);

let fetchMock;

beforeEach(() => {
	fetchMock = vi.fn(async () => json({ data: [] }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	authoredLoadMany.mockClear();
});

describe('app-wide adapter defaults never make a local model fault (D161 / SKILL "no adapter, no read verb")', () => {
	it('a model with no static adapter stays pure-local under an app-wide dialect', async () => {
		const store = makeStore(endpointDialect());

		const { value, requests } = trackedPass(store, () => ({
			notes: store.findMany('note'),
			one: store.findOne('note', 'n1'),
		}));

		expect(value.notes).toEqual([]);
		expect(value.one).toBeNull();
		expect(requests.size).toBe(0);
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('a model that declares only a write verb stays pure-local', async () => {
		const store = makeStore(endpointDialect());

		const { requests } = trackedPass(store, () => ({
			drafts: store.findMany('draft'),
			one: store.findOne('draft', 'd1'),
		}));

		expect(requests.size).toBe(0);
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('an endpoint model still faults through the app-wide dialect', async () => {
		fetchMock.mockResolvedValueOnce(json({ data: [{ id: 'p1', title: 'Post' }] }));
		const store = makeStore(endpointDialect());

		const first = trackedPass(store, () => store.findMany('post'));
		expect(first.requests.size).toBe(1);
		await Promise.all(first.requests.values());

		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${API}/api/posts`]);
		expect(trackedPass(store, () => store.findMany('post')).value).toMatchObject([
			{ title: 'Post' },
		]);
	});

	it('an authored read verb faults with no endpoint (D161: endpoints are not required)', async () => {
		const store = makeStore(endpointDialect());

		const first = trackedPass(store, () => store.findMany('memo'));
		expect(first.requests.size).toBe(1);
		await Promise.all(first.requests.values());

		expect(authoredLoadMany).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(trackedPass(store, () => store.findMany('memo')).value).toMatchObject([
			{ body: 'authored' },
		]);
	});

	it('an EXPLICIT store.loadMany still dispatches through the dialect for an endpoint-less model', async () => {
		// D158's app-default tier is unchanged for imperative loads: only the
		// automatic (tracked) fault path requires the model to declare server intent.
		const byType = adapter.defaults({
			loadMany: async (_fetch, _options, { type }) => [{ id: `${type}-1`, body: type }],
		});
		const store = makeStore(byType);

		await expect(store.loadMany('note')).resolves.toMatchObject([{ body: 'note' }]);
	});
});

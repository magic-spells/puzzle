import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter, PuzzleAdapterError } from '../client-runtime/datastore/adapter.js';
import { isConfiguredAdapter } from '../client-runtime/capabilities.js';
import { Store } from '../client-runtime/datastore/store.js';
import { installFixtures } from '../client-runtime/fixtures/index.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

const API = 'https://x.test/v1';

const response = (body, init = {}) =>
	new Response(body === undefined ? null : JSON.stringify(body), {
		status: init.status || 200,
		statusText: init.statusText,
		headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
	});

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
		published: Puzzle.boolean().default(false),
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('author adapter transports', () => {
	it('accepts parsed envelope data from author loadMany/loadOne functions', async () => {
		class EnvelopePost extends Post {
			static adapter = {
				async loadMany(fetch) {
					return (await (await fetch('/v2/posts')).json()).data;
				},
				async loadOne(fetch, id) {
					return (await (await fetch(`/v2/posts/${id}`)).json()).data;
				},
			};
		}
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(response({ data: [{ id: 'p1', title: 'All' }] }))
			.mockResolvedValueOnce(response({ data: { id: 'p2', title: 'One' } }));
		vi.stubGlobal('fetch', fetchSpy);
		const store = new Store({ post: EnvelopePost });

		const all = await store.loadMany('post');
		const one = await store.loadOne('post', 'p2');

		expect(all.map((post) => post.id)).toEqual(['p1']);
		expect(one.title).toBe('One');
		expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/v2/posts', '/v2/posts/p2']);
	});

	it('accepts a Response-return one-liner and normalizes non-OK responses', async () => {
		class ResponsePost extends Post {
			static adapter = { loadMany: (fetch) => fetch('/v2/posts') };
		}
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(response([{ id: 'p1', title: 'One line' }]))
			.mockResolvedValueOnce(
				response({ error: 'denied' }, { status: 403, statusText: 'Forbidden' })
			);
		vi.stubGlobal('fetch', fetchSpy);
		const store = new Store({ post: ResponsePost });

		await expect(store.loadMany('post')).resolves.toHaveLength(1);
		const failure = store.loadMany('post');
		await expect(failure).rejects.toBeInstanceOf(PuzzleAdapterError);
		await expect(failure).rejects.toMatchObject({
			status: 403,
			statusText: 'Forbidden',
			body: { error: 'denied' },
		});
	});

	it('supports a fully custom adapter with no endpoint and global fetch', async () => {
		class CustomPost extends Post {
			static adapter = {
				async loadMany() {
					const res = await fetch('/bespoke/posts?state=live');
					return (await res.json()).items;
				},
				async loadOne(_fetch, id) {
					return (await (await fetch(`/bespoke/posts/${id}`)).json()).item;
				},
				async create(_fetch, record) {
					return (
						await (
							await fetch('/bespoke/posts', {
								method: 'POST',
								body: JSON.stringify(record.toJSON()),
							})
						).json()
					).item;
				},
				async update(_fetch, record) {
					return (
						await (
							await fetch(`/bespoke/posts/${record.id}`, {
								method: 'POST',
								body: JSON.stringify(record.toJSON()),
							})
						).json()
					).item;
				},
				delete(_fetch, record) {
					return fetch(`/bespoke/posts/${record.id}`, { method: 'DELETE' });
				},
			};
		}
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(response({ items: [{ id: 'p1', title: 'Live' }] }))
			.mockResolvedValueOnce(response({ item: { id: 'p2', title: 'One' } }))
			.mockResolvedValueOnce(response({ item: { id: 'p3', title: 'Created' } }))
			.mockResolvedValueOnce(response({ item: { id: 'p3', title: 'Updated' } }))
			.mockResolvedValueOnce(response(undefined, { status: 204 }));
		vi.stubGlobal('fetch', fetchSpy);
		const beforeRequest = vi.fn();
		const store = new Store({ post: CustomPost }, { apiURL: API, beforeRequest });

		await expect(store.loadMany('post')).resolves.toHaveLength(1);
		await expect(store.loadOne('post', 'p2')).resolves.toMatchObject({ title: 'One' });
		const post = store.createRecord('post', { id: 'p3', title: 'Draft' });
		await post.save();
		post.update({ title: 'Local update' });
		await post.save();
		await post.delete();

		expect(fetchSpy.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
			['/bespoke/posts?state=live', undefined],
			['/bespoke/posts/p2', undefined],
			['/bespoke/posts', 'POST'],
			['/bespoke/posts/p3', 'POST'],
			['/bespoke/posts/p3', 'DELETE'],
		]);
		expect(store.findOne('post', 'p3')).toBeNull();
		expect(beforeRequest).not.toHaveBeenCalled();
	});

	it('reports the exact missing verb on a partial no-endpoint adapter', async () => {
		class ReadOnlyPost extends Post {
			static adapter = { loadMany: async () => [{ id: 'p1', title: 'Read only' }] };
		}
		const store = new Store({ post: ReadOnlyPost });
		await store.loadMany('post');
		const post = store.createRecord('post', { id: 'p2', title: 'Unsavable' });

		await expect(post.save()).rejects.toThrow(
			"[puzzle] no adapter create() declared for 'post'"
		);
	});
});

describe('pagination', () => {
	it('serializes generated options, forwards author options verbatim, and accumulates pages', async () => {
		class RestPost extends Post {
			static adapter = { endpoint: '/posts' };
		}
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(response([{ id: 'p1', title: 'Page one' }]))
			.mockResolvedValueOnce(response([{ id: 'p2', title: 'Page two' }]));
		vi.stubGlobal('fetch', fetchSpy);
		const restStore = new Store({ post: RestPost }, { apiURL: API });

		await restStore.loadMany('post', { page: 1, cursor: null, limit: 20 });
		await restStore.loadMany('post', { page: 2, cursor: undefined, limit: 20 });

		expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
			`${API}/posts?page=1&limit=20`,
			`${API}/posts?page=2&limit=20`,
		]);
		expect(restStore.findMany('post').map((post) => post.id)).toEqual(['p1', 'p2']);

		const options = { cursor: 'next', limit: 5 };
		let received;
		class PaginatedPost extends Post {
			static adapter = {
				loadMany(_fetch, value) {
					received = value;
					return [{ id: 'p3', title: 'Author page' }];
				},
			};
		}
		await new Store({ post: PaginatedPost }).loadMany('post', options);
		expect(received).toBe(options);
	});
});

describe('bound adapter surface and enhanced fetch', () => {
	it('memoizes store.adapter(type) and binds custom methods that compose with upsert', async () => {
		class PublishPost extends Post {
			static adapter = {
				endpoint: '/posts',
				async publish(fetch, id) {
					return (await fetch(`${API}/posts/${id}/publish`, { method: 'PATCH' })).json();
				},
			};
		}
		const fetchSpy = vi.fn(async () =>
			response({ id: 'p1', title: 'Published', published: true })
		);
		vi.stubGlobal('fetch', fetchSpy);
		const store = new Store({ post: PublishPost }, { apiURL: API });
		const bound = store.adapter('post');

		expect(store.adapter('post')).toBe(bound);
		expect(bound.loadMany).toBeTypeOf('function');
		const post = store.upsert('post', await bound.publish('p1'));

		expect(post.published).toBe(true);
		expect(fetchSpy).toHaveBeenCalledWith(`${API}/posts/p1/publish`, { method: 'PATCH' });
	});

	it('preserves author init headers, runs beforeRequest, and reaches the fixtures seam', async () => {
		class FixturePost extends Post {
			static adapter = {
				endpoint: '/posts',
				async loadMany(fetch) {
					const res = await fetch(`${API}/posts/published`, {
						headers: { 'X-Author': 'yes' },
					});
					return res.json();
				},
			};
		}
		const beforeRequest = vi.fn((init) => {
			init.headers = { ...init.headers, Authorization: 'Bearer fixture' };
		});
		const fetchSpy = vi.fn(() => {
			throw new Error('fixture-backed enhanced fetch reached global fetch');
		});
		vi.stubGlobal('fetch', fetchSpy);
		const uninstall = installFixtures({
			mock: {
				post: {
					handler: ({ method, path }) =>
						method === 'GET' && path === '/published'
							? { body: [{ id: 'p1', title: 'Fixture' }] }
							: null,
				},
			},
		});
		try {
			const store = new Store({ post: FixturePost }, { apiURL: API, beforeRequest });
			const fixtureNetwork = store._network;
			store._network = function (url, init, context) {
				expect(Object.isFrozen(context)).toBe(true);
				return fixtureNetwork.call(this, url, init, context);
			};
			await expect(store.loadMany('post')).resolves.toHaveLength(1);
			expect(beforeRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					headers: { 'X-Author': 'yes', Authorization: 'Bearer fixture' },
				}),
				expect.objectContaining({
					type: 'post',
					method: 'GET',
					url: `${API}/posts/published`,
				})
			);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			uninstall();
		}
	});
});

describe('app-wide adapter defaults', () => {
	it('applies to every endpoint model, beats generated REST, and leaves model config untouched', async () => {
		const articleConfig = { endpoint: '/articles' };
		const pageConfig = { endpoint: '/pages' };
		class Article extends Post {
			static adapter = articleConfig;
		}
		class Page extends Post {
			static adapter = pageConfig;
		}
		const configured = adapter.defaults({
			async loadMany(fetch, _options, { endpoint }) {
				return (await (await fetch(API + endpoint)).json()).data;
			},
		});
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(response({ data: [{ id: 'a1', title: 'Article' }] }))
			.mockResolvedValueOnce(response({ data: [{ id: 'p1', title: 'Page' }] }));
		vi.stubGlobal('fetch', fetchSpy);
		const store = new Store(
			{ article: Article, page: Page },
			{ apiURL: API, adapter: configured }
		);

		await expect(store.loadMany('article')).resolves.toMatchObject([{ title: 'Article' }]);
		await expect(store.loadMany('page')).resolves.toMatchObject([{ title: 'Page' }]);

		expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
			`${API}/articles`,
			`${API}/pages`,
		]);
		expect(Article.adapter).toBe(articleConfig);
		expect(Page.adapter).toBe(pageConfig);
	});

	it("lets a model's own verb beat the app default", async () => {
		const appLoadAll = vi.fn(async () => [{ id: 'default', title: 'Default' }]);
		const modelLoadAll = vi.fn(async () => [{ id: 'model', title: 'Model' }]);
		class SpecificPost extends Post {
			static adapter = { endpoint: '/posts', loadMany: modelLoadAll };
		}
		const configured = adapter.defaults({ loadMany: appLoadAll });
		const store = new Store({ post: SpecificPost }, { adapter: configured });

		await expect(store.loadMany('post')).resolves.toMatchObject([{ title: 'Model' }]);
		expect(modelLoadAll).toHaveBeenCalledTimes(1);
		expect(appLoadAll).not.toHaveBeenCalled();
	});

	it('applies the normal Response handling and shape guards to app defaults', async () => {
		class ResponsePost extends Post {
			static adapter = { endpoint: '/posts' };
		}
		const configured = adapter.defaults({
			loadOne: (fetch, id, { endpoint }) => fetch(`${API}${endpoint}/${id}`),
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ id: 'p1', title: 'Parsed' })));
		const store = new Store(
			{ post: ResponsePost },
			{ apiURL: API, adapter: configured }
		);

		await expect(store.loadOne('post', 'p1')).resolves.toMatchObject({ title: 'Parsed' });
	});

	it('passes the correct type and raw endpoint context for each model', async () => {
		class Article extends Post {
			static adapter = { endpoint: '/articles' };
		}
		class LocalPost extends Post {}
		const contexts = [];
		const configured = adapter.defaults({
			loadOne(_fetch, id, context) {
				contexts.push(context);
				return { id, title: context.type };
			},
		});
		const store = new Store(
			{ article: Article, local: LocalPost },
			{ apiURL: API, adapter: configured }
		);

		await store.loadOne('article', 'a1');
		await store.loadOne('local', 'l1');

		expect(contexts).toEqual([
			{ type: 'article', endpoint: '/articles' },
			{ type: 'local', endpoint: undefined },
		]);
	});

	it('keeps different default dialects isolated between stores', async () => {
		class SharedPost extends Post {
			static adapter = { endpoint: '/posts' };
		}
		const first = adapter.defaults({
			loadMany: async () => [{ id: 'p1', title: 'First dialect' }],
		});
		const second = adapter.defaults({
			loadMany: async () => [{ id: 'p1', title: 'Second dialect' }],
		});
		const firstStore = new Store({ post: SharedPost }, { adapter: first });
		const secondStore = new Store({ post: SharedPost }, { adapter: second });

		const [firstRecords, secondRecords] = await Promise.all([
			firstStore.loadMany('post'),
			secondStore.loadMany('post'),
		]);

		expect(firstRecords[0].title).toBe('First dialect');
		expect(secondRecords[0].title).toBe('Second dialect');
	});

	it('composes with beforeRequest and the fixtures network seam', async () => {
		class FixturePost extends Post {
			static adapter = { endpoint: '/posts' };
		}
		const configured = adapter.defaults({
			async loadMany(fetch, _options, { endpoint }) {
				const res = await fetch(`${API}${endpoint}/published`, {
					headers: { 'X-Dialect': 'envelope' },
				});
				return (await res.json()).data;
			},
		});
		const beforeRequest = vi.fn((init) => {
			init.headers = { ...init.headers, Authorization: 'Bearer fixture' };
		});
		const fetchSpy = vi.fn(() => {
			throw new Error('app default reached global fetch');
		});
		vi.stubGlobal('fetch', fetchSpy);
		const uninstall = installFixtures({
			mock: {
				post: {
					handler: ({ method, path }) =>
						method === 'GET' && path === '/published'
							? { body: { data: [{ id: 'p1', title: 'Fixture default' }] } }
							: null,
				},
			},
		});
		try {
			const store = new Store(
				{ post: FixturePost },
				{ apiURL: API, adapter: configured, beforeRequest }
			);
			await expect(store.loadMany('post')).resolves.toMatchObject([
				{ title: 'Fixture default' },
			]);
			expect(beforeRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					headers: {
						'X-Dialect': 'envelope',
						Authorization: 'Bearer fixture',
					},
				}),
				expect.objectContaining({ type: 'post', url: `${API}/posts/published` })
			);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			uninstall();
		}
	});
});

describe('adapter config validation', () => {
	it('returns new frozen capabilities and warns once for non-verb defaults keys', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const configured = adapter.defaults({ publish: async () => {}, retries: 2 });

		expect(configured).not.toBe(adapter);
		expect(Object.isFrozen(configured)).toBe(true);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('adapter.defaults()');
		expect(warn.mock.calls[0][0]).toContain('"publish", "retries"');
	});

	// The static build reads this to decide whether a page can re-import the bare
	// capability or has to reach the exact configured value the render installed.
	it('tells a configured capability from the bare export', () => {
		expect(isConfiguredAdapter(adapter)).toBe(false);
		expect(isConfiguredAdapter(adapter.defaults({}))).toBe(true);
		expect(isConfiguredAdapter(adapter.defaults({ loadMany: async () => [] }))).toBe(true);
		// Nothing that is not a capability at all can pass.
		expect(isConfiguredAdapter(undefined)).toBe(false);
		expect(isConfiguredAdapter({ install() {} })).toBe(false);
	});

	it('warns once per model for keys that are neither endpoint nor functions', () => {
		class InvalidPost extends Post {
			static adapter = { endpoint: '/posts', serializer: 'json-api', retries: 2 };
		}
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const first = new Store({ post: InvalidPost }, { apiURL: API });
		const second = new Store({ post: InvalidPost }, { apiURL: API });

		first.adapter('post');
		first.adapter('post');
		second.adapter('post');

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('"serializer", "retries"');
	});

	it('accepts the fixtures mock block without warning', () => {
		class MockedPost extends Post {
			static adapter = { endpoint: '/posts', mock: { data: [{ id: 'p1', title: 'Seeded' }] } };
		}
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		new Store({ post: MockedPost }, { apiURL: API }).adapter('post');

		expect(warn).not.toHaveBeenCalled();
	});
});

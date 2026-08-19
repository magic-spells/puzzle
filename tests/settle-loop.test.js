// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

adapter.install();

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};
const ctxWith = (store) => ({ store, router: null, formatters: null });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const API = 'https://x.test';

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
		authorId: Puzzle.string(),
		nextId: Puzzle.string(),
	};
	static adapter = { endpoint: '/api/posts' };
}

class User extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), name: Puzzle.string().required() };
	static adapter = { endpoint: '/api/users' };
}

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: status === 404 ? 'Not Found' : 'OK',
	text: async () => (body === undefined ? '' : JSON.stringify(body)),
	json: async () => body,
});

// A tiny REST server over two collections, so a view's queries settle the way
// they would against a real API. Every request is recorded.
function serveFrom({ posts = {}, users = {} } = {}) {
	const calls = [];
	const collections = { posts, users };
	const fetchMock = vi.fn(async (url) => {
		calls.push(String(url));
		const [, , name, id] = String(url).replace(API, '').split('/');
		const collection = collections[name];
		if (id === undefined) return json(Object.values(collection));
		return collection[id] ? json(collection[id]) : json({ error: 'missing' }, 404);
	});
	vi.stubGlobal('fetch', fetchMock);
	return { calls, fetchMock };
}

const makeStore = () => new Store({ post: Post, user: User }, { apiURL: API });

beforeEach(() => {
	document.body.innerHTML = '';
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('D161 settle loop — rounds', () => {
	it('settles two independent misses in one fetch round', async () => {
		const { calls } = serveFrom({
			posts: { p1: { id: 'p1', title: 'Post' } },
			users: { u1: { id: 'u1', name: 'Ada' } },
		});
		const store = makeStore();
		const runs = [];
		class View extends PuzzleView {
			data() {
				runs.push('data');
				return {
					post: store.findOne('post', 'p1'),
					user: store.findOne('user', 'u1'),
				};
			}
			render() {
				const { post, user } = this.getData();
				return h('div', {}, [text(`${post?.title}/${user?.name}`)]);
			}
		}
		const el = container();
		await new View(ctxWith(store)).mount(el);

		expect(el.textContent).toBe('Post/Ada');
		expect(runs).toHaveLength(2); // one provisional pass, one committed pass
		expect(calls).toEqual([`${API}/api/posts/p1`, `${API}/api/users/u1`]);
	});

	it('settles a post → author waterfall across rounds', async () => {
		const { calls } = serveFrom({
			posts: { p1: { id: 'p1', title: 'Post', authorId: 'u1' } },
			users: { u1: { id: 'u1', name: 'Ada' } },
		});
		const store = makeStore();
		class View extends PuzzleView {
			data() {
				const post = store.findOne('post', 'p1');
				const author = post && store.findOne('user', post.authorId);
				return { byline: post && author ? `${post.title} — ${author.name}` : null };
			}
			render() {
				return h('div', {}, [text(this.getData().byline ?? '')]);
			}
		}
		const el = container();
		await new View(ctxWith(store)).mount(el);

		expect(el.textContent).toBe('Post — Ada');
		expect(calls).toEqual([`${API}/api/posts/p1`, `${API}/api/users/u1`]);
	});

	it('a settled 404 commits null — the not-found face renders', async () => {
		serveFrom({ posts: {} });
		const store = makeStore();
		class View extends PuzzleView {
			data() {
				return { post: store.findOne('post', 'ghost') };
			}
			render() {
				return h('div', {}, [text(this.getData().post ? 'found' : 'not found')]);
			}
		}
		const el = container();
		await new View(ctxWith(store)).mount(el);
		expect(el.textContent).toBe('not found');
	});

	it('an authored async data() can discover queries after an await', async () => {
		const { calls } = serveFrom({ posts: { p1: { id: 'p1', title: 'Post' } } });
		const store = makeStore();
		class View extends PuzzleView {
			async data() {
				await tick();
				return { post: store.findOne('post', 'p1') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const el = container();
		await new View(ctxWith(store)).mount(el);
		expect(el.textContent).toBe('Post');
		expect(calls).toEqual([`${API}/api/posts/p1`]);
	});

	it('throws after ten rounds, naming the view and the last round, and commits nothing', async () => {
		// A chain deeper than the cap: every pass resolves exactly one more link.
		const posts = {};
		for (let i = 1; i <= 20; i++) {
			posts[`p${i}`] = { id: `p${i}`, title: `Post ${i}`, nextId: `p${i + 1}` };
		}
		serveFrom({ posts });
		const store = makeStore();
		class DeepView extends PuzzleView {
			data() {
				let post = store.findOne('post', 'p1');
				for (let hops = 0; post && post.nextId && hops < 30; hops++) {
					post = store.findOne('post', post.nextId);
				}
				return { last: post };
			}
			render() {
				return h('div', {}, [text(this.getData().last?.title ?? 'none')]);
			}
		}
		const view = new DeepView(ctxWith(store));
		const el = container();
		const error = await view.mount(el).catch((err) => err);

		expect(error).toBeInstanceOf(Error);
		expect(error.message).toMatch(/DeepView/);
		expect(error.message).toMatch(/after 10 settle rounds/);
		expect(error.message).toMatch(/post p11/);
		expect(view.getData().last).toBeUndefined(); // nothing partial committed
	});
});

describe('D161 settle loop — supersession and subscriptions', () => {
	it('only the committing pass leaves subscriptions behind', async () => {
		serveFrom({
			posts: { p1: { id: 'p1', title: 'Post', authorId: 'u1' } },
			users: { u1: { id: 'u1', name: 'Ada' }, u2: { id: 'u2', name: 'Grace' } },
		});
		const store = makeStore();
		class View extends PuzzleView {
			data() {
				const post = store.findOne('post', 'p1');
				// The provisional pass reads u2; the committed pass reads the author.
				return { user: post ? store.findOne('user', post.authorId) : store.findOne('user', 'u2') };
			}
			render() {
				return h('div', {}, [text(this.getData().user?.name ?? '')]);
			}
		}
		const view = new View(ctxWith(store));
		await view.mount(container());

		const keys = [...(store.keysBySubscriber.get(view) ?? [])].sort();
		expect(keys).toEqual(['post p1', 'user u1']);
		expect(store.subscribersByKey.has('user u2')).toBe(false);
	});

	it('a store change during settlement folds into the run instead of superseding it', async () => {
		const { calls } = serveFrom({ posts: { p1: { id: 'p1', title: 'Post' } } });
		const store = makeStore();
		let runs = 0;
		class View extends PuzzleView {
			data() {
				runs++;
				return { post: store.findOne('post', 'p1') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const view = new View(ctxWith(store));
		const el = container();
		const mounting = view.mount(el);
		// The load's own upsert notifies; deliver it while the settle is still open.
		await tick();
		store.flush();
		await mounting;

		expect(el.textContent).toBe('Post');
		expect(calls).toHaveLength(1);
		expect(runs).toBeLessThanOrEqual(3); // provisional, dirty re-pass, commit
	});

	it('a destroy mid-settle stops the loop and commits nothing', async () => {
		let release;
		const fetchMock = vi.fn(
			() =>
				new Promise((resolve) => {
					release = () => resolve(json({ id: 'p1', title: 'Post' }));
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const store = makeStore();
		let runs = 0;
		class View extends PuzzleView {
			data() {
				runs++;
				return { post: store.findOne('post', 'p1') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const view = new View(ctxWith(store));
		const el = container();
		const mounting = view.mount(el);
		view.destroy();
		release();
		await mounting;
		await tick();

		expect(runs).toBe(1);
		expect(view.getData().post).toBeUndefined();
		expect(store.keysBySubscriber.size).toBe(0);
	});

	it('a pass that throws after starting a fault leaves no unhandled rejection', async () => {
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			vi.stubGlobal('fetch', async () => json({ error: 'nope' }, 500));
			const store = makeStore();
			class View extends PuzzleView {
				data() {
					const post = store.findOne('post', 'p1');
					throw new Error('data blew up');
				}
				render() {
					return null;
				}
			}
			const view = new View(ctxWith(store));
			await expect(view.mount(container())).rejects.toThrow('data blew up');
			await tick();
			await tick();
			expect(unhandled).not.toHaveBeenCalled();
			// The failed pass left no subscriptions behind either.
			expect(store.keysBySubscriber.size).toBe(0);
		} finally {
			process.off('unhandledRejection', unhandled);
		}
	});
});

describe('D161 settle loop — skeletons and prepared refreshes', () => {
	class SkeletonView extends PuzzleView {
		data() {
			return { post: this.ctx.store.findOne('post', 'p1') };
		}
		renderSkeleton() {
			return h('div', { class: 'skeleton' }, [text('loading')]);
		}
		render() {
			return h('div', { class: 'real' }, [text(this.getData().post?.title ?? 'none')]);
		}
	}

	it('a hit-only pass stays synchronous — the skeleton never appears', async () => {
		serveFrom({ posts: {} });
		const store = makeStore();
		store.upsert('post', { id: 'p1', title: 'Local' });
		const el = container();
		const view = new SkeletonView(ctxWith(store));
		const mounting = view.mount(el);

		expect(el.querySelector('.real')).not.toBeNull(); // committed before any await
		expect(el.querySelector('.skeleton')).toBeNull();
		await mounting;
	});

	it('a miss paints the skeleton, then swaps in the settled content', async () => {
		let release;
		vi.stubGlobal(
			'fetch',
			() =>
				new Promise((resolve) => {
					release = () => resolve(json({ id: 'p1', title: 'Server' }));
				})
		);
		const store = makeStore();
		const el = container();
		const view = new SkeletonView(ctxWith(store));
		const mounting = view.mount(el);
		await tick();

		expect(el.querySelector('.skeleton')).not.toBeNull();
		release();
		await mounting;
		await tick();
		await tick();

		expect(el.querySelector('.skeleton')).toBeNull();
		expect(el.textContent).toBe('Server');
	});

	it('a prepared refresh settles before commit, and a discard unwinds its subscriptions', async () => {
		serveFrom({
			posts: { p1: { id: 'p1', title: 'One' }, p2: { id: 'p2', title: 'Two' } },
		});
		const store = makeStore();
		class View extends PuzzleView {
			data(params) {
				return { post: store.findOne('post', params.id ?? 'p1') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const el = container();
		const view = new View(ctxWith(store));
		await view.mount(el, { params: { id: 'p1' } });
		expect(el.textContent).toBe('One');

		const discarded = view.prepareRefresh({ params: { id: 'p2' } });
		await discarded.ready;
		discarded.discard();
		expect(el.textContent).toBe('One');
		expect([...store.keysBySubscriber.get(view)]).toEqual(['post p1']);

		const committed = view.prepareRefresh({ params: { id: 'p2' } });
		await committed.ready;
		committed.commit();
		expect(el.textContent).toBe('Two');
		expect([...store.keysBySubscriber.get(view)]).toEqual(['post p2']);
	});
});

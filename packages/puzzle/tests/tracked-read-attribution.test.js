// @vitest-environment jsdom
//
// D161 tracked-read attribution. Faulting is attributed by OBJECT IDENTITY: a
// view reads the store through its own per-view handle (`this.ctx.store`), and
// only reads made through THAT handle during THAT view's evaluation can queue a
// fetch into the evaluation's request map. Every other reader in the realm — the
// raw `app.store`, another view's handle, a module capture, a record's
// `_store` inside a relationship getter — gets a pure local snapshot, before or
// after any await.
//
// The bug these lock out: the request map used to be an ambient Store field
// installed for the whole lifetime of an async data(), so a foreign read during
// a suspension both fired a request it must not and landed that promise in the
// suspended view's settle batch, where an unrelated 500 could fail a view that
// never queried the type.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { setErrorHandler } from '../client-runtime/errors.js';

adapter.install();

const API = 'https://x.test';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};
const ctxWith = (store) => ({ store, router: null, formatters: null });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise whose settlement this file controls, so interleavings are exact. */
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
		authorId: Puzzle.string(),
		author: Puzzle.belongsTo('user'),
	};
	static adapter = { endpoint: '/api/posts' };
}

class User extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		name: Puzzle.string().required(),
		posts: Puzzle.hasMany('post', { key: 'authorId' }),
	};
	static adapter = { endpoint: '/api/users' };
}

/** A collection whose transport always 500s — a failure visible in whoever owns it. */
class Flaky extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), body: Puzzle.string() };
	static adapter = { endpoint: '/api/flaky' };
}

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: status === 404 ? 'Not Found' : status === 500 ? 'Server Error' : 'OK',
	text: async () => (body === undefined ? '' : JSON.stringify(body)),
	json: async () => body,
});

/** A tiny REST server over posts + users; /api/flaky always fails. */
function serveFrom({ posts = {}, users = {} } = {}) {
	const calls = [];
	const collections = { posts, users };
	const fetchMock = vi.fn(async (url) => {
		const target = String(url);
		calls.push(target);
		if (target.includes('/api/flaky')) return json({ error: 'boom' }, 500);
		const [, , name, id] = target.replace(API, '').split('/');
		const collection = collections[name] ?? {};
		if (id === undefined) return json(Object.values(collection));
		return collection[id] ? json(collection[id]) : json({ error: 'missing' }, 404);
	});
	vi.stubGlobal('fetch', fetchMock);
	return { calls, fetchMock };
}

const makeStore = () =>
	new Store({ post: Post, user: User, flaky: Flaky }, { apiURL: API, adapter });

/** Requests this run issued against one collection. */
const hits = (calls, path) => calls.filter((url) => url.includes(path));

beforeEach(() => {
	document.body.innerHTML = '';
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('D161 attribution — a foreign read during a suspension', () => {
	/**
	 * View A: one tracked miss, then a suspension, then the same read again. Its
	 * settle batch must contain exactly the key it asked for.
	 */
	function suspendedA(store, gate) {
		class AView extends PuzzleView {
			async data() {
				const s = this.ctx.store;
				s.findOne('post', 'p1');
				await gate.promise;
				return { title: s.findOne('post', 'p1')?.title };
			}
			render() {
				return h('div', {}, [text(this.getData().title ?? '')]);
			}
		}
		const el = container();
		const view = new AView(ctxWith(store));
		return { el, view, mounting: view.mount(el) };
	}

	it('regression 1 — a raw store read fires nothing and joins no settle batch', async () => {
		const { calls } = serveFrom({
			posts: { p1: { id: 'p1', title: 'One' } },
			users: { u42: { id: 'u42', name: 'Ada' } },
		});
		const store = makeStore();
		const gate = deferred();
		const a = suspendedA(store, gate);
		await tick();
		expect(hits(calls, '/api/posts/p1')).toHaveLength(1); // A's own fault, as designed

		// The foreign read: outside any evaluation, on the app's raw store.
		expect(store.findOne('user', 'u42')).toBeNull();
		await tick();
		expect(hits(calls, '/api/users')).toHaveLength(0);

		gate.resolve();
		await a.mounting;
		await tick();
		expect(a.el.textContent).toBe('One');
		// Still nothing: the resumed evaluation did not adopt the foreign key either.
		expect(hits(calls, '/api/users')).toHaveLength(0);
		a.view.destroy();
	});

	it('regression 2 — another view’s failing read cannot fail the suspended view', async () => {
		const { calls } = serveFrom({ posts: { p1: { id: 'p1', title: 'One' } } });
		const store = makeStore();
		const reports = [];

		class BView extends PuzzleView {
			data() {
				return { n: 1 };
			}
			// An ordinary event handler — NOT a data() evaluation.
			onClick() {
				return this.ctx.store.findOne('flaky', 'f1');
			}
			render() {
				return h('div', {}, [text(String(this.getData().n))]);
			}
		}
		const b = new BView(ctxWith(store));
		await b.mount(container());
		setErrorHandler(b.ctx, (error, info) => reports.push({ error, info }));

		const gate = deferred();
		const a = suspendedA(store, gate);
		await tick();
		setErrorHandler(a.view.ctx, (error, info) => reports.push({ error, info }));

		// B reads a missing record through ITS OWN handle, from a handler. The local
		// snapshot is null and no request is owed to anyone.
		expect(b.onClick()).toBeNull();
		await tick();
		expect(hits(calls, '/api/flaky')).toHaveLength(0);

		gate.resolve();
		await a.mounting; // rejects today: B's 500 lands in A's settle batch
		await tick();
		expect(a.el.textContent).toBe('One');
		expect(reports).toEqual([]);
		a.view.destroy();
		b.destroy();
	});

	it('regression 4 — same-view code holding the handle IS attributed (documented residue)', async () => {
		const { calls } = serveFrom({
			posts: { p1: { id: 'p1', title: 'One' } },
			users: { u9: { id: 'u9', name: 'Grace' } },
		});
		const store = makeStore();
		const gate = deferred();
		let sideRead = 'not run';

		class AView extends PuzzleView {
			async data() {
				const s = this.ctx.store;
				s.findOne('post', 'p1');
				// The view's own deferred code, holding the view's own handle, running
				// while the view's own data() is paused. It is the same view and the
				// same data, so this read is attributed to the open evaluation and
				// faults. Pinned so a future change to that is deliberate.
				setTimeout(() => {
					sideRead = s.findOne('user', 'u9');
				}, 0);
				await gate.promise;
				return { title: s.findOne('post', 'p1')?.title };
			}
			render() {
				return h('div', {}, [text(this.getData().title ?? '')]);
			}
		}
		const el = container();
		const view = new AView(ctxWith(store));
		const mounting = view.mount(el);
		await tick();
		expect(sideRead).toBeNull(); // local miss at read time
		await tick();
		expect(hits(calls, '/api/users/u9')).toHaveLength(1);

		gate.resolve();
		await mounting;
		await tick();
		expect(el.textContent).toBe('One');
		view.destroy();
	});

	it('regression 6 — a destroyed view’s suspended evaluation cannot fault', async () => {
		const { calls } = serveFrom({ posts: { p9: { id: 'p9', title: 'Nine' } } });
		const store = makeStore();
		const gate = deferred();

		class DView extends PuzzleView {
			async data() {
				const s = this.ctx.store;
				await gate.promise;
				return { post: s.findOne('post', 'p9') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const view = new DView(ctxWith(store));
		const mounting = view.mount(container());
		await tick();

		view.destroy();
		// An unrelated tracked evaluation runs to completion while the destroyed
		// view is still suspended. Its exit restores the slots IT saved; nothing it
		// restores may re-arm the destroyed view's continuation.
		store.withTracking({}, () => store.findMany('post'));

		gate.resolve();
		await mounting;
		await tick();
		expect(hits(calls, '/api/posts/p9')).toHaveLength(0);
	});

	it('regression 6b — the destroyed view’s OWN nested evaluation cannot re-arm it', async () => {
		const { calls } = serveFrom({ posts: { p9: { id: 'p9', title: 'Nine' } } });
		const store = makeStore();
		const gate = deferred();

		class DView extends PuzzleView {
			async data() {
				const s = this.ctx.store;
				await gate.promise;
				return { post: s.findOne('post', 'p9') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const view = new DView(ctxWith(store));
		const mounting = view.mount(container());
		await tick();

		// A nested evaluation for the SAME subscriber that destroys it: its exit must
		// not hand the suspended outer evaluation its request map back.
		store.withTracking(view, () => view.destroy());

		gate.resolve();
		await mounting;
		await tick();
		expect(hits(calls, '/api/posts/p9')).toHaveLength(0);
	});
});

describe('D161 attribution — what must keep working', () => {
	it('regression 3 — dependent reads discovered after an await still settle', async () => {
		const { calls } = serveFrom({
			posts: { p1: { id: 'p1', title: 'Post', authorId: 'u1' } },
			users: { u1: { id: 'u1', name: 'Ada' } },
		});
		const store = makeStore();
		const gate = deferred();

		class View extends PuzzleView {
			async data() {
				const s = this.ctx.store;
				const post = s.findOne('post', 'p1');
				await gate.promise;
				const author = post && s.findOne('user', post.authorId);
				return { byline: post && author ? `${post.title} — ${author.name}` : null };
			}
			render() {
				return h('div', {}, [text(this.getData().byline ?? '')]);
			}
		}
		const el = container();
		const view = new View(ctxWith(store));
		const mounting = view.mount(el);
		await tick();
		gate.resolve();
		await mounting;
		await tick();

		expect(el.textContent).toBe('Post — Ada');
		expect(hits(calls, '/api/posts/p1')).toHaveLength(1);
		expect(hits(calls, '/api/users/u1')).toHaveLength(1);
		view.destroy();
	});

	it('regression 5 — relationship traversal subscribes through the handle and never faults', async () => {
		const { calls } = serveFrom({ posts: { p1: { id: 'p1', title: 'Post', authorId: 'u1' } } });
		const store = makeStore();
		store.upsert('post', { id: 'p1', title: 'Post', authorId: 'u1' });

		class View extends PuzzleView {
			data() {
				const post = this.ctx.store.findOne('post', 'p1');
				return { author: post?.author ?? null, own: post?.author?.posts ?? [] };
			}
			render() {
				return h('div', {}, [text(this.getData().author?.name ?? 'none')]);
			}
		}
		const el = container();
		const view = new View(ctxWith(store));
		await view.mount(el);

		expect(el.textContent).toBe('none');
		expect(hits(calls, '/api/users')).toHaveLength(0);
		// The traversal still recorded its subscription, so the record landing later
		// notifies this view.
		expect(store.subscribersByKey.get('user u1')?.has(view)).toBe(true);
		view.destroy();
	});

	it('regression 7 — an adapter-free app keeps ctx and store identity', async () => {
		serveFrom();
		const store = new Store({ post: Post }, { apiURL: API });
		const ctx = ctxWith(store);

		class View extends PuzzleView {
			data() {
				return { post: this.ctx.store.findOne('post', 'p1') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? 'none')]);
			}
		}
		const view = new View(ctx);
		expect(view.ctx).toBe(ctx);
		expect(view.ctx.store).toBe(store);
		await view.mount(container());
		expect(view.ctx.store).toBe(store);
		view.destroy();
	});

	it('regression 8 — two views share one in-flight request, with separate batches', async () => {
		let release;
		const calls = [];
		vi.stubGlobal(
			'fetch',
			vi.fn((url) => {
				calls.push(String(url));
				return new Promise((resolve) => {
					release = () => resolve(json({ id: 'p1', title: 'Shared' }));
				});
			})
		);
		const store = makeStore();

		class View extends PuzzleView {
			data() {
				return { post: this.ctx.store.findOne('post', 'p1') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const elA = container();
		const elB = container();
		const a = new View(ctxWith(store));
		const b = new View(ctxWith(store));
		const mountingA = a.mount(elA);
		const mountingB = b.mount(elB);
		await tick();

		expect(hits(calls, '/api/posts/p1')).toHaveLength(1); // deduped in flight
		release();
		await Promise.all([mountingA, mountingB]);
		await tick();

		expect(elA.textContent).toBe('Shared');
		expect(elB.textContent).toBe('Shared');
		expect(hits(calls, '/api/posts/p1')).toHaveLength(1);
		a.destroy();
		b.destroy();
	});
});

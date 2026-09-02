// @vitest-environment jsdom
//
// D161 settle-window bookkeeping vs Store.flush() delivery. Two questions:
//
//   1. a store change FOLDED into an owned settle run (`_settleDirty`) must not
//      be swallowed when that run ends without committing — the D146 prepared
//      commit that supersedes it paints a model that predates the change;
//   2. a settle that fetched must not be followed by a redundant re-run: the
//      flush carrying its OWN upserts was enqueued before the committing pass
//      ran, so the committed model already reflects it. A change from ANY other
//      writer during that pass still has to be delivered.
import { afterEach, describe, expect, it, vi } from 'vitest';
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
// Long enough for the D63 fallback timer (220 ms) to fire in jsdom, where rAF
// exists but never runs on its own schedule.
const settled = () => new Promise((resolve) => setTimeout(resolve, 300));

const API = 'https://x.test';

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
		authorId: Puzzle.string(),
	};
	static adapter = { endpoint: '/api/posts' };
}

class User extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), name: Puzzle.string().required() };
	static adapter = { endpoint: '/api/users' };
}

const json = (body) => ({
	ok: true,
	status: 200,
	statusText: 'OK',
	text: async () => JSON.stringify(body),
});

const makeStore = () => new Store({ post: Post, user: User }, { apiURL: API, adapter });

afterEach(() => vi.unstubAllGlobals());

describe('a store change folded into an owned settle run', () => {
	it('still reaches the view when a prepared commit supersedes that run', async () => {
		// Every request parks until the test releases it by URL.
		const pending = {};
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(url) =>
					new Promise((resolve) => {
						pending[String(url)] = () =>
							resolve(
								json(
									String(url).includes('users')
										? { id: 'u1', name: 'Ada' }
										: { id: 'p1', title: 'A', authorId: 'u1' }
								)
							);
					})
			)
		);
		const store = makeStore();
		const renders = [];
		class V extends PuzzleView {
			data(params) {
				const post = this.ctx.store.findOne('post', 'p1');
				// The prepared destination is a one-round query; the committed
				// (owned) run is a two-round waterfall, so it is still in flight
				// when the prepare settles.
				if (params.short) return { title: post?.title ?? null, author: null };
				const author = post && this.ctx.store.findOne('user', post.authorId);
				return { title: post?.title ?? null, author: author?.name ?? null };
			}
			render() {
				const d = this.getData();
				renders.push(d.title);
				return h('div', {}, [text(`${d.title}|${d.author ?? ''}`)]);
			}
		}

		const el = container();
		const view = new V(ctxWith(store));
		const mounting = view.mount(el, { params: {} }); // owned run: misses p1
		await Promise.resolve();
		const prepared = view.prepareRefresh({ params: { short: true } });
		expect(prepared).not.toBeNull();
		await Promise.resolve();
		pending[`${API}/api/posts/p1`]();
		await prepared.ready; // prepared model captured with title 'A'

		// A local edit lands while the owned run is still waiting on its second
		// round: onStoreChange folds it into that run instead of refreshing.
		store.findOne('post', 'p1').update({ title: 'B' });
		await settled();
		expect(view._settleDirty).toBe(true);

		prepared.commit(); // paints the captured (pre-edit) model and supersedes the run
		pending[`${API}/api/users/u1`]?.(); // the owned run resumes, finds itself stale
		await mounting.catch(() => {});
		await settled();

		expect(store.findOne('post', 'p1').title).toBe('B');
		expect(el.textContent.startsWith('B')).toBe(true);

		// Exactly one follow-up render, then quiet — no refresh loop.
		const after = renders.length;
		await settled();
		expect(renders.length).toBe(after);
	});
});

describe('the flush carrying a settle run’s own upserts', () => {
	it('does not re-run data() after the pass that committed it', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'p1', title: 'Post' })));
		const store = makeStore();
		const runs = [];
		let renders = 0;
		class V extends PuzzleView {
			data() {
				runs.push('data');
				return { post: this.ctx.store.findOne('post', 'p1') };
			}
			render() {
				renders++;
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		const el = container();
		await new V(ctxWith(store)).mount(el);
		expect(el.textContent).toBe('Post');
		// Two passes: the one that faulted and the one that committed.
		expect(runs.length).toBe(2);
		expect(renders).toBe(1);

		await settled();
		await settled();
		expect(runs.length).toBe(2);
		expect(renders).toBe(1);
	});

	it('still delivers a change another writer made during the committing pass', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'p1', title: 'Post' })));
		const store = makeStore();
		const runs = [];
		let renders = 0;
		let release;
		let fired = false;
		class V extends PuzzleView {
			async data() {
				runs.push('data');
				const post = this.ctx.store.findOne('post', 'p1');
				if (post && !fired) {
					fired = true;
					// A second writer edits the record while this (committing) pass
					// is suspended — its notification postdates the pass and must
					// not be mistaken for the run's own.
					await new Promise((resolve) => {
						release = resolve;
					});
				}
				return { title: post?.title ?? null };
			}
			render() {
				renders++;
				return h('div', {}, [text(this.getData().title ?? '')]);
			}
		}
		const el = container();
		const mounting = new V(ctxWith(store)).mount(el);
		await settled();
		// The committing pass is parked inside data(); edit through the raw store.
		store.findOne('post', 'p1').update({ title: 'Edited' });
		release();
		await mounting;
		await settled();
		await settled();

		expect(el.textContent).toBe('Edited');
		// Fault pass, committing pass, and the refresh the foreign edit earned —
		// three, not the four the run's own upserts used to add.
		expect(runs.length).toBe(3);
		expect(renders).toBeGreaterThanOrEqual(1);
	});
});

// @vitest-environment jsdom
//
// D161's dev nudge: `store.loadMany()`/`loadOne()` inside a tracked data() run
// is a leftover from hand-rolled loading. The nudge is attributed the same way
// faulting is — by the HANDLE the call came through — so a click handler or a
// timer firing while some other view sits at an await never trips it.
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
const API = 'https://x.test';

class Post extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
	static adapter = { endpoint: '/api/posts' };
}

const json = (body) => ({
	ok: true,
	status: 200,
	statusText: 'OK',
	text: async () => JSON.stringify(body),
});

const makeStore = () => new Store({ post: Post }, { apiURL: API, adapter });
const nudges = (warn) =>
	warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('inside a tracked data() run'));

afterEach(() => vi.unstubAllGlobals());

describe('the tracked-load nudge', () => {
	it('stays quiet for a load issued from outside data() while a view is suspended', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json([{ id: 'p1', title: 'Post' }])));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = makeStore();
		let release;
		class Slow extends PuzzleView {
			async data() {
				await new Promise((resolve) => {
					release = resolve;
				});
				return {};
			}
			render() {
				return h('div', {}, [text('x')]);
			}
		}
		const mounting = new Slow(ctxWith(store)).mount(container());
		await Promise.resolve();
		// A button handler somewhere else in the app. `store` is the app store —
		// not the suspended view's handle — so nothing here is that view's read.
		await store.loadMany('post');
		release();
		await mounting;

		expect(nudges(warn)).toEqual([]);
		warn.mockRestore();
	});

	it('still warns for a load the view issues through its own handle inside data()', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json([{ id: 'p1', title: 'Post' }])));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = makeStore();
		class Eager extends PuzzleView {
			async data() {
				await this.ctx.store.loadMany('post');
				return { posts: this.ctx.store.findMany('post') };
			}
			render() {
				return h('div', {}, [text(String(this.getData().posts.length))]);
			}
		}
		await new Eager(ctxWith(store)).mount(container());

		expect(nudges(warn).length).toBe(1);
		expect(nudges(warn)[0]).toContain('store.loadMany()');
		warn.mockRestore();
	});

	it('still warns for loadOne issued through the handle inside data()', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'p1', title: 'Post' })));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const store = makeStore();
		class Eager extends PuzzleView {
			async data() {
				await this.ctx.store.loadOne('post', 'p1');
				return { post: this.ctx.store.findOne('post', 'p1') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? '')]);
			}
		}
		await new Eager(ctxWith(store)).mount(container());

		expect(nudges(warn).length).toBe(1);
		expect(nudges(warn)[0]).toContain('store.loadOne()');
		warn.mockRestore();
	});
});

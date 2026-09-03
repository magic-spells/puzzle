// @vitest-environment jsdom
//
// D161 read state has two facts about a collection, not one. LOADED — the
// collection request finished, so a tracked findMany does not re-fault — is
// true for any successful no-options load. EXHAUSTIVE — a findOne miss is an
// authoritative "does not exist", so no detail request is owed — is something
// the framework can only vouch for when IT generated the request (the D158 REST
// default). An authored loadMany is opaque: a paginated first page is a
// perfectly good response and says nothing about the ids it omits.
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
const settled = () => new Promise((resolve) => setTimeout(resolve, 300));

const API = 'https://x.test';
const PAGE = [
	{ id: 'p1', title: 'One' },
	{ id: 'p2', title: 'Two' },
];

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: status === 404 ? 'Not Found' : 'OK',
	text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

/** Generated REST both ways — the tier that IS exhaustive. */
class RestPost extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
	static adapter = { endpoint: '/api/posts' };
}

/** An authored, paginated loadMany beside the generated loadOne. */
class PagedPost extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
	static adapter = {
		endpoint: '/api/posts',
		loadMany: async (fetch) => {
			const res = await fetch(`${API}/api/posts?page=1`);
			const body = await res.text();
			return JSON.parse(body).items;
		},
	};
}

function serve() {
	const calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url) => {
			const target = String(url);
			calls.push(target);
			if (target.includes('page=1')) return json({ items: PAGE, nextPage: 2 });
			const id = target.split('/api/posts/')[1];
			if (id === undefined) return json(PAGE);
			const found = PAGE.find((p) => p.id === id);
			return found ? json(found) : json({ error: 'missing' }, 404);
		})
	);
	return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('an authored loadMany', () => {
	it('does not make a findOne miss authoritative — the off-page id is still fetched', async () => {
		const calls = serve();
		const store = new Store({ post: PagedPost }, { apiURL: API, adapter });
		await store.loadMany('post'); // the first page, and nothing about page 2

		class V extends PuzzleView {
			data() {
				return { post: this.ctx.store.findOne('post', 'p9') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? 'none')]);
			}
		}
		await new V(ctxWith(store)).mount(container());

		expect(calls).toContain(`${API}/api/posts/p9`);
	});

	it('still stops a tracked findMany from re-faulting on every run', async () => {
		const calls = serve();
		const store = new Store({ post: PagedPost }, { apiURL: API, adapter });
		let runs = 0;
		class V extends PuzzleView {
			data() {
				runs++;
				return { posts: this.ctx.store.findMany('post') };
			}
			render() {
				return h('div', {}, [text(String(this.getData().posts.length))]);
			}
		}
		const el = container();
		await new V(ctxWith(store)).mount(el);
		expect(el.textContent).toBe('2');
		await settled();
		await settled();

		expect(calls.filter((c) => c.includes('page=1')).length).toBe(1);
		expect(runs).toBe(2); // the pass that faulted and the pass that committed
	});
});

describe('the generated REST collection load', () => {
	it('answers a findOne miss locally, with no request', async () => {
		const calls = serve();
		const store = new Store({ post: RestPost }, { apiURL: API, adapter });
		await store.loadMany('post');

		class V extends PuzzleView {
			data() {
				return { post: this.ctx.store.findOne('post', 'p9') };
			}
			render() {
				return h('div', {}, [text(this.getData().post?.title ?? 'none')]);
			}
		}
		const el = container();
		await new V(ctxWith(store)).mount(el);

		expect(el.textContent).toBe('none');
		expect(calls).toEqual([`${API}/api/posts`]);
	});
});

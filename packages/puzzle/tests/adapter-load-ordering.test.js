// @vitest-environment jsdom
//
// D138 read ordering. Two overlapping reads for the same identity used to be
// decided by arrival order alone: loadOne/loadMany captured only the local-
// mutation revision, and nothing advanced for a SERVER response, so a slow
// first request landing after a fast second one silently rolled the record
// back. Every read now carries a per-store dispatch generation and a record
// remembers the highest one that landed on it, so a response that lost the race
// is dropped for that record. Local-edit protection is unchanged and still
// layers on top.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Store } from '../client-runtime/datastore/store.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

adapter.install();

const API = 'https://x.test/v1';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** A verb whose every call hands back a promise this file settles by hand. */
function gate() {
	const calls = [];
	return {
		calls,
		verb() {
			const d = deferred();
			calls.push(d);
			return d.promise;
		},
	};
}

/** post model whose loadOne/loadMany are author functions driven by `g`. */
function postModel(g) {
	return class Post extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			title: Puzzle.string().required(),
			published: Puzzle.boolean().default(false),
		};
		static adapter = {
			endpoint: '/api/posts',
			loadOne: () => g.verb(),
			loadMany: () => g.verb(),
		};
	};
}

const makeStore = (g) => new Store({ post: postModel(g) }, { apiURL: API, adapter });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('overlapping loads for the same identity', () => {
	it('keeps the newer loadOne when the older response lands last', async () => {
		const g = gate();
		const store = makeStore(g);

		const first = store.loadOne('post', 'p1');
		const second = store.loadOne('post', 'p1');
		expect(g.calls).toHaveLength(2);

		g.calls[1].resolve({ id: 'p1', title: 'v2' });
		const newer = await second;
		g.calls[0].resolve({ id: 'p1', title: 'v1' });
		const older = await first;

		expect(older).toBe(newer); // one identity, one record instance
		expect(store.findOne('post', 'p1').title).toBe('v2');
	});

	it('keeps the newer loadMany when the older response lands last', async () => {
		const g = gate();
		const store = makeStore(g);

		const first = store.loadMany('post');
		const second = store.loadMany('post');

		g.calls[1].resolve([{ id: 'p1', title: 'v2' }]);
		await second;
		g.calls[0].resolve([{ id: 'p1', title: 'v1' }]);
		await first;

		expect(store.findOne('post', 'p1').title).toBe('v2');
	});

	it('applies the older response when the newer request rejects', async () => {
		const g = gate();
		const store = makeStore(g);

		const first = store.loadOne('post', 'p1');
		const second = store.loadOne('post', 'p1');

		g.calls[1].reject(new Error('network'));
		await expect(second).rejects.toThrow('network');
		g.calls[0].resolve({ id: 'p1', title: 'v1' });
		await first;

		// Nothing newer LANDED, so the loser of the race is still authoritative.
		expect(store.findOne('post', 'p1').title).toBe('v1');
	});
});

describe('an automatic fault racing an explicit loadOne', () => {
	/** Mount a view whose tracked findOne misses, so D161 faults the identity in. */
	function faultingView(store) {
		class PostView extends PuzzleView {
			data() {
				return { title: this.ctx.store.findOne('post', 'p1')?.title ?? '' };
			}
			render() {
				return h('div', {}, [text(this.getData().title)]);
			}
		}
		const el = document.createElement('div');
		document.body.appendChild(el);
		const view = new PostView({ store, router: null, formatters: null });
		return { el, view, mounting: view.mount(el) };
	}

	it('lets the explicit read win when it resolves last', async () => {
		const g = gate();
		const store = makeStore(g);
		const { view, mounting } = faultingView(store);
		await tick();
		expect(g.calls).toHaveLength(1); // the fault

		const explicit = store.loadOne('post', 'p1');
		expect(g.calls).toHaveLength(2);

		g.calls[0].resolve({ id: 'p1', title: 'old' }); // fault first
		await tick();
		g.calls[1].resolve({ id: 'p1', title: 'new' }); // explicit second
		await explicit;
		await mounting;

		expect(store.findOne('post', 'p1').title).toBe('new');
		view.destroy();
	});

	it('lets the explicit read win when it resolves FIRST', async () => {
		const g = gate();
		const store = makeStore(g);
		const { view, mounting } = faultingView(store);
		await tick();
		expect(g.calls).toHaveLength(1);

		const explicit = store.loadOne('post', 'p1');
		expect(g.calls).toHaveLength(2);

		g.calls[1].resolve({ id: 'p1', title: 'new' }); // explicit first
		await explicit;
		g.calls[0].resolve({ id: 'p1', title: 'old' }); // fault second — stale, dropped
		await mounting;
		await tick();

		expect(store.findOne('post', 'p1').title).toBe('new');
		view.destroy();
	});
});

describe('D138 local-edit protection is unaffected', () => {
	it('a mid-flight update() still survives the load response', async () => {
		const g = gate();
		const store = makeStore(g);
		const post = store.upsert('post', { id: 'p1', title: 'orig', published: false });

		const loading = store.loadOne('post', 'p1');
		post.update({ title: 'local' });
		g.calls[0].resolve({ id: 'p1', title: 'server', published: true });
		await loading;

		expect(post.title).toBe('local'); // edited after dispatch — never rolled back
		expect(post.published).toBe(true); // untouched — merged
	});
});

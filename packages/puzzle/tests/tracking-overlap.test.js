// @vitest-environment jsdom
//
// The sync-SHAPED async overlap hazard (D161). Store.withTracking keeps its
// tracking state — `_tracking`, `_trackingAdded`, `_requests` — in mutable Store
// fields, so exactly one async evaluation may be open at a time. A DECLARED-async
// data() is hinted (`expectsAsync`) and defers before it runs, which is safe. A
// .then-style data() — a plain function returning a promise — is not: withTracking
// runs it optimistically inline, discovers the promise, unwinds, and retries behind
// the chain, but the ABANDONED first invocation's continuations still run later and
// record their store reads into whichever evaluation holds `_requests` by then.
//
// These lock the three mitigations: the sticky per-view async-shape flag, the
// per-invocation eval-scope identity guard in prepareRefresh, and the dev-only
// steering warning.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';

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
	static schema = { id: Puzzle.string().primary(), title: Puzzle.string().required() };
	static adapter = { endpoint: '/api/posts' };
}

// A model whose transport always fails — the contamination test needs a fault that
// REJECTS, so it is visible in whichever settle batch ends up owning it.
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

function serve(posts = {}) {
	const calls = [];
	const fetchMock = vi.fn(async (url) => {
		const target = String(url);
		calls.push(target);
		if (target.includes('/api/flaky')) return json({ error: 'boom' }, 500);
		const id = target.split('/').pop();
		return posts[id] ? json(posts[id]) : json({ error: 'missing' }, 404);
	});
	vi.stubGlobal('fetch', fetchMock);
	return { calls, fetchMock };
}

const makeStore = () => new Store({ post: Post, flaky: Flaky }, { apiURL: API, adapter });

/** The steering warning, isolated from the other advisories the runtime emits. */
const shapeWarnings = (spy) =>
	spy.mock.calls.filter((call) => String(call[0]).includes('plain function returning a Promise'));

let warnSpy;

beforeEach(() => {
	document.body.innerHTML = '';
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('D161 overlap — the sticky async-shape flag', () => {
	it('defers a flagged .then-style data() behind an in-flight chain instead of running it inline', async () => {
		serve();
		const store = makeStore();
		store.upsert('post', { id: 'p1', title: 'One' });
		store.upsert('post', { id: 'p2', title: 'Two' });
		// Drain the seeds' BATCHED notifications while nobody subscribes. The flush is
		// rAF-scheduled (D63): on a fast machine it fires after this test's last
		// assertion, but on a slow runner it lands mid-test — a legitimate store-change
		// refresh on the by-then-subscribed view, and one more data() run than the
		// counts below expect. That is exactly the flake CI hit; nothing here asserts
		// notification behavior, so deliver-to-nobody makes the counts deterministic.
		store.flush();

		const gate = deferred();
		let slowRuns = 0;
		class SlowView extends PuzzleView {
			async data() {
				slowRuns++;
				await gate.promise;
				return { title: store.findOne('post', 'p1')?.title };
			}
			render() {
				return h('div', {}, [text(this.getData().title ?? '')]);
			}
		}

		let thenRuns = 0;
		class ThenView extends PuzzleView {
			data(params) {
				thenRuns++;
				return Promise.resolve().then(() => ({
					title: store.findOne('post', params.id)?.title,
				}));
			}
			render() {
				return h('div', {}, [text(this.getData().title ?? '')]);
			}
		}

		// The view's FIRST evaluation is the one that discovers the shape.
		const thenEl = container();
		const thenView = new ThenView(ctxWith(store));
		await thenView.mount(thenEl, { params: { id: 'p1' } });
		expect(thenEl.textContent).toBe('One');
		expect(thenView._dataAsyncShape).toBe(true);
		expect(thenRuns).toBe(1);

		// Open an async chain and leave it open.
		const slowEl = container();
		const slowView = new SlowView(ctxWith(store));
		const mountingSlow = slowView.mount(slowEl);
		await tick();
		expect(slowRuns).toBe(1);

		// Flagged, so this defers BEFORE running — there is no abandoned invocation.
		const refreshing = thenView.refresh({ params: { id: 'p2' } });
		await tick();
		expect(thenRuns).toBe(1);

		gate.resolve();
		await mountingSlow;
		await refreshing;
		await tick();

		expect(slowEl.textContent).toBe('One'); // the suspended view's own model
		expect(thenRuns).toBe(2); // one invocation, behind the chain — not two
		expect(thenEl.textContent).toBe('Two');
	});

	it('keeps a flagged view’s failing fetch out of another view’s settle batch', async () => {
		const { calls } = serve({ p1: { id: 'p1', title: 'One' }, p2: { id: 'p2', title: 'Two' } });
		const store = makeStore();
		store.upsert('post', { id: 'p2', title: 'Two' });
		store.flush(); // same seed-notification drain as above — keep the run counts deterministic

		const gate = deferred();
		class SlowView extends PuzzleView {
			async data() {
				await gate.promise;
				// A MISS: this fault belongs to this view's request map and nobody else's.
				return { title: store.findOne('post', 'p1')?.title };
			}
			render() {
				return h('div', {}, [text(this.getData().title ?? '')]);
			}
		}

		class ThenView extends PuzzleView {
			data(params) {
				// The store read happens in the CONTINUATION — after withTracking has had
				// its chance to abandon this invocation.
				return Promise.resolve().then(() =>
					params.broken
						? { title: store.findOne('flaky', 'f1')?.body }
						: { title: store.findOne('post', 'p2')?.title }
				);
			}
			render() {
				return h('div', {}, [text(this.getData().title ?? '')]);
			}
		}

		const thenView = new ThenView(ctxWith(store));
		await thenView.mount(container(), { params: { broken: false } });
		expect(thenView._dataAsyncShape).toBe(true);

		const slowEl = container();
		const slowView = new SlowView(ctxWith(store));
		const mountingSlow = slowView.mount(slowEl);
		await tick();

		const broken = thenView.refresh({ params: { broken: true } }).catch((err) => err);
		await tick();

		gate.resolve();
		// The suspended view settles on its OWN fetch and commits its own model; the
		// other view's transport failure never reaches its batch.
		await mountingSlow;
		expect(slowEl.textContent).toBe('One');

		// And the failure still lands where it belongs.
		const err = await broken;
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(500);
		expect(calls.filter((url) => url.includes('/api/flaky'))).toHaveLength(1);

		// Torn down before the test ends: the broken params are committed now, so a
		// later store flush would re-run the failing data() and log into the next test.
		thenView.destroy();
		slowView.destroy();
		await tick();
	});
});

describe('D161 overlap — the prepared-refresh scope identity guard', () => {
	// The residual window the flag cannot close: a view's FIRST promise-shaped
	// evaluation is what reveals the shape, so that one invocation can still be
	// abandoned and retried. These two drive exactly that interleaving.
	function scopeFixture(store) {
		const gates = [];
		const seen = [];
		let calls = 0;
		class PreparedView extends PuzzleView {
			data(params) {
				calls++;
				// Synchronous on the mount, so the view is still UNFLAGGED when the
				// prepare below runs and withTracking abandons its first invocation.
				if (calls === 1) return { id: params.id };
				const gate = deferred();
				gates.push(gate);
				return gate.promise.then(() => {
					seen.push(this.params.id);
					return { id: this.params.id };
				});
			}
			render() {
				return h('div', {}, [text(this.getData().id ?? '')]);
			}
		}
		return {
			gates,
			seen,
			view: new PreparedView(ctxWith(store)),
			calls: () => calls,
		};
	}

	/** Opens an async tracking chain and hands back the handle that closes it. */
	function openChain(store) {
		const gate = deferred();
		class ChainView extends PuzzleView {
			async data() {
				await gate.promise;
				return {};
			}
			render() {
				return h('div', {}, []);
			}
		}
		const view = new ChainView(ctxWith(store));
		return { mounting: view.mount(container()), release: gate.resolve };
	}

	it('a late-resolving abandoned invocation cannot clobber the retry’s scope', async () => {
		serve();
		const store = makeStore();
		const el = container();
		const { gates, seen, view, calls } = scopeFixture(store);
		await view.mount(el, { params: { id: 'p1' } });
		expect(el.textContent).toBe('p1');
		expect(view._dataAsyncShape).toBe(false);

		const chain = openChain(store);
		await tick();

		const prepared = view.prepareRefresh({ params: { id: 'p2' } });
		await tick();
		expect(calls()).toBe(2); // invocation #1 — the one withTracking abandons
		expect(gates).toHaveLength(1);

		chain.release();
		await chain.mounting;
		await tick();
		expect(calls()).toBe(3); // invocation #2 — the retry, now suspended
		expect(gates).toHaveLength(2);

		// The abandoned invocation resolves LATE, after the retry installed its scope.
		gates[0].resolve();
		await tick();
		// Only now does the live invocation resume — it must still see the DESTINATION.
		gates[1].resolve();
		await prepared.ready;

		expect(seen).toEqual(['p2', 'p2']);

		prepared.commit();
		expect(view.params.id).toBe('p2');
		expect(el.textContent).toBe('p2');
	});

	it('discarding that same prepare leaves the committed params and DOM untouched', async () => {
		serve();
		const store = makeStore();
		const el = container();
		const { gates, view, calls } = scopeFixture(store);
		await view.mount(el, { params: { id: 'p1' } });

		const chain = openChain(store);
		await tick();

		const prepared = view.prepareRefresh({ params: { id: 'p2' } });
		await tick();
		chain.release();
		await chain.mounting;
		await tick();
		expect(calls()).toBe(3);

		gates[0].resolve();
		await tick();
		gates[1].resolve();
		await prepared.ready;

		prepared.discard();
		expect(view.params.id).toBe('p1');
		expect(el.textContent).toBe('p1');
		expect(store.keysBySubscriber.get(view) ?? new Set()).toEqual(new Set());
	});
});

describe('D161 overlap — the dev steering warning', () => {
	class PlainPromiseView extends PuzzleView {
		data() {
			return Promise.resolve({ n: 1 });
		}
		render() {
			return h('div', {}, [text(String(this.getData().n ?? ''))]);
		}
	}

	it('warns once per view class, naming the class and the fix', async () => {
		const store = makeStore();
		await new PlainPromiseView(ctxWith(store)).mount(container());

		const warnings = shapeWarnings(warnSpy);
		expect(warnings).toHaveLength(1);
		expect(warnings[0][0]).toContain('PlainPromiseView.data()');
		expect(warnings[0][0]).toContain('declare it `async`');

		// A second INSTANCE of the same class is the same authoring mistake.
		await new PlainPromiseView(ctxWith(store)).mount(container());
		expect(shapeWarnings(warnSpy)).toHaveLength(1);
	});

	it('says nothing about a data() that is already declared async', async () => {
		const store = makeStore();
		class DeclaredAsyncView extends PuzzleView {
			async data() {
				return { n: 2 };
			}
			render() {
				return h('div', {}, [text(String(this.getData().n ?? ''))]);
			}
		}
		const view = new DeclaredAsyncView(ctxWith(store));
		await view.mount(container());
		expect(shapeWarnings(warnSpy)).toHaveLength(0);
		expect(view._dataAsyncShape).toBe(true); // still latched — it just needs no advice
	});

	it('latches the flag but warns nothing when __PUZZLE_DEV__ is false', async () => {
		globalThis.__PUZZLE_DEV__ = false;
		try {
			const store = makeStore();
			// A class the dev-mode registry has never seen, so a warning here could only
			// come from this run.
			class ProdShapeView extends PuzzleView {
				data() {
					return Promise.resolve({ n: 3 });
				}
				render() {
					return h('div', {}, [text(String(this.getData().n ?? ''))]);
				}
			}
			const view = new ProdShapeView(ctxWith(store));
			await view.mount(container());
			expect(shapeWarnings(warnSpy)).toHaveLength(0);
			expect(view._dataAsyncShape).toBe(true); // the mitigation itself still runs
		} finally {
			delete globalThis.__PUZZLE_DEV__;
		}
	});
});

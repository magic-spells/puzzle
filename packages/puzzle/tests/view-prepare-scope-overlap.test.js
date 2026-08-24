// @vitest-environment jsdom
//
// D146 — the prepared-eval scope (#evalScope) must be non-null EXACTLY while one
// of this view's prepared data() evaluations is suspended, and null again once
// they have all unwound.
//
// The regression: `outer` was captured once at prepare-CREATION time, so a
// prepare created while an EARLIER prepare's async tail was still in flight
// captured that earlier prepare's scope as its unwind target. By the time the
// second prepare actually ran (the store serializes async evaluations, so it is
// deferred behind the first), the first had already unwound — and restoring to it
// left #evalScope permanently pointing at a destination that never committed.
// view.params / view.route then reported that dead scope for the life of the view.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView, settled } from '../client-runtime/testing/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const tick = () => new Promise((r) => setTimeout(r, 0));

const handles = [];
afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function deferred() {
	let resolve;
	const promise = new Promise((r) => (resolve = r));
	return { promise, resolve };
}

const snapshot = (id) => ({ path: `/x/${id}`, route: { name: id }, params: { id }, chain: [] });

describe('prepareRefresh eval-scope unwinding', () => {
	it('overlapping prepares leave no dead scope behind', async () => {
		const gates = { a: deferred(), b: deferred() };
		class Detail extends PuzzleView {
			async data(params) {
				await gates[params.id]?.promise;
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', { class: 'detail' }, [text(this.getData().id ?? '')]);
			}
		}

		const view = await mountView(Detail, {
			params: { id: 'start' },
			route: snapshot('start'),
		});
		handles.push(view);
		const instance = view.instance;

		// Prepare A runs and suspends on its gate — its scope is installed.
		const a = instance.prepareRefresh({ params: { id: 'a' }, route: snapshot('a') });
		await tick();
		expect(instance.params.id).toBe('a'); // A's destination scope is live

		// Prepare B is created WHILE A is suspended. The store defers its evaluation
		// behind A's in-flight chain, so B does not actually run until A has unwound.
		const b = instance.prepareRefresh({ params: { id: 'b' }, route: snapshot('b') });

		gates.a.resolve();
		await a.ready;
		gates.b.resolve();
		await b.ready;
		await settled();

		// A loses (superseded), B commits — the ordinary supersede-then-commit shape.
		a.discard();
		b.commit();
		await settled();

		// With every prepared evaluation unwound, the getters must report COMMITTED
		// state. The bug pinned them to prepare A's destination forever.
		expect(instance.params.id).toBe('b');
		expect(instance.route.route.name).toBe('b');
		expect(view.element.textContent).toBe('b');

		// And a later committed refresh is visible rather than masked by the dead scope.
		await instance.refresh({ params: { id: 'later' }, route: snapshot('later') });
		await settled();
		expect(instance.params.id).toBe('later');
		expect(instance.route.route.name).toBe('later');
	});

	it('a within-prepare retry still unwinds to the pre-prepare scope', async () => {
		// The case the capture-once comment was written for: a .then-shaped data()
		// reveals itself as async while another evaluation already holds the store's
		// tracking chain, so withTracking ABANDONS the first invocation and re-runs
		// the same prepare behind that chain. The abandoned invocation's scope must
		// never become the retry's unwind target.
		const outer = deferred();
		let gate = Promise.resolve();
		let runs = 0;

		class Other extends PuzzleView {
			data() {
				return outer.promise.then(() => ({}));
			}
			render() {
				return h('puzzle-view', {}, []);
			}
		}
		class Detail extends PuzzleView {
			// Deliberately NOT declared async: the sync-shaped probe is what reaches
			// the abandon-and-retry branch inside Store.withTracking.
			data(params) {
				runs++;
				return gate.then(() => ({ id: params.id }));
			}
			render() {
				return h('puzzle-view', { class: 'detail' }, [text(this.getData().id ?? '')]);
			}
		}

		const view = await mountView(Detail, {
			params: { id: 'start' },
			route: snapshot('start'),
		});
		handles.push(view);
		const instance = view.instance;

		// Park a foreign async evaluation on the SAME store so the tracking chain is busy.
		const other = new Other(view.ctx);
		const otherRun = other.refresh();
		await tick();

		const blocked = deferred();
		gate = blocked.promise;
		// The mount already made the async shape sticky; clear it so this prepare
		// takes the sync-SHAPED probe and is abandoned mid-flight by the busy chain.
		instance._dataAsyncShape = false;
		const before = runs;
		const p = instance.prepareRefresh({ params: { id: 'r' }, route: snapshot('r') });
		await tick();

		outer.resolve();
		await otherRun;
		await tick();
		blocked.resolve();
		await p.ready;
		// The abandoned invocation AND the retry both ran — the multi-invocation
		// window the capture-once comment describes.
		expect(runs).toBe(before + 2);
		p.commit();
		await settled();
		other.destroy();

		expect(instance.params.id).toBe('r');
		expect(instance.route.route.name).toBe('r');

		// Nothing left installed: a committed refresh reports its own params.
		await instance.refresh({ params: { id: 'after' }, route: snapshot('after') });
		await settled();
		expect(instance.params.id).toBe('after');
		expect(instance.route.route.name).toBe('after');
	});
});

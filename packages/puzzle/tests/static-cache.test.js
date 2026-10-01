// @vitest-environment jsdom
//
// Static subtree caching (D170).
//
// The compiler wraps every maximal static subtree worth caching in
// `(this.__c[n] ??= new ViewNode(…))`, so a template's unchanging markup is
// allocated ONCE per instance instead of on every render — and `patch()`'s
// identity short-circuit then skips it. The runtime's whole share is the `__c`
// array declared on PuzzleView; these tests pin the contract that array has to
// keep: it survives every render, an island's children array can live in it, and
// slot expansion never clones a node out of it (which would hand the patcher a
// different object every render and quietly undo the caching).
import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { expandSlots } from '../client-runtime/views/viewManager.js';
import { devperfInstallSink } from '../client-runtime/devperf.js';
import { mountView, settled } from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const handles = [];
let builds = 0;

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	builds = 0;
});

/** Stands in for a compiled static subtree: counts how often it is allocated. */
function buildStatic() {
	builds++;
	return h('header', { class: 'shell' }, [
		h('h1', { class: 'title' }, [text('Puzzle')]),
		h('p', {}, [text('a quiet place')]),
	]);
}

describe('__c — the per-instance static cache', () => {
	it('builds a cached subtree once across N renders', async () => {
		class Page extends PuzzleView {
			render() {
				return h('div', {}, [
					(this.__c[0] ??= buildStatic()),
					h('span', {}, [text(String(this.getData().n ?? 0))]),
				]);
			}
		}

		const view = await mountView(Page);
		handles.push(view);
		const cached = view.instance.__c[0];

		for (let n = 1; n <= 5; n++) {
			view.instance.setData('n', n);
			await settled();
		}

		expect(builds).toBe(1);
		expect(view.instance.__c[0]).toBe(cached);
		expect(view.find('span').textContent).toBe('5');
		expect(view.find('.title').textContent).toBe('Puzzle');
	});

	it('reports the allocation to devperf: built on the first render, zero after', async () => {
		class Counted extends PuzzleView {
			render() {
				return h('div', {}, [
					(this.__c[0] ??= buildStatic()),
					h('span', {}, [text(String(this.getData().n ?? 0))]),
				]);
			}
		}

		const events = [];
		const off = devperfInstallSink((event) => {
			if (event.type === 'static-cache' && event.viewName === 'Counted') events.push(event);
		});
		try {
			const view = await mountView(Counted);
			handles.push(view);
			for (let n = 1; n <= 3; n++) {
				view.instance.setData('n', n);
				await settled();
			}
		} finally {
			off();
		}

		// The dev counter an author reads to answer "is this template still
		// rebuilding its static markup?" — the honest number is what was ALLOCATED,
		// since the compiler's bare `??=` never tells the runtime what was visited.
		expect(events.length).toBeGreaterThan(1);
		expect(events[0]).toMatchObject({ built: 1, held: 0 });
		expect(events.slice(1).every((event) => event.built === 0)).toBe(true);
	});

	it('gives each INSTANCE its own cache', async () => {
		class Page extends PuzzleView {
			render() {
				return h('div', {}, [(this.__c[0] ??= buildStatic())]);
			}
		}

		const first = await mountView(Page);
		const second = await mountView(Page);
		handles.push(first, second);

		// A cached vnode carries live `el` links, so it belongs to one instance —
		// sharing one at module scope would make two mounted views fight over the
		// same DOM node.
		expect(builds).toBe(2);
		expect(first.instance.__c[0]).not.toBe(second.instance.__c[0]);
	});

	it('caches an island\'s children ARRAY, so the seed is allocated once', async () => {
		class Islands extends PuzzleView {
			render() {
				return h('div', {}, [
					h(
						'div',
						{ island: true, 'data-n': String(this.getData().n ?? 0) },
						(this.__c[0] ??= [h('b', {}, [text('seed')])])
					),
				]);
			}
		}

		const view = await mountView(Islands);
		handles.push(view);
		const seed = view.instance.__c[0];
		const island = view.find('[data-n]');
		// Third-party content the island's owner wrote after mount: D44 says the
		// patcher never touches it again.
		island.appendChild(document.createElement('i'));

		view.instance.setData('n', 1);
		await settled();

		expect(view.instance.__c[0]).toBe(seed);
		expect(island.getAttribute('data-n')).toBe('1');
		expect(island.querySelector('i')).not.toBe(null);
	});
});

describe('slot expansion leaves cached nodes alone', () => {
	it('clones only the path to a marker, never a cached sibling', () => {
		const cached = h('header', {}, [h('h1', {}, [text('Puzzle')])]);
		const tree = h('div', {}, [cached, h('main', {}, [new ViewNode(SLOT_TAG)])]);

		const expanded = expandSlots(tree, [h('p', {}, [text('routed')])]);

		// The root and the marker's parent are cloned (their child lists changed);
		// the cached sibling is returned by reference, which is what keeps the
		// identity short-circuit alive across renders.
		expect(expanded).not.toBe(tree);
		expect(expanded.children[0]).toBe(cached);
		expect(expanded.children[1]).not.toBe(tree.children[1]);
		expect(expanded.children[1].children[0].tag).toBe('p');
	});

	it('returns the WHOLE tree by reference when it holds no marker', () => {
		const cached = h('header', {}, [h('h1', {}, [text('Puzzle')])]);
		const tree = h('div', {}, [cached]);

		expect(expandSlots(tree, [])).toBe(tree);
	});
});

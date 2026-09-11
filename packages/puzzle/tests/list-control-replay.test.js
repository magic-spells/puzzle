// @vitest-environment jsdom
//
// Controlled form values inside a CACHED subtree (D170, D147).
//
// A row the list block hands back unchanged is reconciled by patch()'s identity
// short-circuit, which does no attr pass at all — so the one thing a full patch
// would still have done, re-asserting `value`/`checked` against the LIVE DOM,
// has to happen here. Two things decide whether it lands on the right elements:
// WHAT the row's `controls` list collects (it must stop at an island and go
// through a portal), and what happens when a cached control is reached through
// an ORDINARY patch with no list of its own (slot expansion clones the row
// vnode, and the clone carries no `controls`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { PORTAL_TAG, SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { teardownPortals } from '../client-runtime/views/portal.js';
import { listRows } from '../client-runtime/views/listBlock.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

// `key={item}` over primitive rows, and a site the compiler marked as carrying
// controlled values.
const CTRL = { key: (item) => item, ctrl: true };

afterEach(() => {
	teardownPortals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

/**
 * A block driven straight at a ViewManager. The host view never renders through
 * the view pipeline, so its render counter stays put and the second pass is a
 * genuine cache hit.
 */
function setup(factory, meta = CTRL) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const vm = new ViewManager(container, {});
	const view = new PuzzleView({});
	view.__dirty = 0;
	const render = () => vm.render(h('ul', {}, listRows(view, view, 0, ['a'], factory, meta)));
	return { vm, container, render };
}

/** Count writes to an element's `value` property from this point on. */
function countValueWrites(el) {
	const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
	const counter = { writes: 0 };
	Object.defineProperty(el, 'value', {
		configurable: true,
		get() {
			return desc.get.call(this);
		},
		set(v) {
			counter.writes++;
			desc.set.call(this, v);
		},
	});
	return counter;
}

describe('what a cached row re-asserts', () => {
	it('stops at an island element and leaves its seeded input alone', () => {
		const { container, render } = setup((s) =>
			h('li', { key: s.k }, [
				h('input', { class: 'bound', value: 'bound' }, []),
				// D44 island: the patcher never reconciles these children after the
				// seed, so identity replay must not either.
				h('div', { island: true }, [h('input', { class: 'seeded', value: 'seed' }, [])]),
			])
		);
		render();

		const bound = container.querySelector('.bound');
		const seeded = container.querySelector('.seeded');
		// The user (or the widget that owns the island) moves both out of band.
		bound.value = 'typed';
		seeded.value = 'widget';

		render();

		expect(bound.value).toBe('bound');
		expect(seeded.value).toBe('widget');
	});

	it('collects through a Portal, which a cached ancestor never lets patchPortal reach', () => {
		const { render } = setup((s) =>
			h('li', { key: s.k }, [new ViewNode(PORTAL_TAG, {}, [h('input', { class: 'far', value: 'bound' }, [])])])
		);
		render();

		const far = document.querySelector('.far');
		expect(far.value).toBe('bound');
		far.value = 'typed';

		render();

		expect(far.value).toBe('bound');
	});
});

describe('a cached control reached through an ordinary patch', () => {
	it('re-asserts itself when slot expansion cloned the row around it', () => {
		// Slot expansion clones every vnode on the path to a marker — the row root
		// included — and the clone carries no `controls` list; the input INSIDE it
		// is still the same cached object on both sides of the patch.
		const { container, render } = setup((s) =>
			h('li', { key: s.k }, [
				h('input', { class: 'bound', value: 'bound' }, []),
				new ViewNode(SLOT_TAG, { name: 'body' }, [text('fallback')]),
			])
		);
		render();

		const bound = container.querySelector('.bound');
		expect(container.textContent).toContain('fallback');
		bound.value = 'typed';

		render();

		expect(bound.value).toBe('bound');
	});

	it('replays a cached control row exactly once', () => {
		// The row root IS the control, so it is in its own `controls` list: the
		// list re-assert runs, and the element-level one must not run again.
		const { container, render } = setup((s) => h('input', { key: s.k, class: 'bound', value: 'bound' }, []));
		render();

		const bound = container.querySelector('.bound');
		bound.value = 'typed';
		const writes = countValueWrites(bound);

		render();

		expect(bound.value).toBe('bound');
		expect(writes.writes).toBe(1);
	});
});

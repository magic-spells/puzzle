// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';

// Inline SVG (v1.14, D46): a compiled `{#svg 'file'}` emits a plain element vnode
// whose `children` is a STRING — the verbatim inner markup of the file. The
// ViewManager seeds it once via innerHTML at mount (inside the SVG namespace) and
// then treats the subtree as island-owned (D44): children are never reconciled,
// while the element's own attrs/listeners keep patching. See DOC-SPEC §18.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Compiler-shaped inline-SVG vnode: string children, seeded via innerHTML.
const svg = (attrs, inner) => new ViewNode('svg', attrs, inner);
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const setup = () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { container, vm: new ViewManager(container) };
};

describe('ViewManager — inline SVG (string children)', () => {
	it('seeds the string children via innerHTML at mount', () => {
		const { container, vm } = setup();
		vm.render(svg({ viewBox: '0 0 16 16' }, '<path d="M1 1h14"></path>'));
		const el = container.firstChild;
		expect(el.tagName.toLowerCase()).toBe('svg');
		expect(el.getAttribute('viewBox')).toBe('0 0 16 16');
		expect(el.innerHTML).toBe('<path d="M1 1h14"></path>');
	});

	it('creates the root and its seeded children in the SVG namespace', () => {
		const { container, vm } = setup();
		vm.render(svg({}, '<circle cx="8" cy="8" r="4"></circle>'));
		const el = container.firstChild;
		expect(el.namespaceURI).toBe(SVG_NS);
		const child = el.firstChild;
		expect(child.namespaceURI).toBe(SVG_NS); // innerHTML parsed in SVG context
		expect(child.tagName.toLowerCase()).toBe('circle');
		// A real SVGElement, not an inert HTMLUnknownElement.
		expect(child instanceof container.ownerDocument.defaultView.SVGElement).toBe(true);
	});

	it('never reconciles the children on patch, but patches the root attrs/listeners', () => {
		const { container, vm } = setup();
		const fn1 = vi.fn();
		const fn2 = vi.fn();
		vm.render(svg({ class: 'a', '@click': fn1 }, '<path d="M0 0"></path>'));
		const el = container.firstChild;
		const seededChild = el.firstChild;
		expect(el.className.baseVal ?? el.getAttribute('class')).toBe('a');

		// Something owns the subtree internals now; simulate an external mutation.
		el.appendChild(document.createElementNS(SVG_NS, 'rect'));

		// Re-render: SAME seed string, changed class + swapped handler.
		vm.render(svg({ class: 'b', '@click': fn2 }, '<path d="M0 0"></path>'));
		expect(container.firstChild).toBe(el); // same node
		expect(el.getAttribute('class')).toBe('b'); // attr patched
		expect(el.firstChild).toBe(seededChild); // child identity untouched
		expect(el.querySelector('rect')).not.toBeNull(); // external mutation survives

		el.dispatchEvent(new Event('click'));
		expect(fn2).toHaveBeenCalledTimes(1); // swapped handler fires
		expect(fn1).not.toHaveBeenCalled(); // old handler gone
	});

	it('does NOT touch the DOM when the seed string is identical', () => {
		const { container, vm } = setup();
		vm.render(svg({ id: 'x' }, '<path d="M0 0"></path>'));
		const el = container.firstChild;
		const seededChild = el.firstChild;

		// Setting innerHTML — even to the same string — replaces the child nodes, so
		// child IDENTITY is a faithful proxy for "innerHTML was written". An external
		// mutation is added too: a re-seed would wipe it, a skip leaves it.
		el.appendChild(document.createElementNS(SVG_NS, 'rect'));

		vm.render(svg({ id: 'y' }, '<path d="M0 0"></path>')); // same seed, new attr
		expect(el.firstChild).toBe(seededChild); // never re-seeded (same node identity)
		expect(el.querySelector('rect')).not.toBeNull(); // external mutation survives
		expect(el.getAttribute('id')).toBe('y'); // attr still patched
	});

	it('re-applies innerHTML when a same-node patch carries a DIFFERENT seed', () => {
		const { container, vm } = setup();
		vm.render(svg({}, '<path d="M0 0"></path>'));
		const el = container.firstChild;
		const firstChild = el.firstChild;

		vm.render(svg({}, '<circle cx="1" cy="1" r="1"></circle>'));
		expect(container.firstChild).toBe(el); // same root node
		expect(el.firstChild).not.toBe(firstChild); // re-seeded
		expect(el.innerHTML).toBe('<circle cx="1" cy="1" r="1"></circle>');
	});

	it('mounts/patches an inline SVG nested among ordinary element children', () => {
		const { container, vm } = setup();
		vm.render(
			h('span', { class: 'icon' }, [svg({ viewBox: '0 0 1 1' }, '<path d="M0 0"></path>')])
		);
		const span = container.firstChild;
		const el = span.firstChild;
		expect(el.tagName.toLowerCase()).toBe('svg');
		expect(el.innerHTML).toBe('<path d="M0 0"></path>');

		// A parent re-render (new attr) must leave the inlined subtree intact.
		const seeded = el.firstChild;
		vm.render(
			h('span', { class: 'icon hover' }, [svg({ viewBox: '0 0 1 1' }, '<path d="M0 0"></path>')])
		);
		expect(span.className).toBe('icon hover');
		expect(span.firstChild).toBe(el); // same svg node
		expect(el.firstChild).toBe(seeded); // seed untouched
	});

	// Dedup (D46 amendment): in a bundled build each `{#svg}` use site is a call to
	// a per-asset shared factory imported once from a virtual module, instead of an
	// inline `new ViewNode('svg', …)` at every site. The factory below mirrors what
	// the plugin serves (`codegen.SVGAssetModule`): a shared frozen attrs object +
	// seed string, a fresh ViewNode per call, and an optional key passthrough for
	// `{#for}` reconciliation. The rendered DOM and island-freeze behavior must be
	// byte-for-byte identical to the inline path.
	describe('shared-module factory shape (dedup)', () => {
		// One shared attrs object + seed string, exactly as SVGAssetModule emits.
		const __a = { viewBox: '0 0 24 24', fill: 'currentColor' };
		const __s = '<path d="M1 1h22"></path>';
		const factory = (key) =>
			new ViewNode('svg', key === undefined ? __a : { ...__a, key }, __s);

		it('produces a fresh vnode per call over a shared frozen seed', () => {
			const a = factory();
			const b = factory();
			expect(a).not.toBe(b); // distinct vnodes (the ViewManager mutates .el on them)
			expect(a.children).toBe(b.children); // but the seed string is shared (one copy)
			expect(a.children).toBe(__s);
			expect(a.key).toBeNull();
		});

		it('mounts island-frozen and never reconciles the seeded children on patch', () => {
			const { container, vm } = setup();
			vm.render(factory());
			const el = container.firstChild;
			expect(el.tagName.toLowerCase()).toBe('svg');
			expect(el.namespaceURI).toBe(SVG_NS);
			expect(el.innerHTML).toBe(__s);

			const seededChild = el.firstChild;
			el.appendChild(document.createElementNS(SVG_NS, 'rect')); // external mutation

			vm.render(factory()); // same asset, same seed
			expect(container.firstChild).toBe(el); // same node
			expect(el.firstChild).toBe(seededChild); // seed never re-touched
			expect(el.querySelector('rect')).not.toBeNull(); // island-owned subtree preserved
		});

		it('threads a key through for {#for}-body reconciliation', () => {
			const keyed = factory('row-7');
			expect(keyed.key).toBe('row-7');
			expect(keyed.children).toBe(__s); // still the shared seed
			// Two keyed instances reconcile as a keyed list without disturbing seeds.
			const { container, vm } = setup();
			vm.render(h('ul', {}, [factory('a'), factory('b')]));
			const svgs = container.querySelectorAll('svg');
			expect(svgs.length).toBe(2);
			expect(svgs[0].innerHTML).toBe(__s);
			expect(svgs[1].innerHTML).toBe(__s);
		});
	});

	it('unmounts cleanly and a remount re-seeds from the string', () => {
		const { container, vm } = setup();
		// Toggle the inline SVG in and out of a keyed list to force unmount/remount.
		vm.render(
			h('div', {}, [h('svg', { key: 'ico' }, '<path d="M0 0"></path>'), h('b', { key: 'b' })])
		);
		const first = container.querySelector('svg');
		expect(first.innerHTML).toBe('<path d="M0 0"></path>');

		// Remove the svg (unmount path must not iterate the string as vnodes).
		vm.render(h('div', {}, [h('b', { key: 'b' })]));
		expect(container.querySelector('svg')).toBeNull();

		// Bring it back — fresh mount re-seeds.
		vm.render(
			h('div', {}, [h('svg', { key: 'ico' }, '<path d="M9 9"></path>'), h('b', { key: 'b' })])
		);
		const second = container.querySelector('svg');
		expect(second).not.toBe(first);
		expect(second.innerHTML).toBe('<path d="M9 9"></path>');
	});
});

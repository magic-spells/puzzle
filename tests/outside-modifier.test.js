// @vitest-environment jsdom
// The `outside` event modifier (v1.52, D86 — SPEC §5 table + §47): the listener
// attaches to DOCUMENT in the capture phase and the handler runs only when the
// event target is outside the bound element; the framework owns the document
// listener's cleanup on every removal shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const setup = () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { container, vm: new ViewManager(container) };
};

// Attach/detach accounting straight off document's own methods: only calls for
// the given event type WITH { capture: true } count — that is the exact
// signature setAttr/removeAttr/releaseSubtree must use (a capture-flag mismatch
// on remove would leave the listener live, and these spies would catch it).
let addSpy, removeSpy;
const liveDocListeners = (event) => {
	const ours = ([type, , opts]) => type === event && opts?.capture === true;
	return addSpy.mock.calls.filter(ours).length - removeSpy.mock.calls.filter(ours).length;
};

beforeEach(() => {
	addSpy = vi.spyOn(document, 'addEventListener');
	removeSpy = vi.spyOn(document, 'removeEventListener');
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('ViewManager — @event:outside (v1.52, D86)', () => {
	it('outside click fires; inside click (self and descendant) does not', () => {
		const { container, vm } = setup();
		const close = vi.fn();
		vm.render(
			h('div', {}, [
				h('div', { class: 'panel', '@click:outside': close }, [
					h('button', { class: 'inner' }, [text('inner')]),
				]),
				h('button', { class: 'sibling' }, [text('outside')]),
			])
		);

		container.querySelector('.panel').click(); // self — inside
		container.querySelector('.inner').click(); // descendant — inside
		expect(close).not.toHaveBeenCalled();

		container.querySelector('.sibling').click(); // sibling — outside
		expect(close).toHaveBeenCalledTimes(1);
		document.body.click(); // body — outside
		expect(close).toHaveBeenCalledTimes(2);
		// destroy so this document listener can't leak into later tests
		vm.clear();
	});

	it('conditional panel: attaches on mount, detaches when {#if} removes it', () => {
		const { container, vm } = setup();
		const close = vi.fn();
		const tree = (open) =>
			h('div', {}, open ? [h('div', { class: 'panel', '@click:outside': close }, [text('p')])] : []);

		vm.render(tree(true));
		expect(liveDocListeners('click')).toBe(1);
		document.body.click();
		expect(close).toHaveBeenCalledTimes(1);

		vm.render(tree(false)); // conditional off → unmount → releaseSubtree detaches
		expect(liveDocListeners('click')).toBe(0);
		document.body.click();
		expect(close).toHaveBeenCalledTimes(1); // no zombie document listener
	});

	it('keyed-row removal detaches the removed row only', () => {
		const { container, vm } = setup();
		const closeA = vi.fn();
		const closeB = vi.fn();
		const row = (key, fn) => {
			const n = h('li', { '@pointerdown:outside': fn }, [text(key)]);
			n.key = key;
			return n;
		};
		vm.render(h('ul', {}, [row('a', closeA), row('b', closeB)]));
		expect(liveDocListeners('pointerdown')).toBe(2);

		vm.render(h('ul', {}, [row('b', closeB)])); // row a removed
		expect(liveDocListeners('pointerdown')).toBe(1);

		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(closeA).not.toHaveBeenCalled(); // removed row's listener is gone
		expect(closeB).toHaveBeenCalledTimes(1); // survivor still live
		vm.clear();
	});

	it('parent-subtree removal detaches a nested binding (releaseSubtree descends)', () => {
		const { container, vm } = setup();
		const close = vi.fn();
		const tree = (open) =>
			h('div', {}, [
				open
					? h('section', { class: 'wrap' }, [
							h('div', {}, [h('div', { class: 'panel', '@click:outside': close }, [text('p')])]),
						])
					: h('span', {}, [text('gone')]),
			]);
		vm.render(tree(true));
		expect(liveDocListeners('click')).toBe(1);

		vm.render(tree(false)); // tag mismatch → replace → unmount walks the subtree
		expect(liveDocListeners('click')).toBe(0);
		document.body.click();
		expect(close).not.toHaveBeenCalled();
	});

	it('full view destroy (vm.clear — the destroy() → #vm.clear() path) detaches', () => {
		const { vm } = setup();
		const close = vi.fn();
		vm.render(h('div', {}, [h('div', { '@click:outside': close }, [text('p')])]));
		expect(liveDocListeners('click')).toBe(1);

		vm.clear();
		expect(liveDocListeners('click')).toBe(0);
		document.body.click();
		expect(close).not.toHaveBeenCalled();
	});

	it('inline-null toggle (open ? close : null) attaches and detaches across patches', () => {
		const { vm } = setup();
		const close = vi.fn();
		const tree = (open) => h('div', { '@pointerdown:outside': open ? close : null }, [text('p')]);

		vm.render(tree(false));
		expect(liveDocListeners('pointerdown')).toBe(0);

		vm.render(tree(true));
		expect(liveDocListeners('pointerdown')).toBe(1);
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(close).toHaveBeenCalledTimes(1);

		vm.render(tree(false)); // value nulled → setAttr's removal path targets document
		expect(liveDocListeners('pointerdown')).toBe(0);
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(close).toHaveBeenCalledTimes(1);
		vm.clear();
	});

	it('capture semantics: a sibling bubble-phase stopPropagation cannot swallow the outside event', () => {
		const { container, vm } = setup();
		const close = vi.fn();
		vm.render(
			h('div', {}, [
				h('div', { class: 'panel', '@click:outside': close }, [text('p')]),
				// The hand-rolled-pattern killer: a bubble listener stopping propagation
				// never reaches document's CAPTURE phase — it already ran.
				h('button', { class: 'stopper', '@click': (e) => e.stopPropagation() }, [text('x')]),
			])
		);
		container.querySelector('.stopper').click();
		expect(close).toHaveBeenCalledTimes(1);
		vm.clear();
	});

	it('same-dispatch open race: a click that mounts the panel does not instantly dismiss it', () => {
		const { container, vm } = setup();
		const close = vi.fn();
		let open = false;
		const tree = () =>
			h('div', {}, [
				h(
					'button',
					{
						class: 'opener',
						// mounts the panel SYNCHRONOUSLY mid-dispatch — its document capture
						// listener attaches after document's capture phase already passed,
						// so this same click cannot fire it.
						'@click': () => {
							open = true;
							vm.render(tree());
						},
					},
					[text('open')]
				),
				...(open ? [h('div', { class: 'panel', '@click:outside': close }, [text('p')])] : []),
			]);
		vm.render(tree());

		container.querySelector('.opener').click();
		expect(close).not.toHaveBeenCalled(); // the opening click is not an outside click

		document.body.click(); // the NEXT outside click dismisses
		expect(close).toHaveBeenCalledTimes(1);
		vm.clear();
	});

	it(':outside:once fires once ever, and an inside click does not spend the once', () => {
		const { container, vm } = setup();
		const close = vi.fn();
		vm.render(
			h('div', {}, [
				h('div', { class: 'panel', '@click:outside:once': () => close() }, [text('p')]),
			])
		);

		container.querySelector('.panel').click(); // inside — bails BEFORE once-spend
		expect(close).not.toHaveBeenCalled();

		document.body.click(); // outside — fires and spends
		document.body.click(); // spent — silent
		expect(close).toHaveBeenCalledTimes(1);
		vm.clear();
	});

	it('@focusin:outside fires for outside focus, not inside', () => {
		const { container, vm } = setup();
		const blurred = vi.fn();
		vm.render(
			h('div', {}, [
				h('div', { class: 'widget', '@focusin:outside': blurred }, [h('input', { class: 'own' }, [])]),
				h('input', { class: 'other' }, []),
			])
		);
		// focusin does not bubble-dispatch through .click(); dispatch directly — the
		// capture path on document is walked for any target regardless of bubbling.
		container.querySelector('.own').dispatchEvent(new Event('focusin', { bubbles: true }));
		expect(blurred).not.toHaveBeenCalled();

		container.querySelector('.other').dispatchEvent(new Event('focusin', { bubbles: true }));
		expect(blurred).toHaveBeenCalledTimes(1);
		vm.clear();
	});

	it('@click and @click:outside coexist independently on one element', () => {
		const { container, vm } = setup();
		const inside = vi.fn();
		const outside = vi.fn();
		vm.render(
			h('div', {}, [
				h('div', { class: 'panel', '@click': inside, '@click:outside': outside }, [text('p')]),
				h('button', { class: 'other' }, [text('x')]),
			])
		);

		container.querySelector('.panel').click();
		expect(inside).toHaveBeenCalledTimes(1);
		expect(outside).not.toHaveBeenCalled();

		container.querySelector('.other').click();
		expect(inside).toHaveBeenCalledTimes(1);
		expect(outside).toHaveBeenCalledTimes(1);
		vm.clear();
	});

	it('handler swap across patches keeps exactly one document listener (no accumulation)', () => {
		const { vm } = setup();
		const calls = [];
		// Fresh closure per render, exactly as the compiler's per-render trees bind.
		const tree = (tag) => h('div', { '@click:outside': () => calls.push(tag) }, [text('p')]);

		vm.render(tree('first'));
		vm.render(tree('second'));
		vm.render(tree('third'));
		expect(liveDocListeners('click')).toBe(1); // swapped, never stacked

		document.body.click();
		expect(calls).toEqual(['third']); // only the latest handler fires
		vm.clear();
		expect(liveDocListeners('click')).toBe(0);
	});
});

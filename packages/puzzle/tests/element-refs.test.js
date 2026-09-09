// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { serialize } from '../client-runtime/ssg/serialize.js';

// Element refs (v1.39, D72): `ref="name"` in a template gives the view a live
// handle — this.refs.name is the mounted DOM element, null when not mounted. The
// compiler emits `ref: this.__ref("name")` in a vnode's attrs; __ref hands back a
// per-instance CACHED setter that the ViewManager invokes on mount/unmount. These
// tests hand-write render()/vnodes that spell exactly what the compiler emits.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const setup = () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { container, vm: new ViewManager(container) };
};

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

describe('PuzzleView.__ref — the cached setter (D72)', () => {
	it('returns the SAME function identity for a name across calls (stable ref)', () => {
		const v = new PuzzleView();
		expect(v.__ref('chart')).toBe(v.__ref('chart'));
		// distinct names get distinct setters
		expect(v.__ref('chart')).not.toBe(v.__ref('title'));
		// and caches are per-instance
		expect(new PuzzleView().__ref('chart')).not.toBe(v.__ref('chart'));
	});

	it('sets refs[name] on mount and nulls it (guarded) on removal', () => {
		const v = new PuzzleView();
		const setter = v.__ref('x');
		const el = document.createElement('div');
		setter(el);
		expect(v.refs.x).toBe(el);
		setter(null, el);
		expect(v.refs.x).toBe(null);
	});

	it('the removal guard ignores a stale (null, oldEl) after a remount', () => {
		// Simulates mount(newEl) landing BEFORE the old element's removal fires its
		// null — the stale null must not clobber the newer element.
		const v = new PuzzleView();
		const setter = v.__ref('x');
		const oldEl = document.createElement('div');
		const newEl = document.createElement('div');

		setter(oldEl); // old element mounts
		expect(v.refs.x).toBe(oldEl);
		setter(newEl); // new element mounts (before old removal fires)
		expect(v.refs.x).toBe(newEl);
		setter(null, oldEl); // stale removal for the OLD element
		expect(v.refs.x).toBe(newEl); // guard: newer element preserved
		setter(null, newEl); // proper removal
		expect(v.refs.x).toBe(null);
	});

	it('bails quietly (no throw) after the view is destroyed', () => {
		const v = new PuzzleView();
		const setter = v.__ref('x');
		v.destroy();
		expect(() => setter(document.createElement('div'))).not.toThrow();
		expect(() => setter(null, document.createElement('div'))).not.toThrow();
	});
});

describe('ViewManager — element refs mount/unmount (D72)', () => {
	it('populates refs on mount and never writes `ref` as a DOM attribute', () => {
		const host = new PuzzleView();
		const { container, vm } = setup();
		vm.render(h('input', { ref: host.__ref('field'), type: 'text' }, []));
		const input = container.firstChild;
		expect(host.refs.field).toBe(input);
		expect(input.hasAttribute('ref')).toBe(false);
		expect(input.getAttribute('ref')).toBe(null);
		expect(input.type).toBe('text'); // real attrs still land
	});

	it('{#if} toggle: off nulls the ref, on repopulates with the NEW element', () => {
		const host = new PuzzleView();
		const { container, vm } = setup();
		vm.render(h('div', {}, [h('span', { ref: host.__ref('box') }, [text('a')])]));
		const span1 = container.querySelector('span');
		expect(host.refs.box).toBe(span1);

		vm.render(h('div', {}, [])); // toggled off
		expect(host.refs.box).toBe(null);
		expect(container.querySelector('span')).toBe(null);

		vm.render(h('div', {}, [h('span', { ref: host.__ref('box') }, [text('b')])])); // on again
		const span2 = container.querySelector('span');
		expect(host.refs.box).toBe(span2);
		expect(span2).not.toBe(span1); // a freshly mounted element
	});

	it('a ref nested inside a removed subtree is released', () => {
		const host = new PuzzleView();
		const { container, vm } = setup();
		vm.render(
			h('div', {}, [h('section', {}, [h('canvas', { ref: host.__ref('deep') }, [])])])
		);
		const canvas = container.querySelector('canvas');
		expect(host.refs.deep).toBe(canvas);

		vm.render(h('div', {}, [])); // remove the whole section subtree
		expect(host.refs.deep).toBe(null);
	});

	it('keyed replacement points the ref at the new element (guard beats stale null)', () => {
		const host = new PuzzleView();
		const { container, vm } = setup();
		vm.render(h('ul', {}, [h('li', { key: 'a', ref: host.__ref('row') }, [text('A')])]));
		const liA = container.querySelector('li');
		expect(host.refs.row).toBe(liA);

		// key change → old 'a' unmounts (fires null), new 'b' mounts (captures)
		vm.render(h('ul', {}, [h('li', { key: 'b', ref: host.__ref('row') }, [text('B')])]));
		const liB = container.querySelector('li');
		expect(liB).not.toBe(liA);
		expect(host.refs.row).toBe(liB);
	});

	it('a persisting-element patch does NOT re-invoke the cached setter', () => {
		const { container, vm } = setup();
		const setter = vi.fn();
		vm.render(h('div', { ref: setter }, [text('a')]));
		expect(setter).toHaveBeenCalledTimes(1);
		expect(setter).toHaveBeenLastCalledWith(container.firstChild);

		// same tag/key + SAME setter → the element persists, ref value is unchanged
		vm.render(h('div', { ref: setter }, [text('b')]));
		expect(setter).toHaveBeenCalledTimes(1); // not called again
		expect(container.firstChild.textContent).toBe('b'); // but the child did patch
	});

	it('a DIFFERING ref on a persisting element releases old and captures new', () => {
		const { container, vm } = setup();
		const oldSetter = vi.fn();
		const newSetter = vi.fn();
		vm.render(h('div', { ref: oldSetter }, [text('a')]));
		const div = container.firstChild;

		vm.render(h('div', { ref: newSetter }, [text('b')]));
		expect(container.firstChild).toBe(div); // element persisted
		expect(oldSetter).toHaveBeenCalledWith(null, div);
		expect(newSetter).toHaveBeenCalledWith(div);
	});

	it('dropping the ref attr from a persisting element releases it', () => {
		const { container, vm } = setup();
		const setter = vi.fn();
		vm.render(h('div', { ref: setter, id: 'a' }, [text('x')]));
		const div = container.firstChild;

		vm.render(h('div', { id: 'a' }, [text('x')])); // ref gone
		expect(container.firstChild).toBe(div);
		expect(setter).toHaveBeenCalledWith(null, div);
	});

	it('a tag-change replacement releases the old ref and captures the new', () => {
		const host = new PuzzleView();
		const { container, vm } = setup();
		vm.render(h('div', { ref: host.__ref('x') }, [text('a')]));
		const div = container.firstChild;
		expect(host.refs.x).toBe(div);

		vm.render(h('section', { ref: host.__ref('x') }, [text('b')]));
		const section = container.firstChild;
		expect(section.tagName).toBe('SECTION');
		expect(section).not.toBe(div);
		expect(host.refs.x).toBe(section);
	});

	it('fires the ref for the ISLAND element itself; island children stay frozen', () => {
		const host = new PuzzleView();
		const { container, vm } = setup();
		vm.render(h('div', { island: true, ref: host.__ref('surface') }, [text('seed')]));
		const div = container.firstChild;
		expect(host.refs.surface).toBe(div);
		expect(div.hasAttribute('ref')).toBe(false);

		// Browser owns the island internals now.
		div.firstChild.nodeValue = 'edited by browser';
		div.appendChild(document.createElement('b'));

		// Re-render with different island children + the SAME cached setter.
		vm.render(h('div', { island: true, ref: host.__ref('surface') }, [text('NEW')]));
		expect(container.firstChild).toBe(div); // island element persists
		expect(host.refs.surface).toBe(div); // ref still the element
		expect(div.innerHTML).toBe('edited by browser<b></b>'); // children frozen
	});
});

describe('PuzzleView — refs across the mount lifecycle (D72)', () => {
	it('refs are populated BEFORE mounted() fires', async () => {
		let refAtMount;
		class V extends PuzzleView {
			data() {
				return {};
			}
			render() {
				return h('div', {}, [h('canvas', { ref: this.__ref('chart') }, [])]);
			}
			mounted() {
				refAtMount = this.refs.chart;
			}
		}
		const el = container();
		const v = new V();
		await v.mount(el);
		expect(refAtMount).not.toBeNull();
		expect(refAtMount).toBe(el.querySelector('canvas'));
		expect(v.refs.chart).toBe(el.querySelector('canvas'));
	});

	it('re-uses the same attrs.ref function across renders (differ never churns)', async () => {
		const seen = [];
		class V extends PuzzleView {
			data() {
				return {};
			}
			render() {
				const node = h('div', { ref: this.__ref('x') }, []);
				seen.push(node.attrs.ref);
				return node;
			}
		}
		const v = new V();
		await v.mount(container());
		v.refresh(); // force a second render()
		expect(seen.length).toBeGreaterThanOrEqual(2);
		expect(seen[1]).toBe(seen[0]); // same cached setter each render
	});

	it('tracks multiple independent refs; destroy is safe (no throw)', async () => {
		class V extends PuzzleView {
			data() {
				return {};
			}
			render() {
				return h('div', {}, [
					h('h1', { ref: this.__ref('title') }, [text('t')]),
					h('canvas', { ref: this.__ref('chart') }, []),
				]);
			}
		}
		const el = container();
		const v = new V();
		await v.mount(el);
		expect(v.refs.title).toBe(el.querySelector('h1'));
		expect(v.refs.chart).toBe(el.querySelector('canvas'));
		expect(v.refs.title).not.toBe(v.refs.chart);

		expect(() => v.destroy()).not.toThrow();
	});

	it('refs is NOT render data — never surfaces in getData()', async () => {
		class V extends PuzzleView {
			data() {
				return { count: 1 };
			}
			render() {
				return h('div', { ref: this.__ref('root') }, []);
			}
		}
		const v = new V();
		await v.mount(container());
		expect(v.getData()).toEqual({ count: 1 }); // no `root`, no refs
		expect('refs' in v.getData()).toBe(false);
	});
});

describe('SSG serializer — refs are dropped (D72)', () => {
	it('an element with a ref-function attr serializes without any ref output', async () => {
		const v = new PuzzleView();
		const html = await serialize(h('div', { ref: v.__ref('x'), id: 'a' }, [text('hi')]));
		expect(html).toBe('<div id="a">hi</div>');
		expect(html).not.toContain('ref');
	});
});

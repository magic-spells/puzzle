// @vitest-environment jsdom
//
// patch()'s REPLACE arm unmounts the outgoing tree before mounting the incoming
// one (D170).
//
// Vnodes stopped being single-use when list blocks and the static caches landed:
// a cached row, or a `this.__c[n]` subtree, is the SAME OBJECT in the outgoing
// and the incoming tree. Mounting first overwrites that object's live links
// (`component`, `el`) with the new instance and the new element, and the
// outgoing unmount then tears down what it finds there — the thing that was just
// mounted — while the old instance leaks its subscriptions and releaseSubtree
// sweeps the NEW element's document-level `outside` listeners.
//
// Both tests pin the ORDER through its consequences: who is alive afterwards,
// and what is still wired up.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);

// A child mount resolves data() across microtasks; the same flush the identity
// short-circuit suite uses.
const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 20));
		await Promise.resolve();
	}
};

function setup(tree) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const vm = new ViewManager(container, {});
	vm.render(tree);
	return { vm, container };
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('patch() replacement — unmount before mount', () => {
	it('keeps the freshly mounted child when a cached row vnode spans the replacement', async () => {
		const instances = [];
		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				instances.push(this);
			}
			render() {
				return h('strong', { class: 'child' }, [text('child')]);
			}
		}

		// The cached row: ONE vnode object, returned by the block on both passes.
		const row = comp(Child, { key: 'a' });
		const { vm, container } = setup(h('div', { key: 'r1' }, [row]));
		await flush();
		expect(container.querySelector('.child')).not.toBeNull();
		const first = instances[0];

		// The root's key changed: a replacement, with the cached row inside both trees.
		vm.render(h('div', { key: 'r2' }, [row]));
		await flush();

		expect(instances).toHaveLength(2);
		// The OLD instance is the one that dies; the new one lives and is on screen.
		expect(first.isDestroyed).toBe(true);
		expect(instances[1].isDestroyed).toBe(false);
		expect(row.component).toBe(instances[1]);
		expect(container.querySelector('.child')).not.toBeNull();
		vm.clear();
	});

	it('keeps the outside listener of a cached static subtree that spans the replacement', () => {
		const close = vi.fn();
		// A cached static subtree (`this.__c[n]`) carrying a document-level listener.
		const panel = h('div', { class: 'panel', '@click:outside': close }, [text('p')]);
		const { vm, container } = setup(h('section', { key: 's1' }, [panel]));

		vm.render(h('section', { key: 's2' }, [panel]));

		expect(container.querySelector('.panel')).not.toBeNull();
		document.body.click();
		expect(close).toHaveBeenCalledTimes(1);
		vm.clear();
		// And the sweep still happens on the real teardown: no leak either way.
		document.body.click();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('still inserts the replacement before an element that is animating out', async () => {
		const order = [];
		class Leaver extends PuzzleView {
			animations = { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 5 } };
			viewWillHide() {
				order.push('leave');
			}
			render() {
				return h('p', { class: 'leaver' }, [text('bye')]);
			}
		}
		const { vm, container } = setup(h('div', {}, [comp(Leaver), h('b', {}, [text('tail')])]));
		await flush();

		vm.render(h('div', {}, [h('em', { class: 'fresh' }, [text('hi')]), h('b', {}, [text('tail')])]));
		// Unkeyed siblings, so index 0 is patch()'s REPLACE arm. The leaver is still
		// in the DOM and the replacement went in BEFORE it — the placement the old
		// mount-first ordering produced, preserved by resolving the insertion ref
		// from the still-connected anchor.
		const kids = [...container.querySelector('div').children].map((el) => el.tagName);
		expect(kids).toEqual(['EM', 'P', 'B']);
		expect(order).toEqual(['leave']);
		await flush();
		vm.clear();
	});
});

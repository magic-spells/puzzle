// @vitest-environment jsdom
//
// A FIRST mount that throws partway (D145). The patch branch of
// ViewManager.render() has always caught, recorded the corrupt range and rethrown;
// the first-mount branch called mount() bare, so a throw left `currentTree` null —
// and with it, every component the mount had already instantiated permanently
// unreachable: destroy() → clear() walked nothing, so their store subscriptions,
// `outside` listeners and <Portal> ranges (portalCount is bumped BEFORE the
// portaled children mount) survived forever.
import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { PORTAL_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { teardownPortals } from '../client-runtime/views/portal.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string(),
	};
}

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);
const portal = (children = []) => new ViewNode(PORTAL_TAG, {}, children);

const outlet = () => document.querySelector('[data-puzzle-portal]');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

afterEach(() => {
	teardownPortals();
	document.body.replaceChildren();
});

describe('first mount that throws (D145)', () => {
	it('records the corrupt range, releases the half-built tree, and rethrows', async () => {
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: '1', title: 'watched' });
		const ctx = { store };

		const watchers = [];
		class Watcher extends PuzzleView {
			constructor(c) {
				super(c);
				watchers.push(this);
			}
			data() {
				// Synchronous data(): the tracked query subscribes DURING mount, before
				// the sibling below throws.
				return { title: this.ctx.store.findOne('todo', '1')?.title ?? '?' };
			}
			render() {
				return h('em', { class: 'watcher' }, [text(this.getData().title)]);
			}
		}
		class Exploding extends PuzzleView {
			// A class-field initializer that throws: `new vnode.tag(ctx)` inside
			// mountComponent, so the throw is SYNCHRONOUS and unwinds the mount loop.
			boom = (() => {
				throw new Error('field boom');
			})();
			render() {
				return h('span');
			}
		}

		const host = container();
		const vm = new ViewManager(host, ctx);

		expect(() =>
			vm.render(h('div', { class: 'shell' }, [comp(Watcher), comp(Exploding)]))
		).toThrow('field boom');
		await tick();

		// (1) The manager knows the tree is unknown and kept the incoming tree — the
		// only handle on what got built.
		expect(vm.treeUnknown).toBe(true);
		expect(vm.currentTree).toBe(null);
		expect(vm.unknownTrees).toHaveLength(1);
		// mount() inserts the root into the container LAST, so nothing landed.
		expect(host.querySelector('.shell')).toBe(null);

		// (2) The already-mounted sibling really did subscribe.
		expect(watchers).toHaveLength(1);
		expect(store.keysBySubscriber.size).toBe(1);

		// (3) The next render goes through renderFresh(), which releases the aborted
		// tree first: the sibling instance is destroyed and its subscription dropped.
		const tree = vm.render(h('div', { class: 'shell' }, [h('p', { class: 'ok' }, [text('fine')])]));
		await tick();

		expect(watchers[0].isDestroyed).toBe(true);
		expect(store.keysBySubscriber.size).toBe(0);
		expect(store.subscribersByKey.size).toBe(0);

		// (4) …and the fresh mount landed, exactly once.
		expect(vm.treeUnknown).toBe(false);
		expect(vm.currentTree).toBe(tree);
		expect(host.querySelectorAll('.shell')).toHaveLength(1);
		expect(host.querySelector('.ok').textContent).toBe('fine');
	});

	it('releases a <Portal> the failed mount had already opened', async () => {
		const host = container();
		const vm = new ViewManager(host, {});

		class Exploding extends PuzzleView {
			boom = (() => {
				throw new Error('portal boom');
			})();
			render() {
				return h('span');
			}
		}

		expect(() =>
			vm.render(
				h('div', { class: 'shell' }, [
					portal([h('p', { class: 'overlay' }, [text('remote')])]),
					comp(Exploding),
				])
			)
		).toThrow('portal boom');

		// The portal opened before the throw: its content is in the outlet and
		// portalCount is 1.
		expect(outlet()).not.toBe(null);
		expect(outlet().querySelector('p.overlay')).not.toBe(null);

		// renderFresh() unmounts the portal explicitly (raw DOM removal over the local
		// range would reach neither the teleported nodes nor the count). portalCount
		// back to zero + an empty outlet is exactly what releasePortalOutlet() needs to
		// remove the outlet, so its absence IS the count assertion.
		vm.render(h('div', { class: 'shell' }, [h('p', { class: 'ok' }, [text('fine')])]));
		await tick();

		expect(outlet()).toBe(null);
		expect(document.querySelector('p.overlay')).toBe(null);
		expect(host.querySelector('.ok').textContent).toBe('fine');
	});

	it('releases the half-built tree on a destroy that arrives before any re-render', async () => {
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: '1', title: 'watched' });

		class Watcher extends PuzzleView {
			data() {
				return { title: this.ctx.store.findOne('todo', '1')?.title ?? '?' };
			}
			render() {
				return h('em', {}, [text(this.getData().title)]);
			}
		}
		class Exploding extends PuzzleView {
			boom = (() => {
				throw new Error('clear boom');
			})();
			render() {
				return h('span');
			}
		}

		const host = container();
		const vm = new ViewManager(host, { store });
		expect(() => vm.render(h('div', {}, [comp(Watcher), comp(Exploding)]))).toThrow('clear boom');
		await tick();
		expect(store.keysBySubscriber.size).toBe(1);

		// clear() already handled the aborted-PATCH trees; the first-mount tree lands
		// in the same slot, so the teardown path needs no change — assert it.
		vm.clear();
		await tick();
		expect(store.keysBySubscriber.size).toBe(0);
		expect(vm.unknownTrees).toBe(null);
		expect(vm.treeUnknown).toBe(false);
	});

	it('detaches `outside` listeners the failed mount had already parked on document', async () => {
		// `vnode.el` is published the moment the node is created, BEFORE the setAttr
		// loop that parks D86 `outside` handlers on document. Assigned after the child
		// mounts instead, it stayed null on any element whose OWN mount was the one
		// that unwound — and releaseSubtree() reads the listener map off `vnode.el`,
		// so the sweep found nothing to detach and the handler outlived its element,
		// its view and the render that made it.
		//
		// The ANCESTOR of the throw is the leak: mount() builds depth-first into a
		// detached parent, so a preceding SIBLING's own mount ran to completion and
		// always had its `el`. Both are asserted — the pair is what pins the fix to
		// the element that matters rather than to mount order.
		const host = container();
		const vm = new ViewManager(host, {});

		let siblingHits = 0;
		let ancestorHits = 0;
		class Exploding extends PuzzleView {
			boom = (() => {
				throw new Error('listener boom');
			})();
			render() {
				return h('span');
			}
		}

		expect(() =>
			vm.render(
				h('div', { '@click:outside': () => ancestorHits++ }, [
					h('button', { '@click:outside': () => siblingHits++ }, [text('menu')]),
					comp(Exploding),
				])
			)
		).toThrow('listener boom');

		// Both listeners really are live on document — without this the assertions
		// below would pass against bindings that never attached.
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(siblingHits).toBe(1);
		expect(ancestorHits).toBe(1);

		// renderFresh() releases the aborted tree. Neither element is in the app's
		// world any more, so neither document listener may survive.
		vm.render(h('p', { class: 'ok' }, [text('fine')]));
		await tick();

		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(siblingHits).toBe(1);
		expect(ancestorHits).toBe(1);
		expect(host.querySelector('.ok').textContent).toBe('fine');
	});

	it('sweeps content a failed mount left in an anchored slot', async () => {
		// The anchor case: a component's manager holds a comment placeholder while its
		// async data() resolves, and a <Portal> parks its local placeholder in the
		// container BEFORE teleporting. The recorded range brackets that slot and stops
		// AT the anchor, so the sweep clears strays without eating the insertion ref.
		const host = container();
		host.appendChild(document.createElement('hr'));
		const vm = new ViewManager(host, {});
		vm.anchorAt(null);
		const anchor = vm.anchor;

		class Exploding extends PuzzleView {
			boom = (() => {
				throw new Error('anchored boom');
			})();
			render() {
				return h('span');
			}
		}

		expect(() => vm.render(h('div', {}, [portal([h('p', {}, [text('x')])]), comp(Exploding)]))).toThrow(
			'anchored boom'
		);
		expect(vm.unknownRange).not.toBe(null);
		expect(vm.unknownRange.after).toBe(anchor);
		expect(anchor.parentNode).toBe(host);

		vm.render(h('div', { class: 'ok' }, [text('fine')]));
		await tick();

		// The anchor is consumed by the fresh mount, the pre-existing sibling survives,
		// and the new tree sits where the anchor was.
		expect(vm.anchor).toBe(null);
		expect(anchor.parentNode).toBe(null);
		expect(host.querySelector('hr')).not.toBe(null);
		expect(host.querySelector('.ok').textContent).toBe('fine');
		expect(outlet()).toBe(null);
	});
});

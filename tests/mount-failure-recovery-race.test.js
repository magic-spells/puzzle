// @vitest-environment jsdom
//
// Two first-mount-failure lifecycle bugs in viewManager.js mountComponent's
// rejection handler:
//
//   A. THE RACE. mount() is async, so the rejection handler runs in a MICROTASK,
//      but it closes over the vnode as of mount time. A parent re-render in the
//      SAME turn (a store flush, a setData() from the parent's mounted()) patches
//      the position first, and patchComponent copies the instance onto a NEW vnode
//      that becomes the live tree node. The handler then destroyed the instance the
//      LIVE vnode still points at while nulling only the ORPHAN's links — so
//      patch()'s recovery test (`component == null`) never fired again and every
//      later render called applyParentUpdate on a destroyed view: mounted() never
//      fires, setData() re-renders are inert, the component is permanently dead,
//      and an orphan <!--puzzle--> comment sits in the DOM. Recovery now keys off
//      the destroyed INSTANCE (`isDestroyed` + the placeholder stashed on it),
//      which is the one thing both vnodes share.
//
//   B. ROUTER-PRELOADED VIEWS. A vnode carrying `instance` is a view the Router
//      pinned (router.js chain assembly) and committed synchronously; its
//      #observeMount logs a post-commit mount failure EXPECTING the failed view to
//      stay committed until the next navigation replaces it. The teardown destroyed
//      it anyway, leaving router.current holding a dead, unrefreshable view and the
//      committed markup replaced by a comment. The teardown is now skipped entirely
//      for a preloaded instance — the failure is still logged.
//
// Harness follows tests/mount-enter-hook-guard.test.js and
// tests/teardown-hook-guards.test.js: real classes, real Store, jsdom.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { mount } from '../client-runtime/views/viewManager.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);
// setData re-renders schedule through requestAnimationFrame (jsdom fires that on a
// ~16ms timer), and a child mount then resolves data() across microtasks — so flush
// past several rAF ticks + microtask drains.
const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 20));
		await Promise.resolve();
	}
};

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

// A child whose FIRST data() throws (the first mount rejects) and whose later
// mounts succeed. `instances` collects every construction, so "recovered with a
// FRESH instance" and "reused the dead one" are distinguishable.
function makeChild() {
	let failFirst = true;
	const instances = [];
	class Child extends PuzzleView {
		mountedCount = 0;
		constructor(...args) {
			super(...args);
			instances.push(this);
		}
		data() {
			if (failFirst) {
				failFirst = false;
				throw new Error('boom (child data)');
			}
			// Subscribes THIS instance to the 'todo' key via withTracking.
			return { todos: this.ctx.store.findMany('todo') };
		}
		mounted() {
			this.mountedCount++;
		}
		render() {
			return h('span', { class: 'child' }, [text(this.getData()?.label ?? 'ok')]);
		}
	}
	return { Child, instances };
}

// A host rendering the child at a fixed position next to a store-driven sibling.
// The child vnode carries NO props, so a re-render that races the mount rejection
// is a pure patchComponent hand-off (no prop update, no slot churn) — exactly the
// shape that used to strand the destroyed instance on the live vnode.
function makeHost(Child) {
	return class Host extends PuzzleView {
		data() {
			return { todos: this.ctx.store.findMany('todo') };
		}
		render() {
			return h('div', { id: 'host' }, [
				h('em', { class: 'count' }, [text(String(this.getData()?.todos?.length ?? 0))]),
				comp(Child, {}),
			]);
		}
	};
}

function setup() {
	const { Child, instances } = makeChild();
	const Host = makeHost(Child);
	const el = document.createElement('div');
	document.body.appendChild(el);
	const store = new Store({ todo: Todo });
	store.createRecord('todo', { id: 't1', text: 'ship it' });
	// Drain the seed mutation's queued notification (createRecord arms a rAF flush)
	// so the ONLY store-driven re-render in these tests is the one each test fires
	// deliberately — the raced case must own its timing exactly.
	store.flush();
	return { Host, instances, el, store };
}

// Shared tail: the position must now hold a FRESH, fully working component.
async function expectRecovered({ host, el, instances }) {
	host.setData({ tick: 1 }); // any parent re-render reaches the failed position
	await flush();

	expect(instances).toHaveLength(2);
	const fresh = instances[1];
	expect(fresh.isDestroyed).toBe(false);
	expect(fresh.mountedCount).toBe(1); // mounted() actually fired
	const childEl = el.querySelector('.child');
	expect(childEl).not.toBeNull();
	expect(childEl.isConnected).toBe(true);
	expect(childEl.textContent).toBe('ok');

	// Live instance: its own local state re-renders its own DOM.
	fresh.setData({ label: 'live' });
	await flush();
	expect(el.querySelector('.child').textContent).toBe('live');

	// And the recovery consumed the placeholder — no orphan comment left behind.
	expect(el.innerHTML).not.toContain('<!--puzzle-->');
}

describe('first-mount failure recovery survives a same-turn parent re-render', () => {
	it('a parent re-render that RACES the rejection microtask still recovers', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { Host, instances, el, store } = setup();

		const host = new Host({ store });
		const mounting = host.mount(el);
		// mount()'s synchronous half already ran: the child was constructed, its own
		// mount rejected, and the rejection handler is queued as a MICROTASK.
		expect(instances).toHaveLength(1);
		expect(instances[0].isDestroyed).toBe(false);

		// THE RACE — a store flush is synchronous, so this parent re-render lands in
		// the same turn, BEFORE that microtask.
		store.createRecord('todo', { id: 't2', text: 'again' });
		store.flush();

		// Proof the race really happened: the patch landed (sibling text updated) while
		// the child instance was still live, so patchComponent handed it to a new vnode.
		expect(el.querySelector('.count').textContent).toBe('2');
		expect(instances[0].isDestroyed).toBe(false);

		await mounting;
		await flush();

		// Only now does the teardown run — against the orphaned vnode.
		expect(err).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		expect(instances[0].isDestroyed).toBe(true);
		expect(el.querySelector('.child')).toBeNull();

		await expectRecovered({ host, el, instances });
	});

	it('the classic (unraced) recovery is unchanged', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { Host, instances, el, store } = setup();

		const host = await new Host({ store }).mount(el);
		await flush(); // the rejection microtask settles with no competing render

		expect(err).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		expect(instances).toHaveLength(1);
		expect(instances[0].isDestroyed).toBe(true);
		// A bare comment holds the position until the next render.
		const hostEl = el.querySelector('#host');
		expect(hostEl.childNodes[1].nodeType).toBe(8 /* COMMENT_NODE */);

		await expectRecovered({ host, el, instances });
	});
});

describe('a superseding first-mount refresh failure recovers from the anchor race', () => {
	it('plants a placeholder and a later parent render mounts a fresh working instance', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const deferred = () => {
			let resolve;
			const promise = new Promise((r) => {
				resolve = r;
			});
			return { promise, resolve };
		};
		const gates = { one: deferred(), two: deferred() };
		const instances = [];

		class Child extends PuzzleView {
			mountedCount = 0;
			constructor(...args) {
				super(...args);
				instances.push(this);
			}
			async data(params, props) {
				if (props.which === 'one') {
					await gates.one.promise;
					return { label: 'stale' };
				}
				if (props.which === 'two') {
					await gates.two.promise;
					throw new Error('boom (superseding data)');
				}
				return { label: 'fresh' };
			}
			mounted() {
				this.mountedCount++;
			}
			render() {
				return h('span', { class: 'child' }, [text(this.getData().label)]);
			}
		}
		class Host extends PuzzleView {
			created() {
				this.setData('which', 'one');
			}
			render() {
				return h('div', { id: 'pending-host' }, [
					comp(Child, { which: this.getData().which }),
				]);
			}
		}

		const el = document.createElement('div');
		document.body.appendChild(el);
		const host = await new Host().mount(el);
		host.setData('which', 'two');
		host.flushUpdates();

		// The original run resolves stale, so mount() takes Change A's early
		// resolution path and defers mounted()/enter to the superseding run.
		gates.one.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(instances[0].mountedCount).toBe(0);

		gates.two.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(err).toHaveBeenCalledWith(
			'[puzzle] data() failed during a parent prop update:',
			expect.any(Error)
		);
		const failed = instances[0];
		const placeholder = el.querySelector('#pending-host').childNodes[0];
		expect(placeholder.nodeType).toBe(8 /* COMMENT_NODE */);
		expect(placeholder.nodeValue).toBe('puzzle');
		expect(failed.isDestroyed).toBe(true);
		expect(failed.__failedPlaceholder).toBe(placeholder);

		host.setData('which', 'three');
		host.flushUpdates();
		await Promise.resolve();
		await Promise.resolve();

		expect(instances).toHaveLength(2);
		const fresh = instances[1];
		expect(fresh).not.toBe(failed);
		expect(fresh.isDestroyed).toBe(false);
		expect(fresh.mountedCount).toBe(1);
		expect(el.querySelector('.child').textContent).toBe('fresh');
		expect(el.innerHTML).not.toContain('<!--puzzle-->');
	});
});

describe('a router-preloaded instance is never torn down by the view manager', () => {
	it('a rejected preloaded mount is logged only — instance, DOM, and vnode links survive', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		class Routed extends PuzzleView {
			data() {
				return { todos: this.ctx.store.findMany('todo') };
			}
			mounted() {
				// A synchronous throw here surfaces as a REJECTED mount promise, with the
				// view already rendered and committed — the post-commit failure router.js
				// #observeMount exists to log.
				throw new Error('boom (mounted)');
			}
			render() {
				return h('section', { class: 'routed' }, [text(this.getData()?.label ?? 'page')]);
			}
		}

		const el = document.createElement('div');
		document.body.appendChild(el);
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: 't1', text: 'ship it' });

		// Mirror router.js's chain assembly: preload() resolves created()+data() before
		// the commit, then the chain vnode PINS the instance so the manager adopts it
		// instead of constructing one.
		const view = new Routed({ store });
		await view.preload({ params: {} });
		const vnode = new ViewNode(Routed, { key: '/page\x000' }, []);
		vnode.instance = view;

		mount(vnode, el, null, { store });
		await flush();

		expect(err).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));

		// The Router owns this lifetime: the view stays alive, subscribed, and committed
		// until the next navigation replaces it.
		expect(view.isDestroyed).toBe(false);
		expect(store.keysBySubscriber.has(view)).toBe(true);
		expect(vnode.component).toBe(view);
		expect(vnode.instance).toBe(view);
		const routedEl = el.querySelector('.routed');
		expect(routedEl).not.toBeNull();
		expect(routedEl.isConnected).toBe(true);
		expect(el.innerHTML).not.toContain('<!--puzzle-->');

		// …and it is still a working view — router.current can refresh it.
		view.setData({ label: 'refreshed' });
		await flush();
		expect(el.querySelector('.routed').textContent).toBe('refreshed');
	});
});

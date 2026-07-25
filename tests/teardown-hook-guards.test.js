// @vitest-environment jsdom
//
// Two teardown-cascade guards from the deep-review round:
//
//   A. PuzzleView.destroy() ends at `this.destroyed()` — a USER hook. Unguarded,
//      a throw there escaped through the PARENT's #vm.clear() (a child's destroy
//      runs inside it), through Router.stop(), and out of PuzzleApp.#teardown(),
//      stranding the app with _mounted still true, services half-dropped, and a
//      later mount() a silent no-op. It is now try/caught and logged — the same
//      logged/never-wedges posture as app.js's beforeUnmount guard, and the
//      leave-side mirror of tests/mount-enter-hook-guard.test.js.
//
//   B. devstate.unregisterView() notified the D100 view observer unconditionally,
//      so destroying a constructed-but-never-mounted view emitted a mounted:false
//      with no preceding mounted:true — an unbalanced pair for the DevTools
//      bridge. It now notifies only when the registry delete removed something.
//
// Setup conventions follow tests/app.test.js (h/text/slot stand-ins, container(),
// the apps[] + make() cleanup pattern).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { setViewObserver, unregisterView } from '../client-runtime/devstate.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
	};
}

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
	}
}

const container = (id = 'app') => {
	const el = document.createElement('div');
	el.id = id;
	document.body.appendChild(el);
	return el;
};

let apps = [];
function make(config) {
	const app = new PuzzleApp(config);
	apps.push(app);
	return app;
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
});

afterEach(() => {
	apps.forEach((a) => a.unmount());
	apps = [];
	// The devstate observer slot is module-global — never leak one into the next
	// file's tests.
	setViewObserver(null);
	vi.restoreAllMocks();
});

describe('PuzzleView.destroy() — a throwing destroyed() hook never wedges the cascade', () => {
	it("a child's destroyed() throw is logged and the parent still finishes its own teardown", async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const log = [];
		let child = null;

		class Child extends PuzzleView {
			data() {
				// Subscribes THIS instance to the 'todo' key via withTracking.
				return { todos: this.ctx.store.findMany('todo') };
			}
			mounted() {
				child = this;
			}
			destroyed() {
				log.push('child');
				throw new Error('boom (child destroyed)');
			}
			render() {
				return h('span', { class: 'child' }, [text('c')]);
			}
		}

		class Parent extends PuzzleView {
			destroyed() {
				log.push('parent');
			}
			render() {
				return h('div', { id: 'host', ref: this.__ref('box') }, [h(Child, {})]);
			}
		}

		const el = container();
		const store = new Store({ todo: Todo });
		store.createRecord('todo', { id: 't1', text: 'ship it' });
		const parent = await new Parent({ store }).mount(el);
		await tick();
		expect(el.querySelector('.child')).not.toBeNull();
		expect(parent.refs.box).not.toBeNull();

		// The whole point: the throw stays inside the child's destroy().
		expect(() => parent.destroy()).not.toThrow();

		// The cascade ran PAST the throw — child first (inside #vm.clear()), then
		// the parent's own hook, which is the step the escaping throw used to skip.
		expect(log).toEqual(['child', 'parent']);
		expect(err).toHaveBeenCalledWith('[puzzle] destroyed hook error:', expect.any(Error));

		// …and everything after #vm.clear() in destroy() completed: refs nulled
		// (SPEC §38), both instances destroyed, no lingering subscriptions, DOM gone.
		expect(parent.refs.box).toBeNull();
		expect(parent.isDestroyed).toBe(true);
		expect(child.isDestroyed).toBe(true);
		expect(store.keysBySubscriber.has(child)).toBe(false);
		expect(store.keysBySubscriber.has(parent)).toBe(false);
		expect(el.querySelector('.child')).toBeNull();
	});

	it("a view's OWN destroyed() throw is swallowed and logged, and destroy() stays idempotent", async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		let calls = 0;
		class Boom extends PuzzleView {
			destroyed() {
				calls++;
				throw new Error('boom (destroyed)');
			}
			render() {
				return h('div', { class: 'boom' }, [text('x')]);
			}
		}
		const view = await new Boom().mount(container());

		expect(() => view.destroy()).not.toThrow();
		expect(view.isDestroyed).toBe(true);
		expect(err).toHaveBeenCalledWith('[puzzle] destroyed hook error:', expect.any(Error));

		// The #destroyed guard still short-circuits — the hook does not re-fire.
		expect(() => view.destroy()).not.toThrow();
		expect(calls).toBe(1);
	});
});

describe('PuzzleApp.unmount() — a throwing destroyed() hook leaves the app fully unmounted', () => {
	it('unmount() completes, services are dropped, and a subsequent mount() still works', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		class BoomView extends PuzzleView {
			destroyed() {
				throw new Error('boom (destroyed)');
			}
			render() {
				return h('puzzle-view', { class: 'boom' }, [text('BOOM')]);
			}
		}

		const el = container();
		const app = make({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: BoomView, layout: DefaultLayout }],
		});

		await app.mount();
		expect(el.querySelector('.boom')).not.toBeNull();

		// The throw used to escape router.stop() and abort #teardown() mid-way.
		expect(() => app.unmount()).not.toThrow();
		expect(err).toHaveBeenCalledWith('[puzzle] destroyed hook error:', expect.any(Error));

		// Teardown ran to completion: container cleared, router stopped, services
		// dropped (the store getter throws again post-unmount).
		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();
		expect(() => app.store).toThrow(/app\.store is not available/);

		// And the app is genuinely unmounted, so it re-mounts. With _mounted stuck
		// true this second mount() was a silent no-op — the user-visible symptom.
		await app.mount();
		expect(el.querySelector('.boom')).not.toBeNull();
		expect(app.router).not.toBeNull();
	});
});

describe('devstate — the D100 view observer only sees balanced mount/destroy pairs', () => {
	it('a never-mounted view fires NO observer call; a mounted view fires exactly one (view, false)', async () => {
		const seen = [];
		setViewObserver((view, mounted) => seen.push([view, mounted]));

		class Plain extends PuzzleView {
			render() {
				return h('div', { class: 'plain' }, [text('p')]);
			}
		}

		// Constructed, never mounted → never registered → destroying it must be
		// silent. The unguarded version emitted a mounted:false with no pair.
		const orphan = new Plain();
		orphan.destroy();
		expect(seen).toEqual([]);

		// A real mount registers, and the destroy that follows unregisters once.
		const live = await new Plain().mount(container());
		expect(seen).toEqual([[live, true]]);

		live.destroy();
		expect(seen).toEqual([
			[live, true],
			[live, false],
		]);

		// A redundant unregister (an already-removed view) stays silent too — the
		// delete-returned-true gate, not destroy()'s idempotency, is what guards it.
		unregisterView(live);
		expect(seen).toHaveLength(2);
	});
});

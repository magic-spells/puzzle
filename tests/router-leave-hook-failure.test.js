// @vitest-environment jsdom
//
// Regression: a THROWING leave hook must not leak the incoming chain (router.js
// #swap, sequential OUT phase). `await oldAnimator.playOut()` is now guarded — a
// user viewWillHide()/viewDidHide() that throws rejects playOut(), and before the
// guard that rejection propagated out of #swap → out of #navigate (whose
// try/catch wraps only the LOAD phase) into the un-awaited push() promise (an
// unhandled rejection), while the PRELOADED incoming instances were never mounted
// AND never destroyed — leaked with live store subscriptions that router.stop()
// can't release. This mirrors destroyAnimated()'s and #startOverlapLeave's own
// leave-hook guards: "a rejected leave must never strand...".
//
// Setup follows tests/router-transitions.test.js / tests/router-memory.test.js:
// memory-mode router, hand-written render() stand-ins, a real Store so
// subscriptions are observable via store.keysBySubscriber. No animations are
// declared — viewWillHide()/viewDidHide() fire regardless of an out spec
// (PuzzleView.playOut), so the throw path is reached without a fake WAAPI.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
	};
}

let routers = [];

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.title = '';
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

// Boot a memory-mode router over `routes` with a live store in ctx (so views can
// subscribe and we can observe store.keysBySubscriber). Starts at '/'.
async function boot(routes) {
	const el = container();
	const store = new Store({ todo: Todo });
	const router = new Router(routes, { mode: 'memory', initialPath: '/' });
	routers.push(router);
	await router.start(el, { store, router: null, formatters: null });
	return { router, el, store };
}

// A view that subscribes to the store in data() (records itself as a subscriber),
// records every constructed instance into `instances`, and optionally throws from
// one of its hide hooks.
function makeView(name, instances, { throwOn = null } = {}) {
	return class extends PuzzleView {
		constructor(...args) {
			super(...args);
			instances.push(this);
		}
		data() {
			// Subscribes THIS instance to the 'todo' key via withTracking.
			const todos = this.ctx.store.findMany('todo');
			return { name, todos };
		}
		viewWillHide() {
			if (throwOn === 'will') throw new Error('boom (viewWillHide)');
		}
		viewDidHide() {
			if (throwOn === 'did') throw new Error('boom (viewDidHide)');
		}
		render() {
			return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
		}
	};
}

// Run the shared scenario for a given throwing-hook variant and return the
// observable state after the A→B navigation settles.
async function runThrowScenario(throwOn) {
	const instances = [];
	const A = makeView('a', instances, { throwOn });
	const B = makeView('b', instances);
	const routes = [
		{ path: '/', name: 'a', view: A },
		{ path: '/b', name: 'b', view: B },
	];
	const { router, el, store } = await boot(routes);
	await tick();

	const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

	// A is the only subscriber right now; capture it.
	const aView = instances[0];
	expect(store.keysBySubscriber.has(aView)).toBe(true);

	// Navigate — push() must RESOLVE (no unhandled rejection escaping #swap).
	let rejected = false;
	await router.push('/b').catch(() => { rejected = true; });
	await tick();

	const bView = instances.find((v) => v !== aView && !v.isDestroyed);

	return { router, el, store, errSpy, aView, bView, instances, rejected };
}

describe('Router — a throwing leave hook does not leak the incoming chain', () => {
	it('viewWillHide() throw: navigation still completes, error logged, no leak', async () => {
		const { router, el, store, errSpy, aView, bView, instances, rejected } =
			await runThrowScenario('will');

		// push() resolved (the rejection was caught inside #swap, not propagated).
		expect(rejected).toBe(false);

		// The navigation COMMITTED: URL/state moved to B, B is mounted, A is gone.
		expect(router.current.path).toBe('/b');
		expect(el.querySelector('.b')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();

		// The leave-hook failure was logged with the guard's message.
		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] leave hook failed during navigation:',
			expect.any(Error)
		);

		// A is torn down and unsubscribed; B is live and subscribed.
		expect(aView.isDestroyed).toBe(true);
		expect(store.keysBySubscriber.has(aView)).toBe(false);
		expect(bView).toBeDefined();
		expect(bView.isDestroyed).toBe(false);
		expect(store.keysBySubscriber.has(bView)).toBe(true);

		// No leak: EVERY remaining store subscriber is a live, mounted view — no
		// destroyed or never-mounted instance is stranded with a subscription.
		for (const sub of store.keysBySubscriber.keys()) {
			expect(sub.isDestroyed).toBe(false);
			expect(sub.element).not.toBeNull();
			expect(sub.element.isConnected).toBe(true);
		}
		// Exactly one subscriber survives (B); no phantom preloaded instance lingers.
		expect(store.keysBySubscriber.size).toBe(1);

		// Any A/B instance that is NOT the mounted B must be destroyed (no orphans).
		for (const v of instances) {
			if (v === bView) continue;
			expect(v.isDestroyed).toBe(true);
		}
	});

	it('viewDidHide() throw: same guarantees', async () => {
		const { router, el, store, errSpy, aView, bView, rejected } =
			await runThrowScenario('did');

		expect(rejected).toBe(false);
		expect(router.current.path).toBe('/b');
		expect(el.querySelector('.b')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] leave hook failed during navigation:',
			expect.any(Error)
		);

		expect(aView.isDestroyed).toBe(true);
		expect(store.keysBySubscriber.has(aView)).toBe(false);
		expect(bView.isDestroyed).toBe(false);
		expect(store.keysBySubscriber.has(bView)).toBe(true);
		expect(store.keysBySubscriber.size).toBe(1);
	});
});

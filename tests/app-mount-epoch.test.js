// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

// Mount-generation races (SPEC §34, D66 lifecycle). mount() is async, so an
// unmount() during one of its awaits can be followed by a WHOLE NEW mount()
// before the first mount's continuation resumes. The old `_mounted` boolean
// could not tell "my mount is still live" from "a newer mount claimed the
// flag", so the stale continuation happily re-started the newer cycle's router,
// fired `mounted` a second time, or (on the beforeMount abort path) tore the
// newer cycle down. The #mountEpoch token is what closes that; these tests pin
// the interleavings. Conventions copied from tests/app.test.js and
// tests/app-lifecycle-hooks.test.js (hand-written render() stand-ins, h/text/
// slot helpers, container(), the apps[] + make() cleanup pattern).
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const tick = () => new Promise((r) => setTimeout(r, 0));

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
	}
}

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

class OtherView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'other' }, [text('OTHER')]);
	}
}

const routesWith = (homeView = HomeView) => [
	{ path: '/', name: 'home', view: homeView, layout: DefaultLayout },
	{ path: '/other', name: 'other', view: OtherView, layout: DefaultLayout },
];

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

// jsdom has no history.scrollRestoration; installing one lets the router's
// start()/stop() save+restore path run, which doubles as a "was start() called
// twice?" probe (a second start() captures the already-'manual' value as the
// restore target, so stop() can never put 'auto' back).
let scrollRestorationInstalled = false;
function installScrollRestoration(initial = 'auto') {
	Object.defineProperty(history, 'scrollRestoration', {
		value: initial,
		writable: true,
		configurable: true,
	});
	scrollRestorationInstalled = true;
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.title = '';
	document.body.innerHTML = '';
});

afterEach(() => {
	apps.forEach((a) => a.unmount());
	apps = [];
	if (scrollRestorationInstalled) {
		delete history.scrollRestoration;
		scrollRestorationInstalled = false;
	}
	vi.restoreAllMocks();
});

describe('PuzzleApp — mount generation (unmount + remount mid-mount)', () => {
	it('a stale continuation resuming after an awaited beforeMount neither re-starts the router nor re-fires mounted', async () => {
		const el = container();
		installScrollRestoration('auto');

		let releaseFirst;
		let beforeMountCalls = 0;
		let mountedCalls = 0;
		const app = make({
			target: '#app',
			routes: routesWith(),
			beforeMount() {
				beforeMountCalls++;
				// Only the FIRST attempt hangs; the second mounts straight through.
				if (beforeMountCalls === 1) {
					return new Promise((resolve) => {
						releaseFirst = resolve;
					});
				}
			},
			mounted() {
				mountedCalls++;
			},
		});

		const first = app.mount();
		await tick(); // suspended inside the awaited beforeMount of cycle 1
		expect(el.children.length).toBe(0); // navigation #0 has not run
		expect(mountedCalls).toBe(0);

		// Tear cycle 1 down mid-hook, then immediately start a WHOLE NEW cycle.
		app.unmount();
		const second = app.mount();
		await second;

		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(mountedCalls).toBe(1);
		const routerAfterSecond = app.router;
		const storeAfterSecond = app.store;

		// Now let cycle 1's hook resolve. Its continuation must see that its epoch
		// is gone and return without touching the live cycle.
		releaseFirst();
		await expect(first).resolves.toBe(app);
		await tick();

		expect(mountedCalls).toBe(1); // `mounted` did NOT fire a second time
		expect(app.router).toBe(routerAfterSecond); // cycle 2's services untouched
		expect(app.store).toBe(storeAfterSecond);
		expect(el.querySelector('.layout main .home')).not.toBeNull();

		// Cycle 2's router is still functional...
		await app.router.push('/other');
		expect(el.querySelector('.other')).not.toBeNull();

		// ...and was started exactly once: a second start() would have captured the
		// already-'manual' value, so stop() could never restore the browser default.
		app.unmount();
		expect(history.scrollRestoration).toBe('auto');
	});

	it('a stale continuation resuming after router.start() runs none of its post-start work', async () => {
		const el = container();

		let releaseFirstData;
		let dataCalls = 0;
		// Only the FIRST instance (cycle 1's navigation #0) hangs inside data(), so
		// the first mount() is suspended INSIDE router.start() while cycle 2 boots.
		class GateHome extends PuzzleView {
			async data() {
				dataCalls++;
				if (dataCalls === 1) {
					await new Promise((resolve) => {
						releaseFirstData = resolve;
					});
				}
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'home' }, [text('HOME')]);
			}
		}

		let mountedCalls = 0;
		const app = make({
			target: '#app',
			routes: routesWith(GateHome),
			mounted() {
				mountedCalls++;
			},
		});

		const first = app.mount();
		await tick(); // inside router.start() → navigation #0 → GateHome.data()
		expect(el.children.length).toBe(0); // nav #0 has not committed
		expect(mountedCalls).toBe(0);

		// Tear cycle 1 down mid-start (router.stop() invalidates the pending nav),
		// then start a new cycle whose own data() resolves immediately.
		app.unmount();
		const second = app.mount();
		await second;

		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(mountedCalls).toBe(1);
		const routerAfterSecond = app.router;

		// Release cycle 1's nav #0: it abandons on the stale router token, start()
		// returns, and the stale continuation reaches the post-start gate.
		releaseFirstData();
		await expect(first).resolves.toBe(app);
		await tick();

		expect(mountedCalls).toBe(1); // post-start work did not run again
		expect(app.router).toBe(routerAfterSecond);
		expect(el.querySelector('.layout main .home')).not.toBeNull();

		await app.router.push('/other');
		expect(el.querySelector('.other')).not.toBeNull();
	});

	it('a late-rejecting beforeMount from a superseded mount does not tear down the cycle that replaced it', async () => {
		const el = container();

		let rejectFirst;
		let beforeMountCalls = 0;
		let mountedCalls = 0;
		let beforeUnmountCalls = 0;
		const app = make({
			target: '#app',
			routes: routesWith(),
			beforeMount() {
				beforeMountCalls++;
				if (beforeMountCalls === 1) {
					return new Promise((_resolve, reject) => {
						rejectFirst = reject;
					});
				}
			},
			mounted() {
				mountedCalls++;
			},
			beforeUnmount() {
				beforeUnmountCalls++;
			},
		});

		const first = app.mount();
		// Observe the outcome up front so the late rejection is never unhandled.
		const firstOutcome = first.then(
			() => ({ ok: true }),
			(err) => ({ ok: false, err })
		);
		await tick(); // suspended inside the awaited beforeMount of cycle 1

		app.unmount(); // cycle 1 abandoned (fires beforeUnmount — the flag was claimed)
		expect(beforeUnmountCalls).toBe(1);

		const second = app.mount(); // cycle 2 takes over
		await second;
		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(mountedCalls).toBe(1);
		const routerAfterSecond = app.router;
		const storeAfterSecond = app.store;

		// Cycle 1's hook rejects LATE. mount() #1 must still reject — but its abort
		// path owns only ITS cycle, and that cycle is already gone.
		rejectFirst(new Error('seed failed'));
		const outcome = await firstOutcome;
		expect(outcome.ok).toBe(false);
		expect(outcome.err.message).toBe('seed failed');
		await tick();

		// Cycle 2 survived intact...
		expect(app.router).toBe(routerAfterSecond);
		expect(app.store).toBe(storeAfterSecond);
		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(mountedCalls).toBe(1);

		// ...is still functional...
		await app.router.push('/other');
		expect(el.querySelector('.other')).not.toBeNull();

		// ...and is still a LIVE mount, so a real unmount() tears it down and fires
		// beforeUnmount a second time (a stale #teardown would have eaten it).
		app.unmount();
		expect(beforeUnmountCalls).toBe(2);
		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();
	});

	it('an async-rejecting beforeMount with no competing cycle still tears its OWN mount down', async () => {
		const el = container();
		let beforeUnmountCalls = 0;
		let rejectOnce = true;
		const app = make({
			target: '#app',
			routes: routesWith(),
			beforeMount() {
				// Rejects across the await boundary — the case the epoch guard on the
				// abort teardown could plausibly break. The epoch is unchanged here, so
				// the abort must still tear down exactly as it always did.
				if (rejectOnce) {
					rejectOnce = false;
					return Promise.reject(new Error('async seed failed'));
				}
			},
			beforeUnmount() {
				beforeUnmountCalls++;
			},
		});

		await expect(app.mount()).rejects.toThrow('async seed failed');

		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();
		expect(() => app.store).toThrow(/app\.store is not available/);
		expect(beforeUnmountCalls).toBe(0); // abort path never pairs with beforeUnmount

		// Re-mounting the same instance is still legal (fresh epoch, clean boot).
		await app.mount();
		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(beforeUnmountCalls).toBe(0);
	});

	it('a navigation-zero commit rejection tears the mount down so a later mount succeeds', async () => {
		const el = container();
		let beforeUnmountCalls = 0;
		vi.spyOn(document, 'title', 'set').mockImplementationOnce(() => {
			throw new Error('navigation zero failed');
		});
		const app = make({
			target: '#app',
			routes: routesWith().map((route, index) =>
				index === 0 ? { ...route, meta: { title: 'Home' } } : route
			),
			beforeUnmount() {
				beforeUnmountCalls++;
			},
		});

		await expect(app.mount()).rejects.toThrow('navigation zero failed');

		expect(el.children.length).toBe(0);
		expect(app.router).toBeNull();
		expect(() => app.store).toThrow(/app\.store is not available/);
		expect(beforeUnmountCalls).toBe(0);

		await app.mount();
		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(beforeUnmountCalls).toBe(0);
	});
});

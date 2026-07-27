// @vitest-environment jsdom
//
// Router SSG takeover (M2). A prerendered app boots with `data-puzzle-ssg` on the
// mount target + the rendered markup already inside it. On navigation #0 the
// router (router.js #swap, both initial-nav mount branches) must clear the
// prerendered content, drop the marker, and suppress the incoming top view's enter
// animation — content the user is reading must not duplicate or re-animate. A
// container WITHOUT the marker keeps the exact pre-SSG behavior.
//
// Enter suppression is observed via viewWillShow(): playIn() fires it even with no
// `animations` field (zero-duration), UNLESS skipEnter() ran first — which is
// exactly what #takeoverSSG does. So viewWillShow NOT firing == enter suppressed.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { prerender } from '../client-runtime/ssg/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

let willShow = 0;

function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

let skeletonRenders = 0;
let gate = deferred();

class Home extends PuzzleView {
	viewWillShow() {
		willShow++;
	}
	render() {
		return h('h1', { class: 'home' }, [text('Home')]);
	}
}
class Layout extends PuzzleView {
	render() {
		return h('div', { class: 'layout' }, [slot()]);
	}
}

const apps = [];
function boot(cfg) {
	const app = new PuzzleApp(cfg);
	apps.push(app);
	return app;
}

/** A container pre-seeded like the SSG prerender step leaves it. */
function ssgContainer(inner) {
	const el = document.createElement('div');
	el.id = 'app';
	el.setAttribute('data-puzzle-ssg', '');
	el.innerHTML = inner;
	document.body.appendChild(el);
	return el;
}

afterEach(() => {
	willShow = 0;
	skeletonRenders = 0;
	while (apps.length) apps.pop().unmount();
	document.body.innerHTML = '';
});

describe('router SSG takeover (M2)', () => {
	it('no-layout: replaces prerendered content once, drops marker, suppresses enter', async () => {
		const el = ssgContainer('<h1 class="home">Home</h1>');
		const app = boot({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: Home }],
			routerMode: 'memory',
		});
		await app.mount();

		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
		expect(el.querySelectorAll('h1.home').length).toBe(1); // no duplication
		expect(el.textContent).toBe('Home');
		expect(willShow).toBe(0); // enter suppressed
	});

	it('with layout: takes over the container, no duplicate chrome, suppresses enter', async () => {
		const el = ssgContainer('<div class="layout"><h1 class="home">Home</h1></div>');
		const app = boot({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: Home, layout: Layout }],
			routerMode: 'memory',
		});
		await app.mount();
		await tick(); // the layout's slot-child playIn is chained async

		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
		expect(el.querySelectorAll('.layout').length).toBe(1);
		expect(el.querySelectorAll('h1.home').length).toBe(1);
		expect(el.textContent).toBe('Home');
		expect(willShow).toBe(0); // top view's enter suppressed
	});

	// Static hosts serve the SSG output at directory URLs — a prerendered page
	// loads as '/components/badge/' while its route is '/components/badge'. The
	// matcher ignores a single trailing '/' so navigation #0 still matches and the
	// takeover runs (an unmatched nav #0 would leave the prerendered DOM inert).
	it('trailing-slash load path matches its route and takes over', async () => {
		const el = ssgContainer('<h1 class="home">Home</h1>');
		const app = boot({
			target: '#app',
			routes: [{ path: '/components/badge', name: 'badge', view: Home }],
			routerMode: 'memory',
			routerInitialPath: '/components/badge/',
		});
		await app.mount();

		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
		expect(el.querySelectorAll('h1.home').length).toBe(1);
		expect(willShow).toBe(0); // takeover ran: enter suppressed
	});

	it('trailing slash on a :param route does not leak into the capture', async () => {
		let seenParams = null;
		class UserView extends PuzzleView {
			data(params) {
				seenParams = params;
				return {};
			}
			render() {
				return h('div', {}, [text('user')]);
			}
		}
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		const app = boot({
			target: '#app',
			routes: [{ path: '/user/:id', name: 'user', view: UserView }],
			routerMode: 'memory',
			routerInitialPath: '/user/123/',
		});
		await app.mount();

		expect(seenParams).toEqual({ id: '123' });
	});

	// ---- SSG takeover × skeleton (D39/D52 interaction) ----------------------
	// A prerendered page whose initial view declares <puzzle-skeleton> (renderSkeleton)
	// with an async data(). At the takeover (nav #0, marker present) the D39 skeleton
	// exemption must NOT apply: the router awaits the chain's preload(s) so the commit
	// + replaceChildren happen with REAL data, replacing the prerendered content with
	// identical real content in ONE swap. The skeleton must NEVER paint (a content →
	// skeleton → content flash), and the D52 min-duration hold must never engage.

	// Async-data skeleton view: data() blocks on a manually-resolved gate so a test
	// can observe the pending (skeleton) window; renderSkeleton() is spied via a
	// module counter (the ONLY producer of skeleton markup, so count 0 == never painted).
	class SkeletonView extends PuzzleView {
		async data() {
			await gate.promise;
			return { ready: true };
		}
		renderSkeleton() {
			skeletonRenders++;
			return h('div', { class: 'skeleton' }, [text('loading...')]);
		}
		render() {
			return h('h1', { class: 'real' }, [text('Real')]);
		}
	}

	it('SSG takeover of a skeleton view: awaits data(), never paints the skeleton', async () => {
		// Prerendered markup == the real render() output (what serialize.js emits).
		const el = ssgContainer('<h1 class="real">Real</h1>');
		// data() must resolve for the takeover to complete — pre-resolve the gate so
		// the awaited preload settles (mount() awaits the whole chain in takeover mode).
		gate.resolve();
		// Flag if the skeleton markup EVER appears in the container between load and
		// settle — a direct assertion of "prerendered content stays until the swap".
		let sawSkeleton = false;
		const mo = new MutationObserver(() => {
			if (el.querySelector('.skeleton')) sawSkeleton = true;
		});
		mo.observe(el, { childList: true, subtree: true });

		const app = boot({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: SkeletonView }],
			routerMode: 'memory',
		});
		await app.mount();
		mo.disconnect();

		expect(skeletonRenders).toBe(0); // skeleton template never rendered
		expect(sawSkeleton).toBe(false); // and never observed in the DOM
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false); // marker dropped
		expect(el.querySelectorAll('.skeleton').length).toBe(0);
		expect(el.querySelectorAll('h1.real').length).toBe(1); // one real element, no dup
		expect(el.textContent).toBe('Real');
	});

	it('keeps prerendered deep async component content until hybrid takeover commits', async () => {
		let clientGate = null;
		class AsyncLeaf extends PuzzleView {
			async data() {
				if (clientGate) await clientGate.promise;
				return { label: 'ASYNC-CONTENT' };
			}
			render() {
				return h('section', { class: 'async-leaf' }, [text(this.getData().label)]);
			}
		}
		class NestedShell extends PuzzleView {
			render() {
				return h('div', { class: 'nested-shell' }, [h(AsyncLeaf)]);
			}
		}
		class NestedLayout extends PuzzleView {
			render() {
				return h('div', { class: 'nested-layout' }, [h(NestedShell), slot()]);
			}
		}
		class NestedPage extends PuzzleView {
			render() {
				return h('main', { class: 'nested-page' }, [text('PAGE-CONTENT')]);
			}
		}
		const routes = [
			{ path: '/', name: 'nested', view: NestedPage, layout: NestedLayout },
		];
		const { pages } = await prerender({ target: '#app', routes }, { mode: 'hybrid' });
		const el = ssgContainer(pages[0].html);
		const prerendered = el.innerHTML;
		clientGate = deferred();
		const app = boot({ target: '#app', routes, routerMode: 'memory' });

		const mounting = app.mount();
		await tick(); // a paint opportunity while the nested data() macrotask is pending
		const firstPaint = el.innerHTML;
		clientGate.resolve();
		await mounting;

		expect(firstPaint).toBe(prerendered);
		expect(el.innerHTML).toBe(prerendered);
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
	});

	it('keeps the nested sync component control byte-identical during hybrid takeover', async () => {
		class SyncLeaf extends PuzzleView {
			data() {
				return { label: 'SYNC-CONTENT' };
			}
			render() {
				return h('section', { class: 'sync-leaf' }, [text(this.getData().label)]);
			}
		}
		class SyncPage extends PuzzleView {
			render() {
				return h('main', { class: 'sync-page' }, [h(SyncLeaf)]);
			}
		}
		const routes = [{ path: '/', name: 'sync', view: SyncPage }];
		const { pages } = await prerender({ target: '#app', routes }, { mode: 'hybrid' });
		const el = ssgContainer(pages[0].html);
		const prerendered = el.innerHTML;
		const app = boot({ target: '#app', routes, routerMode: 'memory' });

		await app.mount();

		expect(el.innerHTML).toBe(prerendered);
		expect(el.querySelector('.sync-leaf').textContent).toBe('SYNC-CONTENT');
	});

	it('mounts the hybrid page when a nested component preload rejects', async () => {
		let rejectOnClient = false;
		class RejectingLeaf extends PuzzleView {
			async data() {
				await tick();
				if (rejectOnClient) throw new Error('nested takeover rejected');
				return { label: 'BUILD-CONTENT' };
			}
			render() {
				return h('section', { class: 'rejecting-leaf' }, [text(this.getData().label)]);
			}
		}
		class RejectingPage extends PuzzleView {
			render() {
				return h('main', { class: 'rejecting-page' }, [h(RejectingLeaf)]);
			}
		}
		const routes = [{ path: '/', name: 'rejecting', view: RejectingPage }];
		const { pages } = await prerender({ target: '#app', routes }, { mode: 'hybrid' });
		const el = ssgContainer(pages[0].html);
		rejectOnClient = true;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const app = boot({ target: '#app', routes, routerMode: 'memory' });

		await expect(app.mount()).resolves.toBe(app);

		expect(error).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);
		expect(el.querySelector('.rejecting-page')).not.toBe(null);
		expect(el.querySelector('.rejecting-leaf')).toBe(null);
	});

	it('mounts the hybrid page when a nested component CONSTRUCTOR throws', async () => {
		// A field initializer or constructor body throws before preload() is ever
		// reached, so the construction has to sit inside the same fail-soft try: this
		// component degrades to its placeholder instead of aborting the takeover.
		let throwOnClient = false;
		class ThrowingCtorLeaf extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				if (throwOnClient) throw new Error('nested constructor exploded');
			}
			render() {
				return h('section', { class: 'ctor-leaf' }, [text('LEAF')]);
			}
		}
		class CtorPage extends PuzzleView {
			render() {
				return h('main', { class: 'ctor-page' }, [h(ThrowingCtorLeaf)]);
			}
		}
		const routes = [{ path: '/', name: 'ctor', view: CtorPage }];
		const { pages } = await prerender({ target: '#app', routes }, { mode: 'hybrid' });
		const el = ssgContainer(pages[0].html);
		throwOnClient = true;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const app = boot({ target: '#app', routes, routerMode: 'memory' });

		await expect(app.mount()).resolves.toBe(app);

		expect(error).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false); // navigation still committed
		expect(el.querySelector('.ctor-page')).not.toBe(null);
		expect(el.querySelector('.ctor-leaf')).toBe(null); // recoverable placeholder
	});

	it('after takeover, a client-side nav to a skeleton view still shows the skeleton (D39 intact)', async () => {
		// Nav #0 takes over a plain prerendered Home; then push('/sk') is an ordinary
		// client-side navigation (cur exists, no marker) — the D39 exemption applies,
		// so the skeleton shows immediately while data() pends.
		const el = ssgContainer('<h1 class="home">Home</h1>');
		gate = deferred(); // fresh, unresolved
		const app = boot({
			target: '#app',
			routes: [
				{ path: '/', name: 'home', view: Home },
				{ path: '/sk', name: 'sk', view: SkeletonView },
			],
			routerMode: 'memory',
		});
		await app.mount(); // takeover of '/'
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false);

		const nav = app.router.push('/sk');
		await tick(); // commit + skeleton mount (data() still pending on the gate)

		expect(el.querySelectorAll('.skeleton').length).toBe(1); // skeleton shown
		expect(skeletonRenders).toBeGreaterThan(0);
		expect(el.querySelectorAll('h1.real').length).toBe(0); // real not yet rendered

		gate.resolve();
		await nav;
		await tick();
		expect(el.querySelectorAll('.skeleton').length).toBe(0); // swapped to real
		expect(el.querySelectorAll('h1.real').length).toBe(1);
	});

	it('SPA cold boot (no marker) with a skeleton view still shows the skeleton (D39 intact)', async () => {
		// No data-puzzle-ssg marker ⇒ isSSGTakeover is false ⇒ the D39 exemption
		// applies on nav #0 too: mount() resolves with the skeleton up, data() pending.
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		gate = deferred(); // fresh, unresolved
		const app = boot({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: SkeletonView }],
			routerMode: 'memory',
		});
		await app.mount(); // does NOT wait on data() — skeleton exemption

		expect(el.querySelectorAll('.skeleton').length).toBe(1); // skeleton shown
		expect(skeletonRenders).toBeGreaterThan(0);
		expect(el.querySelectorAll('h1.real').length).toBe(0);

		gate.resolve();
		await tick();
		expect(el.querySelectorAll('.skeleton').length).toBe(0); // swapped to real
		expect(el.querySelectorAll('h1.real').length).toBe(1);
	});

	it('unmarked container: existing behavior is unchanged (enter plays, no marker)', async () => {
		const nestedGate = deferred();
		class PlainAsyncChild extends PuzzleView {
			async data() {
				await nestedGate.promise;
				return { label: 'child' };
			}
			render() {
				return h('span', { class: 'plain-async-child' }, [text(this.getData().label)]);
			}
		}
		class PlainHome extends Home {
			render() {
				return h('div', {}, [
					h('h1', { class: 'home' }, [text('Home')]),
					h(PlainAsyncChild),
				]);
			}
		}
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		const app = boot({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: PlainHome }],
			routerMode: 'memory',
		});
		let mounted = false;
		const mounting = app.mount().then(() => {
			mounted = true;
		});
		await tick();
		const mountedBeforeNestedData = mounted;
		const childBeforeData = el.querySelector('.plain-async-child');
		nestedGate.resolve();
		await mounting;
		await tick();

		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false); // never had it
		expect(el.querySelectorAll('h1.home').length).toBe(1);
		expect(mountedBeforeNestedData).toBe(true); // ordinary SPA did not await the child
		expect(childBeforeData).toBe(null);
		expect(el.textContent).toBe('Homechild');
		expect(willShow).toBe(1); // enter animation plays as before
	});

	// ---- __PUZZLE_TAKEOVER__ fallback ---------------------------------------
	// The compiler defines __PUZZLE_TAKEOVER__ = false for a plain SPA build so the
	// three takeover gates — and, through the dropped preloadTakeoverComponents
	// import, ssg/preload.js itself — fold out of the bundle. Every gate is written
	// `typeof __PUZZLE_TAKEOVER__ === 'undefined' || __PUZZLE_TAKEOVER__`, so an
	// ABSENT define means ON. That fallback is what keeps this whole file green
	// (vitest supplies no define) and what keeps the runtime usable under a
	// third-party bundler that does not know the name.
	//
	// This case pins it explicitly: it asserts the define really is absent here,
	// then drives all three gates in one navigation — the skeleton-exemption probe
	// (gate 1), the nested-component preload (gate 2), and #takeoverSSG's clear +
	// marker drop (gate 3). Deleting the `typeof …` half of any gate would leave
	// every OTHER test here passing only by accident of ReferenceError timing; this
	// one fails loudly.
	it('takes over with __PUZZLE_TAKEOVER__ undefined (the typeof fallback)', async () => {
		expect(typeof globalThis.__PUZZLE_TAKEOVER__).toBe('undefined');

		let leafGate = null;
		let leafRenders = 0;
		class FallbackLeaf extends PuzzleView {
			async data() {
				if (leafGate) await leafGate.promise;
				return { label: 'LEAF' };
			}
			render() {
				leafRenders++;
				return h('span', { class: 'fallback-leaf' }, [text(this.getData().label)]);
			}
		}
		// Declares renderSkeleton, so gate 1 is what decides whether the D39
		// exemption applies. Under takeover it must NOT: skeletonRenders stays 0.
		class FallbackPage extends PuzzleView {
			async data() {
				return { ready: true };
			}
			renderSkeleton() {
				skeletonRenders++;
				return h('div', { class: 'skeleton' }, [text('loading...')]);
			}
			render() {
				return h('main', { class: 'fallback-page' }, [
					text('PAGE'),
					h(FallbackLeaf),
				]);
			}
		}
		const routes = [{ path: '/', name: 'fallback', view: FallbackPage }];
		const { pages } = await prerender({ target: '#app', routes }, { mode: 'hybrid' });
		const el = ssgContainer(pages[0].html);
		const prerendered = el.innerHTML;

		// A pending nested data() at takeover time: without gate 2 the router would
		// commit before the leaf resolved and the prerendered content would blank.
		leafGate = deferred();
		const app = boot({ target: '#app', routes, routerMode: 'memory' });
		const mounting = app.mount();
		await tick();
		const firstPaint = el.innerHTML;
		leafGate.resolve();
		await mounting;

		expect(skeletonRenders).toBe(0); // gate 1: exemption suppressed under takeover
		expect(firstPaint).toBe(prerendered); // gate 2: nested preload awaited
		expect(el.innerHTML).toBe(prerendered); // one swap, identical content
		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false); // gate 3: marker dropped
		expect(willShow).toBe(0); // gate 3: enter suppressed
		expect(leafRenders).toBeGreaterThan(0);
	});
});

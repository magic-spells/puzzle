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
import { describe, it, expect, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
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
		const el = document.createElement('div');
		el.id = 'app';
		document.body.appendChild(el);
		const app = boot({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: Home }],
			routerMode: 'memory',
		});
		await app.mount();

		expect(el.hasAttribute('data-puzzle-ssg')).toBe(false); // never had it
		expect(el.querySelectorAll('h1.home').length).toBe(1);
		expect(el.textContent).toBe('Home');
		expect(willShow).toBe(1); // enter animation plays as before
	});
});

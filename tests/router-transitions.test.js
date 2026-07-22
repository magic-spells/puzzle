// @vitest-environment jsdom
//
// Router transition integration (constellation/doc/DOC-SPEC.md §12). Drives the
// D19 commit path through the animation surface with the controllable fake WAAPI
// (tests/helpers/fake-waapi.js) and asserts the SEQUENTIAL order + one-animator
// rule: outgoing viewWillHide → out → viewDidHide → destroy → incoming mount →
// viewWillShow → in → viewDidShow. The existing tests/router.test.js (no
// animations) is the regression net for unchanged timing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { installFakeAnimate } from './helpers/fake-waapi.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const ctx = () => ({ store: null, router: null, formatters: null });

const IN = { from: { opacity: 0 }, to: { opacity: 1 }, duration: 200 };
const OUT = { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 };

// A view/layout that logs every lifecycle + enter/leave hook into a shared array,
// prefixed with its name, so ordering across the two sides of a transition is one
// flat timeline. `animations` defaults to in+out; pass null to opt out.
function makeView(name, log, { animations = { in: IN, out: OUT } } = {}) {
	return class extends PuzzleView {
		animations = animations;
		mounted() { log.push(`${name}:mounted`); }
		viewWillShow() { log.push(`${name}:willShow`); }
		viewDidShow() { log.push(`${name}:didShow`); }
		viewWillHide() { log.push(`${name}:willHide`); }
		viewDidHide() { log.push(`${name}:didHide`); }
		destroyed() { log.push(`${name}:destroyed`); }
		render() { return h('puzzle-view', { class: name }, [text(name.toUpperCase())]); }
	};
}

// Same, but a layout: its render() carries a <Slot/> the routed view lands in.
function makeLayout(name, log, { animations = { in: IN, out: OUT } } = {}) {
	return class extends PuzzleView {
		animations = animations;
		mounted() { log.push(`${name}:mounted`); }
		viewWillShow() { log.push(`${name}:willShow`); }
		viewDidShow() { log.push(`${name}:didShow`); }
		viewWillHide() { log.push(`${name}:willHide`); }
		viewDidHide() { log.push(`${name}:didHide`); }
		destroyed() { log.push(`${name}:destroyed`); }
		render() {
			return h('puzzle-view', { class: name }, [h('main', {}, [slot()])]);
		}
	};
}

// A plain layout with no animations/hooks — for reuse tests where the layout is
// meant to stay put and never animate on a view swap.
class PlainLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
	}
}

let routers = [];
let waapi = null;

async function boot(routes) {
	const el = container();
	const router = new Router(routes);
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

// Finish every outstanding fake animation and drain the resulting microtasks,
// repeatedly, so a whole sequential out→mount→in chain settles.
async function settle(rounds = 4) {
	for (let i = 0; i < rounds; i++) {
		if (waapi) waapi.finishAll();
		await tick();
	}
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.title = '';
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	if (waapi) {
		waapi.uninstall();
		waapi = null;
	}
	vi.restoreAllMocks();
});

describe('Router transitions — full nav, both views animate (reused layout)', () => {
	it('sequences old out fully BEFORE new mounts+in; URL commits WITH the mount, not before (D61)', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout },
		];
		const { router, el } = await boot(routes);
		await settle(); // let home's initial enter finish
		log.length = 0;

		const p = router.push('/about');
		await tick();

		// D61: the URL has NOT moved — location commits ATOMICALLY with the incoming
		// mount, which in sequential mode waits for the OLD view's out to settle. The
		// old view is still animating out and the new view has not mounted.
		expect(location.pathname).toBe('/'); // still the old route
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.about')).toBeNull();
		expect(log).toEqual(['home:willHide']); // out started, not finished

		await settle();
		await p;

		// Now the URL, the DOM, and #state all caught up together.
		expect(location.pathname).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.home')).toBeNull();
		expect(log).toEqual([
			'home:willHide',
			'home:didHide',
			'home:destroyed',
			'about:mounted',
			'about:willShow',
			'about:didShow',
		]);
	});
});

describe('Router transitions — views without animations (timing unchanged)', () => {
	it('completes the whole swap on a single await, no manual animation finish', async () => {
		// No fake WAAPI installed AND no animations declared: playOut/playIn are
		// pure zero-duration hooks, so `await push()` fully commits the swap —
		// exactly the pre-animation timing the existing router suite relies on.
		const log = [];
		const Home = makeView('home', log, { animations: undefined });
		const About = makeView('about', log, { animations: undefined });
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout },
		];
		const { router, el } = await boot(routes);
		log.length = 0;

		await router.push('/about');
		await tick();

		expect(location.pathname).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.home')).toBeNull();
		// old torn down before new shown, all hooks in order
		expect(log).toEqual([
			'home:willHide',
			'home:didHide',
			'home:destroyed',
			'about:mounted',
			'about:willShow',
			'about:didShow',
		]);
	});
});

describe('Router transitions — interruption (token guard)', () => {
	it('a nav during the out cancels it, the newcomer wins, no hook double-fires', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const A = makeView('a', log);
		const B = makeView('b', log);
		const C = makeView('c', log);
		const routes = [
			{ path: '/', name: 'a', view: A, layout: PlainLayout },
			{ path: '/b', name: 'b', view: B, layout: PlainLayout },
			{ path: '/c', name: 'c', view: C, layout: PlainLayout },
		];
		const { router, el } = await boot(routes);
		await settle(); // finish A's initial enter
		log.length = 0;

		// A→B: B's transition begins, A animates out.
		const p1 = router.push('/b');
		await tick();
		expect(log).toEqual(['a:willHide']); // A leaving, mid-out

		// C interrupts mid-out.
		const p2 = router.push('/c');
		await Promise.all([p1, p2]);
		await settle();

		expect(location.pathname).toBe('/c');
		expect(el.querySelector('.c')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();
		expect(el.querySelector('.b')).toBeNull();

		// A's out was cancelled: willHide fired, didHide did NOT (destroy skips it).
		expect(log).toContain('a:willHide');
		expect(log).not.toContain('a:didHide');
		expect(log).toContain('a:destroyed');

		// B never took the screen — no mount/show/hide hooks; only a teardown.
		expect(log).not.toContain('b:mounted');
		expect(log).not.toContain('b:willShow');
		expect(log).not.toContain('b:willHide');

		// C won, cleanly, exactly once each (no double-fire).
		expect(log.filter((e) => e === 'c:mounted')).toHaveLength(1);
		expect(log.filter((e) => e === 'c:willShow')).toHaveLength(1);
		expect(log.filter((e) => e === 'c:didShow')).toHaveLength(1);
	});
});

describe('Router transitions — layout swap (only the layout animates)', () => {
	it('animates the layout as a unit; the inner outgoing view fires no out hooks', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const LayoutA = makeLayout('la', log);
		const LayoutB = makeLayout('lb', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: LayoutA },
			{ path: '/other', name: 'other', view: About, layout: LayoutB },
		];
		const { router, el } = await boot(routes);
		await settle(); // home's initial enter (layout did NOT animate on first paint)
		expect(log).not.toContain('la:willShow'); // layout inert on initial nav
		log.length = 0;

		const p = router.push('/other');
		await tick();

		// The LAYOUT is the animator; the inner view is not touched. D61: the URL
		// stays on the old route until the layout's out settles (commit is atomic
		// with the mount).
		expect(location.pathname).toBe('/'); // not yet committed — layout still fading out
		expect(el.querySelector('.la')).not.toBeNull();
		expect(el.querySelector('.lb')).toBeNull();
		expect(log).toEqual(['la:willHide']);
		expect(log).not.toContain('home:willHide'); // inner view does NOT play out

		await settle();
		await p;

		expect(location.pathname).toBe('/other'); // committed with the new layout mount
		expect(el.querySelector('.lb')).not.toBeNull();
		expect(el.querySelector('.la')).toBeNull();
		expect(el.querySelector('.lb .about')).not.toBeNull();

		// Old layout animated out then tore down; the inner old view went with it
		// synchronously — no out hooks, but it was destroyed.
		expect(log).toContain('la:didHide');
		expect(log).toContain('la:destroyed');
		expect(log).not.toContain('home:willHide');
		expect(log).not.toContain('home:didHide');
		expect(log).toContain('home:destroyed');

		// New layout animated in; the inner new view's enter was SUPPRESSED.
		expect(log).toContain('lb:willShow');
		expect(log).toContain('lb:didShow');
		expect(log).toContain('about:mounted');
		expect(log).not.toContain('about:willShow');
		expect(log).not.toContain('about:didShow');
	});
});

describe('Router transitions — layout reuse (the view animates, not the layout)', () => {
	it('swaps the routed view with its own in/out; the shared layout fires no hooks', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const Shared = makeLayout('shared', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: Shared },
			{ path: '/two', name: 'two', view: About, layout: Shared },
		];
		const { router, el } = await boot(routes);
		await settle();
		log.length = 0;

		// push() blocks on the awaited OUT animation, so settle() must run
		// concurrently to finish it (and the subsequent enter) before we await.
		const p = router.push('/two');
		await settle();
		await p;
		await settle();

		expect(el.querySelector('.shared .about')).not.toBeNull();
		expect(el.querySelector('.home')).toBeNull();

		// The VIEW animated across the swap.
		expect(log).toContain('home:willHide');
		expect(log).toContain('home:didHide');
		expect(log).toContain('home:destroyed');
		expect(log).toContain('about:willShow');
		expect(log).toContain('about:didShow');

		// The reused layout never animates on a view swap.
		expect(log).not.toContain('shared:willShow');
		expect(log).not.toContain('shared:willHide');
		expect(log).not.toContain('shared:didShow');
		expect(log).not.toContain('shared:didHide');
		expect(log).not.toContain('shared:destroyed');
	});
});

describe('Router transitions — initial nav plays the routed view in exactly once', () => {
	it('inside a layout: view viewWillShow once; the layout does not animate', async () => {
		waapi = installFakeAnimate();
		const willShow = vi.fn();
		const layoutWillShow = vi.fn();
		class Home extends PuzzleView {
			animations = { in: IN };
			viewWillShow() { willShow(); }
			render() { return h('puzzle-view', { class: 'home' }, [text('HOME')]); }
		}
		class Layout extends PuzzleView {
			animations = { in: IN };
			viewWillShow() { layoutWillShow(); }
			render() { return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]); }
		}
		const routes = [{ path: '/', name: 'home', view: Home, layout: Layout }];
		const { el } = await boot(routes);
		await settle();

		expect(el.querySelector('.layout .home')).not.toBeNull();
		expect(willShow).toHaveBeenCalledTimes(1); // routed view enters exactly once
		expect(layoutWillShow).not.toHaveBeenCalled(); // layout inert on first paint
	});

	it('with no layout: view mounted directly plays in exactly once', async () => {
		waapi = installFakeAnimate();
		const willShow = vi.fn();
		class Home extends PuzzleView {
			animations = { in: IN };
			viewWillShow() { willShow(); }
			render() { return h('puzzle-view', { class: 'home' }, [text('HOME')]); }
		}
		const routes = [{ path: '/', name: 'home', view: Home, layout: null }];
		const { el } = await boot(routes);
		await settle();

		expect(el.querySelector('.home')).not.toBeNull();
		expect(willShow).toHaveBeenCalledTimes(1);
	});
});

// ---- nested transitions (v1.3 / D30) ---------------------------------------

// Start the router at a specific URL (nested deep-link) rather than '/'.
async function bootAt(routes, path) {
	history.replaceState({}, '', path);
	return boot(routes);
}

describe('Router transitions — nested initial nav (topmost view only)', () => {
	it('the parent shell enters once; the nested leaf is suppressed; layout inert', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Layout = makeLayout('layout', log);
		const Parent = makeLayout('parent', log); // a shell view: <Slot/> + hooks
		const Leaf = makeView('leaf', log);
		const routes = [
			{
				path: '/p',
				name: 'p',
				layout: Layout,
				view: Parent,
				children: [{ path: 'c', name: 'c', view: Leaf }],
			},
		];
		const { el } = await bootAt(routes, '/p/c');
		await settle();

		expect(el.querySelector('.layout .parent .leaf')).not.toBeNull();
		// Topmost swapped view (the parent) plays in exactly once.
		expect(log.filter((e) => e === 'parent:willShow')).toHaveLength(1);
		// Nested leaf's auto-chained enter suppressed; layout inert on first paint.
		expect(log).not.toContain('leaf:willShow');
		expect(log).not.toContain('layout:willShow');
	});
});

describe('Router transitions — nested sibling swap (only the leaf animates)', () => {
	it('the leaf plays out→in; the reused parent fires no hide/show hooks', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Parent = makeLayout('parent', log); // shell, no root layout on the route
		const One = makeView('one', log);
		const Two = makeView('two', log);
		const routes = [
			{
				path: '/p',
				name: 'p',
				view: Parent,
				children: [
					{ path: 'one', name: 'one', view: One },
					{ path: 'two', name: 'two', view: Two },
				],
			},
		];
		const { router, el } = await bootAt(routes, '/p/one');
		await settle();
		log.length = 0;

		const p = router.push('/p/two');
		await settle();
		await p;
		await settle();

		expect(el.querySelector('.parent .two')).not.toBeNull();
		expect(el.querySelector('.one')).toBeNull();

		// The leaf is the animator across the mid-chain swap.
		expect(log).toContain('one:willHide');
		expect(log).toContain('one:didHide');
		expect(log).toContain('one:destroyed');
		expect(log).toContain('two:willShow');
		expect(log).toContain('two:didShow');

		// The surviving parent shell never animates on a sibling swap.
		expect(log).not.toContain('parent:willHide');
		expect(log).not.toContain('parent:willShow');
		expect(log).not.toContain('parent:destroyed');
	});
});

describe('Router transitions — nested layout swap suppresses the whole fresh chain', () => {
	it('only the layout animates; fresh parent+leaf are suppressed, old chain torn down', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const LayoutA = makeLayout('la', log);
		const ParentA = makeLayout('pa', log);
		const LeafA = makeView('a', log);
		const LayoutB = makeLayout('lb', log);
		const ParentB = makeLayout('pb', log);
		const LeafB = makeView('b', log);
		const routes = [
			{
				path: '/a',
				name: 'a',
				layout: LayoutA,
				view: ParentA,
				children: [{ path: 'x', name: 'ax', view: LeafA }],
			},
			{
				path: '/b',
				name: 'b',
				layout: LayoutB,
				view: ParentB,
				children: [{ path: 'y', name: 'by', view: LeafB }],
			},
		];
		const { router, el } = await bootAt(routes, '/a/x');
		await settle();
		log.length = 0;

		const p = router.push('/b/y');
		await settle();
		await p;
		await settle();

		expect(el.querySelector('.lb .pb .b')).not.toBeNull();
		expect(el.querySelector('.la')).toBeNull();

		// Only the new layout enters; the entire fresh chain below it is suppressed.
		expect(log).toContain('lb:willShow');
		expect(log).toContain('lb:didShow');
		expect(log).not.toContain('pb:willShow');
		expect(log).not.toContain('b:willShow');

		// Old layout animated out as a unit; its inner chain went with it (no hooks).
		expect(log).toContain('la:willHide');
		expect(log).toContain('la:destroyed');
		expect(log).not.toContain('pa:willHide');
		expect(log).toContain('pa:destroyed');
		expect(log).toContain('a:destroyed');
	});
});

describe('Router transitions — depth interruption (D30)', () => {
	it('a shallow nav during a deeper pending-out tears down BOTH old units', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Shell = makeLayout('s', log); // parent shell with children
		const One = makeView('one', log);
		const Two = makeView('two', log);
		const Other = makeView('other', log);
		const routes = [
			{
				path: '/s',
				name: 's',
				layout: PlainLayout,
				view: Shell,
				children: [
					{ path: 'one', name: 'one', view: One },
					{ path: 'two', name: 'two', view: Two },
				],
			},
			{ path: '/other', name: 'other', layout: PlainLayout, view: Other },
		];
		const { router, el } = await bootAt(routes, '/s/one');
		await settle();
		log.length = 0;

		// /s/one → /s/two: mid-chain swap begins; the deep leaf 'one' animates out.
		const p1 = router.push('/s/two');
		await tick();
		expect(log).toEqual(['one:willHide']);

		// /other interrupts at depth 0 — its own old-animator is the Shell parent,
		// a DIFFERENT instance from the pending-out leaf 'one'. Both must go.
		const p2 = router.push('/other');
		await Promise.all([p1, p2]);
		await settle();

		expect(location.pathname).toBe('/other');
		expect(el.querySelector('.other')).not.toBeNull();
		expect(el.querySelector('.s')).toBeNull();

		// Deep pending-out leaf 'one': out cancelled (willHide, no didHide), destroyed.
		expect(log).toContain('one:willHide');
		expect(log).not.toContain('one:didHide');
		expect(log).toContain('one:destroyed');

		// The winner's own old-animator (Shell) torn down synchronously, no out hooks.
		expect(log).toContain('s:destroyed');
		expect(log).not.toContain('s:willHide');
		expect(log).not.toContain('s:willShow');

		// 'two' never took the screen.
		expect(log).not.toContain('two:mounted');
		expect(log).not.toContain('two:willShow');

		// 'other' won cleanly, once each.
		expect(log.filter((e) => e === 'other:mounted')).toHaveLength(1);
		expect(log.filter((e) => e === 'other:willShow')).toHaveLength(1);
		expect(log.filter((e) => e === 'other:didShow')).toHaveLength(1);
	});
});

describe('Router transitions — instant-finish environment (no WAAPI stub)', () => {
	it('sequences a full animated nav correctly with animations degraded to instant', async () => {
		// No installFakeAnimate(): jsdom has no Element.prototype.animate, so
		// animate.js degrades to an instant finish. The whole out→swap→in still
		// runs in order — proving the router never depends on a real WAAPI.
		const log = [];
		const Home = makeView('home', log); // declares in/out, but no WAAPI to run them
		const About = makeView('about', log);
		const LayoutA = makeLayout('la', log);
		const LayoutB = makeLayout('lb', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: LayoutA },
			{ path: '/other', name: 'other', view: About, layout: LayoutB },
		];
		const { router, el } = await boot(routes);
		await tick();
		log.length = 0;

		await router.push('/other'); // #swap awaits the layout's playOut + playIn
		await tick();

		expect(location.pathname).toBe('/other');
		expect(el.querySelector('.lb .about')).not.toBeNull();
		expect(el.querySelector('.la')).toBeNull();

		// Layout-swap ordering held even with instant animations.
		const iHide = log.indexOf('la:willHide');
		const iDestroyed = log.indexOf('la:destroyed');
		const iShow = log.indexOf('lb:willShow');
		expect(iHide).toBeGreaterThanOrEqual(0);
		expect(iDestroyed).toBeGreaterThan(iHide);
		expect(iShow).toBeGreaterThan(iDestroyed); // new layout in AFTER old torn down
		expect(log).not.toContain('about:willShow'); // inner view enter still suppressed
	});
});

describe('Router transitions — interruption reusing the pending-out subtree (D30)', () => {
	it('a nav back INTO an animating-out subtree rebuilds it fresh instead of reusing the doomed instance', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Shell = makeLayout('s', log); // parent shell with children
		const One = makeView('one', log);
		const Two = makeView('two', log);
		const Other = makeView('other', log);
		const routes = [
			{
				path: '/s',
				name: 's',
				layout: PlainLayout,
				view: Shell,
				children: [
					{ path: 'one', name: 'one', view: One },
					{ path: 'two', name: 'two', view: Two },
				],
			},
			{ path: '/other', name: 'other', layout: PlainLayout, view: Other },
		];
		const { router, el } = await bootAt(routes, '/s/one');
		await settle();
		log.length = 0;

		// /s/one → /other: keep=0 — the Shell (with 'one' inside) starts its OUT.
		const p1 = router.push('/other');
		await tick();
		expect(log).toEqual(['s:willHide']);

		// /s/two interrupts, wanting to land back inside the /s subtree. Naively it
		// would reuse the Shell instance — but that instance is the pending-out unit
		// and is destroyed on interruption. The clamp rebuilds the whole chain fresh.
		const p2 = router.push('/s/two');
		await Promise.all([p1, p2]);
		await settle();

		expect(location.pathname).toBe('/s/two');
		// A LIVE shell hosts the new leaf — not a blank slot on a destroyed shell.
		expect(el.querySelector('.s .two')).not.toBeNull();
		expect(el.querySelector('.one')).toBeNull();
		expect(el.querySelector('.other')).toBeNull();

		// The doomed shell: out cancelled (willHide, no didHide), destroyed; and a
		// SECOND shell mounted fresh as the winner's animator.
		expect(log).toContain('s:destroyed');
		expect(log.filter((e) => e === 's:mounted')).toHaveLength(1); // the fresh one
		expect(log.filter((e) => e === 's:willShow')).toHaveLength(1);
		// The fresh deep leaf rides along, suppressed (one-animator rule).
		expect(log).not.toContain('two:willShow');
		// 'other' lost without ever taking the screen.
		expect(log).not.toContain('other:mounted');
	});
});

// Strand recovery: a navigation that bumps the cancellation token but never
// completes must not wedge an in-flight transition. Two paths: (a) an UNMATCHED
// push is a warn-and-no-op — the token bump now happens only AFTER the match
// check, so it cancels nothing; (b) a MATCHED push whose gated data() rejects
// restores the stalled outgoing unit (cancels its out animation via
// animate.js cancelAnimations — WAAPI cancel clears the fill holding it
// invisible) and clears #pendingOut, since a failed navigation leaves #state —
// and therefore that unit — as the current view.
describe('Router transitions — incomplete navigations do not strand an in-flight out (strand fix)', () => {
	function flatRoutes(log, extra = []) {
		const One = makeView('one', log);
		const Two = makeView('two', log);
		return [
			{ path: '/', name: 'one', view: One, layout: PlainLayout },
			{ path: '/two', name: 'two', view: Two, layout: PlainLayout },
			...extra,
			// deliberately NO catch-all — '/missing' must be genuinely unmatched
		];
	}

	it('an unmatched push during an in-flight out phase does not cancel it — the navigation completes', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const { router, el } = await boot(flatRoutes(log));
		await settle();
		log.length = 0;

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const p = router.push('/two');
		await tick();
		expect(log).toEqual(['one:willHide']); // parked in its out phase

		// Unmatched mid-out: warns and no-ops WITHOUT bumping the token (the bump
		// sits after the match check) — the in-flight navigation stays valid.
		router.push('/missing');
		expect(warnSpy).toHaveBeenCalledWith('[puzzle] no route matched:', '/missing');

		await settle();
		await p;
		// Pre-fix: the bump made the in-flight nav #abandon post-playOut — 'one'
		// sat played-out (hidden) forever and 'two' never mounted.
		expect(el.querySelector('.two')).not.toBeNull();
		expect(el.querySelector('.one')).toBeNull();
		expect(router.current.path).toBe('/two');
		expect(log).toContain('two:mounted');
	});

	it('a same-path no-op push during an in-flight out phase leaves it untouched (no-op precedes any bump)', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const { router, el } = await boot(flatRoutes(log));
		await settle();
		log.length = 0;

		const p = router.push('/two');
		await tick();
		expect(log).toEqual(['one:willHide']); // parked in its out phase

		// '/' is still the COMMITTED path (#state moves only at the end of the
		// swap), so this is the FIX-2 no-op — it must return from push() BEFORE
		// #navigate's token bump, leaving the in-flight navigation valid.
		await router.push('/');

		await settle();
		await p;
		expect(el.querySelector('.two')).not.toBeNull();
		expect(el.querySelector('.one')).toBeNull();
		expect(router.current.path).toBe('/two');
	});

	it('a matched push whose data() rejects mid-out restores the outgoing view, clears the stall, and later navigation works', async () => {
		waapi = installFakeAnimate();
		const log = [];
		class Bad extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			destroyed() {
				log.push('bad:destroyed');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const routes = flatRoutes(log, [{ path: '/bad', name: 'bad', view: Bad, layout: PlainLayout }]);
		const { router, el } = await boot(routes);
		await settle();
		log.length = 0;

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const p1 = router.push('/two');
		await tick();
		expect(log).toEqual(['one:willHide']); // parked in its out phase
		const outAnim = waapi.animations.at(-1); // 'one's out animation, still running

		// Failure contract (unchanged): push() RESOLVES; the rejection is logged,
		// never thrown to the caller; the failing nav's own instance is destroyed.
		await router.push('/bad');
		expect(errSpy).toHaveBeenCalledWith('[puzzle] navigation data() failed:', expect.any(Error));
		expect(log).toContain('bad:destroyed');

		// Strand recovery: the out animation is cancelled (WAAPI cancel clears the
		// fill → 'one' is visually restored), which also resolves the doomed nav's
		// parked playOut so it abandons promptly, destroying its fresh 'two'.
		await p1;
		await tick();
		expect(outAnim.cancel).toHaveBeenCalled();
		expect(el.querySelector('.one')).not.toBeNull(); // the committed view, back on screen
		expect(el.querySelector('.two')).toBeNull();
		expect(log).toContain('two:destroyed');
		expect(router.current.route.name).toBe('one'); // #state never moved

		// #pendingOut was cleared → a subsequent normal navigation works (the
		// restored view's playOut memo is spent, so it swaps out instantly).
		await router.push('/two');
		await settle();
		expect(el.querySelector('.two')).not.toBeNull();
		expect(el.querySelector('.one')).toBeNull();
		expect(router.current.path).toBe('/two');
	});
});

// D61: location side effects (URL + title + history entry) now commit INSIDE the
// #swap #committing window, atomically with the incoming mount — in sequential mode
// that is AFTER the outgoing view's out animation settles. This closes the two
// early-commit holes D19 left open (phantom history entries + URL/view divergence).
describe('Router transitions — D61 atomic location commit (sequential)', () => {
	it('URL, title, history.length and current all stay OLD until the out settles, then flip together', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout, meta: { title: 'Home' } },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout, meta: { title: 'About' } },
		];
		const { router, el } = await boot(routes);
		await settle();
		expect(document.title).toBe('Home'); // initial nav committed the title
		log.length = 0;

		const lenBefore = history.length;
		const pushSpy = vi.spyOn(history, 'pushState');

		const p = router.push('/about');
		await tick();

		// Mid-out: NOTHING has committed — URL, title, history, current + DOM all OLD.
		expect(location.pathname).toBe('/');
		expect(document.title).toBe('Home');
		expect(history.length).toBe(lenBefore); // no phantom entry while fading out
		expect(pushSpy).not.toHaveBeenCalled();
		expect(router.current.route.name).toBe('home');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.about')).toBeNull();

		await settle();
		await p;

		// After the out settles: everything flips to the NEW route TOGETHER.
		expect(location.pathname).toBe('/about');
		expect(document.title).toBe('About');
		expect(history.length).toBe(lenBefore + 1);
		expect(pushSpy).toHaveBeenCalledTimes(1);
		expect(router.current.route.name).toBe('about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.home')).toBeNull();
	});

	it('a nav held in its out, then superseded by a REJECTING nav, commits NOTHING and restores the original (central case)', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const A = makeView('a', log);
		class Bad extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			destroyed() {
				log.push('bad:destroyed');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout, meta: { title: 'Home' } },
			{ path: '/a', name: 'a', view: A, layout: PlainLayout, meta: { title: 'A' } },
			{ path: '/bad', name: 'bad', view: Bad, layout: PlainLayout, meta: { title: 'Bad' } },
		];
		const { router, el } = await boot(routes);
		await settle();
		log.length = 0;

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const lenBefore = history.length;
		const pushSpy = vi.spyOn(history, 'pushState');

		// Nav A: /a begins, home animates out (parked on its out animation).
		const pA = router.push('/a');
		await tick();
		expect(log).toEqual(['home:willHide']);

		// Nav B: /bad's gated data() rejects — it never reaches #swap and, via strand
		// recovery, cancels home's out (restoring it) without committing anything.
		await router.push('/bad');
		expect(errSpy).toHaveBeenCalledWith('[puzzle] navigation data() failed:', expect.any(Error));

		// Nav A resumes from playOut, sees the bumped token, and abandons its fresh 'a'.
		await pA;
		await tick();

		// NEITHER A nor B committed: URL, title, history, current + DOM unchanged.
		expect(location.pathname).toBe('/');
		expect(document.title).toBe('Home');
		expect(history.length).toBe(lenBefore);
		expect(pushSpy).not.toHaveBeenCalled();
		expect(router.current.route.name).toBe('home');
		// Original view restored on screen; neither target ever mounted.
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();
		expect(el.querySelector('.bad')).toBeNull();
		expect(log).toContain('a:destroyed'); // A's fresh instance torn down
		errSpy.mockRestore();
	});

	it('a superseded push never creates a history entry — history.length grows by exactly 1 (the winner only)', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const A = makeView('a', log);
		const B = makeView('b', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/a', name: 'a', view: A, layout: PlainLayout },
			{ path: '/b', name: 'b', view: B, layout: PlainLayout },
		];
		const { router, el } = await boot(routes);
		await settle();
		log.length = 0;

		const lenBefore = history.length;
		const pushSpy = vi.spyOn(history, 'pushState');

		// Nav A held in home's out phase (never commits its pushState).
		const pA = router.push('/a');
		await tick();
		expect(log).toEqual(['home:willHide']);

		// Nav B supersedes A mid-out and WINS (no rejection).
		const pB = router.push('/b');
		await Promise.all([pA, pB]);
		await settle();

		expect(location.pathname).toBe('/b');
		expect(router.current.route.name).toBe('b');
		expect(el.querySelector('.b')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();
		// Exactly ONE history entry added (B's) — A's superseded push left no phantom.
		expect(pushSpy).toHaveBeenCalledTimes(1);
		expect(history.length).toBe(lenBefore + 1);
	});
});

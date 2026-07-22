// @vitest-environment jsdom
//
// Overlapping route transitions (v1.24, D56, constellation/doc/DOC-SPEC.md §26).
// Opt in with `{ transitionMode: 'overlap' }`: the old view's `out` and the new
// view's `in` play at the SAME time — the leaver is pinned in place
// (position:fixed at its measured rect) and torn down when its out settles, while
// the incoming chain mounts + commits immediately. Sequential mode
// (tests/router-transitions.test.js) is the regression net for the default path;
// here we assert the overlap-specific ordering, pinning, teardown, and
// interruption, and that sequential stays byte-identically ordered.
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

// A view that logs every lifecycle + enter/leave hook into a shared array, so
// ordering across both sides of a transition is one flat timeline. `animations`
// defaults to in+out; pass null/undefined to opt out.
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

// A plain shared layout that never animates on a view swap — its <Slot/> hosts
// the routed view, exercising the reuseLayout / patch-driven overlap path.
class PlainLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
	}
}

let routers = [];
let waapi = null;

async function boot(routes, options) {
	const el = container();
	const router = new Router(routes, options);
	routers.push(router);
	await router.start(el, ctx());
	return { router, el };
}

// Finish every outstanding fake animation and drain microtasks, repeatedly, so a
// whole out→settle→destroy chain resolves.
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

describe('Router overlap — new view mounts + commits while the old is still fading', () => {
	it('pins the leaver in place, mounts the newcomer, then tears the leaver down on out-settle', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout },
		];
		const { router, el } = await boot(routes, { transitionMode: 'overlap' });
		await settle(); // let home's initial enter finish
		log.length = 0;

		const p = router.push('/about');
		await tick();

		// URL committed AND the new view is already mounted while the OLD view's
		// out animation is still running (this is the overlap — in sequential mode
		// .about would NOT exist yet, see the guard test below).
		expect(location.pathname).toBe('/about');
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();

		const oldEl = el.querySelector('.home');
		expect(oldEl).not.toBeNull(); // leaver still connected, mid-fade

		// The leaver is pinned in place with inline styles ONLY (no wrapper) —
		// fixed at its measured rect (jsdom rects are 0), margin 0, no pointer events.
		expect(oldEl.style.position).toBe('fixed');
		expect(oldEl.style.pointerEvents).toBe('none');
		expect(oldEl.style.margin).toBe('0px');
		expect(oldEl.style.width).toBe('0px');
		expect(oldEl.style.height).toBe('0px');
		expect(oldEl.style.top).toBe('0px');
		expect(oldEl.style.left).toBe('0px');

		// out not settled yet: didHide/destroyed have not fired.
		expect(log).not.toContain('home:didHide');
		expect(log).not.toContain('home:destroyed');

		// Resolve the out animation → the leaver settles and is destroyed + removed.
		await settle();
		await p;

		expect(el.querySelector('.home')).toBeNull();
		expect(log).toContain('home:willHide');
		expect(log).toContain('home:didHide');
		expect(log).toContain('home:destroyed');
	});
});

describe('Router overlap — hook ordering in the overlap window', () => {
	it('willHide fires at out-start, BEFORE the new view mounts; didHide only after out settles', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout },
		];
		const { router, el } = await boot(routes, { transitionMode: 'overlap' });
		await settle();
		log.length = 0;

		const p = router.push('/about');
		await tick();

		// willHide (out-start) precedes the newcomer's mounted() — both happen in
		// the same synchronous #swap, out-start first.
		expect(log).toContain('home:willHide');
		expect(log).toContain('about:mounted');
		expect(log.indexOf('home:willHide')).toBeLessThan(log.indexOf('about:mounted'));

		// The leaver's didHide waits for the out to settle.
		expect(log).not.toContain('home:didHide');

		await settle();
		await p;

		expect(log).toContain('home:didHide');
		expect(el.querySelector('.about')).not.toBeNull();
		// Newcomer's enter still ran (fire-and-forget) during/after the fade.
		expect(log).toContain('about:willShow');
		expect(log).toContain('about:didShow');
	});
});

describe('Router overlap — sequential default is byte-identically ordered', () => {
	it('without transitionMode the old element is GONE before the new view mounts', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout },
		];
		// No transitionMode → sequential.
		const { router, el } = await boot(routes);
		await settle();
		log.length = 0;

		const p = router.push('/about');
		await tick();

		// Sequential + D61: neither the URL nor the new view has moved yet — the old
		// view is still animating out and location commits WITH the mount (the
		// opposite of overlap, where both .about and the new URL exist mid-fade).
		expect(location.pathname).toBe('/');
		expect(el.querySelector('.about')).toBeNull();
		expect(el.querySelector('.home')).not.toBeNull();
		// The leaver is NOT pinned in sequential mode (no inline positioning).
		expect(el.querySelector('.home').style.position).toBe('');
		expect(log).toEqual(['home:willHide']);

		await settle();
		await p;

		expect(location.pathname).toBe('/about'); // committed together with the swap
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

describe('Router overlap — interruption stays instant', () => {
	it('a nav arriving mid-overlap tears the still-fading leaver down synchronously; no double-destroy', async () => {
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
		const { router, el } = await boot(routes, { transitionMode: 'overlap' });
		await settle();
		log.length = 0;

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		// A→B overlaps: A pinned + fading, B already committed & mounted.
		const p1 = router.push('/b');
		await tick();
		expect(el.querySelector('.b')).not.toBeNull();
		expect(el.querySelector('.a')).not.toBeNull(); // A still fading
		expect(router.current.path).toBe('/b');

		// B→C interrupts mid-overlap. The still-fading A AND the just-committed B
		// are torn down synchronously (skipOut path); C commits.
		const p2 = router.push('/c');
		await Promise.all([p1, p2]);
		await settle();

		expect(location.pathname).toBe('/c');
		expect(router.current.path).toBe('/c');
		expect(el.querySelector('.c')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();
		expect(el.querySelector('.b')).toBeNull();

		// A's out was cancelled (willHide, no didHide), and it was destroyed EXACTLY
		// once — the stale leaver's own settle-handler must not double-free.
		expect(log).toContain('a:willHide');
		expect(log).not.toContain('a:didHide');
		expect(log.filter((e) => e === 'a:destroyed')).toHaveLength(1);
		expect(log.filter((e) => e === 'b:destroyed')).toHaveLength(1);

		// C won cleanly, once each.
		expect(log.filter((e) => e === 'c:mounted')).toHaveLength(1);
		expect(log.filter((e) => e === 'c:willShow')).toHaveLength(1);

		// No teardown error surfaced (no double-destroy throw).
		expect(errSpy).not.toHaveBeenCalled();
	});
});

describe('Router overlap — reused layout (patch-driven leaver removal)', () => {
	it('both view elements coexist during the fade inside the intact layout; leaver removed on settle', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const Shared = PlainLayout;
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: Shared },
			{ path: '/two', name: 'two', view: About, layout: Shared },
		];
		const { router, el } = await boot(routes, { transitionMode: 'overlap' });
		await settle();
		log.length = 0;

		const p = router.push('/two');
		await tick();

		// The shared layout stayed put; BOTH the old and new routed views exist at
		// once under it (the leaver pinned out of flow, the newcomer in the slot).
		expect(el.querySelectorAll('.layout')).toHaveLength(1);
		expect(el.querySelector('.layout .about')).not.toBeNull();
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.home').style.position).toBe('fixed');

		// The reused layout never animates on a view swap.
		expect(log).not.toContain('layout:willHide');

		await settle();
		await p;

		// Leaver torn down (patch's destroyAnimated + the router settle converge).
		expect(el.querySelector('.home')).toBeNull();
		expect(el.querySelector('.layout .about')).not.toBeNull();
		expect(log).toContain('home:didHide');
		expect(log).toContain('home:destroyed');
		expect(log.filter((e) => e === 'home:destroyed')).toHaveLength(1);
	});
});

describe('Router overlap — no animations declared (instant out, no errors)', () => {
	it('overlaps with instant out: newcomer commits, leaver gone, no pin errors', async () => {
		// No WAAPI stub and no animations field: playOut is a pure zero-duration
		// hook, so the out settles immediately — overlap degrades to an effectively
		// instant swap without breaking.
		const log = [];
		const Home = makeView('home', log, { animations: undefined });
		const About = makeView('about', log, { animations: undefined });
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout },
		];
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router, el } = await boot(routes, { transitionMode: 'overlap' });
		log.length = 0;

		await router.push('/about');
		await tick();

		expect(location.pathname).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.home')).toBeNull();
		expect(log).toContain('home:willHide');
		expect(log).toContain('home:destroyed');
		expect(log).toContain('about:mounted');
		expect(errSpy).not.toHaveBeenCalled();
	});
});

describe('Router overlap — D61 location commits without awaiting the out', () => {
	it('URL commits + the newcomer mounts while the leaver is still pinned and animating (no out await)', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout, meta: { title: 'Home' } },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout, meta: { title: 'About' } },
		];
		const { router, el } = await boot(routes, { transitionMode: 'overlap' });
		await settle();
		expect(document.title).toBe('Home');
		log.length = 0;

		const p = router.push('/about');
		await tick();

		// D61 in overlap mode: location (URL + title) commits AND the newcomer mounts
		// WITHOUT awaiting the leaver's out — byte-equivalent timing to before, since
		// overlap never awaited between the out-start and the mount.
		expect(location.pathname).toBe('/about');
		expect(document.title).toBe('About');
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
		const oldEl = el.querySelector('.home');
		expect(oldEl).not.toBeNull();
		expect(oldEl.style.position).toBe('fixed'); // still pinned + fading
		expect(log).not.toContain('home:didHide'); // out has NOT settled yet

		await settle();
		await p;
		expect(el.querySelector('.home')).toBeNull();
		expect(log).toContain('home:didHide');
	});
});

describe('Router overlap — config validation (mirrors the unknown-mode throw)', () => {
	it('rejects an unknown transitionMode at construction', () => {
		const routes = [{ path: '/', name: 'home', view: PlainLayout }];
		expect(() => new Router(routes, { transitionMode: 'crossfade' })).toThrow(
			/unknown transitionMode: "crossfade"/
		);
	});

	it("accepts 'sequential' and 'overlap' without throwing", () => {
		const routes = [{ path: '/', name: 'home', view: PlainLayout }];
		expect(() => new Router(routes, { transitionMode: 'sequential' })).not.toThrow();
		expect(() => new Router(routes, { transitionMode: 'overlap' })).not.toThrow();
		expect(() => new Router(routes)).not.toThrow(); // default
	});

	it('rejects an unknown route-level transitionMode at construction', () => {
		const routes = [{ path: '/', name: 'home', view: PlainLayout, transitionMode: 'crossfade' }];
		expect(() => new Router(routes)).toThrow(/unknown transitionMode: "crossfade" on route "\/"/);
	});

	it('rejects an unknown transitionMode on a CHILD route at construction', () => {
		const routes = [
			{
				path: '/settings',
				name: 'settings',
				view: PlainLayout,
				children: [{ path: 'x', name: 'x', view: PlainLayout, transitionMode: 'nope' }],
			},
		];
		expect(() => new Router(routes)).toThrow(/unknown transitionMode: "nope" on route "x"/);
	});
});

// ---- D65: per-route / per-view transitionMode override (amends D56) --------
//
// Three tiers, most specific first: (1) a `transitionMode` field on a route/
// child-route definition, nearest-defined walking the DESTINATION chain leaf →
// root (same walk #setTitle uses for meta.title); (2) a `transitionMode` field
// on the incoming animator's VIEW or LAYOUT class; (3) the app-level
// constructor default. Resolution is DESTINATION-ONLY — the outgoing view/
// route is never consulted, so a navigation and its reverse can resolve
// differently.
describe('Router overlap — D65 per-route/per-view transitionMode', () => {
	it('a route-level transitionMode overrides the app-level default', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		const About = makeView('about', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: About, layout: PlainLayout, transitionMode: 'overlap' },
		];
		const { router, el } = await boot(routes); // no app-level transitionMode → sequential
		await settle();
		log.length = 0;

		const p = router.push('/about');
		await tick();

		// Overlap even though the app default is sequential: the route's own
		// transitionMode won.
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.home')).not.toBeNull(); // leaver still pinned/fading
		expect(el.querySelector('.home').style.position).toBe('fixed');

		await settle();
		await p;
	});

	it('a view-level transitionMode field overrides the app-level default when no route sets one', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		class OverlapAbout extends makeView('about', log) {
			transitionMode = 'overlap';
		}
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: OverlapAbout, layout: PlainLayout },
		];
		const { router, el } = await boot(routes); // app default sequential
		await settle();
		log.length = 0;

		const p = router.push('/about');
		await tick();

		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.home').style.position).toBe('fixed');

		await settle();
		await p;
	});

	it('a route-level transitionMode takes precedence over the view-level field when both are set', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const Home = makeView('home', log);
		class OverlapAbout extends makeView('about', log) {
			transitionMode = 'overlap';
		}
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			// Route says sequential; the view's own field and the app default both
			// say overlap — the route-level value must still win.
			{
				path: '/about',
				name: 'about',
				view: OverlapAbout,
				layout: PlainLayout,
				transitionMode: 'sequential',
			},
		];
		const { router, el } = await boot(routes, { transitionMode: 'overlap' });
		await settle();
		log.length = 0;

		const p = router.push('/about');
		await tick();

		expect(el.querySelector('.about')).toBeNull(); // sequential: not mounted yet
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.home').style.position).toBe('');

		await settle();
		await p;
		expect(el.querySelector('.about')).not.toBeNull();
	});

	it('is destination-only: A→B overlaps (B declares it) but the reverse B→A does not (A declares nothing)', async () => {
		waapi = installFakeAnimate();
		const log = [];
		const A = makeView('a', log);
		const B = makeView('b', log);
		const routes = [
			{ path: '/', name: 'a', view: A, layout: PlainLayout }, // no transitionMode
			{ path: '/b', name: 'b', view: B, layout: PlainLayout, transitionMode: 'overlap' },
		];
		const { router, el } = await boot(routes); // app default sequential
		await settle();
		log.length = 0;

		// A → B: B is the destination and declares overlap.
		const p1 = router.push('/b');
		await tick();
		expect(el.querySelector('.b')).not.toBeNull();
		expect(el.querySelector('.a')).not.toBeNull(); // still fading — overlap
		await settle();
		await p1;
		log.length = 0;

		// B → A: A is now the destination and declares nothing — B's earlier
		// declaration has no bearing on this direction, so it falls to the app
		// default (sequential).
		const p2 = router.push('/');
		await tick();
		expect(el.querySelector('.a')).toBeNull(); // sequential: not mounted yet
		expect(el.querySelector('.b')).not.toBeNull(); // still awaiting its own out
		await settle();
		await p2;
		expect(el.querySelector('.a')).not.toBeNull();
	});

	it("resolves transitionMode off the incoming LAYOUT on a layout swap (layouts are PuzzleView subclasses too)", async () => {
		waapi = installFakeAnimate();
		class LayoutA extends PuzzleView {
			animations = { in: IN, out: OUT };
			render() {
				return h('puzzle-view', { class: 'layout-a' }, [h('main', {}, [slot()])]);
			}
		}
		class LayoutB extends PuzzleView {
			transitionMode = 'overlap';
			render() {
				return h('puzzle-view', { class: 'layout-b' }, [h('main', {}, [slot()])]);
			}
		}
		const log = [];
		const Home = makeView('home', log);
		const Other = makeView('other', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: LayoutA },
			{ path: '/other', name: 'other', view: Other, layout: LayoutB },
		];
		const { router, el } = await boot(routes); // app default sequential
		await settle();
		log.length = 0;

		const p = router.push('/other');
		await tick();

		// LayoutB is the fresh/incoming animator for this layout swap — its own
		// transitionMode field ('overlap') governs, not the app default.
		expect(el.querySelector('.layout-b')).not.toBeNull();
		expect(el.querySelector('.layout-a')).not.toBeNull(); // old layout still fading

		await settle();
		await p;
		expect(el.querySelector('.layout-a')).toBeNull();
	});

	it("a parent route's transitionMode applies to a child that declares none, even though only the child level animates", async () => {
		waapi = installFakeAnimate();
		const log = [];
		function makeShell(name) {
			return class extends PuzzleView {
				render() {
					return h('puzzle-view', { class: name }, [
						h('section', { class: name + '-outlet' }, [slot()]),
					]);
				}
			};
		}
		const Settings = makeShell('settings');
		const Profile = makeView('profile', log);
		const Billing = makeView('billing', log);
		const routes = [
			{
				path: '/settings',
				name: 'settings',
				layout: PlainLayout,
				view: Settings,
				transitionMode: 'overlap', // set on the PARENT only
				children: [
					{ path: 'profile', name: 'profile', view: Profile },
					{ path: 'billing', name: 'billing', view: Billing },
				],
			},
		];
		history.replaceState({}, '', '/settings/profile');
		const { router, el } = await boot(routes); // app default sequential
		await settle();
		log.length = 0;

		const p = router.push('/settings/billing');
		await tick();

		// The settings SHELL is reused (same class+key); only profile→billing
		// swaps. Neither child declares transitionMode — the leaf→root walk finds
		// it on the PARENT 'settings' node instead, so this still overlaps.
		expect(el.querySelectorAll('.settings')).toHaveLength(1);
		expect(el.querySelector('.settings-outlet .billing')).not.toBeNull();
		expect(el.querySelector('.profile')).not.toBeNull(); // leaver still fading

		await settle();
		await p;
		expect(el.querySelector('.profile')).toBeNull();
	});

	it('an invalid view-level transitionMode warns once and falls through the cascade instead of throwing', async () => {
		waapi = installFakeAnimate();
		const log = [];
		class BadAbout extends makeView('about', log) {
			transitionMode = 'crossfade'; // not a real mode
		}
		const Home = makeView('home', log);
		const routes = [
			{ path: '/', name: 'home', view: Home, layout: PlainLayout },
			{ path: '/about', name: 'about', view: BadAbout, layout: PlainLayout },
		];
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { router, el } = await boot(routes); // app default sequential
		await settle();
		log.length = 0;

		const p = router.push('/about');
		await tick();

		// Falls through to the app default (sequential) instead of crashing.
		expect(el.querySelector('.about')).toBeNull();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('unknown transitionMode "crossfade"')
		);

		await settle();
		await p;
		expect(el.querySelector('.about')).not.toBeNull();
	});
});

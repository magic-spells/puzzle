// @vitest-environment jsdom
//
// Router morph handler slot (v1.23, D55). The router exposes ONE narrow,
// morph-agnostic seam — setMorphHandler({ enter, leave }) — and these tests
// pin its contract with a STUB handler (the real pairing logic lives in
// client-runtime/morph.js on top of @magic-spells/morph-engine and is
// verified through the examples/kanban-morph demo):
//   - enter fires synchronously after every committed swap mounts, with the
//     animator's element and { initial } flagging navigation #0 (deep links
//     never morph);
//   - leave fires as the outgoing unit's out phase starts, and a returned
//     promise is awaited BEFORE that unit is destroyed and the incoming chain
//     mounts (the sequential-transition rule extended to morphs);
//   - params-only navigations (keep === chain length) never reach #swap, so
//     neither hook fires — a dialog re-pointed at new content in place is the
//     handler's own guard problem, not a transition;
//   - a throwing handler is logged and swallowed — navigation must not wedge.
// Memory mode throughout (no jsdom history gymnastics), same conventions as
// router-memory.test.js: hand-written render() stand-ins, routers tracked and
// stop()ped in afterEach.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleApp } from '../client-runtime/app.js';
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

// A parent view hosting its routed child at <Slot/>, logging lifecycle into a
// shared timeline so hook/destroy/mount ordering reads as one flat array.
function makeHost(name, log) {
	return class extends PuzzleView {
		mounted() {
			log.push(`${name}:mounted`);
		}
		destroyed() {
			log.push(`${name}:destroyed`);
		}
		render() {
			return h('puzzle-view', { class: name }, [h('main', {}, [slot()])]);
		}
	};
}

function makeLeaf(name, log) {
	return class extends PuzzleView {
		mounted() {
			log.push(`${name}:mounted`);
		}
		destroyed() {
			log.push(`${name}:destroyed`);
		}
		render() {
			return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
		}
	};
}

describe('router morph handler (v1.23, D55)', () => {
	let routers;
	let log;

	beforeEach(() => {
		routers = [];
		log = [];
		document.body.innerHTML = '';
	});

	afterEach(() => {
		for (const r of routers) r.stop();
		vi.restoreAllMocks();
	});

	// Board hosts an index child and a task/:taskId child — the exact nested
	// shape a morphing dialog app has (the board stays mounted, the dialog
	// swaps in its Slot).
	function makeRouter() {
		const Board = makeHost('board', log);
		const Empty = makeLeaf('empty', log);
		const Dialog = makeLeaf('dialog', log);
		const routes = [
			{
				path: '/',
				name: 'board',
				view: Board,
				children: [
					{ path: '', name: 'board-index', view: Empty },
					{ path: 'task/:taskId', name: 'task', view: Dialog },
				],
			},
		];
		const router = new Router(routes, { mode: 'memory' });
		routers.push(router);
		return router;
	}

	it('fires enter with initial:true on navigation #0, with the mounted element', async () => {
		const router = makeRouter();
		const enter = vi.fn();
		router.setMorphHandler({ enter, leave: () => null });

		await router.start(container(), ctx());

		expect(enter).toHaveBeenCalledTimes(1);
		const [el, meta] = enter.mock.calls[0];
		expect(meta).toEqual({ initial: true });
		expect(el).toBeInstanceOf(Element);
		expect(el.isConnected).toBe(true);
	});

	it('fires enter with initial:false and the swapped animator element on push', async () => {
		const router = makeRouter();
		const enter = vi.fn();
		router.setMorphHandler({ enter, leave: () => null });

		await router.start(container(), ctx());
		await router.push('/task/7');

		expect(enter).toHaveBeenCalledTimes(2);
		const [el, meta] = enter.mock.calls[1];
		expect(meta).toEqual({ initial: false });
		// The animator for a child swap is the swapped view itself, not the host.
		expect(el.classList.contains('dialog')).toBe(true);
		expect(el.isConnected).toBe(true);
	});

	it('awaits a promise returned by leave BEFORE destroying the outgoing unit and mounting the next', async () => {
		const router = makeRouter();
		let release;
		const gate = new Promise((r) => (release = r));
		router.setMorphHandler({
			enter: () => {},
			// Gate ONLY the dialog's exit — leave also fires for the index view
			// swapping out on the way IN (empty → dialog), and a pending promise
			// there would park that navigation instead.
			leave: (el) => {
				log.push(`leave:${el.classList[0]}`);
				return el.classList.contains('dialog') ? gate : null;
			},
		});

		await router.start(container(), ctx());
		await router.push('/task/7');
		log.length = 0;

		const nav = router.push('/');
		await tick();
		// The out phase is parked on our promise: leave has fired, the dialog is
		// still alive and in the DOM, nothing new has mounted.
		expect(log).toEqual(['leave:dialog']);
		expect(document.querySelector('.dialog')).not.toBeNull();

		release();
		await nav;
		expect(log).toEqual(['leave:dialog', 'dialog:destroyed', 'empty:mounted']);
	});

	it('fires neither hook on a params-only navigation', async () => {
		const router = makeRouter();
		const enter = vi.fn();
		const leave = vi.fn(() => null);
		router.setMorphHandler({ enter, leave });

		await router.start(container(), ctx());
		await router.push('/task/7');
		enter.mockClear();
		leave.mockClear();

		await router.push('/task/8'); // same chain, new params — no swap
		expect(enter).not.toHaveBeenCalled();
		expect(leave).not.toHaveBeenCalled();
	});

	it('logs and survives a throwing handler on both hooks', async () => {
		const router = makeRouter();
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		router.setMorphHandler({
			enter: () => {
				throw new Error('enter boom');
			},
			leave: () => {
				throw new Error('leave boom');
			},
		});

		await router.start(container(), ctx());
		await router.push('/task/7');
		await router.push('/');

		// Both directions completed: the dialog swapped in and back out.
		expect(document.querySelector('.empty')).not.toBeNull();
		expect(document.querySelector('.dialog')).toBeNull();
		expect(errors).toHaveBeenCalled();
	});

	it('PuzzleApp.setMorphHandler stashes PRE-mount and forwards when the router is built', async () => {
		// enableMorph(app) is naturally called right after `new PuzzleApp(...)`,
		// but the Router only exists inside mount() — the app-level stash is what
		// makes that ordering legal.
		const Home = makeLeaf('home', log);
		const app = new PuzzleApp({
			target: container(),
			routes: [{ path: '/', name: 'home', view: Home }],
			routerMode: 'memory',
		});
		const enter = vi.fn();
		app.setMorphHandler({ enter, leave: () => null }); // router is still null here

		await app.mount();
		expect(enter).toHaveBeenCalledTimes(1);
		expect(enter.mock.calls[0][1]).toEqual({ initial: true });
		app.unmount();
	});

	it('is byte-identical without a handler (and unregisters via null)', async () => {
		const router = makeRouter();
		const enter = vi.fn();
		router.setMorphHandler({ enter, leave: () => null });
		router.setMorphHandler(null);

		await router.start(container(), ctx());
		await router.push('/task/7');
		await router.push('/');

		expect(enter).not.toHaveBeenCalled();
		expect(document.querySelector('.empty')).not.toBeNull();
	});
});

// Supersession while the outgoing unit is still animating out (v1.23, D55 —
// post-review ordering fix). The bug: with `await playOut(); await morphOut;
// tokenCheck`, a navigation superseded during its own out phase only abandons
// AFTER its morph-leave promise settles — a never-settling engine promise would
// strand (leak) the loser's fresh instances forever. The fix checks the token
// immediately after playOut(), BEFORE awaiting the fly-back, so the loser bails
// promptly. Driven with the controllable fake WAAPI so playOut() stays pending
// until the WINNING navigation's destroy cancels it (real WAAPI is instant here).
describe('router morph — supersession during the out phase (v1.23, D55)', () => {
	let routers;
	let log;
	let waapi;

	beforeEach(() => {
		routers = [];
		log = [];
		document.body.innerHTML = '';
		waapi = installFakeAnimate();
	});

	afterEach(() => {
		for (const r of routers) r.stop();
		waapi.uninstall();
		vi.restoreAllMocks();
	});

	const OUT = { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 };

	// Flat animated leaf: an `out` spec makes playOut() await the (deferred) fake
	// animation, so an interrupting navigation catches it mid-out.
	function animatedLeaf(name) {
		return class extends PuzzleView {
			animations = { out: OUT };
			destroyed() {
				log.push(`${name}:destroyed`);
			}
			render() {
				return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
			}
		};
	}

	it('abandons the superseded nav without awaiting a never-settling morph promise, and lands on the last target', async () => {
		const routes = [
			{ path: '/a', name: 'a', view: animatedLeaf('a') },
			{ path: '/b', name: 'b', view: animatedLeaf('b') },
			{ path: '/c', name: 'c', view: animatedLeaf('c') },
		];
		const router = new Router(routes, { mode: 'memory', initialPath: '/a' });
		routers.push(router);

		// leave() returns a promise that NEVER settles (models a morph engine whose
		// hide() never resolves — e.g. because the winner cancelled the unit under it).
		let morphResolved = false;
		const neverSettles = new Promise(() => {}).then(() => {
			morphResolved = true;
		});
		router.setMorphHandler({ enter: () => {}, leave: () => neverSettles });

		await router.start(container(), ctx());

		// Nav A: /a → /b. 'a' begins its (fake, deferred) out animation and leave()
		// is called; playOut() PARKS because finishAll() is never invoked here.
		const navToB = router.push('/b');
		await tick();
		expect(document.querySelector('.a')).not.toBeNull(); // still animating out
		expect(log).not.toContain('b:destroyed');

		// Nav B supersedes: push('/c') bumps the token; its #swap sees 'a' as the
		// pending-out unit and destroys it (cancelling the fake animation → 'a's
		// playOut() resolves), then mounts 'c'.
		const navToC = router.push('/c');
		await navToC;
		// The superseded Nav A resumes from playOut(), sees the bumped token, and
		// abandons at the post-playOut check — WITHOUT ever awaiting the morph promise.
		await navToB;
		await tick();

		// Landed on the last target, nothing wedged.
		expect(router.current.path).toBe('/c');
		expect(document.querySelector('.c')).not.toBeNull();
		// The superseded nav's fresh instance ('b') was torn down promptly...
		expect(log).toContain('b:destroyed');
		// ...and the never-settling morph promise was never awaited (still pending).
		expect(morphResolved).toBe(false);
	});
});

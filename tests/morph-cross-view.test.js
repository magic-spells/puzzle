// @vitest-environment jsdom
//
// Cross-view (sibling-swap) shared-element morph capture flights (v1.35, D68).
//
// D55 pairs two LIVE `data-puzzle-morph` elements across a swap — but only when
// both coexist in the DOM (a nested-route dialog: the source card stays mounted).
// A SIBLING view swap (Library → Album) destroys the source view — and its card —
// BEFORE the destination mounts, so there is never a pairing moment. D68 bridges
// it with a CLONE: leave() snapshots the outgoing subtree's morph elements while
// they are still measurable, and enter() flies a position:fixed clone from the
// snapshot rect into the freshly mounted counterpart — in BOTH directions (a
// back/forward pop captures the same way from the leaving side).
//
// These tests drive the REAL enableMorph (client-runtime/morph.js) over a mocked
// @magic-spells/morph-engine, in memory mode (no jsdom history gymnastics), same
// conventions as router-morph.test.js. jsdom has no layout, so getClientRects()/
// getBoundingClientRect() are stubbed to report a fixed nonzero rect for connected
// elements (restored per test) — otherwise every "measurable" guard fails.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { enableMorph } from '../client-runtime/morph.js';
import { installFakeAnimate } from './helpers/fake-waapi.js';

// A fake MorphEngine defined INSIDE the mock factory (vi.mock is hoisted above the
// test-file body, so it can't close over anything declared here). enableMorph
// RETURNS the engine it constructs, so tests reach the instance through that return
// value — no external registry needed. show()/hide() return promises the test
// resolves by hand (settleLastShow); every call is recorded for assertions.
vi.mock('@magic-spells/morph-engine', () => {
	class FakeMorphEngine {
		constructor(opts) {
			this.opts = opts;
			this.state = 'idle';
			this.shows = [];
			this.hides = [];
			this.stopCalls = 0;
		}
		show(opts) {
			this.state = 'shown';
			let resolve;
			const promise = new Promise((r) => (resolve = r));
			this.shows.push({ opts, resolve, promise });
			return promise;
		}
		hide() {
			this.state = 'hiding';
			let resolve;
			const promise = new Promise((r) => (resolve = r));
			this.hides.push({ resolve, promise });
			return promise;
		}
		stop() {
			this.state = 'idle';
			this.stopCalls += 1;
		}
		// Test helper: settle the most recent show() (default true = we landed).
		settleLastShow(value = true) {
			const rec = this.shows[this.shows.length - 1];
			rec.resolve(value);
		}
	}
	return { MorphEngine: FakeMorphEngine };
});

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

// A flat leaf view carrying a single morph element (id `mid`), plus an optional
// out animation so playOut() parks under the fake WAAPI (used by the click test).
function morphLeaf(cls, mid, { animated = false } = {}) {
	return class extends PuzzleView {
		animations = animated ? { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } } : undefined;
		render() {
			return h('puzzle-view', { class: cls }, [
				h('div', { 'data-puzzle-morph': mid, class: `${cls}-art` }, [text(cls)]),
			]);
		}
	};
}

// A leaf whose sole morph element is a `-target` (D69) — receives ONLY, never a
// SOURCE; the id lives in the `${attr}-target` attribute value. `attr` overrides the
// base; `animated` parks the leaving-side out phase under the fake WAAPI.
function targetLeaf(cls, mid, { attr = 'data-puzzle-morph', animated = false } = {}) {
	return class extends PuzzleView {
		animations = animated ? { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } } : undefined;
		render() {
			return h('puzzle-view', { class: cls }, [
				h('div', { [`${attr}-target`]: mid, class: `${cls}-art` }, [text(cls)]),
			]);
		}
	};
}

// A leaf whose sole morph element is a `-trigger` (D69) — launches ONLY, never a
// landing; the id lives in the `${attr}-trigger` attribute value. `attr` overrides
// the base; `animated` parks the leaving-side out phase under the fake WAAPI.
function triggerLeaf(cls, mid, { attr = 'data-puzzle-morph', animated = false } = {}) {
	return class extends PuzzleView {
		animations = animated ? { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } } : undefined;
		render() {
			return h('puzzle-view', { class: cls }, [
				h('div', { [`${attr}-trigger`]: mid, class: `${cls}-art` }, [text(cls)]),
			]);
		}
	};
}

// A leaf with NO morph element (destination that mounts its morph target late, or
// never).
function bareLeaf(cls) {
	return class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: cls }, [text(cls)]);
		}
	};
}

// A leaf carrying `count` launch-eligible elements that all share the SAME id `mid`
// under `attr` (plain by default, or a `-trigger` role) — the repeated-component
// collision the duplicate-id guard catches.
function dupLeaf(cls, mid, count = 2, attr = 'data-puzzle-morph') {
	return class extends PuzzleView {
		render() {
			return h(
				'puzzle-view',
				{ class: cls },
				Array.from({ length: count }, (_, i) =>
					h('div', { [attr]: mid, class: `${cls}-art-${i}` }, [text(`${cls}${i}`)])
				)
			);
		}
	};
}

// A leaf where the SAME id appears twice — a PLAIN element first in document order
// and a `-target` element later. The endorsed "featured twice" shape: an artist's
// big header art is the `-target` destination, and the same artist re-appears as a
// plain card lower on the page. Landing must prefer the `-target` element.
function featuredTwiceLeaf(cls, mid) {
	return class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: cls }, [
				h('div', { 'data-puzzle-morph': mid, class: `${cls}-plain` }, [text('PLAIN')]),
				h('div', { 'data-puzzle-morph-target': mid, class: `${cls}-marked` }, [text('TARGET')]),
			]);
		}
	};
}

const RECT = { top: 10, left: 20, width: 100, height: 80, right: 120, bottom: 90, x: 20, y: 10 };

describe('cross-view capture flights (v1.35, D68)', () => {
	let apps;
	let origGCR;
	let origGBCR;

	beforeEach(() => {
		apps = [];
		document.body.innerHTML = '';
		origGCR = Element.prototype.getClientRects;
		origGBCR = Element.prototype.getBoundingClientRect;
		// jsdom has no layout: connected elements report a fixed nonzero rect,
		// detached ones report none (matches the real "measurable" contract).
		Element.prototype.getClientRects = function () {
			return this.isConnected ? [{ ...RECT }] : [];
		};
		Element.prototype.getBoundingClientRect = function () {
			return { ...RECT };
		};
	});

	afterEach(() => {
		for (const app of apps) {
			try {
				app.unmount();
			} catch {
				/* already torn down */
			}
		}
		Element.prototype.getClientRects = origGCR;
		Element.prototype.getBoundingClientRect = origGBCR;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// Mount a memory-mode app with enableMorph wired, at `initialPath`.
	async function mountApp(routes, initialPath, morphOptions) {
		const app = new PuzzleApp({
			target: container(),
			routes,
			routerMode: 'memory',
			routerInitialPath: initialPath,
		});
		apps.push(app);
		const engine = enableMorph(app, morphOptions);
		await app.mount();
		return { app, engine };
	}

	it('forward sibling swap flies a clone from the leaving rect into the entering element', async () => {
		const routes = [
			{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
			{ path: '/b', name: 'b', view: morphLeaf('b', 'art-1') },
		];
		const { app, engine } = await mountApp(routes, '/a');

		const aArt = document.querySelector('.a-art');
		await app.router.push('/b');

		const bArt = document.querySelector('.b-art');
		expect(engine.shows).toHaveLength(1);
		const { from, to } = engine.shows[0].opts;

		// from is a CLONE — not the (destroyed) source, connected under body,
		// attribute stripped, position:fixed pinned at the captured rect.
		expect(from).not.toBe(aArt);
		expect(from.isConnected).toBe(true);
		expect(from.parentNode).toBe(document.body);
		expect(from.hasAttribute('data-puzzle-morph')).toBe(false);
		expect(from.style.position).toBe('fixed');
		expect(from.style.top).toBe('10px');
		expect(from.style.left).toBe('20px');
		expect(from.style.width).toBe('100px');
		// to is the entering element itself.
		expect(to).toBe(bArt);

		// One-shot unwind: settle the show → clone removed, engine.stop() on a true settle.
		engine.settleLastShow(true);
		await tick();
		expect(from.isConnected).toBe(false);
		expect(engine.stopCalls).toBe(1);
	});

	it('back navigation flies a fresh clone the other direction', async () => {
		const routes = [
			{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
			{ path: '/b', name: 'b', view: morphLeaf('b', 'art-1') },
		];
		const { app, engine } = await mountApp(routes, '/a');

		await app.router.push('/b');
		engine.settleLastShow(true);
		await tick();
		expect(engine.shows).toHaveLength(1);

		// Pop back to /a — the leaving B header art is captured and flown into the
		// re-mounted A element.
		const bArt = document.querySelector('.b-art');
		await app.router.back();

		expect(engine.shows).toHaveLength(2);
		const { from, to } = engine.shows[1].opts;
		expect(from).not.toBe(bArt);
		expect(from.hasAttribute('data-puzzle-morph')).toBe(false);
		expect(from.style.position).toBe('fixed');
		expect(to).toBe(document.querySelector('.a-art'));
	});

	it('live-pair (D55) precedence: a coexisting counterpart flies the REAL source, no clone, and leave flies back', async () => {
		// Board host keeps its card mounted while the dialog swaps into its Slot.
		const Board = class extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'board' }, [
					h('div', { 'data-puzzle-morph': 'art-1', class: 'card' }, [text('CARD')]),
					h('main', {}, [slot()]),
				]);
			}
		};
		const routes = [
			{
				path: '/',
				name: 'board',
				view: Board,
				children: [
					{ path: '', name: 'board-index', view: bareLeaf('empty') },
					{ path: 'task/:taskId', name: 'task', view: morphLeaf('dialog', 'art-1') },
				],
			},
		];
		const { app, engine } = await mountApp(routes, '/');

		const card = document.querySelector('.card');
		await app.router.push('/task/7');

		// Live pair wins: show's `from` is the REAL surviving card, not a clone.
		expect(engine.shows).toHaveLength(1);
		expect(engine.shows[0].opts.from).toBe(card);
		expect(engine.shows[0].opts.from.hasAttribute('data-puzzle-morph')).toBe(true);
		expect(engine.shows[0].opts.to).toBe(document.querySelector('.dialog-art'));

		// Closing flies BACK: intact round trip → engine.hide(), which the router
		// AWAITS before destroy, so resolve it to let the navigation complete.
		const closing = app.router.push('/');
		await tick();
		expect(engine.hides).toHaveLength(1);
		engine.hides[0].resolve(true);
		await closing;
	});

	it('deferred target: a morph element that mounts late is caught by the observer', async () => {
		const LateB = class extends PuzzleView {
			mounted() {
				// The real header art lands a beat after the skeleton mount.
				setTimeout(() => {
					const artEl = document.createElement('div');
					artEl.setAttribute('data-puzzle-morph', 'art-1');
					artEl.className = 'late-art';
					this.element.appendChild(artEl);
				}, 50);
			}
			render() {
				return h('puzzle-view', { class: 'lateb' }, [text('LATEB')]);
			}
		};
		const routes = [
			{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
			{ path: '/b', name: 'b', view: LateB },
		];
		const { app, engine } = await mountApp(routes, '/a');

		await app.router.push('/b');
		// Nothing measurable to fly INTO yet — no show, observer armed.
		expect(engine.shows).toHaveLength(0);

		// The late element appears → observer fires the capture flight.
		await new Promise((r) => setTimeout(r, 80));
		expect(engine.shows).toHaveLength(1);
		const { from, to } = engine.shows[0].opts;
		expect(from.hasAttribute('data-puzzle-morph')).toBe(false);
		expect(to).toBe(document.querySelector('.late-art'));
	});

	it('deferred target TTL: no target within 2s drops the snapshots and never flies (fake timers)', async () => {
		vi.useFakeTimers();
		try {
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
				{ path: '/b', name: 'b', view: bareLeaf('bareb') },
			];
			const app = new PuzzleApp({
				target: container(),
				routes,
				routerMode: 'memory',
				routerInitialPath: '/a',
			});
			apps.push(app);
			const engine = enableMorph(app);
			await app.mount();

			await app.router.push('/b');
			expect(engine.shows).toHaveLength(0);

			// TTL expires; the capture is discarded. A late target now must NOT fly.
			vi.advanceTimersByTime(2001);
			const artEl = document.createElement('div');
			artEl.setAttribute('data-puzzle-morph', 'art-1');
			document.querySelector('.bareb').appendChild(artEl);
			await Promise.resolve();
			vi.advanceTimersByTime(200);

			expect(engine.shows).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('click-pinned clone: a click before navigation pins a stand-in that becomes the show() from', async () => {
		const waapi = installFakeAnimate();
		try {
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1', { animated: true }) },
				{ path: '/b', name: 'b', view: morphLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			// Real click on the card art → the capture-phase document listener records it.
			const aArt = document.querySelector('.a-art');
			aArt.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			// Start the nav; A's out animation parks playOut() so we can observe the
			// pinned clone that leave() created BEFORE the destination mounts.
			const nav = app.router.push('/b');
			await tick();
			const pinned = [...document.body.children].find((c) => c.style && c.style.position === 'fixed');
			expect(pinned).toBeTruthy();
			expect(pinned.hasAttribute('data-puzzle-morph')).toBe(false);
			expect(document.querySelector('.b-art')).toBeNull(); // not mounted yet

			// Finish the out → mount B → enter reuses the pinned clone as the flight source.
			waapi.finishAll();
			await nav;

			expect(engine.shows).toHaveLength(1);
			expect(engine.shows[0].opts.from).toBe(pinned);
			expect(engine.shows[0].opts.to).toBe(document.querySelector('.b-art'));
		} finally {
			waapi.uninstall();
		}
	});

	it('reduced motion: no captures, no clones, no show for a sibling swap', async () => {
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		const routes = [
			{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
			{ path: '/b', name: 'b', view: morphLeaf('b', 'art-1') },
		];
		const { app, engine } = await mountApp(routes, '/a');

		await app.router.push('/b');

		expect(engine.shows).toHaveLength(0);
		expect([...document.body.children].some((c) => c.style && c.style.position === 'fixed')).toBe(false);
	});

	it('attribute override: capture flights use the custom attribute and ignore the default one', async () => {
		const A = class extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'a' }, [
					// A default-attribute element that must be ignored under the override.
					h('div', { 'data-puzzle-morph': 'ignored', class: 'default-art' }),
					h('div', { 'data-x': 'art-1', class: 'x-art' }, [text('A')]),
				]);
			}
		};
		const B = class extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'b' }, [h('div', { 'data-x': 'art-1', class: 'bx-art' })]);
			}
		};
		const routes = [
			{ path: '/a', name: 'a', view: A },
			{ path: '/b', name: 'b', view: B },
		];
		const { app, engine } = await mountApp(routes, '/a', { attribute: 'data-x' });

		await app.router.push('/b');

		expect(engine.shows).toHaveLength(1);
		const { from, to } = engine.shows[0].opts;
		// Flight uses the data-x element; the clone is stripped of data-x, not data-puzzle-morph.
		expect(from.hasAttribute('data-x')).toBe(false);
		expect(to).toBe(document.querySelector('.bx-art'));
	});

	it('no-enter cleanup: an unclaimed pinned clone is removed by its TTL (fake timers)', async () => {
		vi.useFakeTimers();
		try {
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
				{ path: '/b', name: 'b', view: bareLeaf('bareb') }, // no morph → nothing claims the capture
			];
			const app = new PuzzleApp({
				target: container(),
				routes,
				routerMode: 'memory',
				routerInitialPath: '/a',
			});
			apps.push(app);
			enableMorph(app);
			await app.mount();

			// Click the card so leave() pins a clone, then navigate to a morph-less view.
			document.querySelector('.a-art').dispatchEvent(new MouseEvent('click', { bubbles: true }));
			await app.router.push('/b');

			// The pinned clone exists (nothing consumed it — B has no morph element).
			const pinned = [...document.body.children].find((c) => c.style && c.style.position === 'fixed');
			expect(pinned).toBeTruthy();
			expect(pinned.isConnected).toBe(true);

			// Its 2s TTL fades (150ms) then removes it.
			vi.advanceTimersByTime(2001);
			vi.advanceTimersByTime(160);
			expect(pinned.isConnected).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not throw when document is absent (SSG prerender under node)', () => {
		// The click-listener registration is guarded by `typeof document !== 'undefined'`
		// so enableMorph is importable/callable under Node during static prerender.
		vi.stubGlobal('document', undefined);
		const fakeApp = { setMorphHandler: vi.fn() };
		expect(() => enableMorph(fakeApp)).not.toThrow();
		expect(fakeApp.setMorphHandler).toHaveBeenCalledTimes(1);
	});

	// D69 — three attributes over one id namespace. `data-puzzle-morph` (plain)
	// launches AND receives; `-trigger` launches only (never a landing); `-target`
	// receives only (the preferred landing on an id collision, never launches). All
	// three derive from the configured base.
	describe('three-attribute roles (D69)', () => {
		it('trigger → target flight works with the id in different attributes on each side', async () => {
			const routes = [
				{ path: '/a', name: 'a', view: triggerLeaf('a', 'art-1') },
				{ path: '/b', name: 'b', view: targetLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');

			const bArt = document.querySelector('.b-art');
			expect(engine.shows).toHaveLength(1);
			const { from, to } = engine.shows[0].opts;
			// A `-trigger` source launches a clone (all three role attrs stripped) into
			// the `-target` destination.
			expect(from).not.toBe(bArt);
			expect(from.hasAttribute('data-puzzle-morph-trigger')).toBe(false);
			expect(from.hasAttribute('data-puzzle-morph-target')).toBe(false);
			expect(from.style.position).toBe('fixed');
			expect(to).toBe(bArt);
		});

		it('a plain source flies INTO a -target counterpart (list→detail)', async () => {
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
				{ path: '/b', name: 'b', view: targetLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');

			expect(engine.shows).toHaveLength(1);
			expect(engine.shows[0].opts.to).toBe(document.querySelector('.b-art'));
		});

		it('a -target never launches: back-nav from a target-only view flies nothing, no clone', async () => {
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
				{ path: '/b', name: 'b', view: targetLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');
			engine.settleLastShow(true);
			await tick();
			expect(engine.shows).toHaveLength(1);

			// Back to /a: B's only morph element is a `-target` → excluded from the leave
			// snapshot scan, so no capture, no second flight, no pinned clone.
			await app.router.back();
			expect(engine.shows).toHaveLength(1);
			expect([...document.body.children].some((c) => c.style && c.style.position === 'fixed')).toBe(false);
			expect(document.querySelector('.a-art')).toBeTruthy();
		});

		it('a -trigger never receives: entering view with only a trigger flies nothing; the capture is cleaned up', async () => {
			vi.useFakeTimers();
			try {
				const routes = [
					{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
					{ path: '/b', name: 'b', view: triggerLeaf('b', 'art-1') },
				];
				const app = new PuzzleApp({
					target: container(),
					routes,
					routerMode: 'memory',
					routerInitialPath: '/a',
				});
				apps.push(app);
				const engine = enableMorph(app);
				await app.mount();

				await app.router.push('/b');
				// B's only morph element is a `-trigger` → not receive-eligible; nothing
				// to land on, so no flight (the deferred observer is armed instead).
				expect(engine.shows).toHaveLength(0);

				// TTL discards the capture. A `-target` added afterward must NOT fly.
				vi.advanceTimersByTime(2001);
				const late = document.createElement('div');
				late.setAttribute('data-puzzle-morph-target', 'art-1');
				document.querySelector('.b-art').appendChild(late);
				await Promise.resolve();
				vi.advanceTimersByTime(200);

				expect(engine.shows).toHaveLength(0);
			} finally {
				vi.useRealTimers();
			}
		});

		it('a -trigger is never picked as a live-pair TARGET', async () => {
			const Board = class extends PuzzleView {
				render() {
					return h('puzzle-view', { class: 'board' }, [
						// A live plain SOURCE stays mounted outside the swapping child.
						h('div', { 'data-puzzle-morph': 'art-1', class: 'card' }, [text('CARD')]),
						h('main', {}, [slot()]),
					]);
				}
			};
			const routes = [
				{
					path: '/',
					name: 'board',
					view: Board,
					children: [
						{ path: '', name: 'board-index', view: bareLeaf('empty') },
						// The entering child's only morph element is a `-trigger` → can't receive.
						{ path: 'task/:taskId', name: 'task', view: triggerLeaf('dialog', 'art-1') },
					],
				},
			];
			const { app, engine } = await mountApp(routes, '/');

			await app.router.push('/task/7');

			// The trigger is excluded from the entering receive scan → no live pair; the
			// leaving index has no morph element → no capture → no flight at all.
			expect(engine.shows).toHaveLength(0);
		});

		it('a -target is never picked as a live-pair SOURCE', async () => {
			const Board = class extends PuzzleView {
				render() {
					return h('puzzle-view', { class: 'board' }, [
						// The ONLY outside candidate is a `-target` → excluded as a source.
						h('div', { 'data-puzzle-morph-target': 'art-1', class: 'card' }, [text('CARD')]),
						h('main', {}, [slot()]),
					]);
				}
			};
			const routes = [
				{
					path: '/',
					name: 'board',
					view: Board,
					children: [
						{ path: '', name: 'board-index', view: bareLeaf('empty') },
						{ path: 'task/:taskId', name: 'task', view: morphLeaf('dialog', 'art-1') },
					],
				},
			];
			const { app, engine } = await mountApp(routes, '/');

			await app.router.push('/task/7');

			// Target card excluded from counterparts → no live pair; the leaving index
			// has no morph element → no capture → no flight at all.
			expect(engine.shows).toHaveLength(0);
		});

		it('featured-twice landing: a capture flight lands on the -target, not the earlier plain element', async () => {
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
				// Entering view: PLAIN (.b-plain) first in document order, `-target` (.b-marked) later.
				{ path: '/b', name: 'b', view: featuredTwiceLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');

			expect(engine.shows).toHaveLength(1);
			// `-target` destination wins the landing despite the plain element coming first.
			expect(engine.shows[0].opts.to).toBe(document.querySelector('.b-marked'));
		});

		it('live-pair landing priority: a live counterpart pairs into the -target entering element', async () => {
			const Board = class extends PuzzleView {
				render() {
					return h('puzzle-view', { class: 'board' }, [
						h('div', { 'data-puzzle-morph': 'art-1', class: 'card' }, [text('CARD')]),
						h('main', {}, [slot()]),
					]);
				}
			};
			// Dialog child: same id on a plain element (first) and a `-target` one (later).
			const Dialog = class extends PuzzleView {
				render() {
					return h('puzzle-view', { class: 'dialog' }, [
						h('div', { 'data-puzzle-morph': 'art-1', class: 'dialog-plain' }, [text('PLAIN')]),
						h('div', { 'data-puzzle-morph-target': 'art-1', class: 'dialog-marked' }, [text('TARGET')]),
					]);
				}
			};
			const routes = [
				{
					path: '/',
					name: 'board',
					view: Board,
					children: [
						{ path: '', name: 'board-index', view: bareLeaf('empty') },
						{ path: 'task/:taskId', name: 'task', view: Dialog },
					],
				},
			];
			const { app, engine } = await mountApp(routes, '/');

			const card = document.querySelector('.card');
			await app.router.push('/task/7');

			expect(engine.shows).toHaveLength(1);
			// Source is the real surviving card; destination is the `-target` entering element.
			expect(engine.shows[0].opts.from).toBe(card);
			expect(engine.shows[0].opts.to).toBe(document.querySelector('.dialog-marked'));
		});

		it('a click on a -trigger pins a clone that becomes the show() from', async () => {
			const waapi = installFakeAnimate();
			try {
				const routes = [
					{ path: '/a', name: 'a', view: triggerLeaf('a', 'art-1', { animated: true }) },
					{ path: '/b', name: 'b', view: targetLeaf('b', 'art-1') },
				];
				const { app, engine } = await mountApp(routes, '/a');

				// Click the `-trigger` art → launch-eligible → the click listener records it.
				document.querySelector('.a-art').dispatchEvent(new MouseEvent('click', { bubbles: true }));

				const nav = app.router.push('/b');
				await tick();
				const pinned = [...document.body.children].find((c) => c.style && c.style.position === 'fixed');
				expect(pinned).toBeTruthy();
				expect(pinned.hasAttribute('data-puzzle-morph-trigger')).toBe(false);

				waapi.finishAll();
				await nav;

				expect(engine.shows).toHaveLength(1);
				expect(engine.shows[0].opts.from).toBe(pinned);
				expect(engine.shows[0].opts.to).toBe(document.querySelector('.b-art'));
			} finally {
				waapi.uninstall();
			}
		});

		it('a click on a -target pins nothing during the out phase', async () => {
			// Leaving subtree has a PLAIN element (so captures is non-null and the
			// click-pin block is reached) plus a `-target` element that is the one
			// clicked — the launch-eligible guard must refuse to pin it.
			const ClickTarget = class extends PuzzleView {
				animations = { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } };
				render() {
					return h('puzzle-view', { class: 'a' }, [
						h('div', { 'data-puzzle-morph': 'keep', class: 'keep-art' }, [text('KEEP')]),
						h('div', { 'data-puzzle-morph-target': 'clicked', class: 'to-art' }, [text('TO')]),
					]);
				}
			};
			const waapi = installFakeAnimate();
			try {
				const routes = [
					{ path: '/a', name: 'a', view: ClickTarget },
					{ path: '/b', name: 'b', view: bareLeaf('bareb') },
				];
				const { app } = await mountApp(routes, '/a');

				document.querySelector('.to-art').dispatchEvent(new MouseEvent('click', { bubbles: true }));
				const nav = app.router.push('/b');
				await tick();

				// A clicked `-target` is not launch-eligible → nothing pinned.
				expect([...document.body.children].some((c) => c.style && c.style.position === 'fixed')).toBe(false);

				waapi.finishAll();
				await nav;
			} finally {
				waapi.uninstall();
			}
		});

		it('target in BOTH views: no flight in either direction', async () => {
			const routes = [
				{ path: '/a', name: 'a', view: targetLeaf('a', 'art-1') },
				{ path: '/b', name: 'b', view: targetLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');
			expect(engine.shows).toHaveLength(0);

			await app.router.back();
			expect(engine.shows).toHaveLength(0);
			expect([...document.body.children].some((c) => c.style && c.style.position === 'fixed')).toBe(false);
		});

		it('attribute override composes: data-x / data-x-trigger / data-x-target, default spellings ignored', async () => {
			const A = class extends PuzzleView {
				render() {
					// A `-trigger` under the override launches; a DEFAULT-spelled trigger is
					// unrecognized under data-x and must be ignored (no extra flight).
					return h('puzzle-view', { class: 'a' }, [
						h('div', { 'data-x-trigger': 'art-1', class: 'x-art' }, [text('A')]),
						h('div', { 'data-puzzle-morph-trigger': 'other', class: 'ignored-art' }, [text('X')]),
					]);
				}
			};
			const B = class extends PuzzleView {
				render() {
					return h('puzzle-view', { class: 'b' }, [
						h('div', { 'data-x-target': 'art-1', class: 'bx-art' }, [text('B')]),
					]);
				}
			};
			const routes = [
				{ path: '/a', name: 'a', view: A },
				{ path: '/b', name: 'b', view: B },
			];
			const { app, engine } = await mountApp(routes, '/a', { attribute: 'data-x' });

			// Forward: data-x-trigger launches into data-x-target; default spellings inert.
			await app.router.push('/b');
			expect(engine.shows).toHaveLength(1);
			expect(engine.shows[0].opts.to).toBe(document.querySelector('.bx-art'));
			engine.settleLastShow(true);
			await tick();

			// Reverse: B's only element is a data-x-target → never launches, capture suppressed.
			await app.router.back();
			expect(engine.shows).toHaveLength(1);
			expect([...document.body.children].some((c) => c.style && c.style.position === 'fixed')).toBe(false);
		});
	});

	// Warn-once misuse guard — a duplicate id among launch-eligible (plain / `-trigger`)
	// elements (the D43 formatter / D58 null-key posture). Warning only: the flight
	// behavior is asserted unchanged. Every spy filters to '[puzzle]'-prefixed calls so
	// unrelated framework warnings can't flake the assertions.
	describe('misuse warn-once guard', () => {
		// Only [puzzle]-prefixed console.warn calls (drop any unrelated framework noise).
		const puzzleWarns = (spy) => spy.mock.calls.filter((c) => String(c[0]).startsWith('[puzzle]'));

		it('duplicate PLAIN ids warn once (per guard, not per id) and first still wins', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const routes = [
				// Three colliding plain ids per view — one scan, but only one warning.
				{ path: '/a', name: 'a', view: dupLeaf('a', 'art-1', 3) },
				{ path: '/b', name: 'b', view: dupLeaf('b', 'art-1', 3) },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');

			const dupWarns = () => puzzleWarns(warn).filter((c) => /duplicate/.test(c[0]));
			expect(dupWarns()).toHaveLength(1);
			expect(dupWarns()[0][0]).toContain('art-1');

			// Behavior unchanged: a single flight still fires into B (first element won).
			expect(engine.shows).toHaveLength(1);
			expect(engine.shows[0].opts.to).toBe(document.querySelector('.b-art-0'));

			// A second navigation over the same collision does NOT re-warn.
			engine.settleLastShow(true);
			await tick();
			await app.router.back();
			expect(dupWarns()).toHaveLength(1);
		});

		it('duplicate -trigger ids also warn (launch-eligible collision)', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const routes = [
				// Two colliding `-trigger` ids in the leaving view.
				{ path: '/a', name: 'a', view: dupLeaf('a', 'art-1', 2, 'data-puzzle-morph-trigger') },
				{ path: '/b', name: 'b', view: targetLeaf('b', 'art-1') },
			];
			const { app } = await mountApp(routes, '/a');

			await app.router.push('/b');

			const dupWarns = puzzleWarns(warn).filter((c) => /duplicate/.test(c[0]));
			expect(dupWarns).toHaveLength(1);
			expect(dupWarns[0][0]).toContain('art-1');
		});

		it('no false positives: unique ids and a correct plain↔target pair warn zero times', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
				{ path: '/b', name: 'b', view: targetLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');
			engine.settleLastShow(true);
			await tick();
			await app.router.back();

			expect(puzzleWarns(warn)).toHaveLength(0);
		});

		it('endorsed pattern (-target destination + plain card, same id) warns zero times', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const routes = [
				{ path: '/a', name: 'a', view: morphLeaf('a', 'art-1') },
				// Detail view carries the `-target` header art AND a plain re-feature card,
				// both under the same artist id — the `-target` drops out of the launch maps.
				{ path: '/b', name: 'b', view: featuredTwiceLeaf('b', 'art-1') },
			];
			const { app, engine } = await mountApp(routes, '/a');

			await app.router.push('/b');

			// Flight still lands on the `-target` destination, and the shared id warned NOT once.
			expect(engine.shows[0].opts.to).toBe(document.querySelector('.b-marked'));
			expect(puzzleWarns(warn)).toHaveLength(0);
		});
	});
});

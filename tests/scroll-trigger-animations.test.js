// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

// Scroll-triggered enter animations (v1.40, D73, constellation/doc/DOC-SPEC.md §39).
// Same harness shape as tests/animations.test.js: a controllable fake WAAPI
// (deferred finished, manual finish(), cancel/pause/play spies) plus a
// controllable fake IntersectionObserver installed on globalThis with a helper
// to fire intersections. Globals are restored after each test.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

// Drain microtasks + the setTimeout(0) macrotask so awaited finished/release settle.
const tick = () => new Promise((r) => setTimeout(r, 0));

const IN = { from: { opacity: 0 }, to: { opacity: 1 }, duration: 200, easing: 'ease-out' };
const OUT = { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 };

// ---- controllable fake WAAPI (extended with pause()/play() spies) ------------
let fakeAnimations;

function installFakeAnimate() {
	fakeAnimations = [];
	Element.prototype.animate = function (keyframes, options) {
		let resolve, reject;
		const finished = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const anim = {
			keyframes,
			options,
			finished,
			finishedState: 'running',
			playState: 'running',
			finish() {
				this.finishedState = 'finished';
				resolve(this);
			},
			cancel: vi.fn(function () {
				this.finishedState = 'cancelled';
				this.playState = 'idle';
				reject(new DOMException('The user aborted a request.', 'AbortError'));
			}),
			pause: vi.fn(function () {
				this.playState = 'paused';
			}),
			play: vi.fn(function () {
				this.playState = 'running';
			}),
		};
		fakeAnimations.push(anim);
		return anim;
	};
}

function uninstallFakeAnimate() {
	delete Element.prototype.animate;
	fakeAnimations = undefined;
}

// ---- controllable fake IntersectionObserver ---------------------------------
let ioInstances;

function installFakeIO() {
	ioInstances = [];
	globalThis.IntersectionObserver = class {
		constructor(callback, options) {
			this.callback = callback;
			this.options = options;
			this.observed = new Set();
			this.disconnected = false;
			ioInstances.push(this);
		}
		observe(el) {
			this.observed.add(el);
		}
		unobserve(el) {
			this.observed.delete(el);
		}
		disconnect() {
			this.observed.clear();
			this.disconnected = true;
		}
	};
}

function uninstallFakeIO() {
	delete globalThis.IntersectionObserver;
	ioInstances = undefined;
}

/** Fire an intersection for `el` on whichever observer is watching it. */
function fireIntersect(el, isIntersecting = true) {
	for (const io of ioInstances) {
		if (io.observed.has(el)) {
			io.callback([{ target: el, isIntersecting }], io);
		}
	}
}

const visibleIn = (extra = {}) => ({ ...IN, trigger: 'visible', ...extra });

afterEach(() => {
	if (fakeAnimations) uninstallFakeAnimate();
	if (ioInstances) uninstallFakeIO();
	vi.restoreAllMocks();
});

describe('scroll-trigger enter (D73) — hold & reveal', () => {
	it('holds the enter paused at the from-state; viewWillShow is NOT fired yet', async () => {
		installFakeAnimate();
		installFakeIO();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn() };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', { class: 'v' }, [text('x')]); }
		}
		const v = await new V().mount(container());
		v.playIn(); // fire-and-forget; promise stays pending until reveal

		expect(fakeAnimations).toHaveLength(1);
		expect(fakeAnimations[0].keyframes).toEqual([IN.from, IN.to]);
		expect(fakeAnimations[0].pause).toHaveBeenCalledTimes(1); // held at t=0
		expect(fakeAnimations[0].play).not.toHaveBeenCalled();
		expect(ioInstances[0].observed.has(v.element)).toBe(true);
		expect(calls).toEqual([]); // hooks deferred to the reveal

		v.destroy();
	});

	it('reveals on first intersection: hooks bracket the reveal, releases fill, cleans up', async () => {
		installFakeAnimate();
		installFakeIO();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn() };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn();

		fireIntersect(v.element);
		expect(calls).toEqual(['willShow']); // will-show fires at reveal, not mount
		expect(fakeAnimations[0].play).toHaveBeenCalledTimes(1);
		expect(ioInstances[0].observed.size).toBe(0); // unobserved on reveal
		expect(ioInstances[0].disconnected).toBe(true); // last target → disconnect

		fakeAnimations[0].finish();
		await p;
		await tick();
		expect(calls).toEqual(['willShow', 'didShow']);
		expect(fakeAnimations[0].cancel).toHaveBeenCalledTimes(1); // release: fill handed back
	});

	it('reveals at most once — a second intersection does not replay', async () => {
		installFakeAnimate();
		installFakeIO();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn() };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn();

		fireIntersect(v.element);
		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willShow', 'didShow']);

		// scroll out and back in — observer is already disarmed, nothing replays
		fireIntersect(v.element, false);
		fireIntersect(v.element, true);
		await tick();
		expect(calls).toEqual(['willShow', 'didShow']);
		expect(fakeAnimations).toHaveLength(1); // no second animation created
	});

	it('trigger: "mount" (explicit) plays immediately, like the default', async () => {
		installFakeAnimate();
		installFakeIO();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: { ...IN, trigger: 'mount' } };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn();
		expect(calls).toEqual(['willShow']); // immediate
		expect(fakeAnimations[0].pause).not.toHaveBeenCalled(); // not held
		expect(ioInstances).toHaveLength(0); // no observer
		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willShow', 'didShow']);
	});
});

describe('scroll-trigger enter (D73) — triggerOffset → rootMargin', () => {
	it('number → "0px 0px -<n>px 0px", threshold 0', async () => {
		installFakeAnimate();
		installFakeIO();
		class V extends PuzzleView {
			animations = { in: visibleIn({ triggerOffset: 100 }) };
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		v.playIn();
		expect(ioInstances[0].options.rootMargin).toBe('0px 0px -100px 0px');
		expect(ioInstances[0].options.threshold).toBe(0);
		v.destroy();
	});

	it('percentage string → "0px 0px -<n>% 0px"', async () => {
		installFakeAnimate();
		installFakeIO();
		class V extends PuzzleView {
			animations = { in: visibleIn({ triggerOffset: '15%' }) };
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		v.playIn();
		expect(ioInstances[0].options.rootMargin).toBe('0px 0px -15% 0px');
		v.destroy();
	});

	it('invalid triggerOffset warns once and uses the default rootMargin', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// One shared spec object across two instances → warn-once is per spec object.
		const badSpec = visibleIn({ triggerOffset: 'soon' });
		class V extends PuzzleView {
			animations = { in: badSpec };
			render() { return h('div', {}, [text('x')]); }
		}
		const v1 = await new V().mount(container());
		v1.playIn();
		const v2 = await new V().mount(container());
		v2.playIn();

		expect(warn).toHaveBeenCalledTimes(1);
		expect(ioInstances[0].options.rootMargin).toBe('0px 0px 0px 0px');
		v1.destroy();
		v2.destroy();
	});
});

describe('scroll-trigger enter (D73) — degradation', () => {
	it('no IntersectionObserver global → plays immediately at mount', async () => {
		installFakeAnimate(); // note: NO installFakeIO
		expect(typeof globalThis.IntersectionObserver).toBe('undefined');
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn() };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn();
		expect(calls).toEqual(['willShow']); // mount behavior — fired now
		expect(fakeAnimations).toHaveLength(1);
		expect(fakeAnimations[0].pause).not.toHaveBeenCalled(); // no hold
		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willShow', 'didShow']);
	});

	it('prefers-reduced-motion → no hold, hooks fire at mount, duration zeroed', async () => {
		installFakeAnimate();
		installFakeIO();
		globalThis.matchMedia = vi.fn(() => ({ matches: true }));
		try {
			const calls = [];
			class V extends PuzzleView {
				animations = { in: visibleIn() };
				viewWillShow() { calls.push('willShow'); }
				viewDidShow() { calls.push('didShow'); }
				render() { return h('div', {}, [text('x')]); }
			}
			const v = await new V().mount(container());
			const p = v.playIn();
			expect(calls).toEqual(['willShow']); // mount behavior under reduced motion
			expect(fakeAnimations[0].options).toMatchObject({ duration: 0, delay: 0 });
			expect(fakeAnimations[0].pause).not.toHaveBeenCalled(); // no hold
			expect(ioInstances).toHaveLength(0); // no observer armed
			fakeAnimations[0].finish();
			await p;
			expect(calls).toEqual(['willShow', 'didShow']);
		} finally {
			delete globalThis.matchMedia;
		}
	});

	it('unknown trigger value warns once and falls back to mount behavior', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const calls = [];
		class V extends PuzzleView {
			animations = { in: { ...IN, trigger: 'sideways' } };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(calls).toEqual(['willShow']); // mount behavior
		expect(fakeAnimations[0].pause).not.toHaveBeenCalled();
		expect(ioInstances).toHaveLength(0);
		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willShow', 'didShow']);
	});

	it('a pause() failure degrades gracefully — the element still reveals, never throws', async () => {
		installFakeAnimate();
		installFakeIO();
		// Make pause() throw on the next created animation.
		const realAnimate = Element.prototype.animate;
		Element.prototype.animate = function (kf, opts) {
			const anim = realAnimate.call(this, kf, opts);
			anim.pause = vi.fn(() => { throw new Error('pause unsupported'); });
			return anim;
		};
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn() };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn(); // must not throw despite pause() throwing
		expect(calls).toEqual([]); // still deferred to the observer
		fireIntersect(v.element);
		expect(calls).toEqual(['willShow']);
		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willShow', 'didShow']);
	});
});

describe('scroll-trigger enter (D73) — teardown & interruption', () => {
	it('destroy before reveal resolves playIn, never fires the hooks, disarms the observer', async () => {
		installFakeAnimate();
		installFakeIO();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn() };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playIn();
		expect(ioInstances[0].observed.size).toBe(1);

		v.destroy();
		await expect(p).resolves.toBeUndefined(); // resolves on destroy — no leak
		expect(calls).toEqual([]); // neither hook fired
		expect(ioInstances[0].observed.size).toBe(0); // disarmed
		expect(ioInstances[0].disconnected).toBe(true); // registry entry reclaimed
		expect(fakeAnimations[0].cancel).toHaveBeenCalled(); // held anim cancelled
	});

	it('an out animation on a held element cancels the hold and plays out (no deadlock)', async () => {
		installFakeAnimate();
		installFakeIO();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn(), out: OUT };
			viewWillShow() { calls.push('willShow'); }
			viewWillHide() { calls.push('willHide'); }
			viewDidHide() { calls.push('didHide'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const enter = v.playIn(); // held, observer armed
		expect(ioInstances[0].observed.size).toBe(1);
		const heldAnim = fakeAnimations[0];

		const leave = v.playOut();
		await expect(enter).resolves.toBeUndefined(); // held enter promise released
		expect(ioInstances[0].observed.size).toBe(0); // observer disarmed
		expect(heldAnim.cancel).toHaveBeenCalled(); // hold cancelled
		expect(calls).toContain('willHide');
		// the out animation is the second created animation
		const outAnim = fakeAnimations[fakeAnimations.length - 1];
		expect(outAnim.keyframes).toEqual([OUT.from, OUT.to]);
		outAnim.finish();
		await leave;
		expect(calls).toEqual(['willHide', 'didHide']); // enter hooks never fired
	});
});

describe('scroll-trigger enter (D73) — shared observer registry', () => {
	it('same offset shares one IO; a different offset gets its own; disconnect on last disarm', async () => {
		installFakeAnimate();
		installFakeIO();
		const mk = (offset) =>
			class extends PuzzleView {
				animations = { in: visibleIn({ triggerOffset: offset }) };
				render() { return h('div', {}, [text('x')]); }
			};
		const A = mk(50);
		const B = mk(50); // same margin as A → shares its observer
		const C = mk(999); // different margin → its own observer

		const a = await new A().mount(container());
		a.playIn();
		const b = await new B().mount(container());
		b.playIn();
		const c = await new C().mount(container());
		c.playIn();

		expect(ioInstances).toHaveLength(2); // A+B share io0, C is io1
		const shared = ioInstances[0];
		expect(shared.observed.size).toBe(2);

		a.destroy();
		expect(shared.disconnected).toBe(false); // b still observing
		expect(shared.observed.size).toBe(1);
		b.destroy();
		expect(shared.disconnected).toBe(true); // last target gone → disconnected

		c.destroy();
	});
});

describe('scroll-trigger (D73) — out spec ignores trigger keys', () => {
	it('a trigger on the out spec warns once and the leave path is unchanged', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const calls = [];
		class V extends PuzzleView {
			animations = { out: { ...OUT, trigger: 'visible', triggerOffset: 40 } };
			viewWillHide() { calls.push('willHide'); }
			viewDidHide() { calls.push('didHide'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const v = await new V().mount(container());
		const p = v.playOut();
		expect(warn).toHaveBeenCalledTimes(1); // warned once, ignored
		expect(calls).toEqual(['willHide']); // leave runs normally
		expect(fakeAnimations[0].keyframes).toEqual([OUT.from, OUT.to]);
		expect(fakeAnimations[0].pause).not.toHaveBeenCalled(); // out is never held
		expect(ioInstances).toHaveLength(0); // no observer for a leave

		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willHide', 'didHide']);
	});
});

describe('scroll-trigger enter (D73) — triggerAnchor anchored reveals', () => {
	// Mount a child inside a section ancestor: attach `parent` to the document,
	// nest a mount container inside it, and mount the view there. `parent` (with
	// its class) is the ancestor `closest(selector)` should resolve to.
	function sectionContainer(sectionClass = 'section') {
		const section = document.createElement('div');
		section.className = sectionClass;
		document.body.appendChild(section);
		const inner = document.createElement('div');
		section.appendChild(inner);
		return { section, inner };
	}

	it('observes the ancestor, not the child root; intersecting the section reveals the child', async () => {
		installFakeAnimate();
		installFakeIO();
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn({ triggerAnchor: '.section' }) };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', { class: 'card' }, [text('x')]); }
		}
		const { section, inner } = sectionContainer();
		const v = await new V().mount(inner);
		const p = v.playIn();

		// The OBSERVED element is the section ancestor — the child root is never observed.
		expect(ioInstances[0].observed.has(section)).toBe(true);
		expect(ioInstances[0].observed.has(v.element)).toBe(false);
		expect(calls).toEqual([]); // held until the section reveals

		fireIntersect(section);
		expect(calls).toEqual(['willShow']);
		expect(fakeAnimations[0].play).toHaveBeenCalledTimes(1);
		expect(ioInstances[0].observed.size).toBe(0); // unobserved on reveal

		fakeAnimations[0].finish();
		await p;
		await tick();
		expect(calls).toEqual(['willShow', 'didShow']);
	});

	it('group: two instances anchored to one section share ONE observer entry, revealed together', async () => {
		installFakeAnimate();
		installFakeIO();
		const aCalls = [];
		const bCalls = [];
		class A extends PuzzleView {
			animations = { in: visibleIn({ triggerAnchor: '.section' }) };
			viewWillShow() { aCalls.push('willShow'); }
			viewDidShow() { aCalls.push('didShow'); }
			render() { return h('div', { class: 'a' }, [text('a')]); }
		}
		class B extends PuzzleView {
			// Distinct spec object (its own delay) — still the same anchor/margin bucket.
			animations = { in: visibleIn({ triggerAnchor: '.section', delay: 120 }) };
			viewWillShow() { bCalls.push('willShow'); }
			viewDidShow() { bCalls.push('didShow'); }
			render() { return h('div', { class: 'b' }, [text('b')]); }
		}
		const { section } = sectionContainer();
		const innerA = document.createElement('div');
		const innerB = document.createElement('div');
		section.appendChild(innerA);
		section.appendChild(innerB);

		const a = await new A().mount(innerA);
		const pa = a.playIn();
		const b = await new B().mount(innerB);
		const pb = b.playIn();

		// One observer, one observed element (the section), two callbacks behind it.
		expect(ioInstances).toHaveLength(1);
		expect(ioInstances[0].observed.size).toBe(1);
		expect(ioInstances[0].observed.has(section)).toBe(true);
		expect(fakeAnimations).toHaveLength(2); // each instance held its own animation
		expect(fakeAnimations[1].options.delay).toBe(120); // B's own spec respected

		fireIntersect(section); // one delivery reveals BOTH
		expect(aCalls).toEqual(['willShow']);
		expect(bCalls).toEqual(['willShow']);
		expect(fakeAnimations[0].play).toHaveBeenCalledTimes(1);
		expect(fakeAnimations[1].play).toHaveBeenCalledTimes(1);
		expect(ioInstances[0].observed.size).toBe(0); // last callback gone → unobserved
		expect(ioInstances[0].disconnected).toBe(true);

		fakeAnimations[0].finish();
		fakeAnimations[1].finish();
		await Promise.all([pa, pb]);
		await tick();
		expect(aCalls).toEqual(['willShow', 'didShow']);
		expect(bCalls).toEqual(['willShow', 'didShow']);
	});

	it('independent disarm: destroying one anchored child leaves the other armed and revealable', async () => {
		installFakeAnimate();
		installFakeIO();
		const aCalls = [];
		const bCalls = [];
		class A extends PuzzleView {
			animations = { in: visibleIn({ triggerAnchor: '.section' }) };
			viewWillShow() { aCalls.push('willShow'); }
			viewDidShow() { aCalls.push('didShow'); }
			render() { return h('div', { class: 'a' }, [text('a')]); }
		}
		class B extends PuzzleView {
			animations = { in: visibleIn({ triggerAnchor: '.section' }) };
			viewWillShow() { bCalls.push('willShow'); }
			viewDidShow() { bCalls.push('didShow'); }
			render() { return h('div', { class: 'b' }, [text('b')]); }
		}
		const { section } = sectionContainer();
		const innerA = document.createElement('div');
		const innerB = document.createElement('div');
		section.appendChild(innerA);
		section.appendChild(innerB);

		const a = await new A().mount(innerA);
		const pa = a.playIn();
		const b = await new B().mount(innerB);
		const pb = b.playIn();
		expect(ioInstances[0].observed.size).toBe(1); // shared element, two callbacks

		// Destroy A before any intersection — its playIn resolves, its hooks never fire,
		// and the section stays observed for B (the set still holds B's callback).
		a.destroy();
		await expect(pa).resolves.toBeUndefined();
		expect(aCalls).toEqual([]);
		expect(ioInstances[0].observed.size).toBe(1); // NOT unobserved — B still armed
		expect(ioInstances[0].disconnected).toBe(false);

		fireIntersect(section);
		expect(aCalls).toEqual([]); // A never reveals
		expect(bCalls).toEqual(['willShow']); // B reveals only
		expect(ioInstances[0].observed.size).toBe(0); // last callback gone now
		expect(ioInstances[0].disconnected).toBe(true);

		// B's held animation is fakeAnimations[1] (A's is [0]); finish it to settle.
		fakeAnimations[fakeAnimations.length - 1].finish();
		await pb;
		await tick();
		expect(bCalls).toEqual(['willShow', 'didShow']);

		b.destroy();
	});

	it('no matching ancestor → warns once and observes the child root; reveal still works', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const calls = [];
		// Shared spec across two instances → the warn-once is per spec object.
		const spec = visibleIn({ triggerAnchor: '.does-not-exist' });
		class V extends PuzzleView {
			animations = { in: spec };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const { inner } = sectionContainer();
		const v1 = await new V().mount(inner);
		v1.playIn();
		const { inner: inner2 } = sectionContainer();
		const v2 = await new V().mount(inner2);
		v2.playIn();

		expect(warn).toHaveBeenCalledTimes(1); // once per spec object, both instances
		// Fell back to observing each child's own root (no ancestor matched).
		expect(ioInstances[0].observed.has(v1.element)).toBe(true);
		expect(calls).toEqual([]); // still held, just on the element itself

		fireIntersect(v1.element);
		expect(calls).toEqual(['willShow']); // reveal works via the fallback
		expect(fakeAnimations[0].play).toHaveBeenCalledTimes(1);

		v1.destroy();
		v2.destroy();
	});

	it('invalid selector (closest throws) → warns once and observes the child root', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const calls = [];
		class V extends PuzzleView {
			// ')(' is a syntactically invalid selector → closest() throws SyntaxError.
			animations = { in: visibleIn({ triggerAnchor: ')(' }) };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const { inner } = sectionContainer();
		const v = await new V().mount(inner);
		const p = v.playIn(); // must not throw despite closest() throwing

		expect(warn).toHaveBeenCalledTimes(1);
		expect(ioInstances[0].observed.has(v.element)).toBe(true); // fell back to the root
		expect(calls).toEqual([]);

		fireIntersect(v.element);
		expect(calls).toEqual(['willShow']);
		fakeAnimations[0].finish();
		await p;
		await tick();
		expect(calls).toEqual(['willShow', 'didShow']);
	});

	it('non-string triggerAnchor → warns once and observes the child root', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const calls = [];
		class V extends PuzzleView {
			animations = { in: visibleIn({ triggerAnchor: '   ' }) }; // empty-ish string
			viewWillShow() { calls.push('willShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const { inner } = sectionContainer();
		const v = await new V().mount(inner);
		v.playIn();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(ioInstances[0].observed.has(v.element)).toBe(true);
		expect(calls).toEqual([]);
		v.destroy();
	});

	it('triggerAnchor WITHOUT trigger: "visible" → warns once, mount path, nothing armed', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const calls = [];
		class V extends PuzzleView {
			// triggerAnchor present, but trigger stays 'mount' (absent).
			animations = { in: { ...IN, triggerAnchor: '.section' } };
			viewWillShow() { calls.push('willShow'); }
			viewDidShow() { calls.push('didShow'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const { inner } = sectionContainer();
		const v = await new V().mount(inner);
		const p = v.playIn();

		expect(warn).toHaveBeenCalledTimes(1); // ignored-without-visible warning
		expect(calls).toEqual(['willShow']); // immediate mount behavior
		expect(fakeAnimations[0].pause).not.toHaveBeenCalled(); // not held
		expect(ioInstances).toHaveLength(0); // nothing armed
		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willShow', 'didShow']);
	});

	it('triggerOffset composes with triggerAnchor: the ancestor is observed under the offset margin', async () => {
		installFakeAnimate();
		installFakeIO();
		class V extends PuzzleView {
			animations = { in: visibleIn({ triggerAnchor: '.section', triggerOffset: 80 }) };
			render() { return h('div', {}, [text('x')]); }
		}
		const { section, inner } = sectionContainer();
		const v = await new V().mount(inner);
		v.playIn();

		expect(ioInstances[0].options.rootMargin).toBe('0px 0px -80px 0px');
		expect(ioInstances[0].observed.has(section)).toBe(true); // the anchor, under the offset
		v.destroy();
	});

	it('out spec triggerAnchor warns once and the leave path is unchanged', async () => {
		installFakeAnimate();
		installFakeIO();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const calls = [];
		class V extends PuzzleView {
			animations = { out: { ...OUT, triggerAnchor: '.section' } };
			viewWillHide() { calls.push('willHide'); }
			viewDidHide() { calls.push('didHide'); }
			render() { return h('div', {}, [text('x')]); }
		}
		const { inner } = sectionContainer();
		const v = await new V().mount(inner);
		const p = v.playOut();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(calls).toEqual(['willHide']);
		expect(ioInstances).toHaveLength(0); // no observer for a leave
		fakeAnimations[0].finish();
		await p;
		expect(calls).toEqual(['willHide', 'didHide']);
	});
});

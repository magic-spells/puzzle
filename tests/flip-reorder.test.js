// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { serialize } from '../client-runtime/ssg/serialize.js';

// FLIP keyed-reorder animation (D85): a `flip` attr on a keyed row root
// animates the row's MOVE when a keyed reconciliation reorders the list —
// measure before the patch (First), let the existing move pass relocate the
// unchanged DOM node, measure after (Last), play the inverted translate.
// `flip` is a framework directive: it must never reach the DOM or SSG output.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

/** Element's index among its parent's element children — the fake "layout" input. */
function indexOf(el) {
	return el.parentNode ? [...el.parentNode.children].indexOf(el) : 0;
}
const vertical = (rowH) => (el) => ({ left: 0, top: indexOf(el) * rowH });
const horizontal = (colW) => (el) => ({ left: indexOf(el) * colW, top: 0 });

/**
 * Controllable jsdom stand-ins for the two DOM capabilities FLIP needs:
 * - getBoundingClientRect returns `layout(el)` (index-based by default) PLUS a
 *   per-element visual offset — the offset simulates an ACTIVE transform, so a
 *   mid-flight rect differs from the layout rect exactly like real WAAPI;
 * - Element.prototype.animate records keyframes/options and returns a minimal
 *   Animation-like { finished, cancel(), finish(), onfinish }. cancel() clears
 *   the target's visual offset (cancelling a real FLIP drops its transform) and
 *   rejects `finished` with AbortError, matching real WAAPI semantics.
 */
function installStubs({ waapi = true } = {}) {
	const origGBCR = Element.prototype.getBoundingClientRect;
	const animations = [];
	let layout = () => ({ left: 0, top: 0 });
	const offsets = new Map(); // element → { x, y } simulated active-transform offset
	const gbcr = vi.fn(function () {
		const pos = layout(this);
		const off = offsets.get(this) ?? { x: 0, y: 0 };
		const left = pos.left + off.x;
		const top = pos.top + off.y;
		return { left, top, x: left, y: top, right: left + 100, bottom: top + 20, width: 100, height: 20 };
	});
	Element.prototype.getBoundingClientRect = gbcr;
	if (waapi) {
		Element.prototype.animate = vi.fn(function (keyframes, options) {
			let resolve, reject;
			const finished = new Promise((res, rej) => {
				resolve = res;
				reject = rej;
			});
			const anim = {
				target: this,
				keyframes,
				options,
				finished,
				onfinish: null,
				finish() {
					resolve();
				},
				cancel: vi.fn(() => {
					offsets.delete(anim.target);
					reject(new DOMException('aborted', 'AbortError'));
				}),
			};
			animations.push(anim);
			return anim;
		});
	}
	return {
		animations,
		gbcr,
		setLayout(fn) {
			layout = fn;
		},
		setOffset(el, x, y) {
			offsets.set(el, { x, y });
		},
		uninstall() {
			Element.prototype.getBoundingClientRect = origGBCR;
			if (waapi) delete Element.prototype.animate;
		},
	};
}

function mountList(items, rowAttrs = (item) => ({ key: item })) {
	const list = (its) => h('ul', {}, its.map((item) => h('li', rowAttrs(item), [text(item)])));
	const container = document.createElement('div');
	document.body.appendChild(container);
	const vm = new ViewManager(container);
	vm.render(list(items));
	return { vm, list, container };
}

let stubs = null;
afterEach(() => {
	stubs?.uninstall();
	stubs = null;
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('FLIP keyed reorder (D85)', () => {
	it('computes correct dx/dy for vertical moves and uses the default timing', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));

		vm.render(list(['c', 'a', 'b']));

		// candidates play in newChildren order: c (40→0), a (0→20), b (20→40)
		expect(stubs.animations.map((a) => a.keyframes[0].transform)).toEqual([
			'translate(0px, 40px)',
			'translate(0px, -20px)',
			'translate(0px, -20px)',
		]);
		for (const a of stubs.animations) {
			expect(a.keyframes[1].transform).toBe('none'); // no base transform → settle to natural state
			expect(a.options).toEqual({ duration: 250, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
		}
	});

	it('computes correct dx/dy for horizontal moves', () => {
		stubs = installStubs();
		stubs.setLayout(horizontal(50));
		const { vm, list } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));

		vm.render(list(['c', 'a', 'b']));

		expect(stubs.animations.map((a) => a.keyframes[0].transform)).toEqual([
			'translate(100px, 0px)',
			'translate(-50px, 0px)',
			'translate(-50px, 0px)',
		]);
	});

	it('animates every moved row of an arbitrary sort with per-row deltas', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(10));
		const { vm, list } = mountList(['a', 'b', 'c', 'd', 'e'], (i) => ({ key: i, flip: true }));

		vm.render(list(['d', 'a', 'e', 'c', 'b']));

		// first tops: a0 b10 c20 d30 e40 → last: d0 a10 e20 c30 b40
		expect(stubs.animations.map((a) => a.keyframes[0].transform)).toEqual([
			'translate(0px, 30px)', // d 30→0
			'translate(0px, -10px)', // a 0→10
			'translate(0px, 20px)', // e 40→20
			'translate(0px, -10px)', // c 20→30
			'translate(0px, -30px)', // b 10→40
		]);
	});

	it('honors a { duration, easing } spec and falls back to defaults on a malformed one', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const spec = { duration: 400, easing: 'ease-out', bogus: 'ignored' };
		const { vm, list } = mountList(['a', 'b'], (i) => ({ key: i, flip: spec }));
		vm.render(list(['b', 'a']));
		expect(stubs.animations).toHaveLength(2);
		expect(stubs.animations[0].options).toEqual({ duration: 400, easing: 'ease-out' });

		// malformed shapes: silently default (optional config, not a template error)
		const { vm: vm2, list: list2 } = mountList(['x', 'y'], (i) => ({
			key: i,
			flip: { duration: 'fast', easing: 42 },
		}));
		vm2.render(list2(['y', 'x']));
		const last = stubs.animations[stubs.animations.length - 1];
		expect(last.options).toEqual({ duration: 250, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
	});

	it('retained rows keep the SAME DOM nodes (moved, not remounted) and those nodes animate', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list, container } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));
		const [elA, elB, elC] = container.querySelectorAll('li');

		vm.render(list(['c', 'a', 'b']));

		const after = [...container.querySelectorAll('li')];
		expect(after.map((n) => n.textContent)).toEqual(['c', 'a', 'b']);
		expect(after[0]).toBe(elC);
		expect(after[1]).toBe(elA);
		expect(after[2]).toBe(elB);
		expect(stubs.animations.map((a) => a.target)).toEqual([elC, elA, elB]);
	});

	it('excludes inserted and removed rows — only retained movers animate', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list, container } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));
		const [elA, , elC] = container.querySelectorAll('li');

		vm.render(list(['c', 'a', 'd'])); // b removed, d inserted, c+a moved

		expect([...container.querySelectorAll('li')].map((n) => n.textContent)).toEqual(['c', 'a', 'd']);
		// c: 40→0, a: 0→20 — the fresh d and the removed b never animate
		expect(stubs.animations.map((a) => a.target)).toEqual([elC, elA]);
		expect(stubs.animations.map((a) => a.keyframes[0].transform)).toEqual([
			'translate(0px, 40px)',
			'translate(0px, -20px)',
		]);
	});

	it('composes a pre-existing computed base transform into both keyframes', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list, container } = mountList(['a', 'b'], (i) => ({ key: i, flip: true }));
		const [elA] = container.querySelectorAll('li');
		const matrix = 'matrix(1, 0, 0, 1, 5, 5)';
		vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({
			transform: el === elA ? matrix : '',
		}));

		vm.render(list(['b', 'a']));

		const animA = stubs.animations.find((a) => a.target === elA);
		expect(animA.keyframes[0].transform).toBe(`translate(0px, -20px) ${matrix}`); // a 0→20
		expect(animA.keyframes[1].transform).toBe(matrix); // base survives at rest
		const animB = stubs.animations.find((a) => a.target !== elA);
		expect(animB.keyframes[1].transform).toBe('none');
	});

	it('prefers-reduced-motion: zero measurements and zero animations', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));
		stubs.gbcr.mockClear();
		vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });

		vm.render(list(['c', 'a', 'b']));

		expect(stubs.gbcr).not.toHaveBeenCalled();
		expect(stubs.animations).toHaveLength(0);
	});

	it('missing WAAPI (jsdom default): no throw, no measurements, reorder still lands', () => {
		stubs = installStubs({ waapi: false });
		stubs.setLayout(vertical(20));
		const { vm, list, container } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));
		stubs.gbcr.mockClear();

		expect(() => vm.render(list(['c', 'a', 'b']))).not.toThrow();
		expect([...container.querySelectorAll('li')].map((n) => n.textContent)).toEqual(['c', 'a', 'b']);
		expect(stubs.gbcr).not.toHaveBeenCalled(); // bailed before First measure
	});

	it('el.animate absent mid-list: that row degrades to no-op, siblings still animate', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list, container } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));
		const [elA, elB, elC] = container.querySelectorAll('li');
		// Shadow a NON-first candidate: the first candidate is the WAAPI
		// environment probe (its absence bails the whole list, by design).
		elA.animate = undefined; // own property shadows the prototype stub

		expect(() => vm.render(list(['c', 'a', 'b']))).not.toThrow(); // candidates: c, a, b
		expect(stubs.animations.map((a) => a.target)).toEqual([elC, elB]); // a skipped mid-list
	});

	it('rapid second reorder cancels the in-flight flip and starts from the mid-flight rect', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list, container } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));
		const [elA] = container.querySelectorAll('li');

		vm.render(list(['b', 'a', 'c'])); // a: 0→20, b: 20→0
		const firstFlipA = stubs.animations.find((a) => a.target === elA);
		expect(firstFlipA).toBeDefined();

		// Mid-flight: a sits at layout top 20 with an active transform showing it
		// at 8 (translate -12). The rect INCLUDES the transform — that visual
		// position must seed the next First measure, and only then is the prior
		// flip cancelled (cancelling first would snap a to 20 and fail below).
		stubs.setOffset(elA, 0, -12);
		vm.render(list(['a', 'b', 'c'])); // reorder straight back

		expect(firstFlipA.cancel).toHaveBeenCalledTimes(1);
		const secondFlipA = stubs.animations.filter((a) => a.target === elA)[1];
		expect(secondFlipA.keyframes[0].transform).toBe('translate(0px, 8px)'); // 8 (visual) → 0
	});

	it('keyed lists without any flip attr never measure or animate', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list, container } = mountList(['a', 'b', 'c']); // keyed, no flip
		const [elA] = container.querySelectorAll('li');
		stubs.gbcr.mockClear();

		vm.render(list(['c', 'a', 'b']));

		expect([...container.querySelectorAll('li')][1]).toBe(elA); // reorder still moved nodes
		expect(stubs.gbcr).not.toHaveBeenCalled();
		expect(stubs.animations).toHaveLength(0);
	});

	it('unchanged order: measured but below the sub-pixel threshold → no animations', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list } = mountList(['a', 'b', 'c'], (i) => ({ key: i, flip: true }));
		stubs.gbcr.mockClear();

		vm.render(list(['a', 'b', 'c']));

		expect(stubs.gbcr).toHaveBeenCalled(); // First+Last ran (rows retained)
		expect(stubs.animations).toHaveLength(0); // every delta < 0.5px
	});

	it('flip={false} / flip={null} disable the row (conditional flip)', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const { vm, list } = mountList(['a', 'b'], (i) => ({ key: i, flip: i === 'a' ? true : false }));

		vm.render(list(['b', 'a']));

		expect(stubs.animations).toHaveLength(1);
		expect(stubs.animations[0].target.textContent).toBe('a');
	});

	it('warns once (and animates nothing) for a flip attr on a null-key row', () => {
		stubs = installStubs();
		stubs.setLayout(vertical(20));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// keyed list (sibling carries a key) with a flip row that has NO key —
		// that row diffs positionally, so FLIP has no identity to track.
		const tree = (label) =>
			h('ul', {}, [h('li', { key: 'k' }, [text('keyed')]), h('li', { flip: true }, [text(label)])]);
		const container = document.createElement('div');
		document.body.appendChild(container);
		const vm = new ViewManager(container);
		vm.render(tree('one'));

		vm.render(tree('two'));
		vm.render(tree('three'));

		const flipWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('flip'));
		expect(flipWarnings).toHaveLength(1);
		expect(String(flipWarnings[0][0])).toContain('requires a keyed row');
		expect(stubs.animations).toHaveLength(0);
	});
});

describe('flip is a framework directive — never markup (D85)', () => {
	it('mounted and patched elements carry no flip attribute (bare and object forms)', () => {
		stubs = installStubs();
		const { vm, list, container } = mountList(['a', 'b'], (i) => ({
			key: i,
			flip: i === 'a' ? true : { duration: 300 },
		}));
		for (const li of container.querySelectorAll('li')) {
			expect(li.hasAttribute('flip')).toBe(false);
		}

		// value change (true → object) and removal both stay off the DOM
		vm.render(list(['a', 'b']));
		const dropFlip = h('ul', {}, ['a', 'b'].map((i) => h('li', { key: i }, [text(i)])));
		expect(() => vm.render(dropFlip)).not.toThrow();
		for (const li of container.querySelectorAll('li')) {
			expect(li.hasAttribute('flip')).toBe(false);
		}
		expect(container.innerHTML).not.toContain('object Object');
	});

	it('SSG serialize drops flip like key/island/ref', async () => {
		const tree = h('ul', {}, [
			h('li', { key: 'a', flip: true, class: 'row' }, [text('a')]),
			h('li', { key: 'b', flip: { duration: 300 } }, [text('b')]),
		]);
		const html = await serialize(tree);
		expect(html).toBe('<ul><li class="row">a</li><li>b</li></ul>');
		expect(html).not.toContain('flip');
	});
});

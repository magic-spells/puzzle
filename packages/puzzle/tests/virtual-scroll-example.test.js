// @vitest-environment jsdom
//
// Compiler-output proof for examples/virtual-scroll (the FEATURE-VIRTUAL-SCROLLING
// prototype). The view under test is the Go compiler's output
// (tests/fixtures/virtual-scroll/Home.compiled.js, produced by the
// `build:virtual-scroll` pretest step from examples/virtual-scroll/app/**), mounted
// through a real PuzzleApp. Green here means the pure-userland windowing recipe
// works on stock Puzzle — no framework changes.
//
// The recipe: a fixed-height scroll container with an @scroll handler that
// recomputes the window's start bucket and setData/refresh()es; data() slices a
// bounded window out of the 10k-row dataset; two spacer divs carry the off-window
// geometry so the native scrollbar behaves as if all 10,000 rows were present.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/index.js';
import installFakeAnimate from './helpers/fake-waapi.js';
import VirtualScrollHome from './fixtures/virtual-scroll/Home.compiled.js';

// Geometry constants — MUST mirror the view (examples/virtual-scroll/app/views/Home.pzl).
const ROW_H = 40;
const TOTAL = 10000;
const VIEWPORT_H = 600;
const OVERSCAN = 6;
const VISIBLE = Math.ceil(VIEWPORT_H / ROW_H); // 15
const WINDOW = VISIBLE + OVERSCAN * 2; // 27
const TOTAL_PX = TOTAL * ROW_H; // 400000

let waapi = null;
let apps = [];

const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
// refresh() re-renders on a rAF; two rounds cover a render that schedules another.
async function settle() {
	await raf();
	await raf();
}

function boot() {
	const el = document.createElement('div');
	el.id = 'app';
	document.body.appendChild(el);
	const app = new PuzzleApp({
		target: el,
		routes: [{ path: '/', name: 'home', view: VirtualScrollHome, meta: { title: 'VS' } }],
	});
	apps.push(app);
	return { app, el };
}

const rowEls = (el) => [...el.querySelectorAll('.vs-row')];
const rowIndices = (el) => rowEls(el).map((r) => Number(r.dataset.index));
const pxOf = (node) => parseInt(node.style.height, 10) || 0;

// The scroll container measures scrollTop off the real DOM. jsdom always reports
// 0 for layout properties, so we stub the specific element's scrollTop to the
// value we're simulating before dispatching the event — exactly the number the
// browser would hand the @scroll listener.
function scrollTo(el, scrollTop) {
	const scroller = el.querySelector('.vs-scroller');
	Object.defineProperty(scroller, 'scrollTop', { value: scrollTop, configurable: true });
	scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
	return scroller;
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.body.innerHTML = '';
	document.title = '';
	vi.spyOn(console, 'log').mockImplementation(() => {});
	waapi = installFakeAnimate();
});

afterEach(() => {
	apps.forEach((a) => a.unmount());
	apps = [];
	waapi?.finishAll();
	waapi?.uninstall();
	waapi = null;
	vi.restoreAllMocks();
});

describe('Virtual scroll example [compiled] — bounded DOM window', () => {
	it('renders only a bounded window of rows on initial mount (not all 10,000)', async () => {
		const { app, el } = boot();
		await app.mount();

		const nodes = rowEls(el);
		// The headline claim: DOM node count is bounded, nowhere near 10k.
		expect(nodes.length).toBeLessThan(100);
		expect(nodes.length).toBe(WINDOW); // exactly the window (15 visible + 2×6 overscan)

		// The window starts at the top: rows 0..WINDOW-1 in order.
		expect(rowIndices(el)).toEqual(Array.from({ length: WINDOW }, (_, i) => i));

		// Header reflects the window vs. the full list.
		expect(el.textContent).toContain('rendering ' + WINDOW);
		expect(el.textContent).toContain('of ' + TOTAL + ' rows');
	});

	it('re-renders the correct new window after a scroll (start bucket = firstVisible − overscan)', async () => {
		const { app, el } = boot();
		await app.mount();
		expect(rowIndices(el)[0]).toBe(0);

		// Scroll to row 100 (scrollTop 4000). Expected start = 100 − OVERSCAN = 94.
		scrollTo(el, 100 * ROW_H);
		await settle();

		const expectedStart = 100 - OVERSCAN; // 94
		expect(rowIndices(el)[0]).toBe(expectedStart);
		expect(rowEls(el).length).toBe(WINDOW);
		expect(rowIndices(el)).toEqual(
			Array.from({ length: WINDOW }, (_, i) => expectedStart + i)
		);
		// Header range readout tracks the window.
		expect(el.textContent).toContain('#' + expectedStart + '–' + (expectedStart + WINDOW - 1));
	});

	it('does not re-render while scrolling within a single row bucket (no patch storm)', async () => {
		const { app, el } = boot();
		await app.mount();

		// Scroll into row-1's pixels — firstVisible stays 0 until scrollTop ≥ ROW_H,
		// and with OVERSCAN the clamped start is still 0, so the window is unchanged.
		scrollTo(el, ROW_H - 1);
		await settle();
		expect(rowIndices(el)[0]).toBe(0);

		// A tiny scroll that stays within the same start bucket also changes nothing.
		scrollTo(el, ROW_H + 5);
		await settle();
		expect(rowIndices(el)[0]).toBe(0);
	});

	it('spacers + rendered rows always sum to the full list height (10000 × ROW_H)', async () => {
		const { app, el } = boot();
		await app.mount();

		const measure = () => {
			const top = pxOf(el.querySelector('.vs-spacer-top'));
			const bottom = pxOf(el.querySelector('.vs-spacer-bottom'));
			const rows = rowEls(el).length * ROW_H;
			return { top, bottom, rows, total: top + bottom + rows };
		};

		// At the top.
		let m = measure();
		expect(m.top).toBe(0);
		expect(m.total).toBe(TOTAL_PX);

		// Mid-list.
		scrollTo(el, 100 * ROW_H);
		await settle();
		m = measure();
		expect(m.top).toBe((100 - OVERSCAN) * ROW_H); // 94 × 40
		expect(m.total).toBe(TOTAL_PX);

		// Near the bottom — window clamps, bottom spacer shrinks, total holds.
		scrollTo(el, TOTAL_PX);
		await settle();
		m = measure();
		expect(m.total).toBe(TOTAL_PX);
		// The last row is in view.
		expect(rowIndices(el)).toContain(TOTAL - 1);
	});
});

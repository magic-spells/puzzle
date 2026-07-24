// @vitest-environment jsdom
//
// enableMorph teardown + double-install guard (review follow-up).
//
// enableMorph attaches a CAPTURE-phase document 'click' listener (the zero-write
// click hint) that lived forever with no way to remove it, and lastClicked could
// pin a detached subtree until the next click. This suite pins the fix:
//   - the returned engine carries `dispose`, which removes that document listener
//     (and releases in-flight morph state) — idempotently;
//   - calling enableMorph twice on the same app tears the first install down, so a
//     duplicate listener never stacks up;
//   - app.unmount() reaches the teardown through the handler object.
// Same mocked-engine + memory-mode conventions as morph-cross-view.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { enableMorph } from '../client-runtime/morph.js';

vi.mock('@magic-spells/morph-engine', () => {
	class FakeMorphEngine {
		constructor(opts) {
			this.opts = opts;
			this.state = 'idle';
			this.stopCalls = 0;
		}
		show() {
			return Promise.resolve(false);
		}
		hide() {
			return Promise.resolve(false);
		}
		stop() {
			this.state = 'idle';
			this.stopCalls += 1;
		}
	}
	return { MorphEngine: FakeMorphEngine };
});

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

// Count only morph's own listener registrations: capture-phase document 'click'.
const clickCaptureCalls = (spy) =>
	spy.mock.calls.filter((c) => c[0] === 'click' && c[2] === true).length;

class Leaf extends PuzzleView {
	render() {
		return h('puzzle-view', {}, [text('leaf')]);
	}
}

describe('enableMorph teardown + double-install guard', () => {
	let addSpy;
	let removeSpy;

	beforeEach(() => {
		document.body.innerHTML = '';
		addSpy = vi.spyOn(document, 'addEventListener');
		removeSpy = vi.spyOn(document, 'removeEventListener');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exposes engine.dispose, which removes the document click listener (idempotently)', () => {
		const app = { setMorphHandler(handler) { this.handler = handler; } };
		const engine = enableMorph(app);

		expect(typeof engine.dispose).toBe('function');
		expect(clickCaptureCalls(addSpy)).toBe(1);
		expect(clickCaptureCalls(removeSpy)).toBe(0);

		engine.dispose();
		expect(clickCaptureCalls(removeSpy)).toBe(1);

		// Idempotent: a second dispose is a no-op, not a second removeEventListener.
		engine.dispose();
		expect(clickCaptureCalls(removeSpy)).toBe(1);
	});

	it('a second enableMorph on the same app tears the first down — no duplicate listener', () => {
		const app = { setMorphHandler(handler) { this.handler = handler; } };

		enableMorph(app);
		expect(clickCaptureCalls(addSpy)).toBe(1);
		expect(clickCaptureCalls(removeSpy)).toBe(0);

		// The double-install guard disposes install #1 before wiring #2.
		const engine2 = enableMorph(app);
		expect(clickCaptureCalls(addSpy)).toBe(2); // #2 added
		expect(clickCaptureCalls(removeSpy)).toBe(1); // #1 removed → exactly one active

		// #2's dispose still works and brings the net to zero.
		engine2.dispose();
		expect(clickCaptureCalls(removeSpy)).toBe(2);
	});

	it('app.unmount() invokes the morph teardown via the handler', async () => {
		const app = new PuzzleApp({
			target: container(),
			routes: [{ path: '/', name: 'home', view: Leaf }],
			routerMode: 'memory',
			routerInitialPath: '/',
		});
		enableMorph(app);
		await app.mount();

		expect(clickCaptureCalls(addSpy)).toBe(1);
		const removedBefore = clickCaptureCalls(removeSpy);

		app.unmount();
		expect(clickCaptureCalls(removeSpy)).toBe(removedBefore + 1);
	});

	it('exposes handler.arm; arm() is a no-op while armed and re-attaches exactly once after dispose', () => {
		const app = {
			setMorphHandler(handler) {
				this.handler = handler;
			},
		};
		enableMorph(app);
		expect(typeof app.handler.arm).toBe('function');
		expect(clickCaptureCalls(addSpy)).toBe(1);

		// Arming while still armed must NOT stack a second listener.
		app.handler.arm();
		expect(clickCaptureCalls(addSpy)).toBe(1);

		// After dispose, arm() re-attaches exactly one listener — and stays idempotent.
		app.handler.dispose();
		expect(clickCaptureCalls(removeSpy)).toBe(1);
		app.handler.arm();
		expect(clickCaptureCalls(addSpy)).toBe(2);
		app.handler.arm();
		expect(clickCaptureCalls(addSpy)).toBe(2);
	});

	it('mount → unmount → re-mount re-arms morph — exactly one live click listener across the cycle', async () => {
		const app = new PuzzleApp({
			target: container(),
			routes: [{ path: '/', name: 'home', view: Leaf }],
			routerMode: 'memory',
			routerInitialPath: '/',
		});
		enableMorph(app);
		const live = () => clickCaptureCalls(addSpy) - clickCaptureCalls(removeSpy);

		await app.mount(); // handler applied; arm() no-ops (still armed from enableMorph)
		expect(clickCaptureCalls(addSpy)).toBe(1);
		expect(live()).toBe(1);

		app.unmount(); // dispose → listener removed
		expect(live()).toBe(0);

		await app.mount(); // re-arm restores the listener (this is the fix)
		expect(clickCaptureCalls(addSpy)).toBe(2);
		expect(live()).toBe(1); // one live listener, not zero (dead) and not two (stacked)

		app.unmount();
		expect(live()).toBe(0); // still tears down cleanly
	});
});

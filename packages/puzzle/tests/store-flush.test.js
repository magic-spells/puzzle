// @vitest-environment jsdom
//
// D63 — store flush scheduling gains a hidden-tab timer fallback. rAF stays the
// primary scheduler, but Chrome suspends rAF entirely in hidden tabs, so a
// backgrounded app would queue mutations forever behind one frozen rAF. These
// tests drive the three branches of Store._notify: hidden at notify time (timer
// only), the visibility-boundary race (rAF armed but frozen → the 220ms fallback
// delivers), and the visible happy path (rAF flushes, fallback cleared, once).
//
// jsdom gives us a real `document` whose `.hidden` we shadow with an own
// property; `requestAnimationFrame` is stubbed per test for full control, and
// fake timers drive the setTimeout fallbacks deterministically.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
	};
}

const makeStore = () => new Store({ todo: Todo });

// Shadow document.hidden with a configurable own property (jsdom's is a
// prototype getter). afterEach removes it, restoring the default (visible).
const setHidden = (v) => {
	Object.defineProperty(document, 'hidden', { value: v, configurable: true });
};

describe('Store — hidden-tab flush fallback (D63)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		delete document.hidden; // drop the own-property shadow → prototype getter (false)
	});

	it('takes the timer queue directly (no rAF) when the tab is hidden at notify time', () => {
		// A frozen rAF spy: if the store ever reached for it while hidden this would
		// register a call. It never should — hidden goes straight to setTimeout.
		const rafSpy = vi.fn();
		vi.stubGlobal('requestAnimationFrame', rafSpy);

		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush(); // clear the create notification + its armed fallback timer

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findOne('todo', 't1'));

		rafSpy.mockClear();
		setHidden(true);

		store.findOne('todo', 't1').update({ text: 'y' }); // _notify while hidden
		expect(rafSpy).not.toHaveBeenCalled(); // hidden → timer path, rAF untouched
		expect(component.onStoreChange).not.toHaveBeenCalled(); // still batched, not sync

		vi.runAllTimers(); // fire the setTimeout(0) fallback
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('delivers via the ~220ms fallback when rAF is armed but frozen (visibility-boundary race)', () => {
		// A rAF that swallows its callback — models the tab hiding AFTER we schedule
		// but before the next frame, where Chrome freezes the pending rAF.
		const frozenRaf = vi.fn(); // never invokes cb
		vi.stubGlobal('requestAnimationFrame', frozenRaf);

		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findOne('todo', 't1'));

		frozenRaf.mockClear();
		setHidden(false); // visible at notify time → arms rAF AND the fallback timer

		store.findOne('todo', 't1').update({ text: 'y' });
		expect(frozenRaf).toHaveBeenCalledTimes(1); // rAF was the primary scheduler
		expect(component.onStoreChange).not.toHaveBeenCalled(); // rAF frozen, no delivery

		vi.advanceTimersByTime(219);
		expect(component.onStoreChange).not.toHaveBeenCalled(); // fallback not due yet

		vi.advanceTimersByTime(1); // cross the ~220ms boundary
		expect(component.onStoreChange).toHaveBeenCalledTimes(1); // fallback delivered
		expect(store._flushTimer).toBeNull(); // and cleared itself on the way out
	});

	it('flushes via rAF on the happy path and clears the fallback (delivered exactly once)', () => {
		// A rAF that CAPTURES its callback so we fire the "frame" by hand, after
		// _notify has finished arming the fallback timer.
		let frame = null;
		const liveRaf = vi.fn((cb) => {
			frame = cb;
			return 1;
		});
		vi.stubGlobal('requestAnimationFrame', liveRaf);

		const store = makeStore();
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => store.findOne('todo', 't1'));

		frame = null;
		setHidden(false);

		store.findOne('todo', 't1').update({ text: 'y' });
		expect(component.onStoreChange).not.toHaveBeenCalled(); // frame not fired yet
		expect(store._flushTimer).not.toBeNull(); // fallback armed alongside the rAF

		frame(); // the frame fires → rAF flush
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
		expect(store._flushTimer).toBeNull(); // rAF flush cleared the fallback

		// Advancing every remaining timer must NOT re-deliver: the fallback was
		// cleared, and flush() is idempotent even if a stray timer fired.
		vi.runAllTimers();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});
});

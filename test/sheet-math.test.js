import test from 'node:test';
import assert from 'node:assert/strict';

import { dismissProgress } from '../registry/lib/sheet-math.js';

test('dismissProgress saturates at and above the resting extent', () => {
	// Rest is the SHORTEST snap, so every position at or above it reports fully
	// on screen. This is the whole reason snap-to-snap travel and upward
	// rubber-band overscroll leave the scrim alone without a branch.
	assert.equal(dismissProgress(400, 400), 1);
	assert.equal(dismissProgress(700, 400), 1);
	assert.equal(dismissProgress(1200, 400), 1);
});

test('dismissProgress maps the travel below rest linearly onto [1, 0]', () => {
	assert.equal(dismissProgress(300, 400), 0.75);
	assert.equal(dismissProgress(200, 400), 0.5);
	assert.equal(dismissProgress(0, 400), 0);
});

test('dismissProgress floors at zero past the bottom edge', () => {
	assert.equal(dismissProgress(-120, 400), 0);
});

test('dismissProgress reports fully on screen when the extent is unmeasurable', () => {
	// DIVERGES from sheet-engine.js's dismissalZoneProgress, which answers 0 for
	// the same inputs — see sheet-engine.test.js. The engine always holds a
	// measured extent; this can be asked mid-gesture on a dialog that has not
	// laid out, and blanking the scrim over a plainly visible sheet is worse than
	// leaving it alone. Do not "reconcile" the two.
	for (const rest of [0, -400, NaN, Infinity, undefined]) {
		assert.equal(dismissProgress(300, rest), 1, String(rest));
	}
	assert.equal(dismissProgress(NaN, 400), 1);
});

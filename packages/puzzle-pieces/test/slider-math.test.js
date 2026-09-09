import test from 'node:test';
import assert from 'node:assert/strict';

import { configFrom, normalize, tickValues } from '../registry/lib/slider-math.js';

const single = (props, value) => normalize(value, 'single', configFrom(props), {});

// --- off-grid fractional max ------------------------------------------------
// `dec` must account for `max`, or the clamp's own bound gets rounded past.

test('normalize keeps an off-grid fractional max reachable', () => {
	assert.equal(single({ min: 0, max: 2.5, step: 1 }, 2.5), 2.5);
});

test('normalize keeps a .5 max on a larger range', () => {
	assert.equal(single({ min: 0, max: 7.5, step: 1 }, 7.5), 7.5);
});

test('normalize keeps a two-decimal max on a one-decimal step', () => {
	assert.equal(single({ min: 0, max: 1.05, step: 0.1 }, 1.05), 1.05);
});

// --- controls: on-grid maxima still quantize down ---------------------------

test('normalize still snaps below an on-grid integer max', () => {
	assert.equal(single({ min: 0, max: 100, step: 3 }, 100), 99);
});

test('normalize still snaps below an on-grid fractional max', () => {
	assert.equal(single({ min: 0, max: 1, step: 0.3 }, 1), 0.9);
});

// --- ticks ------------------------------------------------------------------

test('tickValues never generates a tick past an off-grid max', () => {
	const cfg = configFrom({ min: 0, max: 2.5, step: 1 });
	const ticks = tickValues(cfg, true);
	assert.ok(ticks.length > 0);
	for (const t of ticks) assert.ok(t.value <= cfg.max, `tick ${t.value} exceeds max ${cfg.max}`);
});

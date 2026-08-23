import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { linePath, stackSeries } from '../registry/lib/chart-math.js';

// --- stackSeries ------------------------------------------------------------

test('stackSeries treats numeric strings as numbers', () => {
	const rows = [{ a: '30', b: 10 }];
	const out = stackSeries(rows, ['a', 'b']);
	assert.deepEqual(out.a[0], [0, 30]);
	assert.deepEqual(out.b[0], [30, 40]);
});

test('stackSeries zeroes missing and non-finite values', () => {
	const rows = [{ a: null, b: 'x', c: Infinity, d: 5 }];
	const out = stackSeries(rows, ['a', 'b', 'c', 'd']);
	assert.deepEqual(out.a[0], [0, 0]);
	assert.deepEqual(out.b[0], [0, 0]);
	assert.deepEqual(out.c[0], [0, 0]);
	assert.deepEqual(out.d[0], [0, 5]);
});

test('stackSeries keeps cumulative order across keys', () => {
	const rows = [
		{ a: 1, b: 2 },
		{ a: 3, b: 4 },
	];
	const out = stackSeries(rows, ['a', 'b']);
	assert.deepEqual(out.b[1], [3, 7]);
});

// --- linePath ---------------------------------------------------------------

test('linePath renders a lone point as a zero-length segment', () => {
	const d = linePath([[10, 20]]);
	assert.match(d, /^M10 20L10 20$/);
});

test('linePath renders isolated points inside gaps', () => {
	const d = linePath([[0, 1], null, [5, 2], null, [9, 3]]);
	// three runs of length 1 → three degenerate segments
	assert.equal((d.match(/L/g) || []).length, 3);
	assert.equal((d.match(/M/g) || []).length, 3);
	assert.equal(d, 'M0 1L0 1M5 2L5 2M9 3L9 3');
});

test('linePath only degenerates the lone runs in a mixed series', () => {
	assert.equal(
		linePath([
			[0, 0],
			[1, 1],
			null,
			[3, 3],
			null,
			[5, 5],
			[6, 6],
		]),
		'M0 0L1 1M3 3L3 3M5 5L6 6'
	);
});

test('linePath leaves multi-point runs unchanged', () => {
	assert.equal(
		linePath([
			[0, 0],
			[1, 1],
		]),
		'M0 0L1 1'
	);
});

// Byte-for-byte pins on the pre-existing multi-point geometry: only runs of
// length 1 may change shape. These are the regression fence for the lone-point
// fix — every assertion below reproduces output from before the change.
test('linePath multi-point geometry is unchanged by the lone-point fix', () => {
	assert.equal(
		linePath([
			[0, 0],
			[1, 1],
			[2, 4],
			[3, 9],
		]),
		'M0 0L1 1L2 4L3 9'
	);
	// gap between two multi-point runs: pen lifts, no bridging segment
	assert.equal(
		linePath([
			[0, 0],
			[1, 1],
			null,
			[3, 3],
			[4, 4],
		]),
		'M0 0L1 1M3 3L4 4'
	);
	// a non-finite coordinate is a gap, exactly like null
	assert.equal(
		linePath([
			[0, 0],
			[1, 1],
			[NaN, 2],
			[3, 3],
			[4, 4],
			[5, Infinity],
			[6, 6],
			[7, 7],
		]),
		'M0 0L1 1M3 3L4 4M6 6L7 7'
	);
	// coordinates keep the 3-decimal rounding of fmt()
	assert.equal(
		linePath([
			[0.12345, 1.98765],
			[2.5, 3.0],
		]),
		'M0.123 1.988L2.5 3'
	);
	// leading and trailing gaps contribute nothing
	assert.equal(
		linePath([
			null,
			[1, 1],
			[2, 2],
			null,
		]),
		'M1 1L2 2'
	);
});

test('linePath returns an empty string for non-arrays and empty input', () => {
	assert.equal(linePath(null), '');
	assert.equal(linePath(undefined), '');
	assert.equal(linePath('nope'), '');
	assert.equal(linePath([]), '');
	assert.equal(linePath([null, null]), '');
});

// --- registry → demo parity -------------------------------------------------

const copies = [
	['chart-math.js', '../registry/lib/chart-math.js', '../demo/app/lib/chart-math.js'],
	[
		'AreaChart.pzl',
		'../registry/ui/area-chart/AreaChart.pzl',
		'../demo/app/components/ui/AreaChart.pzl',
	],
	[
		'LineChart.pzl',
		'../registry/ui/line-chart/LineChart.pzl',
		'../demo/app/components/ui/LineChart.pzl',
	],
	[
		'Sparkline.pzl',
		'../registry/ui/sparkline/Sparkline.pzl',
		'../demo/app/components/ui/Sparkline.pzl',
	],
];

test('registry and demo chart files stay byte-identical', async () => {
	for (const [name, registryPath, demoPath] of copies) {
		const [registrySource, demoSource] = await Promise.all([
			readFile(new URL(registryPath, import.meta.url)),
			readFile(new URL(demoPath, import.meta.url)),
		]);
		assert.equal(Buffer.compare(registrySource, demoSource), 0, `${name} copy drifted`);
	}
});

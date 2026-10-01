import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// SplitPanel's `snap` prop → the `snap` ATTRIBUTE the web component reads.
// data() is pure and DOM-free, so the <script> block lifts out of the .pzl and
// imports directly (same trick as input-otp-component.test.js).
//
// The bug this locks down: a bare `<SplitPanel snap>` used to render `snap=""`,
// and upstream parses the attribute as
//
//   raw.split(/[\s,]+/).map(Number).filter(finite && 0 <= n <= 100)
//
// falling back to 0/50/100 only when that list is EMPTY. `''.split(…)` is `['']`
// and `Number('')` is 0 — a valid point — so the fallback never fired and the
// only snap point was 0. Every drag released to a fully collapsed first pane.
const source = await readFile(
	new URL('../registry/ui/split-panel/SplitPanel/SplitPanel.pzl', import.meta.url),
	'utf8'
);
const script = source.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(script, 'SplitPanel.pzl contains a script block');

const puzzleViewStub = `
class PuzzleView {
	constructor() {
		this.props = {};
		this.element = null;
	}
}`;

const moduleSource = script.replace(
	"import { PuzzleView } from '@magic-spells/puzzle';",
	puzzleViewStub
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
const { default: SplitPanel } = await import(moduleUrl);

const snapAttr = (snap) => new SplitPanel().data({}, { snap }).snapAttr;

// Upstream's reader, verbatim from @magic-spells/split-panel 0.2.0 #snapShare.
function upstreamPoints(raw) {
	if (raw === null) return null;
	const parsed = raw
		.split(/[\s,]+/)
		.map(Number)
		.filter((point) => Number.isFinite(point) && point >= 0 && point <= 100);
	return parsed.length ? parsed : [0, 50, 100];
}

test('the piece never emits a bare/empty snap attribute', () => {
	for (const snap of [true, 'true', [0, 50, 100], '0 50 100', 'nonsense']) {
		const attr = snapAttr(snap);
		assert.notEqual(attr, '', `snap=${JSON.stringify(snap)} rendered a bare attribute`);
		assert.equal(typeof attr, 'string');
	}
});

test('bare snap resolves to the documented 0 / 50 / 100 default', () => {
	assert.equal(snapAttr(true), '0 50 100');
	assert.deepEqual(upstreamPoints(snapAttr(true)), [0, 50, 100]);
});

test('an empty attribute would have snapped to 0 only — the regression', () => {
	// Documents why the piece may not take the bare-attribute shortcut.
	assert.deepEqual(upstreamPoints(''), [0]);
});

test('explicit points pass through, as an array or a string', () => {
	assert.equal(snapAttr([0, 33, 66, 100]), '0 33 66 100');
	assert.equal(snapAttr('0, 33, 66, 100'), '0 33 66 100');
	assert.equal(snapAttr('25 75'), '25 75');
	assert.equal(snapAttr(50), '50');
	assert.deepEqual(upstreamPoints(snapAttr([0, 33, 66, 100])), [0, 33, 66, 100]);
});

test('out-of-range and unparseable points fall back to the default, never to 0', () => {
	assert.equal(snapAttr(['nope', 120, -5]), '0 50 100');
	assert.equal(snapAttr([]), '0 50 100');
	assert.equal(snapAttr('   '), '0 50 100');
});

test('no snap prop omits the attribute entirely', () => {
	for (const snap of [undefined, false, null, '', 0]) {
		assert.equal(snapAttr(snap), false, `snap=${JSON.stringify(snap)} must omit the attribute`);
	}
});

test('the other root props are untouched by the snap normalisation', () => {
	const view = new SplitPanel();
	const data = view.data({}, { snap: true, direction: 'vertical', disabled: true, id: 'editor' });
	assert.equal(data.direction, 'vertical');
	assert.equal(data.disabled, true);
	assert.equal(data.id, 'editor');
	assert.match(data.rootClass, /min-w-0 min-h-0/);
});

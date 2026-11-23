import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Drives DateRangePicker's dismissal the way the browser does, over a stub view
// (the input-otp-component.test.js trick): the parent passes props and counts
// @hide, and the test fires the events one interaction produces.
const file = new URL('../registry/ui/date-range-picker/DateRangePicker.pzl', import.meta.url);
const script = (await readFile(file, 'utf8')).match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
const moduleSource = script
	.replace(
		"import { PuzzleView } from '@magic-spells/puzzle';",
		`class PuzzleView {
			state = {};
			setState(key, value) { Object.assign(this.state, typeof key === 'string' ? { [key]: value } : key); }
			getData() { return this.state; }
		}`
	)
	.replace("import Calendar from './Calendar.pzl';", '')
	.replace('../../lib/date-math.js', new URL('../registry/lib/date-math.js', import.meta.url).href);
const { default: DateRangePicker } = await import(
	`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

globalThis.requestAnimationFrame = () => {};

const day = { name: 'a day in the open panel' };
const nextField = { name: 'the form field after the picker' };

test('Tab out of the open panel closes it; a move inside does not', () => {
	globalThis.document = { addEventListener() {}, removeEventListener() {} };

	let hides = 0;
	const view = new DateRangePicker();
	view.props = { hide: () => hides++ };
	view.element = { contains: (node) => node === day, querySelector: () => null };
	view.created();
	view.mounted();
	view.events.onTriggerClick();
	view.afterUpdate(); // the render that opened the panel

	view.events.onFocusOut({ relatedTarget: day });
	view.events.onFocusOut({ relatedTarget: null }); // a press on a non-focusable spot
	assert.equal(hides, 0);

	view.events.onFocusOut({ relatedTarget: nextField });
	assert.equal(hides, 1);
});

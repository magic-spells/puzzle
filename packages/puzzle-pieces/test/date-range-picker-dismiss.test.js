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

// Each test brings its own document: other files in all.test.js stub one too.
function mount(t, props) {
	const { document } = globalThis;
	t.after(() => (globalThis.document = document));
	const picker = { view: new DateRangePicker(), hides: 0, listeners: {} };
	globalThis.document = {
		addEventListener: (type, fn) => (picker.listeners[type] = fn),
		removeEventListener: (type) => delete picker.listeners[type],
	};
	picker.view.props = { ...props, hide: () => picker.hides++ };
	picker.view.element = { contains: (node) => node === day, querySelector: () => null };
	picker.view.created();
	picker.view.mounted();
	return picker;
}

test('Tab out of the open panel closes it; a move inside does not', (t) => {
	const picker = mount(t, {});
	picker.view.events.onTriggerClick();
	picker.view.afterUpdate(); // the render that opened the panel

	picker.view.events.onFocusOut({ relatedTarget: day });
	picker.view.events.onFocusOut({ relatedTarget: null }); // a press on a non-focusable spot
	assert.equal(picker.hides, 0);

	picker.view.events.onFocusOut({ relatedTarget: nextField });
	assert.equal(picker.hides, 1);
});

test('one outside click asks a controlled parent to close once', (t) => {
	const picker = mount(t, { open: true });

	// The press lands on the next field: pointerdown, then focus moves there.
	picker.listeners.pointerdown({ target: nextField });
	picker.view.events.onFocusOut({ relatedTarget: nextField });
	assert.equal(picker.hides, 1);

	// The parent's answer renders; the next open asks again.
	picker.view.props = { ...picker.view.props, open: false };
	picker.view.afterUpdate();
	picker.view.props = { ...picker.view.props, open: true };
	picker.view.afterUpdate();
	picker.view.events.onFocusOut({ relatedTarget: nextField });
	assert.equal(picker.hides, 2);
});

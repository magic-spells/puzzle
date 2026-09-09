import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Drives InputOtp's event handlers against a stub DOM. The piece is DOM-free
// apart from focus()/select()/value on its cells, so the <script> block can be
// lifted out of the .pzl and imported directly (same trick as
// sheet-component.test.js).
const otpFile = new URL('../registry/ui/input-otp/InputOtp.pzl', import.meta.url);
const otpSource = await readFile(otpFile, 'utf8');
const script = otpSource.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

assert.ok(script, 'InputOtp.pzl contains a script block');

const puzzleViewStub = `
class PuzzleView {
	constructor() {
		this.props = {};
		this.element = null;
		this._data = {};
	}

	getData() {
		return this._data;
	}
}`;

const moduleSource = script.replace(
	"import { PuzzleView } from '@magic-spells/puzzle';",
	puzzleViewStub
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
const { default: InputOtp } = await import(moduleUrl);

// A stub cell. focus() dispatches the focus event synchronously, exactly like
// HTMLElement.focus() does — that is what lets the piece's own _focus() calls
// re-enter onFocus, which is the interaction under test.
class StubCell {
	constructor(index, harness) {
		this.index = index;
		this.harness = harness;
		this.value = '';
		this.selectCount = 0;
	}

	focus() {
		if (this.harness.focused === this) return;
		this.harness.focused = this;
		this.harness.focusLog.push(this.index);
		this.harness.view.events.onFocus(this.harness.items[this.index], { target: this });
	}

	select() {
		this.selectCount += 1;
	}
}

// Mounts the view with a stub DOM. `change` records the emitted value and
// stages it as the next prop, but does NOT re-render — Puzzle commits data()
// on a later frame, so handlers must stay correct while getData() is stale.
// Call flush() to model that commit landing.
function mount(props = {}) {
	const harness = {
		view: new InputOtp(),
		cells: [],
		items: [],
		focused: null,
		focusLog: [],
		changes: [],
		completes: [],
	};

	harness.view.props = {
		...props,
		change: (next) => {
			harness.changes.push(next);
			harness.view.props.value = next;
		},
		complete: (next) => harness.completes.push(next),
	};

	harness.flush = () => {
		harness.view._data = harness.view.data({}, harness.view.props);
		for (const item of harness.view._data.items) {
			if (item.kind !== 'cell') continue;
			harness.items[item.index] = item;
			harness.cells[item.index] ??= new StubCell(item.index, harness);
			harness.cells[item.index].value = item.char;
		}
	};

	harness.view.element = {
		querySelector: (selector) =>
			harness.cells[Number(selector.match(/"(\d+)"/)[1])] ?? null,
	};

	// Simulate a user clicking a cell: the browser focuses it, then the piece
	// decides where focus actually belongs.
	harness.click = (index) => harness.cells[index].focus();

	// Simulate typing a character into whatever cell currently has focus.
	harness.type = (char) => {
		const cell = harness.focused;
		cell.value = char;
		harness.view.events.onInput(harness.items[cell.index], { target: cell });
	};

	harness.flush();
	return harness;
}

test('clicking an empty cell past the prefix lands on the first open slot', () => {
	const otp = mount({ value: '' });

	otp.click(2);

	assert.equal(otp.focused.index, 0);
});

test('clicking past a partial value lands on the first open slot', () => {
	const otp = mount({ value: '12' });

	otp.click(5);

	assert.equal(otp.focused.index, 2);
});

test('clicking inside the filled prefix keeps focus and selects the char', () => {
	const otp = mount({ value: '123' });

	otp.click(1);

	assert.equal(otp.focused.index, 1);
	assert.equal(otp.cells[1].selectCount, 1);
});

test('clicking a full code keeps focus on the clicked cell', () => {
	const otp = mount({ value: '123456' });

	otp.click(3);

	assert.equal(otp.focused.index, 3);
});

test('typing after clicking an out-of-range cell advances one slot, not from the click', () => {
	const otp = mount({ value: '' });

	otp.click(2);
	otp.type('5');

	assert.deepEqual(otp.changes, ['5']);
	assert.equal(otp.focused.index, 1);
});

test('an edit aimed past the prefix writes the slot it lands in', () => {
	const otp = mount({ value: '' });

	// Bypass the click redirect to prove the write index is clamped on its own.
	otp.cells[3].value = '5';
	otp.view.events.onInput(otp.items[3], { target: otp.cells[3] });

	assert.deepEqual(otp.changes, ['5']);
	assert.equal(otp.focusLog.at(-1), 1);
});

test('typing through every cell advances one at a time', () => {
	const otp = mount({ value: '' });

	otp.click(0);
	for (const char of '123456') {
		otp.type(char);
		otp.flush();
	}

	assert.deepEqual(otp.changes, ['1', '12', '123', '1234', '12345', '123456']);
	assert.deepEqual(otp.completes, ['123456']);
});

test('advancing focus is not bounced back by a stale data() commit', () => {
	const otp = mount({ value: '' });

	otp.click(0);
	otp.type('1');

	// change() has fired but data() has not been re-committed yet, so getData()
	// still reports value ''. Focus must stay where the piece put it.
	assert.equal(otp.focused.index, 1);
});

test('backspace on the first open slot clears the last char', () => {
	const otp = mount({ value: '12' });

	otp.click(4);
	otp.view.events.onKey(otp.items[otp.focused.index], {
		key: 'Backspace',
		preventDefault: () => {},
	});

	assert.deepEqual(otp.changes, ['1']);
	assert.equal(otp.focused.index, 1);
});

test('paste aimed past the prefix fills from the first open slot', () => {
	const otp = mount({ value: '12' });

	otp.view.events.onPaste(otp.items[5], {
		preventDefault: () => {},
		clipboardData: { getData: () => '3456' },
	});

	assert.deepEqual(otp.changes, ['123456']);
});

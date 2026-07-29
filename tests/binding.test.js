// @vitest-environment jsdom
//
// Implicit two-way form binding — the RUNTIME half (D147).
//
// The compiler synthesizes `'@input:bind': this.__bind(target, key, spec)` on
// qualifying form controls; this suite pins what that call must do. The views
// under test are the Go compiler's ACTUAL output
// (tests/fixtures/binding/*.compiled.js, produced by `npm run build:binding`
// from the .pzl sources beside them), so a green run proves the emitted shape
// and the runtime dispatch agree.
//
// Three write arms, chosen at write time from the target: null → local state
// (setData + refresh), a duck-typed record (update + string _type) →
// PuzzleModel.update(), anything else → direct property mutation + refresh.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountView, measureRenders, settled } from '../client-runtime/testing/index.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { setErrorHandler } from '../client-runtime/errors.js';
import LocalForm from './fixtures/binding/LocalForm.compiled.js';
import RecordForm from './fixtures/binding/RecordForm.compiled.js';
import PlainForm from './fixtures/binding/PlainForm.compiled.js';
import TodoTitles from './fixtures/binding/TodoTitles.compiled.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string().required(),
		completed: Puzzle.boolean().default(false),
		rank: Puzzle.number().default(0),
	};
}

const makeStorage = () => {
	const cells = new Map();
	return {
		getItem: vi.fn((key) => (cells.has(key) ? cells.get(key) : null)),
		setItem: vi.fn((key, value) => cells.set(key, value)),
		removeItem: vi.fn((key) => cells.delete(key)),
	};
};

const todoStore = (options = {}) => {
	const store = new Store({ todo: Todo }, options);
	store.createRecord('todo', { id: '1', text: 'wash', rank: 1 });
	store.createRecord('todo', { id: '2', text: 'fold', rank: 2 });
	return store;
};

// A bubbling event on the bound element. InputEvent carries `isComposing`, which
// the IME guard reads; a plain Event leaves it undefined (falsy), same as a
// programmatic dispatch in a real browser.
const fire = (el, name, init = {}) =>
	el.dispatchEvent(new InputEvent(name, { bubbles: true, ...init }));

const handles = [];
const mount = async (View, options) => {
	const handle = await mountView(View, options);
	handles.push(handle);
	return handle;
};

afterEach(() => {
	handles.splice(0).forEach((handle) => handle.destroy());
	vi.restoreAllMocks();
});

describe('implicit binding — local-state arm', () => {
	it('writes the bound field and re-runs data() so derived values stay live', async () => {
		const view = await mount(LocalForm);
		const input = view.find('input.draft');
		// every word contains '' — the derived count starts at 4
		expect(view.find('p.matches').textContent).toBe('4');

		input.value = 'al';
		fire(input, 'input');
		await settled();

		expect(view.instance.getData().draft).toBe('al');
		// data() re-ran: only 'alpha' contains 'al'. A bare setData would have left
		// this at 4 — the search-box case the refresh() exists for.
		expect(view.find('p.matches').textContent).toBe('1');
	});

	it('costs exactly one render per keystroke', async () => {
		const view = await mount(LocalForm);
		const input = view.find('input.draft');

		const report = await measureRenders(async () => {
			input.value = 'be';
			fire(input, 'input');
			await settled();
		});

		// setData arms a frame, the synchronous refresh() renders and disarms it.
		expect(report.renders).toBe(1);
		expect(view.instance.getData().draft).toBe('be');
	});

	it('writes nothing back to the element on the echo render — caret preserved', async () => {
		// Mirrors the value-setter spy in tests/vdom.test.js: the bound value the
		// patch sees already equals the live DOM property, so patchAttrs must skip
		// the write. A write here would reset the caret to the end on every keystroke.
		const view = await mount(LocalForm);
		const input = view.find('input.draft');
		const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
		let writes = 0;
		Object.defineProperty(input, 'value', {
			configurable: true,
			get: desc.get,
			set(v) {
				writes++;
				desc.set.call(this, v);
			},
		});

		input.value = 'ab'; // the user's typing
		writes = 0; // count only what the framework does from here
		fire(input, 'input');
		await settled();

		expect(view.instance.getData().draft).toBe('ab');
		expect(writes).toBe(0);
		expect(input.value).toBe('ab');
	});

	it('ignores an input event fired mid-IME-composition', async () => {
		const view = await mount(LocalForm);
		const input = view.find('input.draft');

		input.value = 'にほ';
		fire(input, 'input', { isComposing: true });
		await settled();
		expect(view.instance.getData().draft).toBe('');

		// the final input after compositionend carries isComposing:false — it lands
		fire(input, 'input', { isComposing: false });
		await settled();
		expect(view.instance.getData().draft).toBe('にほ');
	});
});

describe('implicit binding — coercion matrix', () => {
	it('binds a text input as a string on input', async () => {
		const view = await mount(LocalForm);
		const input = view.find('input.draft');
		input.value = 'hello';
		fire(input, 'input');
		await settled();
		expect(view.instance.getData().draft).toBe('hello');
	});

	it('binds a textarea as a string on input', async () => {
		const view = await mount(LocalForm);
		const area = view.find('textarea.notes');
		area.value = 'a note';
		fire(area, 'input');
		await settled();
		expect(view.instance.getData().notes).toBe('a note');
	});

	it('binds a single select as a string on change', async () => {
		const view = await mount(LocalForm);
		const select = view.find('select.sort');
		select.value = 'done';
		fire(select, 'change');
		await settled();
		expect(view.instance.getData().sort).toBe('done');
	});

	it('binds a checkbox as a boolean on change', async () => {
		const view = await mount(LocalForm);
		const box = view.find('input.agree');
		box.checked = true;
		fire(box, 'change');
		await settled();
		expect(view.instance.getData().agree).toBe(true);

		box.checked = false;
		fire(box, 'change');
		await settled();
		expect(view.instance.getData().agree).toBe(false);
	});

	it('binds a number input as a number on change, and an emptied one as null', async () => {
		const view = await mount(LocalForm);
		const age = view.find('input.age');

		age.value = '42';
		fire(age, 'change');
		await settled();
		expect(view.instance.getData().age).toBe(42);

		age.value = '';
		fire(age, 'change');
		await settled();
		// Number('') is 0, which would rewrite a just-cleared field to "0" and jump
		// the caret. null renders as '' (displayValue), so the field stays cleared.
		expect(view.instance.getData().age).toBe(null);
		expect(age.value).toBe('');
	});

	it('binds a range input as a number on input', async () => {
		const view = await mount(LocalForm);
		const range = view.find('input.volume');
		range.value = '7';
		fire(range, 'input');
		await settled();
		expect(view.instance.getData().volume).toBe(7);
	});

	it('skips the write entirely when a numeric coercion yields NaN', async () => {
		// jsdom (like every browser) sanitizes an unparseable number-input value to
		// '' before it is readable, so this row is unreachable through a real
		// dispatch. Drive the memoized handler directly with a constructed event —
		// it is the same function identity the render installed.
		const view = await mount(LocalForm);
		const age = view.find('input.age');
		age.value = '42';
		fire(age, 'change');
		await settled();
		expect(view.instance.getData().age).toBe(42);

		const handler = view.instance.__bind(null, 'age', 'vn');
		const report = await measureRenders(async () => {
			handler({ target: { value: '-' } });
			await settled();
		});

		expect(view.instance.getData().age).toBe(42); // untouched, never NaN
		expect(report.renders).toBe(0); // no write at all, so no render
	});
});

describe('implicit binding — handler memoization', () => {
	it('returns one stable handler per (target, key, spec) across renders', async () => {
		const view = await mount(LocalForm);
		const first = view.instance.__bind(null, 'draft', 'v');

		view.instance.refresh();
		await settled();

		expect(view.instance.__bind(null, 'draft', 'v')).toBe(first);
		// key and spec both participate in the memo key
		expect(view.instance.__bind(null, 'notes', 'v')).not.toBe(first);
		expect(view.instance.__bind(null, 'draft', 'vn')).not.toBe(first);
	});

	it('memoizes member handlers per target object, and a replaced record gets a new one', async () => {
		const store = todoStore();
		const view = await mount(RecordForm, { store });
		const first = store.findOne('todo', '1');
		const second = store.findOne('todo', '2');

		const handler = view.instance.__bind(first, 'text', 'v');
		expect(view.instance.__bind(first, 'text', 'v')).toBe(handler);
		expect(view.instance.__bind(first, 'rank', 'vn')).not.toBe(handler);
		// a DIFFERENT record object is a different memo bucket
		expect(view.instance.__bind(second, 'text', 'v')).not.toBe(handler);
	});
});

describe('implicit binding — record arm', () => {
	it('writes through update(), re-renders a subscribed sibling, and persists', async () => {
		const storage = makeStorage();
		const store = todoStore({ storage, storageKey: 'binding-test' });
		const view = await mount(RecordForm, { store });
		const sibling = await mount(TodoTitles, { store });
		expect(sibling.find('.titles').textContent).toBe('wash|fold');

		const record = store.findOne('todo', '1');
		const update = vi.spyOn(record, 'update');
		const input = view.findAll('input.text')[0];

		input.value = 'wash up';
		fire(input, 'input');
		await settled();

		// the write goes through the model's validated mutation path, not a raw set
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith({ text: 'wash up' });
		expect(record.text).toBe('wash up');
		// the sibling's data() query auto-subscribed, so the store flush re-rendered it
		expect(sibling.find('.titles').textContent).toBe('wash up|fold');
		// and the batched persistence write observed the change
		expect(storage.setItem).toHaveBeenCalled();
		expect(storage.setItem.mock.calls.at(-1)[1]).toContain('wash up');
	});

	it('coerces record binds the same way as local ones', async () => {
		const store = todoStore();
		const view = await mount(RecordForm, { store });
		const record = store.findOne('todo', '1');

		const box = view.findAll('input.done')[0];
		box.checked = true;
		fire(box, 'change');
		await settled();
		expect(record.completed).toBe(true);

		const rank = view.findAll('input.rank')[0];
		rank.value = '9';
		fire(rank, 'change');
		await settled();
		expect(record.rank).toBe(9);
	});

	it('routes a validation throw to onError with phase "bind" and leaves state and DOM alone', async () => {
		const store = todoStore();
		const view = await mount(RecordForm, { store });
		const onError = vi.fn();
		setErrorHandler(view.ctx, onError);

		const record = store.findOne('todo', '1');
		const input = view.findAll('input.text')[0];
		input.value = ''; // `text` is required() — update() throws before mutating
		fire(input, 'input');
		await settled();

		expect(onError).toHaveBeenCalledTimes(1);
		const [error, info] = onError.mock.calls[0];
		expect(error.name).toBe('PuzzleValidationError');
		expect(info.phase).toBe('bind');
		expect(info.view).toBe(view.instance);
		// the record never moved, and nothing re-rendered — the typed text survives
		expect(record.text).toBe('wash');
		expect(input.value).toBe('');

		setErrorHandler(view.ctx, null);
	});

	it('logs the rejected write when the app declares no onError hook', async () => {
		const store = todoStore();
		const view = await mount(RecordForm, { store });
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const input = view.findAll('input.text')[0];
		input.value = '';
		fire(input, 'input');
		await settled();

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toContain('[puzzle]');
		expect(store.findOne('todo', '1').text).toBe('wash');
	});
});

describe('implicit binding — plain-object arm', () => {
	it('mutates the object and re-renders its owner', async () => {
		const view = await mount(PlainForm);
		const hue = view.find('input.hue');

		const report = await measureRenders(async () => {
			hue.value = 'blue';
			fire(hue, 'input');
			await settled();
		});

		expect(view.instance.profile.hue).toBe('blue');
		expect(report.renders).toBe(1);
		expect(view.find('input.hue').value).toBe('blue');
	});

	it('applies the numeric coercion on a plain-object member too', async () => {
		const view = await mount(PlainForm);
		const size = view.find('input.size');
		size.value = '9';
		fire(size, 'change');
		await settled();
		expect(view.instance.profile.size).toBe(9);
	});

	it('takes the plain arm for an object with update() but no string _type', async () => {
		// Record detection is duck-typed on BOTH members together, so a plain object
		// that merely owns an update() method is mutated directly.
		const view = await mount(PlainForm);
		const update = vi.fn();
		view.instance.ducky.update = update;

		const input = view.find('input.ducky');
		input.value = 'moo';
		fire(input, 'input');
		await settled();

		expect(update).not.toHaveBeenCalled();
		expect(view.instance.ducky.label).toBe('moo');

		// adding the second half of the duck-type flips it to the record arm
		view.instance.ducky._type = 'todo';
		input.value = 'quack again';
		fire(input, 'input');
		await settled();

		expect(update).toHaveBeenCalledWith({ label: 'quack again' });
		expect(view.instance.ducky.label).toBe('moo'); // the stub update() writes nothing
	});
});

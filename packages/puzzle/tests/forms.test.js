// @vitest-environment jsdom
//
// the optional forms module (d192): `createForm(view, Model, options)` and the
// controller it writes to view state. two halves:
//
// 1. the controller against a stub view (no dom), for the bookkeeping rules:
//    seeding, touched, changed/dirty, visible errors, submit, server-error
//    mapping and reset.
// 2. a compiled view end to end (tests/fixtures/forms, built by
//    `npm run build:forms`): a raw input bound through the deep d147 path
//    `form.values.title`, the real field piece from puzzle-pieces wired by
//    `form` + `name`, one @focusout touch handler, and a real submit event.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountView, settled, type } from '../client-runtime/testing/index.js';
import { PuzzleModel, Puzzle, PuzzleValidationError } from '../client-runtime/model.js';
import { PuzzleAdapterError } from '../client-runtime/datastore/adapter.js';
import { setErrorHandler } from '../client-runtime/errors.js';
import { RENDER_REV } from '../client-runtime/renderRev.js';
import { createForm } from '../client-runtime/forms.js';
import { safeState } from '../client-runtime/devstate.js';
import PostForm from './fixtures/forms/PostForm.compiled.js';

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required('Title is required'),
		body: Puzzle.string().validate((v) => v.length <= 10, 'Body is too long'),
		status: Puzzle.string().default('draft'),
		publishedAt: Puzzle.date(),
	};
}

/**
 * a stand-in view: records every setState the controller makes.
 * @returns {{ setState: import('vitest').Mock, ctx: null, route: null }}
 */
const stubView = () => ({ setState: vi.fn(), ctx: null, route: null });

/** a deferred promise the test resolves or rejects by hand. */
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe('createForm — the controller', () => {
	it('throws when the second argument is not a model class', () => {
		expect(() => createForm(stubView(), {})).toThrow(/Model must be a PuzzleModel class/);
	});

	it('writes itself to view state under "form", or under options.key', () => {
		const view = stubView();
		const form = createForm(view, Post);
		expect(view.setState).toHaveBeenLastCalledWith('form', form);

		const other = stubView();
		const login = createForm(other, Post, { key: 'login' });
		expect(other.setState).toHaveBeenLastCalledWith('login', login);
	});

	it('seeds from the source, filling schema defaults and nulls', () => {
		const form = createForm(stubView(), Post, { from: { id: 'p1', title: 'Hello' } });
		expect({ ...form.values }).toEqual({
			id: 'p1',
			title: 'Hello',
			body: null,
			status: 'draft',
			publishedAt: null,
		});
		expect(form.source).toEqual({ id: 'p1', title: 'Hello' });
		expect(form.dirty).toBe(false);
		expect(form.submitting).toBe(false);
		expect(form.error).toBe(null);
	});

	it('edits only the listed fields when options.fields is given', () => {
		const form = createForm(stubView(), Post, { fields: ['title'] });
		expect(Object.keys(form.values)).toEqual(['title']);
		// a write to a field the form does not edit is ignored
		form.set('body', 'x');
		expect('body' in form.values).toBe(false);
	});

	it('tracks changed per field and dirty, treating empty values alike and dates by time', () => {
		const when = new Date('2026-01-01T00:00:00Z');
		const form = createForm(stubView(), Post, { from: { title: 'A', publishedAt: when } });

		form.values.title = 'B';
		expect(form.changed.title).toBe(true);
		expect(form.dirty).toBe(true);

		form.values.title = 'A';
		expect(form.changed.title).toBe(false);
		expect(form.dirty).toBe(false);

		// a cleared input writes '' over a field the source never set
		form.set('body', '');
		expect(form.changed.body).toBe(false);

		// an equal date is not a change
		form.set('publishedAt', new Date(when.getTime()));
		expect(form.changed.publishedAt).toBe(false);
	});

	it('hides errors until a field is touched, then clears them as soon as the value is fixed', () => {
		const form = createForm(stubView(), Post, { fields: ['title'] });
		expect(form.valid).toBe(false);
		expect(form.errors.title).toBe(null);

		form.touch('title');
		expect(form.touched.title).toBe(true);
		expect(form.errors.title).toBe('Title is required');

		form.set('title', 'ok');
		expect(form.errors.title).toBe(null);
		expect(form.valid).toBe(true);

		// once touched, it re-checks on every edit
		form.set('title', '');
		expect(form.errors.title).toBe('Title is required');
	});

	it('touches from a focus event by its target name, and ignores unknown names', () => {
		const view = stubView();
		const form = createForm(view, Post, { fields: ['title'] });
		form.touch({ target: { name: 'title' } });
		expect(form.touched.title).toBe(true);

		// touching again, or touching something that is not a field, writes nothing
		const calls = view.setState.mock.calls.length;
		form.touch('title');
		form.touch({ target: { name: 'search' } });
		form.touch({ target: {} });
		expect(view.setState.mock.calls.length).toBe(calls);
	});

	it('bumps the render revision and replaces the derived maps on every change', () => {
		const form = createForm(stubView(), Post, { fields: ['title'] });
		const rev = form[RENDER_REV];
		const errors = form.errors;
		const values = form.values;
		form.set('title', 'x');
		expect(form[RENDER_REV]).toBe(rev + 1);
		expect(form.errors).not.toBe(errors);
		// values stays the same object so a bind's target never moves
		expect(form.values).toBe(values);
	});

	it('refuses an invalid submit, shows every error and never calls fn', async () => {
		const form = createForm(stubView(), Post, { fields: ['title', 'body'] });
		const fn = vi.fn();
		const event = { preventDefault: vi.fn() };
		await expect(form.submit(event, fn)).resolves.toBe(false);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(fn).not.toHaveBeenCalled();
		expect(form.errors.title).toBe('Title is required');
		expect(form.submitting).toBe(false);
	});

	it('focuses the first invalid control the submitted form holds', async () => {
		const form = createForm(stubView(), Post, { fields: ['title'] });
		const control = { focus: vi.fn() };
		const namedItem = vi.fn(() => control);
		await form.submit({ preventDefault() {}, target: { elements: { namedItem } } }, vi.fn());
		expect(namedItem).toHaveBeenCalledWith('title');
		expect(control.focus).toHaveBeenCalled();
	});

	it('submits a plain copy, flags submitting while in flight, and rebases on success', async () => {
		const form = createForm(stubView(), Post, { from: { title: 'A' }, fields: ['title'] });
		form.set('title', 'B');
		form.touch('title');

		const gate = deferred();
		const fn = vi.fn(() => gate.promise);
		const pending = form.submit(fn);
		await Promise.resolve();
		expect(form.submitting).toBe(true);

		// the callback gets plain data, not the accessor object
		const [values] = fn.mock.calls[0];
		expect(values).toEqual({ title: 'B' });
		expect(values).not.toBe(form.values);

		// a second submit while one is pending is refused at once
		await expect(form.submit(fn)).resolves.toBe(false);
		expect(fn).toHaveBeenCalledTimes(1);

		gate.resolve();
		await expect(pending).resolves.toBe(true);
		expect(form.submitting).toBe(false);
		expect(form.dirty).toBe(false);
		expect(form.touched.title).toBe(false);
	});

	it('rebases on what was sent: an edit made during the save stays dirty, a reseed keeps its baseline', async () => {
		const form = createForm(stubView(), Post, { from: { title: 'A' }, fields: ['title'] });
		form.set('title', 'B');
		let gate = deferred();
		let pending = form.submit(() => gate.promise);
		form.set('title', 'B and more');
		gate.resolve();
		await expect(pending).resolves.toBe(true);
		expect(form.values.title).toBe('B and more');
		expect(form.changed.title).toBe(true);
		expect(form.dirty).toBe(true);

		// a reseed while the save runs keeps the new record's baseline
		gate = deferred();
		pending = form.submit(() => gate.promise);
		form.reset({ title: 'Next record' });
		gate.resolve();
		await expect(pending).resolves.toBe(true);
		expect(form.values.title).toBe('Next record');
		expect(form.dirty).toBe(false);
	});

	it('maps a model validation error onto its fields', async () => {
		const form = createForm(stubView(), Post, { from: { title: 'A' }, fields: ['title'] });
		const fn = () => {
			throw new PuzzleValidationError([{ field: 'title', rule: 'custom', message: 'Taken' }]);
		};
		await expect(form.submit(fn)).resolves.toBe(false);
		expect(form.errors.title).toBe('Taken');
		expect(form.error).toBe(null);

		// editing the field clears its server message
		form.set('title', 'B');
		expect(form.errors.title).toBe(null);
	});

	it('maps an adapter error body in object or array form, and sends unknown names to error', async () => {
		const form = createForm(stubView(), Post, { from: { title: 'A', body: 'b' }, fields: ['title', 'body'] });

		const objectBody = new PuzzleAdapterError(422, 'Unprocessable', {
			errors: { title: ['is taken', 'is short'], base: 'Try again later' },
		});
		await form.submit(() => Promise.reject(objectBody));
		expect(form.errors.title).toBe('is taken');
		expect(form.error).toBe('Try again later');

		const arrayBody = new PuzzleAdapterError(422, 'Unprocessable', {
			errors: [
				{ field: 'body', message: 'is rude' },
				{ field: 'body', message: 'second message is dropped' },
			],
		});
		await form.submit(() => Promise.reject(arrayBody));
		expect(form.errors.body).toBe('is rude');
		// the new attempt dropped the old server answer
		expect(form.errors.title).toBe(null);
		expect(form.error).toBe(null);
	});

	it('uses a custom serverErrors mapper when given one', async () => {
		const serverErrors = vi.fn((err) => ({ title: err.reason }));
		const form = createForm(stubView(), Post, { from: { title: 'A' }, fields: ['title'], serverErrors });
		await form.submit(() => Promise.reject({ reason: 'nope' }));
		expect(serverErrors).toHaveBeenCalled();
		expect(form.errors.title).toBe('nope');
	});

	it('is left out of the dev hmr snapshot, so created() rebuilds a live controller', () => {
		const form = createForm(stubView(), Post, { fields: ['title'] });
		expect(safeState({ form, draft: 'kept' })).toEqual({ draft: 'kept' });
	});

	it('resets to the baseline, or reseeds from a new source', () => {
		const form = createForm(stubView(), Post, { from: { title: 'A' }, fields: ['title'] });
		form.set('title', 'B');
		form.touch('title');
		form.reset();
		expect(form.values.title).toBe('A');
		expect(form.dirty).toBe(false);
		expect(form.touched.title).toBe(false);

		const next = { title: 'C' };
		form.reset(next);
		expect(form.values.title).toBe('C');
		expect(form.source).toBe(next);
		expect(form.dirty).toBe(false);
	});
});

describe('createForm — in a compiled view with the field piece', () => {
	const handles = [];
	const mount = async (options) => {
		const handle = await mountView(PostForm, options);
		handles.push(handle);
		return handle;
	};

	afterEach(() => {
		handles.splice(0).forEach((handle) => handle.destroy());
		vi.restoreAllMocks();
	});

	// a bubbling blur, the way a real control reports leaving
	const leave = async (el) => {
		el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		el.dispatchEvent(new FocusEvent('blur'));
		await settled();
	};
	const submit = async (view) => {
		view.find('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await view.instance.pending;
		await settled();
	};

	it('seeds the bound input and the field piece from the source', async () => {
		const view = await mount({ props: { Model: Post, post: { title: 'Hello', body: 'Hi' }, onSave: vi.fn() } });
		expect(view.find('input.title').value).toBe('Hello');
		expect(view.find('input[name="body"]').value).toBe('Hi');
		expect(view.find('p.flags').textContent).toBe('clean idle');
	});

	it('writes typing through the deep bind and shows the error only after the field is left', async () => {
		const view = await mount({ props: { Model: Post, post: { title: 'Hello' }, onSave: vi.fn() } });
		const input = view.find('input.title');

		await type(input, '');
		expect(view.instance.form.values.title).toBe('');
		expect(view.find('p.flags').textContent).toBe('dirty idle');
		expect(view.find('p.title-error')).toBe(null);

		await leave(input);
		expect(view.find('p.title-error').textContent).toBe('Title is required');

		await type(input, 'Back');
		expect(view.find('p.title-error')).toBe(null);
	});

	it('drives the field piece through form.set and form.touch', async () => {
		const view = await mount({ props: { Model: Post, post: { title: 'Hello' }, onSave: vi.fn() } });
		const body = view.find('input[name="body"]');

		await type(body, 'far too long here');
		expect(view.instance.form.values.body).toBe('far too long here');
		// not shown until the field is left
		expect(body.getAttribute('aria-invalid')).toBe(null);

		await leave(body);
		const message = view.findAll('p').find((p) => p.textContent === 'Body is too long');
		expect(message).toBeTruthy();
		expect(body.getAttribute('aria-invalid')).toBe('true');
	});

	it('submits valid input once and goes clean, and refuses invalid input', async () => {
		const onSave = vi.fn();
		const view = await mount({ props: { Model: Post, post: { title: 'Hello' }, onSave } });

		await type(view.find('input.title'), '');
		await submit(view);
		expect(onSave).not.toHaveBeenCalled();
		expect(view.find('p.title-error').textContent).toBe('Title is required');

		await type(view.find('input.title'), 'Fixed');
		await submit(view);
		expect(onSave).toHaveBeenCalledWith({ title: 'Fixed', body: null });
		expect(view.find('p.flags').textContent).toBe('clean idle');
	});

	it('shows an unmapped failure as form.error and reports it to onError with phase submit', async () => {
		const failure = new Error('network down');
		const view = await mount({
			props: { Model: Post, post: { title: 'Hello' }, onSave: () => Promise.reject(failure) },
		});
		const onError = vi.fn();
		setErrorHandler(view.ctx, onError);

		await submit(view);
		expect(view.find('p.form-error').textContent).toBe('network down');
		expect(onError).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({ phase: 'submit', view: view.instance })
		);
	});

	it('resets from a view handler', async () => {
		const view = await mount({ props: { Model: Post, post: { title: 'Hello' }, onSave: vi.fn() } });
		await type(view.find('input.title'), 'Changed');
		view.find('button.cancel').click();
		await settled();
		expect(view.find('input.title').value).toBe('Hello');
		expect(view.find('p.flags').textContent).toBe('clean idle');
	});
});

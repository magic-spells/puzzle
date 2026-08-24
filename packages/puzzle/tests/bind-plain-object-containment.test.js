// @vitest-environment jsdom
//
// D147 bind write arms + D145 containment. The plain-object arm assigns straight
// to `target[key]`, and the write target is app-supplied: it need not be
// writable. `route.query` is frozen (D83), and every module is strict, so
// `data() { return { query: this.route.query } }` with `value={ query.q }` throws
// on EVERY keystroke. Unwrapped, that throw escaped the DOM listener as an
// uncaught window error and never reached the reporting funnel — unlike the
// record arm beside it, which has always reported.
//
// Also pins the attribute-name label on the PROPS path's undefined diagnostic.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView, settled } from '../client-runtime/testing/index.js';
import { setErrorHandler } from '../client-runtime/errors.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);

const handles = [];
afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('plain-object bind writes are contained (D145)', () => {
	it('a frozen bind root reports through the funnel instead of throwing', async () => {
		const query = Object.freeze({ q: 'hi' });

		class Search extends PuzzleView {
			data() {
				return { query };
			}
			render() {
				const q = this.getData().query;
				return h('puzzle-view', { class: 'search' }, [
					h('input', { type: 'text', value: q.q, '@input:bind': this.__bind(q, 'q', 'v') }),
				]);
			}
		}

		const view = await mountView(Search, {});
		handles.push(view);

		const reports = [];
		setErrorHandler(view.ctx, (error, info) => reports.push({ error, info }));

		const input = view.find('input');
		input.value = 'hello';
		// The compiled bind handler, invoked exactly as the DOM listener invokes it.
		const handler = view.instance.__bind(query, 'q', 'v');
		expect(() => handler({ target: input })).not.toThrow();
		await settled();

		expect(reports).toHaveLength(1);
		expect(reports[0].info.phase).toBe('bind');
		expect(reports[0].error).toBeInstanceOf(TypeError);
		// The write is lost (the object really is frozen), but the control keeps the
		// text the user typed rather than being reverted by an aborted handler.
		expect(input.value).toBe('hello');
		expect(query.q).toBe('hi');
	});

	it('a getter-only bind root is contained the same way', async () => {
		const target = {};
		Object.defineProperty(target, 'title', { get: () => 'read only', enumerable: true });

		class Form extends PuzzleView {
			data() {
				return { row: target };
			}
			render() {
				const row = this.getData().row;
				return h('puzzle-view', { class: 'form' }, [
					h('input', {
						type: 'text',
						value: row.title,
						'@input:bind': this.__bind(row, 'title', 'v'),
					}),
				]);
			}
		}

		const view = await mountView(Form, {});
		handles.push(view);

		const reports = [];
		setErrorHandler(view.ctx, (error, info) => reports.push({ error, info }));

		const input = view.find('input');
		input.value = 'typed';
		const handler = view.instance.__bind(target, 'title', 'v');
		expect(() => handler({ target: input })).not.toThrow();
		await settled();

		expect(reports).toHaveLength(1);
		expect(reports[0].info.phase).toBe('bind');
		expect(input.value).toBe('typed');
	});

	it('a writable plain-object root still writes and re-renders', async () => {
		const row = { title: 'before' };
		class Form extends PuzzleView {
			data() {
				return { row };
			}
			render() {
				const r = this.getData().row;
				return h('puzzle-view', { class: 'form' }, [
					h('input', { type: 'text', value: r.title, '@input:bind': this.__bind(r, 'title', 'v') }),
				]);
			}
		}

		const view = await mountView(Form, {});
		handles.push(view);
		const reports = [];
		setErrorHandler(view.ctx, (error, info) => reports.push({ error, info }));

		const input = view.find('input');
		input.value = 'after';
		view.instance.__bind(row, 'title', 'v')({ target: input });
		await settled();

		expect(reports).toEqual([]);
		expect(row.title).toBe('after');
		expect(view.find('input').value).toBe('after');
	});
});

describe('undefined-value diagnostic labels the attribute (PROPS path)', () => {
	it('names the prop instead of warning namelessly', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		class Broken extends PuzzleView {
			data() {
				return {};
			}
			render() {
				return h('puzzle-view', {}, [h('input', { type: 'text', value: undefined })]);
			}
		}

		const view = await mountView(Broken, {});
		handles.push(view);

		const messages = warn.mock.calls.map((args) => String(args[0]));
		const undefinedWarnings = messages.filter((m) => m.includes('undefined template value'));
		expect(undefinedWarnings.length).toBeGreaterThan(0);
		// Labeled — so it is attributable AND dedups per attribute rather than
		// collapsing every unlabeled site in the app into one '' key.
		expect(undefinedWarnings.some((m) => m.includes('for "value"'))).toBe(true);
	});
});

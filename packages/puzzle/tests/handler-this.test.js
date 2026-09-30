// @vitest-environment jsdom
// D03 — the runtime calls every `events` handler as `this.events.name(…)`, so a
// method-shorthand or `function` handler runs with the events object as `this`:
// it compiles, then breaks when the event fires. A view's first mount warns in
// development, once per view class, for each such handler that uses `this`. The
// fixtures (tests/fixtures/handler-this, built by the build:handler-this pretest
// script) are real compiler output, so the TypeScript one has been through the
// same esbuild type strip as a `<script lang="ts">` in an app.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatterRegistry } from '../client-runtime/formatters.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import HandlerForms from './fixtures/handler-this/HandlerForms.compiled.js';
import HandlerFormsTs from './fixtures/handler-this/HandlerFormsTs.compiled.js';

function container() {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}

const thisWarnings = (warn) =>
	warn.mock.calls.map((call) => call[0]).filter((message) => message.includes('is not an arrow function'));

const click = (el, selector) => el.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	delete globalThis.__PUZZLE_DEV__;
});

describe('events handler that is not an arrow and uses `this` (D03)', () => {
	it('warns for method shorthand, a function expression and async shorthand — once per class', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = container();
		const view = new HandlerForms({ formatters: new FormatterRegistry() });
		await view.mount(el);

		const messages = thisWarnings(warn);
		expect(messages).toEqual([
			'[puzzle] HandlerForms.pzl: handler `play` uses `this` but is not an arrow function — the runtime calls it as this.events.play(…), so `this` is the events object, not the component; write it as an arrow function: `play: (…) => { … }`',
			expect.stringContaining('handler `legacy` uses `this` but is not an arrow function'),
			expect.stringContaining('write it as an arrow function: `load: async (…) => { … }`'),
		]);

		// The trap the warning names: the shorthand wrote to the events object.
		click(el, '.play');
		expect(view.events.played).toBe(true);

		// Clicks, re-renders and more instances of the class say nothing more.
		click(el, '.bump');
		click(el, '.bump');
		click(el, '.reset');
		await vi.waitFor(() => expect(el.querySelector('.bump').textContent).toBe('2'));
		await new HandlerForms({ formatters: new FormatterRegistry() }).mount(container());
		expect(thisWarnings(warn)).toHaveLength(3);
	});

	it('reads a TypeScript component the same way after the type strip', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = container();
		const view = new HandlerFormsTs({ formatters: new FormatterRegistry() });
		await view.mount(el);

		const messages = thisWarnings(warn);
		expect(messages).toHaveLength(2);
		expect(messages[0]).toContain('[puzzle] HandlerFormsTs.pzl: handler `play` uses `this`');
		expect(messages[1]).toContain('handler `load` uses `this`');
		expect(messages[1]).toContain('`load: async (…) => { … }`');

		click(el, '.bump');
		await vi.waitFor(() => expect(el.querySelector('.bump').textContent).toBe('1'));
		expect(thisWarnings(warn)).toHaveLength(2);
	});

	it('stays quiet for arrows, for shorthand without `this`, and for non-function entries', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		let getterRan = false;
		class Quiet extends PuzzleView {
			events = {
				bare: (event) => this.setData('last', event),
				single: event => this.setData('last', event),
				asyncArrow: async () => this.setData('last', 1),
				noThis(event) {
					// this comment says this, and so does "this" string
					return event;
				},
				label: 'this is data, not a handler',
				get lazy() {
					getterRan = true;
					return function () {
						return this;
					};
				},
			};
			render() {
				return new ViewNode('puzzle-view', {}, []);
			}
		}
		await new Quiet({}).mount(container());
		expect(thisWarnings(warn)).toHaveLength(0);
		expect(getterRan).toBe(false);
	});

	it('names the view by its .pzl module when the compiler stamped one', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class Stamped extends PuzzleView {
			static __pzlModule = 'app/views/Stamped.pzl';
			events = {
				go() {
					return this;
				},
			};
			render() {
				return new ViewNode('puzzle-view', {}, []);
			}
		}
		await new Stamped({}).mount(container());
		expect(thisWarnings(warn)[0]).toMatch(/^\[puzzle\] app\/views\/Stamped\.pzl: handler `go` uses `this`/);
	});

	it('says nothing in production', async () => {
		globalThis.__PUZZLE_DEV__ = false;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class ProdForms extends PuzzleView {
			events = {
				play() {
					this.played = true;
				},
			};
			render() {
				return new ViewNode('puzzle-view', {}, []);
			}
		}
		await new ProdForms({}).mount(container());
		expect(thisWarnings(warn)).toHaveLength(0);
	});
});

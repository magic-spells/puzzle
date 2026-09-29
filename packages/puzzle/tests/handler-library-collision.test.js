// @vitest-environment jsdom
// D176 §4 — inside an @event value a bare `save(…)` calls the view's handler, and
// everywhere else the library function of that name. When both exist, one name
// means two things in one template, so a view's mount warns once per view and
// name in development.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { FormatterRegistry, makeFormatterRegistry } from '../client-runtime/formatters.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);

function container() {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}

/** A view class with the given handler names, rendering one button. */
function viewWith(name, handlers) {
	const View = {
		[name]: class extends PuzzleView {
			events = Object.fromEntries(handlers.map((handler) => [handler, () => {}]));
			render() {
				return h('puzzle-view', {}, [h('button', {}, [])]);
			}
		},
	}[name];
	return View;
}

const shadowWarnings = (warn) =>
	warn.mock.calls.map((call) => call[0]).filter((message) => message.includes('shadows the library function'));

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	delete globalThis.__PUZZLE_DEV__;
});

describe('handler/library name collision (D176 §4)', () => {
	it('warns for a handler named like a standard, PuzzleKit-only or app-registered function', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const View = viewWith('OrderView', ['save', 'date', 'timeago', 'toggle']);
		// An empty seed, as a compiled app gets when its templates use no built-in:
		// the standard names still count, whatever the manifest kept.
		const formatters = new FormatterRegistry({});
		formatters.register('save', (v) => v);
		await new View({ formatters }).mount(container());

		const messages = shadowWarnings(warn);
		expect(messages).toHaveLength(3);
		expect(messages[0]).toBe(
			'[puzzle] OrderView: handler `save` shadows the library function `save` inside @event — save(…) in an @event value calls the handler, and the library function everywhere else; rename the handler to keep one meaning per name'
		);
		expect(messages[1]).toContain('handler `date` shadows the library function `date` inside @event');
		expect(messages[2]).toContain('handler `timeago` shadows the library function `timeago` inside @event');
	});

	it('warns once per view and name, however many instances mount', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const View = viewWith('RowView', ['currency']);
		const formatters = makeFormatterRegistry();
		await new View({ formatters }).mount(container());
		await new View({ formatters }).mount(container());
		expect(shadowWarnings(warn)).toHaveLength(1);

		// A different view with the same handler name is its own collision.
		const Other = viewWith('OtherRowView', ['currency']);
		await new Other({ formatters }).mount(container());
		expect(shadowWarnings(warn)).toHaveLength(2);
		expect(shadowWarnings(warn)[1]).toContain('[puzzle] OtherRowView: handler `currency`');
	});

	it('names the view by its .pzl module when the compiler stamped one', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const View = viewWith('Stamped', ['link']);
		View.__pzlModule = 'app/components/Stamped.pzl';
		await new View({ formatters: makeFormatterRegistry({}, (path) => path) }).mount(container());
		expect(shadowWarnings(warn)[0]).toMatch(/^\[puzzle\] app\/components\/Stamped\.pzl: handler `link`/);
	});

	it('stays quiet for other names, the deprecated built-ins and a view without handlers', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const formatters = makeFormatterRegistry();
		// `join`, `trim` and `floor` are still registered built-ins, but they are
		// leaving the library, so a handler of that name is not a collision.
		await new (viewWith('QuietView', ['toggle', 'join', 'trim', 'floor']))({ formatters }).mount(container());
		await new (viewWith('NoHandlers', []))({ formatters }).mount(container());
		class Bare extends PuzzleView {
			render() {
				return h('puzzle-view', {}, []);
			}
		}
		await new Bare({ formatters }).mount(container());
		await new (viewWith('NoRegistry', ['toggle']))({}).mount(container());
		expect(shadowWarnings(warn)).toHaveLength(0);
	});

	it('says nothing in production', async () => {
		globalThis.__PUZZLE_DEV__ = false;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await new (viewWith('ProdView', ['save', 'date']))({ formatters: makeFormatterRegistry({ save: (v) => v }) }).mount(
			container()
		);
		expect(shadowWarnings(warn)).toHaveLength(0);
	});

	it('checks routed views through the app, against the app registry', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const Home = viewWith('RoutedHome', ['shout', 'noop']);
		class Layout extends PuzzleView {
			render() {
				return h('puzzle-view', {}, [new ViewNode(SLOT_TAG)]);
			}
		}
		const el = container();
		el.id = 'app';
		const app = new PuzzleApp({
			target: '#app',
			routes: [{ path: '/', name: 'home', view: Home, layout: Layout }],
			formatters: { shout: (s) => String(s).toUpperCase() },
		});
		await app.mount();
		try {
			const messages = shadowWarnings(warn);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toContain('[puzzle] RoutedHome: handler `shout` shadows the library function `shout` inside @event');
		} finally {
			app.unmount();
		}
	});
});

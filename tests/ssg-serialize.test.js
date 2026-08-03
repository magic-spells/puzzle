// SSG serializer goldens (M1) — the pure ViewNode → HTML string serializer
// (client-runtime/ssg/serialize.js). Node env: serialize + preload are DOM-free,
// so no jsdom is needed. Hand-written ViewNode trees stand in for compiler output
// (same convention as the other suites).
import { describe, it, expect, vi } from 'vitest';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG, PORTAL_TAG } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import LocalForm from './fixtures/binding/LocalForm.compiled.js';
import RecordForm from './fixtures/binding/RecordForm.compiled.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const slot = () => new ViewNode(SLOT_TAG);
const namedSlot = (name) => new ViewNode(SLOT_TAG, { name });

describe('SSG serializer (M1)', () => {
	describe('escaping', () => {
		it('escapes & < > in text', async () => {
			const tree = h('p', {}, [text('a < b & c > d')]);
			expect(await serialize(tree)).toBe('<p>a &lt; b &amp; c &gt; d</p>');
		});

		it('escapes & < > " and \' in attribute values', async () => {
			const tree = h('div', { title: `a"b'c<>&` });
			expect(await serialize(tree)).toBe('<div title="a&quot;b&#39;c&lt;&gt;&amp;"></div>');
		});
	});

	describe('void elements', () => {
		it('self-closes without a closing tag or children', async () => {
			expect(await serialize(h('img', { src: 'x.png', alt: 'X' }))).toBe('<img src="x.png" alt="X">');
			expect(await serialize(h('br'))).toBe('<br>');
			expect(await serialize(h('input', { type: 'text' }))).toBe('<input type="text">');
		});
	});

	describe('attributes mirror setAttr semantics', () => {
		it('input and option values keep serializing as plain attributes', async () => {
			expect(await serialize(h('input', { value: 'hi' }))).toBe('<input value="hi">');
			expect(await serialize(h('option', { value: 5 }))).toBe('<option value="5"></option>');
		});

		it('select value marks the first matching middle option and omits select value attr', async () => {
			const tree = h('select', { value: 'b' }, [
				h('option', { value: 'a' }, [text('Alpha')]),
				h('option', { value: 'b' }, [text('Beta')]),
				h('option', { value: 'b' }, [text('Duplicate')]),
			]);
			expect(await serialize(tree)).toBe(
				'<select><option value="a">Alpha</option>' +
					'<option value="b" selected>Beta</option>' +
					'<option value="b">Duplicate</option></select>'
			);
		});

		it('select option without value falls back to its text content, including optgroups', async () => {
			const tree = h('select', { value: 'Beta' }, [
				h('option', { value: 'alpha' }, [text('Alpha')]),
				h('optgroup', { label: 'Group' }, [
					h('option', {}, [text('Beta')]),
					h('option', {}, [text('Gamma')]),
				]),
			]);
			expect(await serialize(tree)).toBe(
				'<select><option value="alpha">Alpha</option>' +
					'<optgroup label="Group"><option selected>Beta</option>' +
					'<option>Gamma</option></optgroup></select>'
			);
		});

		it('textarea value renders as escaped text content and omits value attr', async () => {
			const tree = h('textarea', { value: 'a < b & c > d' }, [text('ignored child')]);
			expect(await serialize(tree)).toBe('<textarea>a &lt; b &amp; c &gt; d</textarea>');
		});

		it('input value attribute emission is unchanged', async () => {
			const tree = h('input', { value: `a"b'c<>&` });
			expect(await serialize(tree)).toBe('<input value="a&quot;b&#39;c&lt;&gt;&amp;">');
		});

		it('select with no matching option emits no selected attr', async () => {
			const tree = h('select', { value: 'missing' }, [
				h('option', { value: 'a' }, [text('Alpha')]),
				h('optgroup', { label: 'Group' }, [h('option', {}, [text('Beta')])]),
			]);
			const html = await serialize(tree);
			expect(html).toBe(
				'<select><option value="a">Alpha</option>' +
					'<optgroup label="Group"><option>Beta</option></optgroup></select>'
			);
			expect(html).not.toContain('selected');
		});

		it('truthy boolean props become bare attrs; falsy omit', async () => {
			expect(await serialize(h('button', { disabled: true }))).toBe('<button disabled></button>');
			expect(await serialize(h('button', { disabled: false }))).toBe('<button></button>');
			expect(await serialize(h('input', { checked: true }))).toBe('<input checked>');
			expect(await serialize(h('input', { checked: false }))).toBe('<input>');
		});

		it('true → bare attr; false/null/undefined omit', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				expect(await serialize(h('details', { open: true }))).toBe('<details open></details>');
				const tree = h('div', { id: 'a', 'data-x': false, 'data-y': null, 'data-z': undefined });
				expect(await serialize(tree)).toBe('<div id="a"></div>');
				expect(warn).toHaveBeenCalledTimes(1);
			} finally {
				warn.mockRestore();
			}
		});

		it('skips @event, key, and island directives', async () => {
			const tree = h('button', { class: 'x', '@click': () => {}, key: 7, island: true }, [text('Go')]);
			expect(await serialize(tree)).toBe('<button class="x">Go</button>');
		});

		it('passes scoped-style data-<scopeId> and data-puzzle-morph through', async () => {
			expect(await serialize(h('div', { 'data-v-abc123': true }))).toBe('<div data-v-abc123></div>');
			expect(await serialize(h('div', { 'data-puzzle-morph': 'card-1' }))).toBe(
				'<div data-puzzle-morph="card-1"></div>'
			);
		});
	});

	describe('string (SVG island seed) children', () => {
		it('emits string children verbatim', async () => {
			const svg = new ViewNode('svg', { class: 'icon' }, '<path d="M0 0h4v4H0z"/>');
			expect(await serialize(svg)).toBe('<svg class="icon"><path d="M0 0h4v4H0z"/></svg>');
		});
	});

	describe('slots', () => {
		class Card extends PuzzleView {
			render() {
				return h('div', { class: 'card' }, [
					h('header', {}, [namedSlot('header')]),
					h('div', { class: 'body' }, [slot()]),
					h('footer', {}, [namedSlot('footer')]),
				]);
			}
		}

		it('routes named + default content and strips the slot attr', async () => {
			const tree = comp(Card, {}, [
				h('h2', { slot: 'header' }, [text('Title')]),
				h('p', {}, [text('body')]),
				h('button', { slot: 'footer' }, [text('Read')]),
			]);
			expect(await serialize(tree)).toBe(
				'<div class="card"><header><h2>Title</h2></header>' +
					'<div class="body"><p>body</p></div><footer><button>Read</button></footer></div>'
			);
		});

		it('renders nothing when regions are unfilled', async () => {
			const tree = comp(Card, {}, []);
			expect(await serialize(tree)).toBe(
				'<div class="card"><header></header><div class="body"></div><footer></footer></div>'
			);
		});

		it('serializes marker children as fallback', async () => {
			class FallbackCard extends PuzzleView {
				render() {
					return h('section', {}, [
						new ViewNode(SLOT_TAG, { name: 'missing' }, [text('fallback')]),
					]);
				}
			}
			expect(await serialize(comp(FallbackCard))).toBe('<section>fallback</section>');
		});

		it('emits nothing for a <Portal> (D144)', async () => {
			class WithPortal extends PuzzleView {
				render() {
					return h('section', {}, [
						text('page'),
						new ViewNode(PORTAL_TAG, {}, [h('div', { class: 'overlay' }, [text('modal')])]),
					]);
				}
			}
			expect(await serialize(comp(WithPortal))).toBe('<section>page</section>');
		});
	});

	describe('nested components with preloaded data', () => {
		it('constructs + preloads nested components, threading props into data()', async () => {
			class Inner extends PuzzleView {
				data(params, props) {
					return { label: props.label };
				}
				render() {
					return h('span', {}, [text(this.getData().label)]);
				}
			}
			class Outer extends PuzzleView {
				async data() {
					return { n: 2 };
				}
				render() {
					return h('div', {}, [comp(Inner, { label: 'hi' }), text(String(this.getData().n))]);
				}
			}
			expect(await serialize(comp(Outer))).toBe('<div><span>hi</span>2</div>');
		});

		it('renders nothing for a component whose render() returns null', async () => {
			class Empty extends PuzzleView {
				render() {
					return null;
				}
			}
			expect(await serialize(comp(Empty))).toBe('');
		});
	});

	// The compiler synthesizes `'@input:bind'` / `'@change:bind'` attrs on
	// qualifying form controls (D147). They are framework directives carrying a
	// FUNCTION, so they must never reach the markup — serializeAttrs' `@` prefix
	// rule is what covers them, and these pin that the `:bind` suffix rides it
	// rather than needing (or growing) a rule of its own. The controlled value the
	// bind is paired with still serializes exactly as an unbound one does.
	describe('implicit two-way binding directives (D147)', () => {
		const bind = () => () => {};

		it('drops @input:bind and @change:bind while keeping the controlled value', async () => {
			expect(await serialize(h('input', { class: 'draft', value: 'hello', '@input:bind': bind() }))).toBe(
				'<input class="draft" value="hello">'
			);
			expect(await serialize(h('input', { type: 'number', value: 7, '@change:bind': bind() }))).toBe(
				'<input type="number" value="7">'
			);
			expect(await serialize(h('input', { type: 'range', value: 0, '@input:bind': bind() }))).toBe(
				'<input type="range" value="0">'
			);
		});

		it('serializes a bound checkbox as a bare checked attr, or omits it', async () => {
			expect(
				await serialize(h('input', { type: 'checkbox', checked: true, '@change:bind': bind() }))
			).toBe('<input type="checkbox" checked>');
			expect(
				await serialize(h('input', { type: 'checkbox', checked: false, '@change:bind': bind() }))
			).toBe('<input type="checkbox">');
		});

		it('serializes a bound textarea value as escaped text content', async () => {
			const tree = h('textarea', { class: 'notes', value: 'a < b & c', '@input:bind': bind() });
			expect(await serialize(tree)).toBe('<textarea class="notes">a &lt; b &amp; c</textarea>');
		});

		it('serializes a bound select as a selected option, not a value attr', async () => {
			const tree = h('select', { class: 'sort', value: 'done', '@change:bind': bind() }, [
				h('option', { value: 'all' }, [text('All')]),
				h('option', { value: 'done' }, [text('Done')]),
			]);
			expect(await serialize(tree)).toBe(
				'<select class="sort"><option value="all">All</option>' +
					'<option value="done" selected>Done</option></select>'
			);
		});

		it('emits no directive for real compiler output (local-state binds)', async () => {
			const html = await serialize(comp(LocalForm));
			expect(html).toBe(
				'<puzzle-view class="local-form">' +
					'<input class="draft" value="">' +
					'<input class="age" type="number" value="">' +
					'<input class="volume" type="range" value="0">' +
					'<input class="agree" type="checkbox">' +
					'<textarea class="notes"></textarea>' +
					'<select class="sort"><option value="all" selected>All</option>' +
					'<option value="done">Done</option></select>' +
					'<p class="matches">4</p>' +
					'</puzzle-view>'
			);
			expect(html).not.toContain('bind');
			expect(html).not.toContain('@');
		});

		it('emits no directive for real compiler output (record-path binds)', async () => {
			class Todo extends PuzzleModel {
				static schema = {
					id: Puzzle.string().primary(),
					text: Puzzle.string().required(),
					completed: Puzzle.boolean().default(false),
					rank: Puzzle.number().default(0),
				};
			}
			const store = new Store({ todo: Todo });
			store.createRecord('todo', { id: '1', text: 'wash', rank: 1, completed: true });
			store.createRecord('todo', { id: '2', text: 'fo<ld', rank: 2 });

			const html = await serialize(comp(RecordForm), { ctx: { store } });
			expect(html).toBe(
				'<puzzle-view class="record-form">' +
					'<div class="row"><input class="text" value="wash">' +
					'<input class="done" type="checkbox" checked>' +
					'<input class="rank" type="number" value="1"></div>' +
					'<div class="row"><input class="text" value="fo&lt;ld">' +
					'<input class="done" type="checkbox">' +
					'<input class="rank" type="number" value="2"></div>' +
					'</puzzle-view>'
			);
			expect(html).not.toContain('bind');
			expect(html).not.toContain('@');
		});
	});
});

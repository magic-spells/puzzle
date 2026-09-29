// @vitest-environment jsdom
//
// A cached vnode whose sibling INDEX moves (D170).
//
// `this.__c[n]` and a row's `s.c[n]` hand the patcher the SAME vnode object on
// every render. Index pairing assumed it also stays at the same index, but a
// variable-length unkeyed run before it — an unkeyed `{#for}` over primitives,
// slot content — shifts it. Paired with a different old vnode, the cached node
// was patched into a foreign element and then unmounted as a leftover, which
// removed the one element it describes and orphaned the original: the static
// markup duplicated and rows went missing. These tests pin that a shifted cached
// vnode keeps its own element, exactly once, in the right place.
//
// The same shift one level down — a cached vnode inside a FRESH parent whose
// index moved — cannot be seen from the parent's list: the fresh parent pairs
// with some other old node, the cached vnode is mounted into it first, and its
// outgoing copy is released through the same object afterwards. The nested
// tests below hand-write the compiled shapes of real templates and pin that the
// outgoing copy is released as itself: the live element keeps its ref and its
// one `outside` listener, and nothing outlives destroy().
import { afterEach, describe, expect, it } from 'vitest';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { listRows } from '../client-runtime/views/listBlock.js';
import { mountView, settled } from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const handles = [];

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	document.body.innerHTML = '';
});

/**
 * Track the `click` listeners parked on document — where an `@click:outside`
 * handler lives (D86) — for the duration of one test.
 */
function trackOutsideListeners() {
	const live = new Set();
	const add = document.addEventListener;
	const remove = document.removeEventListener;
	document.addEventListener = function (type, fn, opts) {
		if (type === 'click') live.add(fn);
		return add.call(this, type, fn, opts);
	};
	document.removeEventListener = function (type, fn, opts) {
		if (type === 'click') live.delete(fn);
		return remove.call(this, type, fn, opts);
	};
	return {
		live,
		restore() {
			document.addEventListener = add;
			document.removeEventListener = remove;
		},
	};
}

// A primitive-item loop keys by nothing, so its rows pair by index (the compiled
// `ViewNode.keyOf(tag)` returns null for a string, and warns once).
const NO_KEY = { key: () => null };

function setup() {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { vm: new ViewManager(container, {}), container };
}

/** A stand-in for a compiled static subtree: one object for every render. */
const buildStatic = () => h('li', { class: 'add' }, [h('b', {}, [text('Add')]), text(' a tag')]);

describe('a cached vnode behind an unkeyed run', () => {
	it('keeps its own element when the run shrinks, grows and empties', () => {
		const { vm, container } = setup();
		const S = buildStatic();
		const tree = (tags) => h('ul', {}, [...tags.map((t) => h('li', {}, [text(t)])), S]);

		vm.render(tree(['a', 'b']));
		const add = container.querySelector('.add');
		const html = () => container.querySelector('ul').innerHTML;

		for (const tags of [['a'], ['a', 'b'], [], ['x', 'y', 'z'], ['a']]) {
			vm.render(tree(tags));
			expect(html()).toBe(tags.map((t) => `<li>${t}</li>`).join('') + '<li class="add"><b>Add</b> a tag</li>');
			expect(container.querySelector('.add')).toBe(add);
			expect(S.el).toBe(add);
		}
	});

	it('keeps two cached siblings apart across a variable run between them', () => {
		const { vm, container } = setup();
		const head = h('li', { class: 'head' }, [h('b', {}, [text('Head')]), text('!')]);
		const S = buildStatic();
		const tree = (tags) => h('ul', {}, [head, ...tags.map((t) => h('li', {}, [text(t)])), S]);

		vm.render(tree(['a', 'b', 'c']));
		for (const tags of [['a'], [], ['p', 'q']]) {
			vm.render(tree(tags));
			const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
			expect(items).toEqual(['Head!', ...tags, 'Add a tag']);
		}
	});

	it('pairs a cached UNKEYED sibling with itself inside a keyed list', () => {
		// Keyed rows reconcile by key, but unkeyed siblings still pair
		// positionally among themselves — a variable unkeyed run shifts the
		// cached one exactly as in an unkeyed list.
		const { vm, container } = setup();
		const S = buildStatic();
		const tree = (notes) =>
			h('ul', {}, [
				h('li', { key: 'k1' }, [text('keyed')]),
				...notes.map((n) => h('li', { class: 'note' }, [text(n)])),
				S,
			]);

		vm.render(tree(['n1', 'n2']));
		const add = container.querySelector('.add');
		for (const notes of [['n1'], ['n1', 'n2', 'n3'], []]) {
			vm.render(tree(notes));
			const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
			expect(items).toEqual(['keyed', ...notes, 'Add a tag']);
			expect(container.querySelector('.add')).toBe(add);
		}
	});

	it("keeps a row's `s.c` subtree after the row's own inner unkeyed loop", () => {
		// A plain-object item is always dirty, so the row body re-runs every pass
		// while its `s.c[0]` stays the same object.
		const { vm, container } = setup();
		const view = new PuzzleView({});
		view.__dirty = 0;
		const meta = { key: (item) => item.id };
		const render = (parts) =>
			vm.render(
				h(
					'ul',
					{},
					listRows(
						view,
						view,
						0,
						[{ id: 1, parts }],
						(s) =>
							h('li', { key: s.k }, [
								...s.item.parts.map((p) => h('span', {}, [text(p)])),
								(s.c[0] ??= h('em', { class: 'tail' }, [h('b', {}, [text('t')]), text('ail')])),
							]),
						meta
					)
				)
			);

		render(['a', 'b']);
		const tail = container.querySelector('.tail');
		for (const parts of [['a'], ['a', 'b', 'c'], []]) {
			render(parts);
			expect(container.querySelector('li').innerHTML).toBe(
				parts.map((p) => `<span>${p}</span>`).join('') + '<em class="tail"><b>t</b>ail</em>'
			);
			expect(container.querySelector('.tail')).toBe(tail);
		}
	});

	it('does not destroy a component that lives inside the shifted subtree', async () => {
		let created = 0;
		let destroyed = 0;
		class Badge extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				created++;
			}
			render() {
				return h('i', { class: 'badge' }, [text('badge')]);
			}
			destroyed() {
				destroyed++;
			}
		}
		class Tags extends PuzzleView {
			data() {
				return { tags: ['a', 'b'] };
			}
			render() {
				const d = this.getData();
				return h('ul', {}, [
					...d.tags.map((t) => h('li', {}, [text(t)])),
					(this.__c[0] ??= h('li', { class: 'add' }, [new ViewNode(Badge, {}, []), text(' add')])),
				]);
			}
		}

		const view = await mountView(Tags);
		handles.push(view);
		for (const tags of [['a'], ['a', 'b'], []]) {
			view.instance.setData('tags', tags);
			await settled();
			expect(view.findAll('.badge')).toHaveLength(1);
			expect(view.findAll('li').map((li) => li.textContent)).toEqual([...tags, 'badge add']);
		}
		expect(created).toBe(1);
		expect(destroyed).toBe(0);
	});
});

describe('a cached vnode inside a fresh parent behind an unkeyed run', () => {
	it('keeps its ref and exactly one live outside listener (compiled Tags.pzl)', async () => {
		// <div class="tags">
		//   {#for tag in tags}<span>{ tag }</span>{/for}
		//   <button class={ cls } @click={ add }>
		//     <svg class="icon" ref="icon" @click:outside={ out }><path/><path/></svg>
		//   </button>
		// </div>
		let outside = 0;
		class Tags extends PuzzleView {
			data() {
				return { tags: ['a', 'b'], cls: 'btn' };
			}
			events = { add: () => {}, out: () => outside++ };
			render() {
				const d = this.getData();
				return h('div', { class: 'tags' }, [
					...listRows(this, this, 0, d.tags, (s) => h('span', { key: s.k }, [text(s.item)]), NO_KEY),
					h('button', { class: d.cls, '@click': ((this.__h ??= {})[0] ??= (e) => this.events.add(e)) }, [
						(this.__c[0] ??= h(
							'svg',
							{
								class: 'icon',
								ref: this.__ref('icon'),
								'@click:outside': ((this.__h ??= {})[1] ??= (e) => this.events.out(e)),
							},
							[h('path', { d: 'M0 0' }), h('path', { d: 'M1 1' })]
						)),
					]),
				]);
			}
		}

		const listeners = trackOutsideListeners();
		try {
			const view = await mountView(Tags);
			document.body.appendChild(view.container);
			const inst = view.instance;
			expect(listeners.live.size).toBe(1);

			for (const [tags, cls] of [
				[['a'], 'btn'],
				[['a'], 'btn2'],
				[['a', 'b', 'c'], 'btn'],
				[[], 'btn'],
			]) {
				inst.setData({ tags, cls });
				await settled();
				const svg = view.find('.icon');
				expect(view.findAll('span').map((s) => s.textContent)).toEqual(tags);
				expect(view.findAll('.icon')).toHaveLength(1);
				expect(inst.refs.icon).toBe(svg);
				expect(listeners.live.size).toBe(1);

				// Inside the live svg is not outside; the page is.
				outside = 0;
				svg.querySelector('path').dispatchEvent(new MouseEvent('click', { bubbles: true }));
				expect(outside).toBe(0);
				document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				expect(outside).toBe(1);
			}

			view.destroy();
			expect(listeners.live.size).toBe(0);
		} finally {
			listeners.restore();
		}
	});

	it('keeps static markup in its own parent across two variable runs (compiled Grow.pzl)', async () => {
		// <section>
		//   {#for n in notes}<div>{ n }</div>{/for}
		//   <div class={ cls }><div class="a"><b>1</b><b>2</b></div></div>
		//   {#for m in more}<div>{ m }</div>{/for}
		// </section>
		class Grow extends PuzzleView {
			data() {
				return { notes: ['n1', 'n2'], more: [], cls: 'box' };
			}
			render() {
				const d = this.getData();
				return h('section', {}, [
					...listRows(this, this, 0, d.notes, (s) => h('div', { key: s.k }, [text(s.item)]), NO_KEY),
					h('div', { class: d.cls }, [
						(this.__c[0] ??= h('div', { class: 'a' }, [h('b', {}, [text('1')]), h('b', {}, [text('2')])])),
					]),
					...listRows(this, this, 1, d.more, (s) => h('div', { key: s.k }, [text(s.item)]), NO_KEY),
				]);
			}
		}

		const view = await mountView(Grow);
		handles.push(view);
		const html = () => view.instance.element.innerHTML;
		const expected = (notes, more, cls) =>
			notes.map((n) => `<div>${n}</div>`).join('') +
			`<div class="${cls}"><div class="a"><b>1</b><b>2</b></div></div>` +
			more.map((m) => `<div>${m}</div>`).join('');

		for (const [notes, more, cls] of [
			[['n1'], ['m1'], 'box'],
			[['n1'], ['m1'], 'box2'],
			[['n1', 'n2', 'n3'], [], 'box'],
			[[], ['m1', 'm2'], 'box'],
			[['n1'], [], 'box3'],
		]) {
			view.instance.setData({ notes, more, cls });
			await settled();
			expect(html()).toBe(expected(notes, more, cls));
		}
	});

	it('keeps a cached subtree behind variable-length slot content', async () => {
		// <section>
		//   {#if open}<Children/>{/if}
		//   <footer class={ cls }>
		//     <div class="a" ref="box" @click:outside={ outside }><b>1</b><b>2</b></div>
		//   </footer>
		// </section>
		class Panel extends PuzzleView {
			hits = 0;
			data() {
				return { open: true, cls: 'f' };
			}
			events = { outside: () => this.hits++ };
			render() {
				const d = this.getData();
				return h('section', {}, [
					...(d.open ? [new ViewNode(SLOT_TAG)] : []),
					h('footer', { class: d.cls }, [
						(this.__c[0] ??= h(
							'div',
							{
								class: 'a',
								ref: this.__ref('box'),
								'@click:outside': ((this.__h ??= {})[0] ??= (e) => this.events.outside(e)),
							},
							[h('b', {}, [text('1')]), h('b', {}, [text('2')])]
						)),
					]),
				]);
			}
		}

		const listeners = trackOutsideListeners();
		try {
			const kids = [h('p', {}, [text('one')]), h('p', {}, [text('two')])];
			const view = await mountView(Panel, { children: kids });
			document.body.appendChild(view.container);
			const inst = view.instance;

			for (const [open, cls] of [
				[false, 'f'],
				[false, 'g'],
				[true, 'f'],
				[false, 'f'],
			]) {
				inst.setData({ open, cls });
				await settled();
				const box = view.find('.a');
				expect(view.findAll('p')).toHaveLength(open ? 2 : 0);
				expect(view.findAll('.a')).toHaveLength(1);
				expect(box.parentNode).toBe(view.find('footer'));
				expect(inst.refs.box).toBe(box);
				expect(listeners.live.size).toBe(1);

				inst.hits = 0;
				box.querySelector('b').dispatchEvent(new MouseEvent('click', { bubbles: true }));
				expect(inst.hits).toBe(0);
				document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				expect(inst.hits).toBe(1);
			}

			view.destroy();
			expect(listeners.live.size).toBe(0);
		} finally {
			listeners.restore();
		}
	});

	it("keeps a row's `s.c` subtree inside a fresh element after the row's inner loop", async () => {
		// {#for item in items}
		//   <li>
		//     {#for p in item.parts}<span>{ p }</span>{/for}
		//     <em class={ item.tone }><b ref=… @click:outside={ out }>t</b></em>
		//   </li>
		// {/for}
		// A plain-object item is always dirty, so the row body re-runs every pass
		// while its `s.c[0]` stays the same object.
		let outside = 0;
		let tail = null;
		const setTail = (el, old) => {
			if (el != null) tail = el;
			else if (tail === old) tail = null;
		};
		class Rows extends PuzzleView {
			data() {
				return { items: [{ id: 1, parts: ['a', 'b'], tone: 'x' }] };
			}
			events = { out: () => outside++ };
			render() {
				const d = this.getData();
				return h(
					'ul',
					{},
					listRows(
						this,
						this,
						0,
						d.items,
						(s) =>
							h('li', { key: s.k }, [
								...listRows(this, s, 1, s.item.parts, (r) => h('span', { key: r.k }, [text(r.item)]), NO_KEY),
								h('em', { class: s.item.tone }, [
									(s.c[0] ??= h(
										'b',
										{ ref: setTail, '@click:outside': (s.h0 ??= (e) => this.events.out(e)) },
										[text('t')]
									)),
								]),
							]),
						{ key: (item) => ViewNode.keyOf(item) }
					)
				);
			}
		}

		const listeners = trackOutsideListeners();
		try {
			const view = await mountView(Rows);
			document.body.appendChild(view.container);
			for (const [parts, tone] of [
				[['a'], 'x'],
				[['a'], 'y'],
				[['a', 'b', 'c'], 'x'],
				[[], 'x'],
			]) {
				view.instance.setData('items', [{ id: 1, parts, tone }]);
				await settled();
				expect(view.find('li').innerHTML).toBe(
					parts.map((p) => `<span>${p}</span>`).join('') + `<em class="${tone}"><b>t</b></em>`
				);
				expect(tail).toBe(view.find('b'));
				expect(listeners.live.size).toBe(1);
				outside = 0;
				view.find('b').dispatchEvent(new MouseEvent('click', { bubbles: true }));
				expect(outside).toBe(0);
			}
			view.destroy();
			expect(listeners.live.size).toBe(0);
		} finally {
			listeners.restore();
		}
	});

	it('releases a nested live-HTML range and component with their outgoing copy', async () => {
		let created = 0;
		let destroyed = 0;
		class Badge extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				created++;
			}
			render() {
				return h('i', { class: 'badge' }, [text('badge')]);
			}
			destroyed() {
				destroyed++;
			}
		}
		class Mixed extends PuzzleView {
			data() {
				return { tags: ['a', 'b'], cls: 'c' };
			}
			render() {
				const d = this.getData();
				return h('div', {}, [
					...listRows(this, this, 0, d.tags, (s) => h('span', { key: s.k }, [text(s.item)]), NO_KEY),
					h('p', { class: d.cls }, [
						(this.__c[0] ??= h('q', {}, [
							new ViewNode('#html', { value: '<u>x</u><u>y</u>' }),
							new ViewNode(Badge),
						])),
					]),
				]);
			}
		}

		const view = await mountView(Mixed);
		for (const tags of [['a'], ['a', 'b', 'c'], [], ['z']]) {
			view.instance.setData('tags', tags);
			await settled();
			expect(view.instance.element.innerHTML).toBe(
				tags.map((t) => `<span>${t}</span>`).join('') +
					'<p class="c"><q><!----><u>x</u><u>y</u><i class="badge">badge</i></q></p>'
			);
			expect(created - destroyed).toBe(1);
		}
		view.destroy();
		expect(created - destroyed).toBe(0);
	});
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG, SNIPPET_TAG } from '../client-runtime/views/ViewNode.js';
import { expandSlots } from '../client-runtime/views/viewManager.js';
import { serialize } from '../client-runtime/ssg/serialize.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (View, props = {}, children = []) => new ViewNode(View, props, children);
const marker = (name, args, fallback = []) =>
	new ViewNode(SLOT_TAG, { ...(name ? { name } : {}), ...(args ? { args } : {}) }, fallback);
const snippet = (fits, params, fn) => new ViewNode(SNIPPET_TAG, { fits, params, fn });

const mounted = [];
const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

afterEach(() => {
	for (const view of mounted.splice(0)) view.destroy();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

class Regions extends PuzzleView {
	data(params, props) {
		return { users: props.users, group: props.group };
	}
	render() {
		const { users, group } = this.getData();
		return h('section', { class: 'regions' }, [
			h('h1', {}, [marker('heading', { group }, [text('fallback heading')])]),
			h('ul', {}, users.map((user) =>
				h('li', { key: user.id }, [marker('row', { user, group }, [text(user.name)])])
			)),
			h('aside', {}, [marker('', { group }, [text('fallback default')])]),
		]);
	}
}

describe('snippets — runtime join (D166)', () => {
	it('routes default and named snippets and hands data by name', async () => {
		const users = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }];
		const group = { title: 'Core' };
		const view = new Regions();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			props: { users, group },
			children: [
				snippet('heading', ['group'], ({ group: g }) => [text(g.title)]),
				snippet('row', ['user', 'group'], ({ user, group: g }) => [
					h('span', { class: 'person' }, [text(`${g.title}/${user.name}`)]),
				]),
				snippet('', ['group'], ({ group: g }) => [text(`default:${g.title}`)]),
			],
		});

		expect(el.querySelector('h1').textContent).toBe('Core');
		expect([...el.querySelectorAll('.person')].map((n) => n.textContent)).toEqual([
			'Core/Ada',
			'Core/Grace',
		]);
		expect(el.querySelector('aside').textContent).toBe('default:Core');
		expect(el.querySelectorAll('#snippet')).toHaveLength(0);
	});

	it('stamps fresh vnodes for every keyed row and patches one changed stamp independently', async () => {
		class StampList extends PuzzleView {
			created() {
				this.setData({
					rows: [
						{ id: 1, name: 'A' },
						{ id: 2, name: 'B' },
						{ id: 3, name: 'C' },
					],
					version: 0,
				});
			}
			render() {
				return h('ul', {}, this.getData().rows.map((row) =>
					h('li', { key: row.id }, [marker('', { row })])
				));
			}
		}
		const view = new StampList();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('', ['row'], ({ row }) => [h('span', {}, [text(row.name)])])],
		});
		const before = [...el.querySelectorAll('li')];
		const spans = [...el.querySelectorAll('span')];

		view.getData().rows[1].name = 'B2';
		view.setData('version', 1);
		view.flushUpdates();

		const after = [...el.querySelectorAll('li')];
		expect(after).toEqual(before);
		expect([...el.querySelectorAll('span')].map((n) => n.textContent)).toEqual(['A', 'B2', 'C']);
		expect(el.querySelectorAll('span')[0]).toBe(spans[0]);
		expect(el.querySelectorAll('span')[2]).toBe(spans[2]);
	});

	it('keeps same-key stateful output local to each keyed wrapper as one loop marker changes arity', async () => {
		let nextInstance = 0;
		class StatefulStamp extends PuzzleView {
			created() { this.instanceId = ++nextInstance; }
			data(params, props) { return { label: props.label }; }
			render() {
				return h('button', { class: 'stateful-stamp' }, [
					text(`${this.getData().label}:${this.instanceId}`),
				]);
			}
		}
		class VariableStampList extends PuzzleView {
			created() {
				this.setData({
					rows: [
						{ id: 1, label: 'A', extra: false },
						{ id: 2, label: 'B', extra: false },
					],
				});
			}
			render() {
				return h('ul', {}, this.getData().rows.map((row) =>
					h('li', { key: row.id }, [marker('row', { row })])
				));
			}
		}

		const view = new VariableStampList();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('row', ['row'], ({ row }) => {
				const stateful = comp(StatefulStamp, { key: 'stateful', label: row.label });
				return row.extra
					? [h('i', { class: 'extra' }, [text('extra')]), stateful]
					: [stateful];
			})],
		});
		const before = [...el.querySelectorAll('.stateful-stamp')];
		const labels = before.map((node) => node.textContent);

		view.setData('rows', view.getData().rows.map((row) =>
			row.id === 1 ? { ...row, extra: true } : row
		));
		view.flushUpdates();

		const after = [...el.querySelectorAll('.stateful-stamp')];
		expect(el.querySelectorAll('.extra')).toHaveLength(1);
		expect(after).toEqual(before);
		expect(after.map((node) => node.textContent)).toEqual(labels);
	});

	it('renders marker fallbacks when no snippet is supplied', async () => {
		const view = new Regions();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			props: { users: [{ id: 1, name: 'Ada' }], group: { title: 'Core' } },
		});
		expect(el.querySelector('h1').textContent).toBe('fallback heading');
		expect(el.querySelector('li').textContent).toBe('Ada');
		expect(el.querySelector('aside').textContent).toBe('fallback default');
	});

	it('caller state changes rebuild snippet closures and snippet events stay in caller scope', async () => {
		class Repeater extends PuzzleView {
			render() {
				return h('div', {}, [marker('', { item: 'row' })]);
			}
		}
		class Host extends PuzzleView {
			created() {
				this.setData({ count: 0 });
			}
			render() {
				const count = this.getData().count;
				return h('main', {}, [
					comp(Repeater, {}, [snippet('', ['item'], ({ item }) => [
						h('button', { '@click': () => this.setData('count', count + 1) }, [
							text(`${item}:${count}`),
						]),
					])]),
				]);
			}
		}
		const host = new Host();
		mounted.push(host);
		const el = container();
		await host.mount(el);
		expect(el.querySelector('button').textContent).toBe('row:0');

		el.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		host.flushUpdates();
		expect(el.querySelector('button').textContent).toBe('row:1');
	});

	it('component state changes re-stamp snippets with fresh args', async () => {
		class StatefulList extends PuzzleView {
			created() {
				this.setData({ rows: [{ id: 1, name: 'first' }] });
			}
			render() {
				return h('ul', {}, this.getData().rows.map((row) =>
					h('li', { key: row.id }, [marker('row', { row })])
				));
			}
		}
		const view = new StatefulList();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('row', ['row'], ({ row }) => [text(row.name)])],
		});
		expect(el.textContent).toBe('first');
		view.setData('rows', [{ id: 1, name: 'second' }]);
		view.flushUpdates();
		expect(el.textContent).toBe('second');
	});

	it('coexists with ordinary slot= content on another region', async () => {
		class MixedRegions extends PuzzleView {
			render() {
				return h('div', {}, [
					h('p', { class: 'row' }, [marker('', { row: { name: 'snippet-rendered' } })]),
					h('footer', {}, [marker('actions', null)]),
				]);
			}
		}
		const view = new MixedRegions();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [
				snippet('', ['row'], ({ row }) => [text(row.name)]),
				h('button', { slot: 'actions' }, [text('Save')]),
			],
		});
		expect(el.querySelector('.row').textContent).toBe('snippet-rendered');
		expect(el.querySelector('footer button').textContent).toBe('Save');
		expect(el.querySelector('button').hasAttribute('slot')).toBe(false);
	});
});

describe('snippets — forwarding through wrappers (D166 amendment)', () => {
	it('forwards the original metadata vnode without invoking or modifying it', () => {
		class Inner extends PuzzleView {}
		const fn = vi.fn(() => [text('stamped')]);
		const forwarded = snippet('row', ['item'], fn);
		const attrs = forwarded.attrs;
		const tree = comp(Inner, {}, [
			h('div', { class: 'nested-call-site' }, [marker('', null)]),
		]);

		const expanded = expandSlots(tree, [forwarded]);

		expect(expanded).not.toBe(tree);
		expect(expanded.children).toHaveLength(2);
		expect(expanded.children[0].children).toEqual([]);
		expect(expanded.children[1]).toBe(forwarded);
		expect(forwarded.attrs).toBe(attrs);
		expect(fn).not.toHaveBeenCalled();
	});

	it('forwards ordinary default content and every named snippet to the inner component', async () => {
		class Inner extends PuzzleView {
			render() {
				return h('article', { class: 'forwarded-regions' }, [
					h('h2', {}, [marker('heading', { title: 'Inner' })]),
					h('p', { class: 'forwarded-row' }, [marker('row', { item: { label: 'Row' } })]),
					h('div', { class: 'forwarded-default' }, [marker('', null)]),
				]);
			}
		}
		class Wrapper extends PuzzleView {
			render() {
				return h('section', { class: 'wrapper' }, [
					comp(Inner, {}, [
						h('div', { class: 'nested-call-site' }, [marker('', null)]),
					]),
				]);
			}
		}

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const view = new Wrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [
				h('em', { class: 'caller-default' }, [text('Body')]),
				snippet('heading', ['title'], ({ title }) => [text(`heading:${title}`)]),
				snippet('row', ['item'], ({ item }) => [text(`row:${item.label}`)]),
			],
		});

		expect(el.querySelector('h2').textContent).toBe('heading:Inner');
		expect(el.querySelector('.forwarded-row').textContent).toBe('row:Row');
		expect(el.querySelector('.forwarded-default .caller-default').textContent).toBe('Body');
		expect(warn).not.toHaveBeenCalled();
	});

	it('does not stamp a forwarded default snippet until the inner marker supplies args', async () => {
		class Inner extends PuzzleView {
			render() {
				return h('div', { class: 'default-recipient' }, [marker('', { item: 'inner' })]);
			}
		}
		class Wrapper extends PuzzleView {
			render() {
				return comp(Inner, {}, [marker('', null)]);
			}
		}

		const handed = [];
		const view = new Wrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('', ['item'], (args) => {
				handed.push(args);
				return [text(args.item ?? 'missing')];
			})],
		});

		expect(handed).toEqual([{ item: 'inner' }]);
		expect(el.querySelector('.default-recipient').textContent).toBe('inner');
	});

	it('forwards transitively through two wrappers to a third-level consumer', async () => {
		class Leaf extends PuzzleView {
			render() {
				return h('div', { class: 'forwarding-leaf' }, [marker('row', { item: 'three' })]);
			}
		}
		class InnerWrapper extends PuzzleView {
			render() {
				return comp(Leaf, {}, [marker('', null)]);
			}
		}
		class OuterWrapper extends PuzzleView {
			render() {
				return comp(InnerWrapper, {}, [marker('', null)]);
			}
		}

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const view = new OuterWrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('row', ['item'], ({ item }) => [text(`level:${item}`)])],
		});

		expect(el.querySelector('.forwarding-leaf').textContent).toBe('level:three');
		expect(warn).not.toHaveBeenCalled();
	});

	it('forwards a snippet even after the wrapper stamps it for its own marker', async () => {
		class Leaf extends PuzzleView {
			render() {
				return h('p', { class: 'inner-consumer' }, [marker('shared', { value: 'inner' })]);
			}
		}
		class ConsumingWrapper extends PuzzleView {
			render() {
				return h('section', {}, [
					h('p', { class: 'wrapper-consumer' }, [marker('shared', { value: 'wrapper' })]),
					comp(Leaf, {}, [marker('', null)]),
				]);
			}
		}

		const stamps = [];
		const view = new ConsumingWrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('shared', ['value'], ({ value }) => {
				stamps.push(value);
				return [text(value)];
			})],
		});

		expect(stamps).toEqual(['wrapper', 'inner']);
		expect(el.querySelector('.wrapper-consumer').textContent).toBe('wrapper');
		expect(el.querySelector('.inner-consumer').textContent).toBe('inner');
	});

	it('stamps an args-bearing call-site marker instead of forwarding through it', async () => {
		class BareSink extends PuzzleView {
			render() { return h('div', { class: 'args-sink' }, [marker('', null)]); }
		}
		class ArgsWrapper extends PuzzleView {
			render() {
				return comp(BareSink, {}, [marker('', { value: 'wrapper' })]);
			}
		}

		const handed = [];
		const view = new ArgsWrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('', ['value'], (args) => {
				handed.push(args);
				return [text(args.value ?? 'missing')];
			})],
		});

		expect(handed).toEqual([{ value: 'wrapper' }]);
		expect(el.querySelector('.args-sink').textContent).toBe('wrapper');
	});

	it('keeps a bare marker in the wrapper template on the ordinary local stamp path', async () => {
		class DirectWrapper extends PuzzleView {
			render() { return h('div', { class: 'direct-wrapper' }, [marker('', null)]); }
		}

		const fn = vi.fn(() => [text('local')]);
		const view = new DirectWrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, { children: [snippet('', [], fn)] });

		expect(fn).toHaveBeenCalledOnce();
		expect(fn).toHaveBeenCalledWith({});
		expect(el.querySelector('.direct-wrapper').textContent).toBe('local');
	});

	it('forwards a snippet nothing consumes without warning or mounting the metadata', async () => {
		// A declaration no marker in the chain fits is simply never stamped. It is
		// forwarded to the innermost component, dropped by that component's
		// partition, and never reaches the DOM — silently: a marker under a false
		// {#if} or an empty {#for} is not rendered either, so "no marker consumed it"
		// is not evidence of an authoring mistake and used to be reported as one.
		class Sink extends PuzzleView {
			render() { return h('div', { class: 'snippet-sink' }); }
		}
		class InnerWrapper extends PuzzleView {
			render() { return comp(Sink, {}, [marker('', null)]); }
		}
		class OuterWrapper extends PuzzleView {
			render() { return comp(InnerWrapper, {}, [marker('', null)]); }
		}

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const createElement = vi.spyOn(document, 'createElement');
		const view = new OuterWrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('missing', ['item'], () => [text('unconsumed')])],
		});

		expect(warn).not.toHaveBeenCalled();
		expect(el.querySelector('.snippet-sink')).not.toBeNull();
		expect(el.textContent).toBe('');
		expect(createElement.mock.calls.some(([tag]) => tag === SNIPPET_TAG)).toBe(false);
	});

	it('never mounts or patches forwarded metadata during keyed reconciliation', async () => {
		class KeyedLeaf extends PuzzleView {
			render() {
				return h('ul', {}, [
					h('li', { key: 'one' }, [marker('row', { item: 'one' })]),
					h('li', { key: 'two' }, [marker('row', { item: 'two' })]),
				]);
			}
		}
		class KeyedWrapper extends PuzzleView {
			created() { this.setData({ tick: 0 }); }
			render() {
				return h('section', { 'data-tick': this.getData().tick }, [
					comp(KeyedLeaf, { key: 'leaf' }, [marker('', null)]),
				]);
			}
		}

		const createElement = vi.spyOn(document, 'createElement');
		const view = new KeyedWrapper();
		mounted.push(view);
		const el = container();
		await view.mount(el, {
			children: [snippet('row', ['item'], ({ item }) => [
				h('strong', { key: 'stamp' }, [text(item)]),
			])],
		});
		const rows = [...el.querySelectorAll('li')];
		const stamps = [...el.querySelectorAll('strong')];

		view.setData('tick', 1);
		view.flushUpdates();

		expect([...el.querySelectorAll('li')]).toEqual(rows);
		expect([...el.querySelectorAll('strong')]).toEqual(stamps);
		expect(createElement.mock.calls.some(([tag]) => tag === SNIPPET_TAG)).toBe(false);
	});
});

describe('snippets — development diagnostics', () => {
	it('warns once per component/slot when handed and declared shapes differ', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class ShapeMismatch extends PuzzleView {
			created() { this.setData({ tick: 0 }); }
			render() { return h('div', {}, [marker('row', { user: {} })]); }
		}
		const view = new ShapeMismatch();
		mounted.push(view);
		await view.mount(container(), {
			children: [snippet('row', ['person'], () => [text('ok')])],
		});
		view.setData('tick', 1);
		view.flushUpdates();
		const messages = warn.mock.calls.map(([message]) => message).filter((message) =>
			message.includes('the shapes don\'t match')
		);
		expect(messages).toEqual([
			'[puzzle] snippet fits slot "row" declares (person); slot hands over (user) — the shapes don\'t match',
		]);
	});

	it('stays quiet for a Snippet no marker consumed', async () => {
		// There is no unused-snippet warning: a marker inside a currently-false
		// {#if} or an empty {#for} never renders, so an observation of "nothing
		// consumed this" cannot tell a real authoring mistake from ordinary
		// conditional markup. The other three diagnostics below stay.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class NoMarkers extends PuzzleView {
			render() { return h('div'); }
		}
		const view = new NoMarkers();
		mounted.push(view);
		await view.mount(container(), {
			children: [snippet('missing', ['item'], () => [text('unconsumed')])],
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it('warns and renders fallback when plain content fills an args-bearing marker', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class ScopedOnly extends PuzzleView {
			render() { return h('div', {}, [marker('', { item: 1 }, [text('fallback')])]); }
		}
		const view = new ScopedOnly();
		mounted.push(view);
		const el = container();
		await view.mount(el, { children: [h('span', {}, [text('plain')])] });
		expect(el.textContent).toBe('fallback');
		expect(warn.mock.calls.some(([message]) => message.includes('plain content cannot fill args-bearing slot "default"'))).toBe(true);
	});

	it('warns defensively when hand-built Snippet output still contains a marker', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class DefensiveMarkerHost extends PuzzleView {
			render() { return h('div', {}, [marker('row', { item: 1 })]); }
		}
		const view = new DefensiveMarkerHost();
		mounted.push(view);
		await view.mount(container(), {
			children: [snippet('row', ['item'], () => [
				h('section', {}, [marker('', null)]),
			])],
		});

		expect(warn).toHaveBeenCalledWith(
			'[puzzle] snippet fits slot "row" returned a composition marker — markers inside <Snippet> bodies are compile errors and belong in the component\'s own template'
		);
	});
});

describe('snippets — SSG', () => {
	it('serializes stamped snippets through the shared expansion pipe', async () => {
		class ServerList extends PuzzleView {
			data(params, props) { return { rows: props.rows }; }
			render() {
				return h('ul', {}, this.getData().rows.map((row) =>
					h('li', { key: row.id }, [marker('row', { row })])
				));
			}
		}
		const html = await serialize(comp(
			ServerList,
			{ rows: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }] },
			[snippet('row', ['row'], ({ row }) => [h('strong', {}, [text(row.name)])])],
		));
		expect(html).toBe('<ul><li><strong>one</strong></li><li><strong>two</strong></li></ul>');
		// A snippet vnode that reaches the serializer was never consumed by an
		// expansion pass — the D89 metadata-tag diagnostic, not empty output
		// (tests/snippet-tag-escape.test.js owns that boundary).
		await expect(serialize(snippet('unconsumed', [], () => [text('never')]))).rejects.toThrow(
			/vnode tag "#snippet" reached the DOM/
		);
	});

	it('serializes snippets forwarded through two wrappers via the shared expansion pipe', async () => {
		class ServerList extends PuzzleView {
			render() {
				return h('ul', {}, [h('li', {}, [marker('row', { item: 'ssg' })])]);
			}
		}
		class InnerWrapper extends PuzzleView {
			render() { return comp(ServerList, {}, [marker('', null)]); }
		}
		class OuterWrapper extends PuzzleView {
			render() { return comp(InnerWrapper, {}, [marker('', null)]); }
		}

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const html = await serialize(comp(OuterWrapper, {}, [
			snippet('row', ['item'], ({ item }) => [h('strong', {}, [text(item)])]),
		]));

		expect(html).toBe('<ul><li><strong>ssg</strong></li></ul>');
		expect(warn).not.toHaveBeenCalled();
	});
});

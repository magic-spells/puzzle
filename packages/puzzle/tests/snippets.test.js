// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG, SNIPPET_TAG } from '../client-runtime/views/ViewNode.js';
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

	it('warns for an unconsumed Snippet fits-name', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		class NoMarkers extends PuzzleView {
			render() { return h('div'); }
		}
		const view = new NoMarkers();
		mounted.push(view);
		await view.mount(container(), {
			children: [snippet('missing', ['item'], () => [text('unused')])],
		});
		expect(warn).toHaveBeenCalledWith(
			'[puzzle] snippet fits slot "missing", but no matching slot marker consumed it'
		);
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
		expect(await serialize(snippet('unused', [], () => [text('never')]))).toBe('');
	});
});

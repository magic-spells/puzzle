// @vitest-environment jsdom
// share() and the single-object data() (D197): a parent view passes values and
// callbacks to nested views at any depth, grouped under its name in camelcase,
// and only the descendants whose data() read a changed key re-run.
import { describe, it, expect } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { serialize } from '../client-runtime/ssg/serialize.js';

// hand-written stand-ins for what the compiler emits (see composition.test.js)
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value: String(value) });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const slot = () => new ViewNode(SLOT_TAG);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

/** wait past the animation frame a setState() armed, plus anything it queued */
const afterFrame = () =>
	new Promise((resolve) => {
		const done = () => setTimeout(resolve, 0);
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
		else setTimeout(done, 0);
	});

describe('data() takes one object (D197)', () => {
	it('passes params, props and an empty shared object', async () => {
		let seen;
		class V extends PuzzleView {
			data(input) {
				seen = input;
				return {};
			}
			render() {
				return h('div');
			}
		}
		await new V().mount(container(), { params: { id: '7' }, props: { tone: 'quiet' } });
		expect(seen.params).toEqual({ id: '7' });
		expect(seen.props).toEqual({ tone: 'quiet' });
		expect(seen.shared).toEqual({});
	});

	it('lets a view destructure a sharer that is not there without throwing', async () => {
		class Leaf extends PuzzleView {
			data({ props, shared: { filter = {} } }) {
				return { label: `${props.name}:${filter.value ?? 'none'}` };
			}
			render() {
				return h('span', {}, [text(this.getData().label)]);
			}
		}
		const el = container();
		await new Leaf().mount(el, { props: { name: 'leaf' } });
		expect(el.textContent).toBe('leaf:none');
	});

	it('keeps the props default when data() is not overridden', async () => {
		class Chip extends PuzzleView {
			render() {
				return h('b', {}, [text(this.getData().tone)]);
			}
		}
		const el = container();
		await new Chip().mount(el, { props: { tone: 'loud' } });
		expect(el.textContent).toBe('loud');
	});
});

describe('share() (D197)', () => {
	it('reaches a nested component under the sharer name in camelCase', async () => {
		class Leaf extends PuzzleView {
			data({ shared: { filterPanel } }) {
				return { value: filterPanel.value };
			}
			render() {
				return h('i', {}, [text(this.getData().value)]);
			}
		}
		class Middle extends PuzzleView {
			render() {
				return h('div', {}, [comp(Leaf)]);
			}
		}
		class FilterPanel extends PuzzleView {
			data() {
				return { value: 'red' };
			}
			share() {
				return { value: this.getData().value };
			}
			render() {
				return h('section', {}, [comp(Middle)]);
			}
		}
		const el = container();
		await new FilterPanel().mount(el);
		await afterFrame();
		expect(el.textContent).toBe('red');
	});

	it('reaches slot content: a Tab inside Tabs that Tabs does not render itself', async () => {
		const tabRuns = { a: 0, b: 0 };
		class Tab extends PuzzleView {
			data({ props, shared: { tabs } }) {
				tabRuns[props.id]++;
				return { id: props.id, active: tabs.active === props.id };
			}
			render() {
				const { id, active } = this.getData();
				return h('button', {
					class: active ? 'on' : 'off',
					'@click': () => this.shared.tabs.select(id),
				}, [text(id)]);
			}
		}
		class Tabs extends PuzzleView {
			created() {
				this.setState({ active: 'a' });
			}
			data() {
				return {};
			}
			share() {
				const { active } = this.getState();
				return { active, select: (id) => this.setState({ active: id }) };
			}
			render() {
				return h('nav', {}, [slot()]);
			}
		}
		// the page writes both Tab vnodes as Tabs' slot content
		class Page extends PuzzleView {
			render() {
				return h('main', {}, [comp(Tabs, {}, [comp(Tab, { id: 'a' }), comp(Tab, { id: 'b' })])]);
			}
		}
		const el = container();
		await new Page().mount(el);
		await afterFrame();
		const [a, b] = el.querySelectorAll('button');
		expect([a.className, b.className]).toEqual(['on', 'off']);
		const before = { ...tabRuns };

		b.click();
		await afterFrame();
		const [a2, b2] = el.querySelectorAll('button');
		expect([a2.className, b2.className]).toEqual(['off', 'on']);
		// each tab read `active`, so each re-ran once
		expect(tabRuns.a - before.a).toBe(1);
		expect(tabRuns.b - before.b).toBe(1);
	});

	it('lets a nested Filter build on its parent Filter: a three-level chain', async () => {
		class Readout extends PuzzleView {
			data({ shared: { filter = {} } }) {
				return { chain: (filter.chain ?? []).join('>') };
			}
			render() {
				return h('output', {}, [text(this.getData().chain)]);
			}
		}
		class Filter extends PuzzleView {
			created() {
				this.setState({ value: this.props.value });
			}
			share({ shared: { filter } }) {
				const { value } = this.getState();
				return {
					value,
					chain: [...(filter?.chain ?? []), value],
					set: (v) => this.setState({ value: v }),
				};
			}
			render() {
				return h('div', {}, [slot()]);
			}
		}
		class Page extends PuzzleView {
			render() {
				return h('main', {}, [
					comp(Filter, { value: 'shoes' }, [
						comp(Filter, { value: 'red' }, [comp(Filter, { value: 'size-9' }, [comp(Readout)])]),
					]),
				]);
			}
		}
		const el = container();
		const page = new Page();
		await page.mount(el);
		await afterFrame();
		expect(el.querySelector('output').textContent).toBe('shoes>red>size-9');

		// change the outermost filter: the change has to travel down two sharers
		const outer = page._vnodeTree().children[0].component;
		// the outermost filter has no Filter above it
		expect(outer.shared).toEqual({});
		outer.setState({ value: 'boots' });
		await afterFrame();
		expect(el.querySelector('output').textContent).toBe('boots>red>size-9');
	});

	it('lets the nearest ancestor of a name win', async () => {
		let seen;
		class Leaf extends PuzzleView {
			data({ shared }) {
				seen = shared.theme.name;
				return {};
			}
			render() {
				return h('i');
			}
		}
		class Theme extends PuzzleView {
			share({ props }) {
				return { name: props.name };
			}
			render() {
				return h('div', {}, [slot()]);
			}
		}
		class Page extends PuzzleView {
			render() {
				return h('main', {}, [comp(Theme, { name: 'outer' }, [comp(Theme, { name: 'inner' }, [comp(Leaf)])])]);
			}
		}
		await new Page().mount(container());
		await afterFrame();
		expect(seen).toBe('inner');
	});

	it('groups different sharers side by side', async () => {
		let seen;
		class Leaf extends PuzzleView {
			data({ shared }) {
				seen = { theme: shared.theme.name, filter: shared.filter.value };
				return {};
			}
			render() {
				return h('i');
			}
		}
		class Theme extends PuzzleView {
			share() {
				return { name: 'dark' };
			}
			render() {
				return h('div', {}, [slot()]);
			}
		}
		class Filter extends PuzzleView {
			share() {
				return { value: 'red' };
			}
			render() {
				return h('div', {}, [slot()]);
			}
		}
		class Page extends PuzzleView {
			render() {
				return h('main', {}, [comp(Theme, {}, [comp(Filter, {}, [comp(Leaf)])])]);
			}
		}
		await new Page().mount(container());
		await afterFrame();
		expect(seen).toEqual({ theme: 'dark', filter: 'red' });
	});

	it('re-runs only the children whose data() read the changed key', async () => {
		const runs = { count: 0, label: 0, none: 0 };
		class ReadsCount extends PuzzleView {
			data({ shared: { counter } }) {
				runs.count++;
				return { n: counter.count };
			}
			render() {
				return h('i', { class: 'count' }, [text(this.getData().n)]);
			}
		}
		class ReadsLabel extends PuzzleView {
			data({ shared: { counter } }) {
				runs.label++;
				return { label: counter.label };
			}
			render() {
				return h('i', {}, [text(this.getData().label)]);
			}
		}
		class ReadsNothing extends PuzzleView {
			data() {
				runs.none++;
				return {};
			}
			render() {
				return h('i');
			}
		}
		class Counter extends PuzzleView {
			created() {
				this.setState({ count: 0, label: 'clicks' });
			}
			share() {
				const { count, label } = this.getState();
				return { count, label };
			}
			render() {
				return h('div', {}, [slot()]);
			}
		}
		class Page extends PuzzleView {
			render() {
				return h('main', {}, [comp(Counter, {}, [comp(ReadsCount), comp(ReadsLabel), comp(ReadsNothing)])]);
			}
		}
		const el = container();
		const page = new Page();
		await page.mount(el);
		await afterFrame();
		const before = { ...runs };
		const counter = page._vnodeTree().children[0].component;

		counter.setState({ count: 1 });
		await afterFrame();
		expect(el.querySelector('.count').textContent).toBe('1');
		expect(runs.count - before.count).toBe(1);
		expect(runs.label - before.label).toBe(0);
		expect(runs.none - before.none).toBe(0);
	});

	it('re-runs share() when setState() writes a key share() read but data() did not', async () => {
		let shareRuns = 0;
		class Leaf extends PuzzleView {
			data({ shared: { box } }) {
				return { open: box.open };
			}
			render() {
				return h('i', {}, [text(this.getData().open)]);
			}
		}
		class Box extends PuzzleView {
			created() {
				this.setState({ open: false });
			}
			data() {
				return {};
			}
			share() {
				shareRuns++;
				return { open: this.getState().open };
			}
			render() {
				return h('div', {}, [comp(Leaf)]);
			}
		}
		const el = container();
		const box = new Box();
		await box.mount(el);
		await afterFrame();
		const before = shareRuns;
		box.setState({ open: true });
		await afterFrame();
		expect(shareRuns - before).toBe(1);
		expect(el.textContent).toBe('true');
	});

	it('hands out stable callbacks that always call the newest closure', async () => {
		const sets = [];
		let leafRuns = 0;
		class Leaf extends PuzzleView {
			data({ shared: { picker } }) {
				leafRuns++;
				return { set: picker.set };
			}
			render() {
				return h('i');
			}
		}
		class Picker extends PuzzleView {
			created() {
				this.setState({ version: 1 });
			}
			share() {
				const { version } = this.getState();
				// a fresh closure on every run, capturing the current version
				return { version, set: (v) => sets.push([version, v]) };
			}
			render() {
				return h('div', {}, [comp(Leaf)]);
			}
		}
		const el = container();
		const picker = new Picker();
		await picker.mount(el);
		await afterFrame();
		const leaf = picker._vnodeTree().children[0].component;
		const first = leaf.getData().set;
		const runsBefore = leafRuns;

		picker.setState({ version: 2 });
		await afterFrame();
		// the leaf read only `set`: a new closure is not a change, so it did not re-run
		expect(leafRuns).toBe(runsBefore);
		expect(leaf.shared.picker.set).toBe(first);
		first('x');
		expect(sets).toEqual([[2, 'x']]);
	});

	it('gives handlers this.shared without recording reads', async () => {
		let leaf;
		class Leaf extends PuzzleView {
			created() {
				leaf = this;
			}
			render() {
				return h('i');
			}
		}
		class Cart extends PuzzleView {
			created() {
				this.setState({ items: 0 });
			}
			share() {
				return { items: this.getState().items, add: () => this.setState({ items: this.getState().items + 1 }) };
			}
			render() {
				return h('div', {}, [comp(Leaf)]);
			}
		}
		await new Cart().mount(container());
		await afterFrame();
		leaf.shared.cart.add();
		leaf.shared.cart.add();
		await afterFrame();
		expect(leaf.shared.cart.items).toBe(2);
	});

	it('uses the compiler stamp for the key when there is one', async () => {
		let seen;
		class Leaf extends PuzzleView {
			data({ shared }) {
				seen = Object.keys(shared);
				return {};
			}
			render() {
				return h('i');
			}
		}
		// a minified class name, as a production build leaves it
		class q extends PuzzleView {
			share() {
				return { on: true };
			}
			render() {
				return h('div', {}, [comp(Leaf)]);
			}
		}
		q.__share = 'toggleGroup';
		await new q().mount(container());
		await afterFrame();
		expect(seen).toEqual(['toggleGroup']);
	});

	it('takes children off the sharer list when they, or the sharer, are destroyed', async () => {
		let leafRuns = 0;
		class Leaf extends PuzzleView {
			data({ shared: { panel } }) {
				leafRuns++;
				return { v: panel.v };
			}
			render() {
				return h('i');
			}
		}
		class Panel extends PuzzleView {
			created() {
				this.setState({ v: 1, show: true });
			}
			share() {
				return { v: this.getState().v };
			}
			render() {
				return h('div', {}, this.getData().show ? [comp(Leaf)] : []);
			}
		}
		const el = container();
		const panel = new Panel();
		await panel.mount(el);
		await afterFrame();
		const leaf = panel._vnodeTree().children[0].component;

		// hide the child: it leaves the sharer list, so a change does not re-run it
		panel.setState({ show: false });
		await afterFrame();
		expect(leaf.isDestroyed).toBe(true);
		const runsBefore = leafRuns;
		panel.setState({ v: 2 });
		await afterFrame();
		expect(leafRuns).toBe(runsBefore);

		// destroy the sharer itself: nothing re-runs and nothing throws
		panel.setState({ show: true });
		await afterFrame();
		const leaf2 = panel._vnodeTree().children[0].component;
		panel.destroy();
		expect(leaf2.isDestroyed).toBe(true);
		const after = leafRuns;
		panel.setState({ v: 3 });
		await afterFrame();
		expect(leafRuns).toBe(after);
	});

	it('re-publishes whenever the sharer data() commits again', async () => {
		let shown;
		class Leaf extends PuzzleView {
			data({ shared: { scores } }) {
				shown = scores.total;
				return {};
			}
			render() {
				return h('i');
			}
		}
		class Scores extends PuzzleView {
			data() {
				return { total: (this.getState().tick ?? 0) * 10 };
			}
			share() {
				return { total: this.getData().total };
			}
			render() {
				return h('div', {}, [comp(Leaf)]);
			}
		}
		const scores = new Scores();
		await scores.mount(container());
		await afterFrame();
		expect(shown).toBe(0);
		scores.setState({ tick: 2 });
		await afterFrame();
		expect(shown).toBe(20);
	});

	it('reaches nested components in a prerender too', async () => {
		class Leaf extends PuzzleView {
			data({ shared: { filter } }) {
				return { value: filter.value };
			}
			render() {
				return h('i', {}, [text(this.getData().value)]);
			}
		}
		class Filter extends PuzzleView {
			share({ props }) {
				return { value: props.value };
			}
			render() {
				return h('div', {}, [slot()]);
			}
		}
		class Page extends PuzzleView {
			render() {
				return h('main', {}, [comp(Filter, { value: 'red' }, [comp(Leaf)])]);
			}
		}
		const html = await serialize(comp(Page));
		expect(html).toBe('<main><div><i>red</i></div></main>');
	});

	it('stops at a router-mounted view: a layout share() never reaches its page', async () => {
		let seen;
		class Page extends PuzzleView {
			data({ shared }) {
				seen = shared;
				return {};
			}
			render() {
				return h('i');
			}
		}
		class Layout extends PuzzleView {
			share() {
				return { title: 'site' };
			}
			render() {
				return h('div', {}, [comp(Page)]);
			}
		}
		// the router hands a routed view its route snapshot through preload()
		const page = new Page();
		page.__parent = new Layout();
		await page.preload({ params: {}, props: {}, route: { path: '/' } });
		expect(seen).toEqual({});
	});
});

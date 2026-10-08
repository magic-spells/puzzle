// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Puzzle, PuzzleModel, PuzzleView, ViewNode, SLOT_TAG, dynamicComponent } from '../client-runtime/index.js';
import { mountView, settled, installFakeAnimate } from '../client-runtime/testing/index.js';
import { liveViewList } from '../client-runtime/devstate.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { preloadTakeoverComponents } from '../client-runtime/ssg/preload.js';
import CompiledHost from './fixtures/component-slot/Host.compiled.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => h('text', { value });
const handles = [];
afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	vi.restoreAllMocks();
});
async function mounted(Class, options) {
	const handle = await mountView(Class, options);
	handles.push(handle);
	return handle;
}

class Card extends PuzzleView {
	data(_params, props) { return props; }
	render() {
		const { title, close } = this.getData();
		return h('section', { class: 'card' }, [text(title), h('button', { '@click': () => close?.(title) }), h(SLOT_TAG)]);
	}
}
class Panel extends Card {
	render() { return h('article', { class: 'panel' }, [text(this.getData().title), h(SLOT_TAG)]); }
}
class Host extends PuzzleView {
	data(_params, props) { return props; }
	render() {
		const { current, title, close, content } = this.getData();
		return h('main', {}, [dynamicComponent(current, { title, close }, [h('b', {}, [text(content)])]), h('input', { class: 'sibling' })]);
	}
}

describe('<Component> runtime (D180)', () => {
	it('runs compiler output with indexed module selection, ordered spreads, events, and default slots', async () => {
		const onclose = vi.fn();
		const view = await mounted(CompiledHost, { props: { type: 'card', title: 'first', extra: { title: 'overridden' }, onclose } });
		const input = view.find('.persistent');
		expect(view.find('.current').textContent).toBe('firstslot first');
		expect(view.find('.mapped').textContent).toBe('firstmap slot first');
		expect(view.find('.direct').textContent).toBe('direct');
		await view.click('.current button');
		expect(onclose).toHaveBeenLastCalledWith('first');
		await view.setProps({ type: 'panel', title: 'second', extra: { title: 'old' }, onclose });
		expect(view.findAll('.compiled-panel')).toHaveLength(2);
		expect(view.find('.current').textContent).toBe('secondslot second');
		await view.click('.mapped button');
		expect(onclose).toHaveBeenLastCalledWith('second');
		expect(view.find('.mapped').textContent).toBe('secondmap slot second');
		await view.setProps({ type: 'missing', title: 'third', onclose });
		expect(view.find('.current').textContent).toBe('');
		expect(view.find('.mapped').textContent).toBe('');
		expect(view.find('.persistent')).toBe(input);
	});

	it('updates props and callbacks, swaps constructors with current props, and forwards is children', async () => {
		const close = vi.fn();
		const view = await mounted(Host, { props: { current: Card, title: 'one', close, content: 'slot one' } });
		const card = liveViewList().find((v) => v.constructor === Card);
		const sibling = view.find('.sibling');
		await view.click('button');
		expect(close).toHaveBeenLastCalledWith('one');
		await view.setProps({ current: Card, title: 'two', close, content: 'slot two' });
		expect(liveViewList()).toContain(card);
		expect(view.find('.card').textContent).toBe('twoslot two');
		await view.click('button');
		expect(close).toHaveBeenLastCalledWith('two');
		await view.setProps({ current: Panel, title: 'three', close, content: 'slot three' });
		expect(card.isDestroyed).toBe(true);
		expect(view.find('.panel').textContent).toBe('threeslot three');
		expect(view.find('.sibling')).toBe(sibling);
	});

	it('null and undefined hold the position, release the child, and mount again', async () => {
		const view = await mounted(Host, { props: { current: Card, title: 'a', content: '' } });
		const sibling = view.find('.sibling');
		for (const current of [null, undefined, Panel, null, Card]) {
			await view.setProps({ current, title: 'now', content: '' });
			expect(view.findAll('section, article')).toHaveLength(current ? 1 : 0);
			expect(view.find('.sibling')).toBe(sibling);
		}
	});

	it('rejects values that are not compiled Puzzle component constructors', () => {
		for (const value of ['Card', {}, false, () => {}]) {
			expect(() => dynamicComponent(value)).toThrow('imported Puzzle component');
		}
	});

	it('destroys subscriptions, refs, listeners, and animations before the replacement mounts', async () => {
		const outside = vi.fn();
		const destroyed = vi.fn();
		const fake = installFakeAnimate();
		class Item extends PuzzleModel { static schema = { id: Puzzle.string().primary(), title: Puzzle.string() }; }
		let old;
		class Tracked extends PuzzleView {
			animations = { in: { from: { opacity: 0 }, to: { opacity: 1 }, duration: 1000 }, out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 1000 } };
			created() { old = this; }
			data() { return { item: this.ctx.store.findOne('item', '1') }; }
			render() { return h('div', {}, [h('button', { ref: this.__ref('button'), '@click:outside': outside }, [text(this.getData().item?.title ?? '')])]); }
			destroyed() { destroyed(); }
		}
		class Replacement extends Card {
			created() {
				expect(old.isDestroyed).toBe(true);
				expect(old.refs.button).toBeNull();
				expect(this.ctx.store.keysBySubscriber.has(old)).toBe(false);
			}
		}
		try {
			const view = await mounted(Host, { props: { current: Tracked, content: '' }, models: { item: Item } });
			expect(view.store.keysBySubscriber.has(old)).toBe(true);
			expect(fake.animations).toHaveLength(1);
			await view.setProps({ current: Replacement, title: 'fresh', content: '' });
			expect(fake.animations[0].finishedState).toBe('cancelled');
			expect(destroyed).toHaveBeenCalledOnce();
			expect(liveViewList()).not.toContain(old);
			document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(outside).not.toHaveBeenCalled();
			view.store.createRecord('item', { id: '1', title: 'late' });
			await settled();
			expect(view.find('.card').textContent).toBe('fresh');
		} finally { fake.uninstall(); }
	});

	it('cancels a pending async child so its eventual data cannot mount after a swap', async () => {
		let resolveData;
		let announceCreated;
		const created = new Promise((resolve) => { announceCreated = resolve; });
		const data = new Promise((resolve) => { resolveData = resolve; });
		const mountedHook = vi.fn();
		let pending;
		class Pending extends Card {
			created() { pending = this; announceCreated(); }
			async data() { return await data; }
			mounted() { mountedHook(); }
		}
		const view = await mounted(Host, { props: { current: null, title: 'ready', content: '' } });
		view.instance.setData('current', Pending);
		await created;
		let announceReplacement;
		const replaced = new Promise((resolve) => { announceReplacement = resolve; });
		class Replacement extends Card { created() { announceReplacement(); } }
		view.instance.setData('current', Replacement);
		await replaced;
		expect(pending.isDestroyed).toBe(true);
		resolveData({ title: 'late' });
		await settled();
		expect(mountedHook).not.toHaveBeenCalled();
		expect(view.find('.card').textContent).toBe('ready');
	});

	it('destroys a selected component with a component root before mounting its replacement', async () => {
		let nested;
		class Nested extends Card {
			created() { nested = this; }
			viewWillHide() {}
		}
		class Selected extends PuzzleView {
			render() { return h(Nested, { title: 'nested' }); }
		}
		class Replacement extends Card {
			created() { expect(nested.isDestroyed).toBe(true); }
		}
		const view = await mounted(Host, { props: { current: Selected, title: 'new', content: '' } });
		await view.setProps({ current: Replacement, title: 'new', content: '' });
		expect(view.findAll('.card')).toHaveLength(1);
		expect(liveViewList()).not.toContain(nested);
	});

	it('nested selections and keyed moves carry their whole DOM ranges', async () => {
		class Nested extends Card {
			render() { return h('div', { class: 'nested' }, [dynamicComponent(Card, { title: this.props.title })]); }
		}
		class List extends PuzzleView {
			data(_params, props) { return props; }
			render() { return h('main', {}, this.getData().items.map((id) => dynamicComponent(Nested, { key: id, title: id }))); }
		}
		const view = await mounted(List, { props: { items: ['a', 'b'] } });
		const a = view.findAll('.nested')[0];
		await view.setProps({ items: ['b', 'a'] });
		expect(view.findAll('.nested').map((v) => v.textContent)).toEqual(['b', 'a']);
		expect(view.findAll('.nested')[1]).toBe(a);
		await view.setProps({ items: [] });
		expect(view.element.childNodes).toHaveLength(0);
	});

	it('an empty selection leaves an enclosing slot unfilled', async () => {
		class FallbackCard extends PuzzleView {
			render() { return h('section', {}, [h(SLOT_TAG, {}, [text('unfilled')])]); }
		}
		class Wrapper extends PuzzleView {
			render() { return h('main', {}, [h(FallbackCard, {}, [dynamicComponent(null)])]); }
		}
		const view = await mounted(Wrapper);
		expect(view.element.textContent).toBe('unfilled');
	});

	it('a root range can swap and be destroyed without leaving comments or content', async () => {
		class Root extends PuzzleView {
			data(_params, props) { return props; }
			render() { return dynamicComponent(this.getData().current, { title: 'root' }); }
		}
		const view = await mounted(Root, { props: { current: Card } });
		await view.setProps({ current: Panel });
		expect(view.container.textContent).toBe('root');
		view.destroy();
		expect(view.container.childNodes).toHaveLength(0);
	});

	it('serializes selections, slot content and null, and preloads takeover children', async () => {
		const tree = h('main', {}, [dynamicComponent(Card, { title: 'SSR' }, [h('b', {}, [text('slot')])]), dynamicComponent(null)]);
		expect(await serialize(tree)).toBe('<main><section class="card">SSR<button></button><b>slot</b></section></main>');
		const host = await mounted(Host, { props: { current: null } });
		const preloaded = await preloadTakeoverComponents(tree, host.ctx);
		try { expect(preloaded.map((v) => v.constructor)).toEqual([Card]); }
		finally { for (const view of preloaded) view.destroy(); }
	});
});

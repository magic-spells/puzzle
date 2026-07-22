// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

// Hand-written stand-ins for what the compiler emits for named slots (SPEC §24,
// D53): a named marker is `new ViewNode(SLOT_TAG, { name }, [fallback…])`, a bare
// default marker is `new ViewNode(SLOT_TAG)`, and a call-site child routed to a
// region carries a static `slot` attr the ViewManager partitions + strips.
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const slot = () => new ViewNode(SLOT_TAG);
const namedSlot = (name, fallback = []) => new ViewNode(SLOT_TAG, { name }, fallback);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

// A three-region card: named header (fallback "Untitled"), default body,
// named footer (no fallback).
class Card extends PuzzleView {
	render() {
		return h('div', { class: 'card' }, [
			h('header', {}, [namedSlot('header', [text('Untitled')])]),
			h('div', { class: 'body' }, [slot()]),
			h('footer', {}, [namedSlot('footer')]),
		]);
	}
}

describe('named slots — routing (D53)', () => {
	it('routes content to two named regions and the default simultaneously', async () => {
		class Host extends PuzzleView {
			render() {
				return h('div', {}, [
					comp(Card, {}, [
						h('h2', { slot: 'header' }, [text('Title')]),
						h('p', {}, [text('body content')]),
						h('button', { slot: 'footer' }, [text('Read')]),
					]),
				]);
			}
		}
		const el = container();
		await new Host().mount(el);

		expect(el.querySelector('.card header h2').textContent).toBe('Title');
		expect(el.querySelector('.card .body p').textContent).toBe('body content');
		expect(el.querySelector('.card footer button').textContent).toBe('Read');
		// fallback is gone once the region is filled
		expect(el.querySelector('.card header').textContent).toBe('Title');
	});

	it('the slot attr is stripped from routed content but kept on plain-HTML deep usage', async () => {
		class DeepSlot extends PuzzleView {
			// a `slot` attr in the component's OWN render tree (shadow-DOM style) is
			// the ordinary HTML global attribute — never partitioned, never stripped.
			render() {
				return h('div', { class: 'wrap' }, [h('span', { slot: 'x', class: 'deep' }, [text('deep')])]);
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('div', {}, [
					comp(Card, {}, [h('h2', { slot: 'header' }, [text('T')])]),
					comp(DeepSlot),
				]);
			}
		}
		const el = container();
		await new Host().mount(el);

		// routed content: slot attr absent from the DOM
		expect(el.querySelector('.card header h2').hasAttribute('slot')).toBe(false);
		// plain-HTML deep usage: slot attr present
		expect(el.querySelector('.deep').getAttribute('slot')).toBe('x');
	});
});

describe('named slots — fallback (D53)', () => {
	it('renders fallback when unfilled and swaps it in/out on later patches', async () => {
		class Host extends PuzzleView {
			created() {
				this.setData({ withHeader: false });
			}
			data() {
				return { withHeader: this.getData().withHeader };
			}
			render() {
				const kids = [h('p', {}, [text('body')])];
				if (this.getData().withHeader) {
					kids.unshift(h('h2', { slot: 'header' }, [text('Filled')]));
				}
				return h('div', {}, [comp(Card, {}, kids)]);
			}
		}
		const el = container();
		const host = await new Host().mount(el);

		// unfilled → fallback
		expect(el.querySelector('.card header').textContent).toBe('Untitled');

		// fill it → fallback replaced
		host.setData('withHeader', true);
		host.flushUpdates();
		expect(el.querySelector('.card header h2').textContent).toBe('Filled');
		expect(el.querySelector('.card header').textContent).toBe('Filled');

		// unfill again → fallback returns
		host.setData('withHeader', false);
		host.flushUpdates();
		expect(el.querySelector('.card header h2')).toBeNull();
		expect(el.querySelector('.card header').textContent).toBe('Untitled');
	});

	it('a routed view/layout (router fills default only) renders named fallbacks', async () => {
		// The router only ever supplies DEFAULT slot content (a view/layout chain),
		// so a named marker in that template renders its fallback naturally.
		class Host extends PuzzleView {
			render() {
				return h('div', {}, [comp(Card, {}, [h('p', {}, [text('routed body')])])]);
			}
		}
		const el = container();
		await new Host().mount(el);

		expect(el.querySelector('.card header').textContent).toBe('Untitled'); // fallback
		expect(el.querySelector('.card .body p').textContent).toBe('routed body');
		expect(el.querySelector('.card footer').textContent).toBe(''); // empty fallback
	});
});

describe('named slots — slotted components + control flow (D53)', () => {
	it('a slotted component tag mounts, patches, and destroys correctly', async () => {
		const destroyed = vi.fn();
		class Chip extends PuzzleView {
			data(params, props) {
				return { label: props.label };
			}
			render() {
				return h('span', { class: 'chip' }, [text(this.getData().label)]);
			}
			destroyed() {
				destroyed();
			}
		}
		class Host extends PuzzleView {
			created() {
				this.setData({ label: 'a', show: true });
			}
			data() {
				const d = this.getData();
				return { label: d.label, show: d.show };
			}
			render() {
				const d = this.getData();
				const footer = d.show ? [comp(Chip, { slot: 'footer', label: d.label })] : [];
				return h('div', {}, [comp(Card, {}, [h('p', {}, [text('b')]), ...footer])]);
			}
		}
		const el = container();
		const host = await new Host().mount(el);

		// mounted into the footer region
		expect(el.querySelector('.card footer .chip').textContent).toBe('a');

		// prop patch flows through the slot
		host.setData('label', 'b');
		host.flushUpdates();
		expect(el.querySelector('.card footer .chip').textContent).toBe('b');

		// removal destroys the slotted child
		host.setData('show', false);
		host.flushUpdates();
		expect(el.querySelector('.card footer .chip')).toBeNull();
		expect(destroyed).toHaveBeenCalledTimes(1);
	});

	it('control flow inside a slotted element works and handlers hit the parent', async () => {
		let clicks = 0;
		class Host extends PuzzleView {
			created() {
				this.setData({ open: true });
			}
			data() {
				return { open: this.getData().open };
			}
			events = {
				hit: () => {
					clicks++;
				},
			};
			render() {
				const d = this.getData();
				// control flow lives INSIDE the slotted element (the sanctioned form)
				return h('div', {}, [
					comp(Card, {}, [
						h('h2', { slot: 'header' }, d.open ? [text('Open')] : [text('Closed')]),
						h(
							'button',
							{ slot: 'footer', '@click': (event) => this.events.hit(event) },
							[text('X')]
						),
					]),
				]);
			}
		}
		const el = container();
		const host = await new Host().mount(el);

		expect(el.querySelector('.card header h2').textContent).toBe('Open');
		host.setData('open', false);
		host.flushUpdates();
		expect(el.querySelector('.card header h2').textContent).toBe('Closed');

		el.querySelector('.card footer button').click();
		expect(clicks).toBe(1); // parent-scope handler ran through the slot
	});
});

describe('named slots — reserved-name slot buckets (FIX 10)', () => {
	it('partitions and renders a slot named "constructor" without crashing (null-proto bucket)', async () => {
		class Weird extends PuzzleView {
			render() {
				return h('div', { class: 'weird' }, [
					h('section', { class: 'ctor' }, [namedSlot('constructor', [text('fallback')])]),
					h('div', { class: 'body' }, [slot()]),
				]);
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('div', {}, [
					comp(Weird, {}, [
						h('span', { slot: 'constructor' }, [text('routed')]),
						h('p', {}, [text('body')]),
					]),
				]);
			}
		}
		// Pre-fix: `named = {}` makes `named['constructor']` inherit Object.prototype's
		// constructor (truthy), so `??= []` skips and `.push` crashes at mount.
		const el = container();
		await new Host().mount(el);

		expect(el.querySelector('.weird .ctor span').textContent).toBe('routed');
		expect(el.querySelector('.weird .body p').textContent).toBe('body');
	});
});

describe('named slots — keyed reconciliation inside a region (D53)', () => {
	// A card region that fans a whole keyed list into one named slot.
	class ListCard extends PuzzleView {
		render() {
			return h('ul', { class: 'listcard' }, [namedSlot('items')]);
		}
	}

	it('multiple keyed children in one named slot reorder without rebuilding DOM', async () => {
		class Host extends PuzzleView {
			created() {
				this.setData({ order: ['a', 'b', 'c'] });
			}
			data() {
				return { order: this.getData().order };
			}
			render() {
				const items = this.getData().order.map((id) =>
					h('li', { slot: 'items', key: id, 'data-id': id }, [text(id)])
				);
				return h('div', {}, [comp(ListCard, {}, items)]);
			}
		}
		const el = container();
		const host = await new Host().mount(el);

		const before = [...el.querySelectorAll('.listcard li')];
		expect(before.map((n) => n.textContent)).toEqual(['a', 'b', 'c']);
		const [elA, elB, elC] = before;

		host.setData('order', ['c', 'a', 'b']);
		host.flushUpdates();

		const after = [...el.querySelectorAll('.listcard li')];
		expect(after.map((n) => n.textContent)).toEqual(['c', 'a', 'b']);
		// same DOM nodes, moved not rebuilt
		expect(after[0]).toBe(elC);
		expect(after[1]).toBe(elA);
		expect(after[2]).toBe(elB);
		// the routing slot attr never reached the DOM
		expect(after[0].hasAttribute('slot')).toBe(false);
	});
});

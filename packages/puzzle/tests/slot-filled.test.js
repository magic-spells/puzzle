// @vitest-environment jsdom
//
// D173 V14 — a composition position is filled only when the content supplied
// for it renders at least one node that is not whitespace-only text. A false
// call-site {#if} (its arity placeholder) and an empty {#for} both leave the
// position unfilled, so the marker's D141 fallback shows. The trees below are
// the shapes the compiler emits (see the compiled render in the H.pzl probe:
// `...(show ? [p] : [new ViewNode('#')])` and a list-block spread), and the SSG
// serializer shares expandSlots, so prerendered output must match the browser.
import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import {
	PLACEHOLDER_TAG,
	SLOT_TAG,
	SNIPPET_TAG,
	ViewNode,
} from '../client-runtime/views/ViewNode.js';
import { serialize } from '../client-runtime/ssg/serialize.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const placeholder = () => new ViewNode(PLACEHOLDER_TAG);
const marker = (fallback = [], attrs = {}) => new ViewNode(SLOT_TAG, attrs, fallback);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

afterEach(() => {
	document.body.replaceChildren();
});

class Card extends PuzzleView {
	render() {
		return h('section', { class: 'card' }, [
			marker([h('em', { class: 'fallback' }, [text('Nothing here yet')])]),
			h('footer', {}, [
				marker([h('em', { class: 'named-fallback' }, [text('No footer')])], { name: 'footer' }),
			]),
		]);
	}
}

// Host renders <Card> with `content(state)` as its call-site children.
function hostFor(content, initial) {
	return class Host extends PuzzleView {
		created() {
			this.setData({ state: initial });
		}
		data() {
			return { state: this.getData().state };
		}
		render() {
			return h('div', {}, [h(Card, {}, content(this.getData().state))]);
		}
	};
}

describe('slot filled rule (D173 V14)', () => {
	it('a false call-site {#if} shows the fallback, and toggling swaps both ways', async () => {
		const Host = hostFor(
			(show) => (show ? [h('p', { class: 'fill' }, [text('Hi')])] : [placeholder()]),
			false
		);
		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.fallback')?.textContent).toBe('Nothing here yet');

		host.setData('state', true);
		host.flushUpdates();
		expect(el.querySelector('.fallback')).toBeNull();
		expect(el.querySelector('.fill')?.textContent).toBe('Hi');

		host.setData('state', false);
		host.flushUpdates();
		expect(el.querySelector('.fill')).toBeNull();
		expect(el.querySelector('.fallback')?.textContent).toBe('Nothing here yet');
		host.destroy();
	});

	it('an empty {#for} shows the fallback (the empty-state pattern)', async () => {
		const Host = hostFor(
			(items) => items.map((item) => h('li', { key: item, class: 'row' }, [text(item)])),
			[]
		);
		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.fallback')).not.toBeNull();

		host.setData('state', ['a', 'b']);
		host.flushUpdates();
		expect(el.querySelectorAll('.row')).toHaveLength(2);
		expect(el.querySelector('.fallback')).toBeNull();
		host.destroy();
	});

	it('whitespace-only text and empty interpolations do not fill; any other text does', async () => {
		const Host = hostFor((value) => [text('  \n  '), placeholder(), text(value)], '');
		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.fallback')).not.toBeNull();

		host.setData('state', 'x');
		host.flushUpdates();
		expect(el.querySelector('.fallback')).toBeNull();
		expect(el.querySelector('.card').textContent).toContain('x');
		host.destroy();
	});

	it('a false {#if} inside a slot-routed element still fills the named slot (the element renders)', async () => {
		const Host = hostFor(() => [h('span', { slot: 'footer', class: 'foot' }, [placeholder()])], null);
		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.foot')).not.toBeNull();
		expect(el.querySelector('.named-fallback')).toBeNull();
		host.destroy();
	});

	it('a snippet stamp that renders nothing shows the marker fallback for that stamp', async () => {
		class List extends PuzzleView {
			render() {
				return h('ul', {}, ['a', 'b'].map((item) =>
					h('li', { key: item }, [
						marker([h('i', { class: 'fb' }, [text(item)])], { args: { item } }),
					])
				));
			}
		}
		class Host extends PuzzleView {
			render() {
				const fn = ({ item }) =>
					item === 'a' ? [h('b', { class: 'stamp' }, [text(item)])] : [placeholder()];
				return h('div', {}, [
					h(List, {}, [h(SNIPPET_TAG, { fn, params: ['item'] })]),
				]);
			}
		}
		const el = container();
		const host = await new Host().mount(el);
		const rows = el.querySelectorAll('li');
		expect(rows[0].innerHTML).toBe('<b class="stamp">a</b>');
		expect(rows[1].innerHTML).toBe('<i class="fb">b</i>');
		host.destroy();
	});

	it('forwarding: an unfilled wrapper position forwards its own fallback, else nothing', async () => {
		class Inner extends PuzzleView {
			render() {
				return h('div', { class: 'inner' }, [
					marker([h('em', { class: 'inner-fallback' }, [text('inner')])]),
				]);
			}
		}
		// <Inner><Children/></Inner> and <Inner><Children>wrapper</Children></Inner>
		class Bare extends PuzzleView {
			render() {
				return h(Inner, {}, [marker()]);
			}
		}
		class WithFallback extends PuzzleView {
			render() {
				return h(Inner, {}, [marker([h('em', { class: 'wrapper-fallback' }, [text('wrapper')])])]);
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('div', {}, [
					h('div', { class: 'a' }, [h(Bare, {}, [placeholder()])]),
					h('div', { class: 'b' }, [h(WithFallback, {}, [placeholder()])]),
				]);
			}
		}
		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.a .inner-fallback')).not.toBeNull();
		expect(el.querySelector('.b .wrapper-fallback')).not.toBeNull();
		expect(el.querySelector('.b .inner-fallback')).toBeNull();
		host.destroy();
	});

	it('SSG serialization shows the same fallback as the browser', async () => {
		const tree = (children) => h('div', {}, [h(Card, {}, children)]);
		expect(await serialize(tree([placeholder()]))).toBe(
			'<div><section class="card"><em class="fallback">Nothing here yet</em>' +
				'<footer><em class="named-fallback">No footer</em></footer></section></div>'
		);
		expect(await serialize(tree([text(' '), placeholder()]))).toContain('Nothing here yet');
		expect(await serialize(tree([h('p', {}, [text('Hi')])]))).toBe(
			'<div><section class="card"><p>Hi</p>' +
				'<footer><em class="named-fallback">No footer</em></footer></section></div>'
		);
	});
});

describe('default markers in exclusive branches (D173 V13)', () => {
	it('the same call-site content moves between branch markers on toggle', async () => {
		class Flex extends PuzzleView {
			data(params, props) {
				return { compact: props.compact };
			}
			render() {
				return this.getData().compact
					? h('div', { class: 'compact' }, [marker()])
					: h('article', { class: 'full' }, [h('header'), marker()]);
			}
		}
		class Host extends PuzzleView {
			created() {
				this.setData({ compact: true });
			}
			data() {
				return { compact: this.getData().compact };
			}
			render() {
				return h('main', {}, [
					h(Flex, { compact: this.getData().compact }, [h('p', { class: 'body' }, [text('Body')])]),
				]);
			}
		}
		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.compact .body')?.textContent).toBe('Body');

		host.setData('compact', false);
		host.flushUpdates();
		await Promise.resolve();
		expect(el.querySelector('.compact')).toBeNull();
		expect(el.querySelector('.full .body')?.textContent).toBe('Body');
		expect(el.querySelectorAll('.body')).toHaveLength(1);

		host.setData('compact', true);
		host.flushUpdates();
		await Promise.resolve();
		expect(el.querySelector('.compact .body')?.textContent).toBe('Body');
		expect(el.querySelectorAll('.body')).toHaveLength(1);
		host.destroy();
	});
});

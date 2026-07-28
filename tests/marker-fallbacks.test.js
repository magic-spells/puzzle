// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const marker = (fallback = []) => new ViewNode(SLOT_TAG, {}, fallback);
const namedMarker = (name, fallback = []) => new ViewNode(SLOT_TAG, { name }, fallback);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

let activeRouter = null;

afterEach(() => {
	activeRouter?.stop();
	activeRouter = null;
	document.body.replaceChildren();
});

describe('marker fallback bodies (D141)', () => {
	it('default Children fallback renders unfilled and supplied content wins on every swap', async () => {
		class Card extends PuzzleView {
			render() {
				return h('section', { class: 'default-card' }, [
					marker([h('span', { class: 'default-fallback' }, [text('Default')])]),
				]);
			}
		}

		class Host extends PuzzleView {
			created() {
				this.setData({ filled: false });
			}
			data() {
				return { filled: this.getData().filled };
			}
			render() {
				const children = this.getData().filled
					? [h('strong', { class: 'default-fill' }, [text('Filled')])]
					: [];
				return h('div', {}, [comp(Card, {}, children)]);
			}
		}

		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.default-fallback')?.textContent).toBe('Default');

		host.setData('filled', true);
		host.flushUpdates();
		expect(el.querySelector('.default-fallback')).toBeNull();
		expect(el.querySelector('.default-fill')?.textContent).toBe('Filled');

		host.setData('filled', false);
		host.flushUpdates();
		expect(el.querySelector('.default-fill')).toBeNull();
		expect(el.querySelector('.default-fallback')?.textContent).toBe('Default');
		host.destroy();
	});

	it('named Slot fallback renders unfilled and supplied content wins on every swap', async () => {
		class Card extends PuzzleView {
			render() {
				return h('section', { class: 'named-card' }, [
					namedMarker('actions', [
						h('button', { class: 'named-fallback' }, [text('Default action')]),
					]),
				]);
			}
		}

		class Host extends PuzzleView {
			created() {
				this.setData({ filled: false });
			}
			data() {
				return { filled: this.getData().filled };
			}
			render() {
				const children = this.getData().filled
					? [
							h('a', { slot: 'actions', class: 'named-fill', href: '/go' }, [
								text('Go'),
							]),
						]
					: [];
				return h('div', {}, [comp(Card, {}, children)]);
			}
		}

		const el = container();
		const host = await new Host().mount(el);
		expect(el.querySelector('.named-fallback')?.textContent).toBe('Default action');

		host.setData('filled', true);
		host.flushUpdates();
		expect(el.querySelector('.named-fallback')).toBeNull();
		expect(el.querySelector('.named-fill')?.textContent).toBe('Go');

		host.setData('filled', false);
		host.flushUpdates();
		expect(el.querySelector('.named-fill')).toBeNull();
		expect(el.querySelector('.named-fallback')?.textContent).toBe('Default action');
		host.destroy();
	});

	it('router outlet fallback renders for a leaf view and a routed child wins on navigation', async () => {
		class Shell extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'shell' }, [
					h('main', {}, [
						marker([
							h('p', { class: 'outlet-fallback' }, [text('Nothing selected')]),
						]),
					]),
				]);
			}
		}

		class Leaf extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'outlet-fill' }, [text('Selected')]);
			}
		}

		const routes = [
			{ path: '/empty', name: 'empty', view: Shell },
			{
				path: '/filled',
				name: 'filled',
				view: Shell,
				children: [{ path: '', name: 'selected', view: Leaf }],
			},
		];
		const el = container();
		activeRouter = new Router(routes, { mode: 'memory', initialPath: '/empty' });
		await activeRouter.start(el, { store: null, router: activeRouter, formatters: null });

		expect(el.querySelector('.outlet-fallback')?.textContent).toBe('Nothing selected');

		await activeRouter.push('/filled');
		expect(el.querySelector('.outlet-fallback')).toBeNull();
		expect(el.querySelector('.outlet-fill')?.textContent).toBe('Selected');

		await activeRouter.push('/empty');
		expect(el.querySelector('.outlet-fill')).toBeNull();
		expect(el.querySelector('.outlet-fallback')?.textContent).toBe('Nothing selected');
	});
});

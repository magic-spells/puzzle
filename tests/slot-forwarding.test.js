// @vitest-environment jsdom
// Default-slot forwarding through a component invocation (v1.38, D71).
//
// A `<slot/>` marker written INSIDE a component's call-site children is authored
// in the outer template, so the outer template's slot expansion must substitute
// it before the component ever sees its children — `<Card><slot/></Card>` in a
// layout forwards the routed page into Card's default slot. Pre-D71 the
// expansion walk early-returned at component vnodes and the marker mounted as a
// literal inert <slot> DOM element (the routed content silently never mounted).
//
// Hand-written ViewNode trees stand in for compiler output (same convention as
// named-slots.test.js). Only the bare DEFAULT marker forwards — a named marker
// inside an invocation is a compile error (parser slot.go, D71).
import { describe, it, expect, afterEach } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { expandSlots } from '../client-runtime/views/viewManager.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { Router } from '../client-runtime/router/router.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const slot = () => new ViewNode(SLOT_TAG);

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

// A wrapper component with a default slot in its own template — the global
// <Container>/<Card> pattern a layout wraps routed content in.
class Card extends PuzzleView {
	render() {
		return h('div', { class: 'card' }, [h('div', { class: 'body' }, [slot()])]);
	}
}

class Panel extends PuzzleView {
	render() {
		return h('section', { class: 'panel' }, [slot()]);
	}
}

describe('default-slot forwarding through a component (D71)', () => {
	it('forwards slot content into a wrapping component instead of mounting a literal <slot>', async () => {
		// The layout case: this view's own <slot/> (router-filled) sits inside a
		// <Card> invocation. Its slot content must land inside Card's rendered body.
		class Layout extends PuzzleView {
			render() {
				return h('div', { class: 'layout' }, [comp(Card, {}, [slot()])]);
			}
		}
		const el = container();
		await new Layout().mount(el, {
			children: [h('p', { class: 'page' }, [text('routed page')])],
		});

		expect(el.querySelector('.layout .card .body p.page').textContent).toBe('routed page');
		expect(el.querySelector('slot')).toBeNull();
	});

	it('substitutes a marker nested deeper inside the call-site markup', async () => {
		class Layout extends PuzzleView {
			render() {
				return h('div', {}, [comp(Card, {}, [h('div', { class: 'wrap' }, [slot()])])]);
			}
		}
		const el = container();
		await new Layout().mount(el, { children: [h('em', {}, [text('deep')])] });

		expect(el.querySelector('.card .body .wrap em').textContent).toBe('deep');
		expect(el.querySelector('slot')).toBeNull();
	});

	it('forwards through two nested component invocations', async () => {
		class Layout extends PuzzleView {
			render() {
				return h('div', {}, [comp(Card, {}, [comp(Panel, {}, [slot()])])]);
			}
		}
		const el = container();
		await new Layout().mount(el, { children: [h('b', {}, [text('inner')])] });

		expect(el.querySelector('.card .body .panel b').textContent).toBe('inner');
		expect(el.querySelector('slot')).toBeNull();
	});

	it('adopts a pinned (preloaded) instance forwarded through a component — the router path', async () => {
		// The router hands the layout its routed view as a component vnode with a
		// pre-built `instance` whose data() already resolved; forwarding must carry
		// that pin into the wrapper's slot content and adopt it at mount.
		let created = 0;
		class Page extends PuzzleView {
			created() {
				created++;
			}
			render() {
				return h('article', { class: 'page' }, [text('pinned')]);
			}
		}
		class Layout extends PuzzleView {
			render() {
				return h('div', {}, [comp(Card, {}, [slot()])]);
			}
		}
		const pinned = new Page({});
		await pinned.preload({});
		expect(created).toBe(1);

		const routedVnode = comp(Page);
		routedVnode.instance = pinned;

		const el = container();
		await new Layout().mount(el, { children: [routedVnode] });

		expect(el.querySelector('.card .body article.page').textContent).toBe('pinned');
		expect(created).toBe(1); // adopted, not re-instantiated
		expect(pinned.element).toBe(el.querySelector('article.page'));
	});

	it('swaps forwarded content on a slot-only parent update without remounting the wrapper', async () => {
		class Layout extends PuzzleView {
			render() {
				return h('div', {}, [comp(Card, {}, [slot()])]);
			}
		}
		const el = container();
		const layout = await new Layout().mount(el, {
			children: [h('p', { class: 'a' }, [text('first')])],
		});
		const cardEl = el.querySelector('.card');
		expect(el.querySelector('.card .body p.a').textContent).toBe('first');

		layout.applyParentUpdate({ children: [h('p', { class: 'b' }, [text('second')])] });

		expect(el.querySelector('.card')).toBe(cardEl); // wrapper patched, not remounted
		expect(el.querySelector('.card .body p.a')).toBeNull();
		expect(el.querySelector('.card .body p.b').textContent).toBe('second');
	});

	it('keeps forwarded DOM stable across an unrelated host re-render', async () => {
		class Layout extends PuzzleView {
			created() {
				this.setData({ mode: 'x' });
			}
			data() {
				return { mode: this.getData().mode };
			}
			render() {
				return h('div', { class: this.getData().mode }, [comp(Card, {}, [slot()])]);
			}
		}
		const el = container();
		const layout = await new Layout().mount(el, {
			children: [h('p', { class: 'page' }, [text('stable')])],
		});
		const pageEl = el.querySelector('p.page');

		layout.setData('mode', 'y');
		layout.flushUpdates();

		expect(el.querySelector('div.y')).not.toBeNull();
		expect(el.querySelector('p.page')).toBe(pageEl); // patched in place
	});

	it('renders nothing at the marker when no slot content is supplied', async () => {
		class Layout extends PuzzleView {
			render() {
				return h('div', {}, [comp(Card, {}, [slot()])]);
			}
		}
		const el = container();
		await new Layout().mount(el);

		expect(el.querySelector('.card .body').children.length).toBe(0);
		expect(el.querySelector('slot')).toBeNull();
	});

	it('fast path: a component invocation with marker-free children is returned untouched', () => {
		const tree = h('div', {}, [comp(Card, {}, [h('p', {}, [text('plain')])])]);
		expect(expandSlots(tree, [h('span')])).toBe(tree);
	});
});

describe('default-slot forwarding — router end-to-end (D71)', () => {
	// The original bug scenario: a routed layout wraps its <Slot/> in a global
	// wrapper component. Pre-D71 this mounted a literal <slot> element and the
	// routed view never appeared.
	let routers = [];
	afterEach(() => {
		routers.forEach((r) => r.stop());
		routers = [];
	});

	const boot = async (routes) => {
		const el = container();
		const router = new Router(routes, { mode: 'memory' });
		routers.push(router);
		await router.start(el, { store: null, router: null, formatters: null });
		return { router, el };
	};

	class WrappingLayout extends PuzzleView {
		render() {
			return h('puzzle-view', { class: 'layout' }, [comp(Card, {}, [slot()])]);
		}
	}
	class HomeView extends PuzzleView {
		render() {
			return h('puzzle-view', { class: 'home' }, [text('HOME')]);
		}
	}
	class AboutView extends PuzzleView {
		render() {
			return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
		}
	}

	it('mounts the routed view inside the layout-wrapping component and swaps it on navigation', async () => {
		const { router, el } = await boot([
			{ path: '/', name: 'home', view: HomeView, layout: WrappingLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: WrappingLayout },
		]);

		expect(el.querySelector('.layout .card .body .home')).not.toBeNull();
		expect(el.querySelector('slot')).toBeNull();

		await router.push('/about');
		expect(el.querySelector('.layout .card .body .about')).not.toBeNull();
		expect(el.querySelector('.layout .card .body .home')).toBeNull();
		expect(el.querySelector('slot')).toBeNull();
	});
});

describe('default-slot forwarding — SSG serializer (D71)', () => {
	it('serializes forwarded content inside the wrapper (shared expandSlots path)', async () => {
		class Layout extends PuzzleView {
			render() {
				return h('div', { class: 'layout' }, [comp(Card, {}, [slot()])]);
			}
		}
		const html = await serialize(
			comp(Layout, {}, [h('p', { class: 'page' }, [text('static page')])])
		);
		expect(html).toBe(
			'<div class="layout"><div class="card"><div class="body">' +
				'<p class="page">static page</p></div></div></div>'
		);
		expect(html).not.toContain('<slot');
	});
});

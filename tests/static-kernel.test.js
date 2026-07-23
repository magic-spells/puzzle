// @vitest-environment jsdom
//
// Static output kernel (D81) — client-runtime/static/index.js `mountStatic()`.
// The parity net: prerender a fixture route in static mode, drop the prerendered
// markup + data island into a jsdom document exactly as the shell surgery would,
// then mountStatic() and assert (1) the mounted innerHTML equals the prerendered
// markup (flash-free replace-on-commit), (2) a click handler fires and patches the
// DOM, and (3) the store is rehydrated so data() sees the build-time records with no
// network. Also: the router stub throws, and hydration is skipped when the island is
// absent/empty.
import { describe, it, expect, afterEach } from 'vitest';
import { prerender } from '../client-runtime/ssg/index.js';
import { mountStatic } from '../client-runtime/static/index.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));
// setData re-renders flush on the next animation frame (PuzzleView #scheduleRender).
const frame = () =>
	new Promise((r) =>
		typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)
	);

function stamp(Class, module) {
	Class.__pzlModule = module;
	return Class;
}

class Note extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		body: Puzzle.string(),
	};
}

// A view whose data() reads the store (so hydration is observable) and whose render
// carries a click handler + local setData (so client interactivity is observable).
class Counter extends PuzzleView {
	created() {
		this.setData({ clicks: 0 });
	}
	data() {
		const notes = this.ctx.store.findMany('note');
		return { notes };
	}
	render() {
		const d = this.getData();
		return h('div', { class: 'counter' }, [
			h('ul', {}, d.notes.map((n) => h('li', { key: n.id }, [text(n.body)]))),
			h('button', { '@click': () => this.setData({ clicks: d.clicks + 1 }) }, [
				text(`clicks: ${d.clicks}`),
			]),
		]);
	}
}
stamp(Counter, 'app/views/Counter.pzl');

class Layout extends PuzzleView {
	render() {
		return h('div', { class: 'layout' }, [slot()]);
	}
}
stamp(Layout, 'app/layouts/Default.pzl');

/** Seed the store at build time via beforeMount so the snapshot carries records. */
const config = () => ({
	target: '#app',
	models: { note: Note },
	routes: [{ path: '/', name: 'home', view: Counter, layout: Layout, meta: { title: 'Home' } }],
	beforeMount({ store }) {
		store.createRecord('note', { id: 'a', body: 'alpha' });
		store.createRecord('note', { id: 'b', body: 'beta' });
	},
});

/**
 * Build a jsdom document the way the static shell surgery leaves it for one page:
 * the target holds the prerendered markup, and the inline JSON data island carries
 * the page's store snapshot.
 */
function seedDocument({ content, data }) {
	document.body.innerHTML =
		`<div id="app">${content}</div>` +
		`<script type="application/json" data-puzzle-static-data>${JSON.stringify(data)}</script>`;
	return document.querySelector('#app');
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('static kernel — mountStatic (D81)', () => {
	it('mounts to markup identical to the prerendered output (parity)', async () => {
		const { pages } = await prerender(config(), { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.innerHTML;

		await mountStatic({
			target: '#app',
			views: [Counter],
			layout: Layout,
			route: page.route,
			models: { note: Note },
		});
		await tick();

		// The client re-render reproduces the prerendered markup byte-for-byte.
		expect(el.innerHTML).toBe(prerendered);
		// One rendered tree, no duplication of the layout/content.
		expect(el.querySelectorAll('.layout').length).toBe(1);
		expect(el.querySelectorAll('.counter li').length).toBe(2);
		expect(el.textContent).toContain('alpha');
		expect(el.textContent).toContain('beta');
	});

	it('rehydrates the store so data() sees the build-time records with no network', async () => {
		const { pages } = await prerender(config(), { mode: 'static' });
		const page = pages[0];
		seedDocument({ content: page.html, data: page.data });

		await mountStatic({
			target: '#app',
			views: [Counter],
			layout: Layout,
			route: page.route,
			models: { note: Note },
		});
		await tick();

		// The <li>s are driven by data()'s store query, which only has records because
		// _hydrateAll ran from the island.
		expect(document.querySelectorAll('.counter li').length).toBe(2);
	});

	it('runs client interactivity: a click handler fires and patches the DOM', async () => {
		const { pages } = await prerender(config(), { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });

		await mountStatic({
			target: '#app',
			views: [Counter],
			layout: Layout,
			route: page.route,
			models: { note: Note },
		});
		await tick();

		const button = el.querySelector('button');
		expect(button.textContent).toBe('clicks: 0');
		button.click();
		await frame(); // the setData re-render flushes on the next animation frame
		expect(el.querySelector('button').textContent).toBe('clicks: 1');
	});

	it('does not animate the initial paint (skipEnter on every instance)', async () => {
		let willShow = 0;
		class NoAnim extends PuzzleView {
			viewWillShow() {
				willShow++;
			}
			render() {
				return h('p', {}, [text('hi')]);
			}
		}
		stamp(NoAnim, 'app/views/NoAnim.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'home', view: NoAnim }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		seedDocument({ content: pages[0].html, data: pages[0].data });
		await mountStatic({ target: '#app', views: [NoAnim], route: pages[0].route });
		await tick();
		expect(willShow).toBe(0);
	});

	it('mounts a prerender:false page into the empty target (same code path)', async () => {
		const cfg = {
			target: '#app',
			models: { note: Note },
			routes: [{ path: '/app', name: 'spa', view: Counter, prerender: false }],
			beforeMount({ store }) {
				store.createRecord('note', { id: 'z', body: 'zulu' });
			},
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		// prerender:false → the target is empty; only the island carries the seed.
		const el = seedDocument({ content: '', data: page.data });

		await mountStatic({
			target: '#app',
			views: [Counter],
			route: page.route,
			models: { note: Note },
		});
		await tick();

		expect(el.querySelectorAll('.counter li').length).toBe(1);
		expect(el.textContent).toContain('zulu');
	});

	it('ctx.router is a stub whose methods throw', async () => {
		let captured = null;
		class RouterProbe extends PuzzleView {
			created() {
				captured = this.ctx.router;
			}
			render() {
				return h('p', {}, [text('x')]);
			}
		}
		stamp(RouterProbe, 'app/views/RouterProbe.pzl');
		const cfg = { target: '#app', routes: [{ path: '/', name: 'home', view: RouterProbe }] };
		const { pages } = await prerender(cfg, { mode: 'static' });
		seedDocument({ content: pages[0].html, data: pages[0].data });
		await mountStatic({ target: '#app', views: [RouterProbe], route: pages[0].route });
		await tick();

		expect(captured).toBeTruthy();
		expect(() => captured.push('/x')).toThrow(/static output has no router — use plain links/);
		expect(() => captured.replace('/x')).toThrow(/no router/);
		expect(() => captured.back()).toThrow(/no router/);
	});

	it('skips hydration silently when the data island is absent or empty', async () => {
		class Plain extends PuzzleView {
			render() {
				return h('p', {}, [text('plain')]);
			}
		}
		stamp(Plain, 'app/views/Plain.pzl');
		// No island at all.
		document.body.innerHTML = '<div id="app"><p>plain</p></div>';
		await expect(
			mountStatic({
				target: '#app',
				views: [Plain],
				route: { path: '/', params: {}, chain: [{ path: '/', name: 'home' }] },
			})
		).resolves.toBeUndefined();
		expect(document.querySelector('#app').textContent).toBe('plain');

		// Empty island body.
		document.body.innerHTML =
			'<div id="app"><p>plain</p></div>' +
			'<script type="application/json" data-puzzle-static-data></script>';
		await expect(
			mountStatic({
				target: '#app',
				views: [Plain],
				route: { path: '/', params: {}, chain: [{ path: '/', name: 'home' }] },
			})
		).resolves.toBeUndefined();
	});

	it('throws when the mount target is missing', async () => {
		document.body.innerHTML = '<div id="other"></div>';
		await expect(
			mountStatic({
				target: '#app',
				views: [Layout],
				route: { path: '/', params: {}, chain: [{ path: '/', name: 'home' }] },
			})
		).rejects.toThrow(/static mount target not found/);
	});
});

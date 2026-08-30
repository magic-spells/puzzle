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
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { prerender } from '../client-runtime/ssg/index.js';
import { mountStatic } from '../client-runtime/static/index.js';
import { adapter, serializeReadState } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG, TEMPLATE_TAG } from '../client-runtime/views/ViewNode.js';
import LocalForm from './fixtures/binding/LocalForm.compiled.js';
import { hashRouter } from '../client-runtime/router/modes.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const scopedMarker = (name, args) => new ViewNode(SLOT_TAG, { name, args });
const scopedTemplate = (fits, params, fn) => new ViewNode(TEMPLATE_TAG, { fits, params, fn });
const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
// setData re-renders flush on the next animation frame (PuzzleView #scheduleRender).
const frame = () =>
	new Promise((r) =>
		typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)
	);
// A bind write is setData + refresh(): the re-render lands on an animation frame
// after data() re-runs, so drain both queues a few times.
async function flush() {
	for (let i = 0; i < 5; i++) {
		await frame();
		await tick();
	}
}

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
		`<div id="app"${content ? ' data-puzzle-static' : ''}>${content}</div>` +
		`<script type="application/json" data-puzzle-static-data>${JSON.stringify(data)}</script>`;
	return document.querySelector('#app');
}

let nestedWillShow = 0;

afterEach(() => {
	nestedWillShow = 0;
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('static kernel — mountStatic (D81)', () => {
	it('installs the app adapter capability before constructing its Store', async () => {
		class ApiNote extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
			static adapter = { endpoint: '/notes' };
		}
		class Probe extends PuzzleView {
			async data() {
				const notes = await this.ctx.store.loadMany('note');
				return { installed: typeof this.ctx.store.loadMany === 'function', count: notes.length };
			}
			render() {
				return h('main', {}, [text(`${this.getData().installed}:${this.getData().count}`)]);
			}
		}
		stamp(Probe, 'app/views/Probe.pzl');
		const configured = adapter.defaults({
			loadMany: async () => [{ id: 'n1' }],
		});
		const cfg = {
			target: '#app',
			models: { note: ApiNote },
			adapter: configured,
			routes: [{ path: '/', view: Probe }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		seedDocument({ content: pages[0].html, data: pages[0].data });

		await mountStatic({
			target: '#app',
			views: [Probe],
			route: pages[0].route,
			models: { note: ApiNote },
			adapter: configured,
		});

		expect(document.querySelector('#app').textContent).toBe('true:1');
	});

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

	it('restores the exact prerendered nodes when the root render throws', async () => {
		let failOnClient = false;
		class BadRenderPage extends PuzzleView {
			render() {
				if (failOnClient) throw new Error('static render failed');
				return h('main', { class: 'prerendered-bad-render' }, [text('Still readable')]);
			}
		}
		stamp(BadRenderPage, 'app/views/BadRenderPage.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'bad-render', view: BadRenderPage }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.firstElementChild;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		failOnClient = true;

		await expect(
			mountStatic({ target: '#app', views: [BadRenderPage], route: page.route })
		).resolves.toBeUndefined();

		expect(el.firstElementChild).toBe(prerendered);
		expect(el.textContent).toBe('Still readable');
		expect(el.hasAttribute('data-puzzle-static')).toBe(true);
		expect(error).toHaveBeenCalledWith(
			'[puzzle] component mount failed — the component was destroyed and the prerendered content restored (static pages have no later patch/remount):',
			expect.any(Error)
		);
		error.mockRestore();
	});

	it('restores prerendered nodes and marker when the root mounted() throws', async () => {
		class BadMountedPage extends PuzzleView {
			render() {
				return h('main', { class: 'bad-mounted' }, [text('Still readable')]);
			}
			mounted() {
				throw new Error('static mounted failed');
			}
		}
		stamp(BadMountedPage, 'app/views/BadMountedPage.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'bad-mounted', view: BadMountedPage }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.firstElementChild;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(
			mountStatic({ target: '#app', views: [BadMountedPage], route: page.route })
		).resolves.toBeUndefined();

		expect(el.firstElementChild).toBe(prerendered);
		expect(el.textContent).toBe('Still readable');
		expect(el.hasAttribute('data-puzzle-static')).toBe(true);
		expect(error).toHaveBeenCalledWith(
			'[puzzle] component mount failed — the component was destroyed and the prerendered content restored (static pages have no later patch/remount):',
			expect.any(Error)
		);
		error.mockRestore();
	});

	it('keeps prerendered deep async component content until static takeover commits', async () => {
		let clientGate = null;
		class AsyncLeaf extends PuzzleView {
			async data() {
				if (clientGate) await clientGate.promise;
				return { label: 'ASYNC-CONTENT' };
			}
			render() {
				return h('section', { class: 'async-leaf' }, [text(this.getData().label)]);
			}
		}
		stamp(AsyncLeaf, 'app/components/AsyncLeaf.pzl');
		class NestedShell extends PuzzleView {
			render() {
				return h('div', { class: 'nested-shell' }, [h(AsyncLeaf)]);
			}
		}
		stamp(NestedShell, 'app/components/NestedShell.pzl');
		class NestedPage extends PuzzleView {
			render() {
				return h('main', { class: 'nested-page' }, [h(NestedShell)]);
			}
		}
		stamp(NestedPage, 'app/views/NestedPage.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'nested', view: NestedPage }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.innerHTML;
		clientGate = deferred();

		const mounting = mountStatic({
			target: '#app',
			views: [NestedPage],
			route: page.route,
		});
		await tick(); // a paint opportunity while the nested data() macrotask is pending
		const firstPaint = el.innerHTML;
		clientGate.resolve();
		await mounting;

		expect(firstPaint).toBe(prerendered);
		expect(el.innerHTML).toBe(prerendered);
	});

	it('keeps the nested sync component control byte-identical during static takeover', async () => {
		class SyncLeaf extends PuzzleView {
			data() {
				return { label: 'SYNC-CONTENT' };
			}
			render() {
				return h('section', { class: 'sync-leaf' }, [text(this.getData().label)]);
			}
		}
		stamp(SyncLeaf, 'app/components/SyncLeaf.pzl');
		class SyncPage extends PuzzleView {
			render() {
				return h('main', { class: 'sync-page' }, [h(SyncLeaf)]);
			}
		}
		stamp(SyncPage, 'app/views/SyncPage.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'sync', view: SyncPage }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.innerHTML;

		await mountStatic({ target: '#app', views: [SyncPage], route: page.route });

		expect(el.innerHTML).toBe(prerendered);
		expect(el.querySelector('.sync-leaf').textContent).toBe('SYNC-CONTENT');
	});

	it('mounts scoped-template output once during static takeover with zero dev warnings', async () => {
		class ScopedList extends PuzzleView {
			render() {
				return h('ul', { class: 'takeover-scoped-list' }, [
					h('li', {}, [scopedMarker('row', { item: { label: 'static' } })]),
				]);
			}
		}
		stamp(ScopedList, 'app/components/ScopedList.pzl');
		class ScopedPage extends PuzzleView {
			render() {
				return h('main', {}, [
					h(ScopedList, {}, [
						scopedTemplate('row', ['item'], ({ item }) => [
							h('strong', { class: 'takeover-stamp' }, [text(item.label)]),
						]),
					]),
				]);
			}
		}
		stamp(ScopedPage, 'app/views/ScopedPage.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'scoped', view: ScopedPage }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.innerHTML;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await mountStatic({ target: '#app', views: [ScopedPage], route: page.route });

		expect(el.innerHTML).toBe(prerendered);
		expect(el.querySelector('.takeover-stamp').textContent).toBe('static');
		expect(warn).not.toHaveBeenCalled();
	});

	it('mounts the static page when a nested component preload rejects', async () => {
		let rejectOnClient = false;
		class RejectingLeaf extends PuzzleView {
			async data() {
				await tick();
				if (rejectOnClient) throw new Error('nested static takeover rejected');
				return { label: 'BUILD-CONTENT' };
			}
			render() {
				return h('section', { class: 'rejecting-leaf' }, [text(this.getData().label)]);
			}
		}
		stamp(RejectingLeaf, 'app/components/RejectingLeaf.pzl');
		class RejectingPage extends PuzzleView {
			render() {
				return h('main', { class: 'rejecting-page' }, [h(RejectingLeaf)]);
			}
		}
		stamp(RejectingPage, 'app/views/RejectingPage.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'rejecting', view: RejectingPage }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		rejectOnClient = true;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(
			mountStatic({ target: '#app', views: [RejectingPage], route: page.route })
		).resolves.toBeUndefined();

		expect(error).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		expect(el.querySelector('.rejecting-page')).not.toBe(null);
		expect(el.querySelector('.rejecting-leaf')).toBe(null);
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

	// A NESTED (non-routed) component is not part of the route chain, so it is not
	// in `instances` — mountComponent auto-chains playIn() onto it. Under takeover
	// its markup is already on screen, so it must be skipEnter'd too.
	class EnterLeaf extends PuzzleView {
		animations = { in: { from: { opacity: 0 }, to: { opacity: 1 }, duration: 200 } };
		viewWillShow() {
			nestedWillShow++;
		}
		render() {
			return h('section', { class: 'enter-leaf' }, [text('LEAF')]);
		}
	}
	stamp(EnterLeaf, 'app/components/EnterLeaf.pzl');
	class EnterPage extends PuzzleView {
		render() {
			return h('main', { class: 'enter-page' }, [h(EnterLeaf)]);
		}
	}
	stamp(EnterPage, 'app/views/EnterPage.pzl');
	const enterRoutes = [{ path: '/', name: 'home', view: EnterPage }];

	it('does not animate a NESTED component on the initial paint either', async () => {
		const { pages } = await prerender({ target: '#app', routes: enterRoutes }, { mode: 'static' });
		const el = seedDocument({ content: pages[0].html, data: pages[0].data });

		await mountStatic({ target: '#app', views: [EnterPage], route: pages[0].route });
		await tick();

		expect(el.querySelector('.enter-leaf')).not.toBe(null);
		expect(nestedWillShow).toBe(0);
	});

	it('a prerender:false page still plays its nested component enter', async () => {
		// No `data-puzzle-static` marker ⇒ nothing was prerendered into the target, so
		// the nested enter is an ordinary first paint and must animate as usual.
		const cfg = {
			target: '#app',
			routes: [{ path: '/', name: 'home', view: EnterPage, prerender: false }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const el = seedDocument({ content: '', data: pages[0].data });

		await mountStatic({ target: '#app', views: [EnterPage], route: pages[0].route });
		await tick();

		expect(el.querySelector('.enter-leaf')).not.toBe(null);
		expect(nestedWillShow).toBe(1);
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

	it('ctx.router.url() ignores routerMode — hash config, path-shaped hrefs, byte-equal to the prerender (P2.1)', async () => {
		// A static build never carries the app's routerMode into the page at all (D159:
		// the summary drops it and the generated entry never emits it), so both the
		// prerender stub and the kernel stub encode history-style and the two outputs
		// are byte-identical. Were it honoured, the client re-render would rewrite every
		// href to '#/…' over prerendered '/…' markup — links that go nowhere on a page
		// with no router. mountStatic is called here exactly as the generated entry
		// calls it: no routerMode.
		let captured = null;
		class LinkProbe extends PuzzleView {
			created() {
				captured = this.ctx.router;
			}
			render() {
				const __f = this.ctx.formatters.getAll();
				return h('a', { href: __f.link('/about') }, [text('About')]);
			}
		}
		stamp(LinkProbe, 'app/views/LinkProbe.pzl');
		const cfg = {
			target: '#app',
			routerMode: hashRouter(), // a hash-configured app built to static output
			routes: [{ path: '/', name: 'home', view: LinkProbe }],
		};
		const { pages, warnings } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		expect(page.html).toContain('href="/about"');
		expect(warnings.some((w) => w.includes('ignores routerMode (hash routing)'))).toBe(true);

		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.innerHTML;
		captured = null; // drop the build-time capture; assert the KERNEL's stub
		await mountStatic({
			target: '#app',
			views: [LinkProbe],
			route: page.route,
		});
		await tick();

		// Byte-equality of the two stubs' output for the same route/config.
		expect(el.innerHTML).toBe(prerendered);
		expect(el.querySelector('a').getAttribute('href')).toBe('/about');
		expect(captured.url('/about')).toBe('/about');
		expect(captured.url('/about')).not.toContain('#');
	});

	it('ctx.router.url() still honours routerBase under a hash config (base yes, mode no)', async () => {
		let captured = null;
		class BasedProbe extends PuzzleView {
			created() {
				captured = this.ctx.router;
			}
			render() {
				return h('a', { href: this.ctx.router.url('/about') }, [text('About')]);
			}
		}
		stamp(BasedProbe, 'app/views/BasedProbe.pzl');
		const cfg = {
			target: '#app',
			routerMode: hashRouter(),
			routerBase: '/docs',
			routes: [{ path: '/', name: 'home', view: BasedProbe }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		expect(page.html).toContain('href="/docs/about"');

		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.innerHTML;
		captured = null;
		await mountStatic({
			target: '#app',
			views: [BasedProbe],
			route: page.route,
			routerBase: '/docs',
		});
		await tick();

		expect(el.innerHTML).toBe(prerendered);
		expect(captured.url('/about')).toBe('/docs/about');
	});

	it('the kernel-mounted route snapshot carries the D83 pathname/query/hash parts', async () => {
		// The serialized summary route ({ path, params, chain }) never carries the
		// parsed parts — the shared assembleChain derives them when the kernel zips
		// the view classes back on, so this.route matches the browser Router's shape.
		let seen = null;
		class SnapProbe extends PuzzleView {
			data() {
				seen = this.route;
				return {};
			}
			render() {
				return h('p', {}, [text('snap')]);
			}
		}
		stamp(SnapProbe, 'app/views/SnapProbe.pzl');
		const cfg = {
			target: '#app',
			routes: [{ path: '/guide', name: 'guide', view: SnapProbe }],
		};
		const { pages } = await prerender(cfg, { mode: 'static' });
		seedDocument({ content: pages[0].html, data: pages[0].data });
		seen = null; // drop the build-time capture; assert the KERNEL's snapshot
		await mountStatic({ target: '#app', views: [SnapProbe], route: pages[0].route });
		await tick();

		expect(seen.path).toBe('/guide');
		expect(seen.pathname).toBe('/guide');
		expect(seen.hash).toBe('');
		expect(Object.keys(seen.query)).toEqual([]);
		expect(Object.getPrototypeOf(seen.query)).toBeNull();
		expect(Object.isFrozen(seen.query)).toBe(true);
		expect(Object.isFrozen(seen)).toBe(true);
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

	// Implicit two-way binding (D147) is a LISTENER, so it cannot be prerendered:
	// the synthesized `@input:bind` attr is stripped from the serialized HTML
	// (ssg/serialize.js serializeAttrs) and only exists once something mounts. A
	// static page has no router, so mountStatic is that something — the whole
	// interactivity budget of `output: 'static'`. The view is the Go compiler's
	// ACTUAL output (tests/fixtures/binding/LocalForm.compiled.js).
	it('attaches the synthesized bind listener over prerendered markup (D147)', async () => {
		const cfg = { target: '#app', routes: [{ path: '/', name: 'form', view: LocalForm }] };
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];

		// Build-time HTML: controlled values present, directive absent.
		expect(page.html).toContain('<input class="draft" value="">');
		expect(page.html).not.toContain('bind');

		const el = seedDocument({ content: page.html, data: page.data });
		await mountStatic({ target: '#app', views: [LocalForm], route: page.route });
		await tick();

		// Mounting moves controlled form state from HTML initial-state markup to
		// live DOM PROPERTIES (the documented serializer ⟷ ViewManager difference,
		// see ssg-equivalence.test.js), so parity for a form control is its
		// property values, not innerHTML bytes. Either way, no directive markup.
		expect(el.innerHTML).not.toContain('bind');
		expect(el.querySelectorAll('input.draft').length).toBe(1); // no duplication
		expect(el.querySelector('input.draft').value).toBe('');
		expect(el.querySelector('select.sort').value).toBe('all');
		expect(el.querySelector('p.matches').textContent).toBe('4');

		const input = el.querySelector('input.draft');
		input.value = 'al';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await flush();

		// The bind wrote local state AND refresh() re-ran data(): only 'alpha'
		// matches. A dead listener would have left this at 4.
		expect(el.querySelector('p.matches').textContent).toBe('1');
		expect(el.querySelector('input.draft').value).toBe('al');
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

// ---- read-state transfer (D161) ---------------------------------------------
//
// The build's read-state island is the other half of flash-free static parity:
// without it the browser session refetches every collection the build already
// completed and re-404s every identity it already settled — over an API the page
// may not even be able to reach. Records hydrate FIRST, so a stale absence whose
// record is present is dropped rather than trusted.

class ApiNote extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		body: Puzzle.string(),
	};
	static adapter = { endpoint: '/notes' };
}

let lastStore = null;

class Feed extends PuzzleView {
	created() {
		lastStore = this.ctx.store;
	}
	data() {
		const store = this.ctx.store;
		return { notes: store.findMany('note'), gone: store.findOne('note', 'gone') };
	}
	render() {
		const d = this.getData();
		return h('ul', {}, [
			...d.notes.map((n) => h('li', { key: n.id }, [text(n.body)])),
			h('em', {}, [text(d.gone === null ? 'missing' : 'found')]),
		]);
	}
}
stamp(Feed, 'app/views/Feed.pzl');

/** The shell surgery's output for an adapter page: record island + read island. */
function seedReadDocument({ data, readState }) {
	document.body.innerHTML =
		'<div id="app" data-puzzle-static></div>' +
		`<script type="application/json" data-puzzle-static-data>${JSON.stringify(data)}</script>` +
		(readState
			? `<script type="application/json" data-puzzle-static-read>${readState}</script>`
			: '');
}

const mountFeed = () =>
	mountStatic({
		target: '#app',
		views: [Feed],
		route: { path: '/', params: {}, chain: [{ path: '/', name: 'home' }] },
		models: { note: ApiNote },
		apiURL: 'https://api.test',
		adapter,
	});

describe('static kernel — read-state island (D161)', () => {
	let fetchMock;

	beforeEach(() => {
		lastStore = null;
		fetchMock = vi.fn(async (url) => {
			const missing = String(url).endsWith('/notes/gone');
			const body = missing ? { error: 'nope' } : [];
			return {
				ok: !missing,
				status: missing ? 404 : 200,
				statusText: missing ? 'Not Found' : 'OK',
				text: async () => JSON.stringify(body),
				json: async () => body,
			};
		});
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('adopts the envelope so the browser session repeats none of the build reads', async () => {
		seedReadDocument({
			data: { note: [{ id: 'a', body: 'alpha' }] },
			readState: JSON.stringify({ v: 1, complete: ['note'], absent: ['note gone'] }),
		});

		await mountFeed();

		expect(document.querySelector('#app').innerHTML).toContain('alpha');
		expect(document.querySelector('#app').innerHTML).toContain('missing');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(serializeReadState(lastStore)).toEqual({
			v: 1,
			complete: ['note'],
			absent: ['note gone'],
		});
	});

	it('faults normally with no envelope — an adapter page without one behaves as before', async () => {
		seedReadDocument({ data: { note: [{ id: 'a', body: 'alpha' }] }, readState: null });

		await mountFeed();

		expect(fetchMock).toHaveBeenCalled();
	});

	it('ignores an empty or foreign-version envelope', async () => {
		seedReadDocument({
			data: { note: [{ id: 'a', body: 'alpha' }] },
			readState: JSON.stringify({ v: 2, complete: ['note'], absent: ['note gone'] }),
		});

		await mountFeed();

		// Ignored wholesale: the session loaded the collection and re-asked for the
		// identity the build already settled.
		const asked = fetchMock.mock.calls.map(([url]) => String(url));
		expect(asked).toContain('https://api.test/notes');
		expect(asked).toContain('https://api.test/notes/gone');
	});

	it('drops an absence whose record rode in the island — records hydrate first', async () => {
		seedReadDocument({
			data: { note: [{ id: 'a', body: 'alpha' }] },
			readState: JSON.stringify({ v: 1, complete: ['note'], absent: ['note a', 'note gone'] }),
		});

		await mountFeed();

		expect(serializeReadState(lastStore).absent).toEqual(['note gone']);
	});

	it('ignores a corrupt envelope without losing the records', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		seedReadDocument({ data: { note: [{ id: 'a', body: 'alpha' }] }, readState: '{ nope' });

		await mountFeed();

		expect(document.querySelector('#app').innerHTML).toContain('alpha');
		expect(err).toHaveBeenCalledWith(
			expect.stringContaining('static read-state island is corrupt'),
			expect.anything()
		);
		err.mockRestore();
	});
});

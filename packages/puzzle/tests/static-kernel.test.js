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
import { prerender, injectStaticShell } from '../client-runtime/ssg/index.js';
import { mountStatic } from '../client-runtime/static/index.js';
import { assembleChain } from '../client-runtime/ssg/assemble.js';
import { Store } from '../client-runtime/datastore/store.js';
import { adapter, serializeReadState } from '../client-runtime/datastore/adapter.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG, SNIPPET_TAG } from '../client-runtime/views/ViewNode.js';
import LocalForm from './fixtures/binding/LocalForm.compiled.js';
import { hashRouter } from '../client-runtime/router/modes.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const scopedMarker = (name, args) => new ViewNode(SLOT_TAG, { name, args });
const snippet = (fits, params, fn) => new ViewNode(SNIPPET_TAG, { fits, params, fn });
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

	it('mounts transitively forwarded snippet output once during static takeover with zero dev warnings', async () => {
		class ScopedList extends PuzzleView {
			render() {
				return h('ul', { class: 'takeover-scoped-list' }, [
					h('li', {}, [scopedMarker('row', { item: { label: 'static' } })]),
				]);
			}
		}
		stamp(ScopedList, 'app/components/ScopedList.pzl');
		class InnerWrapper extends PuzzleView {
			render() {
				return h('section', { class: 'takeover-inner-wrapper' }, [
					h(ScopedList, {}, [slot()]),
				]);
			}
		}
		stamp(InnerWrapper, 'app/components/InnerWrapper.pzl');
		class OuterWrapper extends PuzzleView {
			render() {
				return h('div', { class: 'takeover-outer-wrapper' }, [
					h(InnerWrapper, {}, [slot()]),
				]);
			}
		}
		stamp(OuterWrapper, 'app/components/OuterWrapper.pzl');
		class ScopedPage extends PuzzleView {
			render() {
				return h('main', {}, [
					h(OuterWrapper, {}, [
						snippet('row', ['item'], ({ item }) => [
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
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { pages } = await prerender(cfg, { mode: 'static' });
		const page = pages[0];
		const el = seedDocument({ content: page.html, data: page.data });
		const prerendered = el.innerHTML;

		await mountStatic({ target: '#app', views: [ScopedPage], route: page.route });

		expect(el.innerHTML).toBe(prerendered);
		expect(el.querySelector('.takeover-stamp').textContent).toBe('static');
		expect(el.querySelector('.takeover-inner-wrapper')).not.toBeNull();
		expect(el.querySelector('.takeover-outer-wrapper')).not.toBeNull();
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

// ---- assembleChain failure cleanup -------------------------------------------
//
// A preload that rejects part-way destroys every instance already constructed,
// so a failed assembly (a static locale switch retried on a flaky network) never
// leaves live store subscriptions behind — the router's partial-chain posture.

describe('assembleChain — a failed preload destroys the partial chain', () => {
	const build = (failAt) => {
		const log = [];
		const make = (name) => {
			class Level extends PuzzleView {
				data() {
					this.ctx.store.findMany('note');
					if (name === failAt) throw new Error(`fail ${name}`);
					return {};
				}
				destroyed() {
					log.push(name);
				}
			}
			return Level;
		};
		const chain = [{ path: '/', view: make('root') }, { path: 'leaf', view: make('leaf') }];
		const entry = { fullPath: '/leaf', chain, layout: make('layout') };
		const store = new Store({ note: Note });
		return { entry, ctx: { store, formatters: {} }, store, log };
	};

	for (const [failAt, destroyed] of [
		['root', ['root']],
		['leaf', ['root', 'leaf']],
		['layout', ['root', 'leaf', 'layout']],
	]) {
		it(`at the ${failAt}: destroys every constructed instance and rejects`, async () => {
			const { entry, ctx, store, log } = build(failAt);
			await expect(assembleChain(entry, ctx)).rejects.toThrow(`fail ${failAt}`);
			expect(log).toEqual(destroyed);
			expect(store.keysBySubscriber.size).toBe(0);
		});
	}

	it('a successful assembly destroys nothing', async () => {
		const { entry, ctx, store, log } = build(null);
		const { instances } = await assembleChain(entry, ctx);
		expect(instances).toHaveLength(3);
		expect(log).toEqual([]);
		expect(store.keysBySubscriber.size).toBe(3);
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
			loaded: ['note'],
			absent: ['note gone'],
		});
	});

	it.each([
		{ label: 'one record', records: [{ id: 'p1', title: 'build-time post' }] },
		{ label: 'an empty collection', records: [] },
	])('transfers authored loadMany state for $label without refetching at mount', async ({ records }) => {
		const loadMany = vi
			.fn()
			.mockResolvedValueOnce(records)
			.mockRejectedValue(new Error('no runtime endpoint'));
		class Post extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
			static adapter = { loadMany };
		}
		class Posts extends PuzzleView {
			created() {
				lastStore = this.ctx.store;
			}
			data() {
				return { posts: this.ctx.store.findMany('post') };
			}
			render() {
				return h('ul', {},
					this.getData().posts.map((post) => h('li', { key: post.id }, [text(post.title)]))
				);
			}
		}
		stamp(Posts, 'app/views/Posts.pzl');
		const { pages } = await prerender(
			{
				target: '#app',
				models: { post: Post },
				adapter,
				routes: [{ path: '/', view: Posts }],
			},
			{ mode: 'static' }
		);
		const page = pages[0];
		const readState = { v: 1, complete: [], loaded: ['post'], absent: [] };
		expect(page.readState).toEqual(readState);
		expect(loadMany).toHaveBeenCalledTimes(1);
		document.body.innerHTML = injectStaticShell('<div id="app"></div>', {
			targetId: 'app',
			content: page.html,
			slug: 'index',
			data: page.data,
			readState: page.readState,
		});
		const island = document.querySelector('[data-puzzle-static-read]');
		expect(island).not.toBeNull();
		expect(JSON.parse(island.textContent)).toEqual(readState);

		await mountStatic({
			target: '#app',
			views: [Posts],
			route: page.route,
			models: { post: Post },
			adapter,
		});

		expect(document.querySelector('#app').innerHTML).toBe(page.html);
		expect(lastStore.findMany('post').map((post) => post.toJSON())).toEqual(records);
		expect(serializeReadState(lastStore)).toEqual(readState);
		expect(loadMany).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
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

// D179 — a page a `staticPaths` route generated shares its route's per-page
// module, so the page carries its own path + params in a
// `data-puzzle-static-route` island; the generated entry merges it into the
// route JSON (prerender_pages.go), and the kernel hands the view exactly the
// params and route the prerender used — never parsing `location`.
describe('static kernel — a page generated by staticPaths (D179)', () => {
	class ApiPost extends PuzzleModel {
		static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
		static adapter = { endpoint: '/posts' };
	}
	const seen = [];
	class PostView extends PuzzleView {
		data() {
			seen.push({ params: { ...this.params }, path: this.route.path, current: this.ctx.router.current.path });
			const store = this.ctx.store;
			return { post: store.findOne('post', this.params.slug), gone: store.findOne('post', 'gone') };
		}
		render() {
			const d = this.getData();
			return h('article', {}, [
				h('h1', {}, [text(d.post ? d.post.title : 'none')]),
				h('em', {}, [text(d.gone === null ? 'missing' : 'found')]),
			]);
		}
	}
	stamp(PostView, 'app/views/Post.pzl');

	it('mounts with the island`s params and route, and the read state the build settled', async () => {
		const fetchMock = vi.fn(async (url) =>
			String(url).endsWith('/posts/a%20b')
				? Response.json({ id: 'a b', title: 'Cookies' })
				: new Response('{}', { status: 404, statusText: 'Not Found' })
		);
		vi.stubGlobal('fetch', fetchMock);
		try {
			const appConfig = { models: { post: ApiPost }, apiURL: 'https://api.test', adapter };
			const { pages } = await prerender(
				{
					target: '#app',
					...appConfig,
					routes: [{ path: '/blog/:slug', view: PostView, staticPaths: [{ slug: 'a b' }, { slug: 'z' }] }],
				},
				{ mode: 'static' }
			);
			const page = pages[0];
			expect(page.path).toBe('/blog/a%20b');
			expect(page.html).toBe('<article><h1>Cookies</h1><em>missing</em></article>');
			expect(page.readState.absent).toHaveLength(1);
			expect(pages[1].route).toEqual(page.route);

			document.body.innerHTML = injectStaticShell('<div id="app"></div>', {
				targetId: 'app',
				content: page.html,
				slug: 'blog--_slug',
				data: page.data,
				readState: page.readState,
				route: { path: page.path, params: page.params },
			});
			seen.length = 0;
			fetchMock.mockClear();
			// What the generated entry does: the shared route JSON, with the page's own
			// path and params merged in from its island.
			const island = document.querySelector('script[data-puzzle-static-route]');
			const route = Object.assign(structuredClone(page.route), JSON.parse(island.textContent));
			await mountStatic({ target: '#app', views: [PostView], route, ...appConfig });

			expect(seen).toEqual([{ params: { slug: 'a b' }, path: '/blog/a%20b', current: '/blog/a%20b' }]);
			expect(document.querySelector('#app').innerHTML).toBe(page.html);
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('hands a fixed route`s view empty params, as before', async () => {
		seen.length = 0;
		document.body.innerHTML = '<div id="app"></div>';
		await mountStatic({
			target: '#app',
			views: [PostView],
			route: { path: '/about', params: {}, chain: [{ path: '/about' }] },
			models: { post: ApiPost },
		});
		expect(seen).toEqual([{ params: {}, path: '/about', current: '/about' }]);
	});
});

// D177 — the static kernel under `i18n.routing: 'prefix'`. The URL decides the
// page's locale (prefix, then the page's own table island, ahead of the stored
// choice and navigator.languages), links render under that locale's prefix,
// setLocale loads the same page under the other prefix, and the locale files
// stay on the BARE routerBase.
describe('static kernel — locale prefix routing (D177)', () => {
	const EN = { title: 'Welcome' };
	const ES = { title: 'Bienvenido' };
	const ROUTED = {
		defaultLocale: 'en',
		locales: { en: 'locales/en.AAAA.json', es: 'locales/es.BBBB.json', 'pt-BR': 'locales/pt-BR.CCCC.json' },
		routing: 'prefix',
	};
	const startURL = location.href;

	function memoryStorage(seed = {}) {
		const map = new Map(Object.entries(seed));
		return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
	}

	beforeEach(() => {
		document.body.innerHTML = '<div id="app"></div>';
		// Everything the URL must beat: a stored English choice and an English browser.
		vi.stubGlobal('localStorage', memoryStorage({ __puzzleLocale: 'en' }));
		vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
	});
	afterEach(() => {
		history.replaceState(null, '', startURL);
		document.documentElement.removeAttribute('lang');
		vi.unstubAllGlobals();
	});

	let seen;
	class Page extends PuzzleView {
		created() {
			seen = this.ctx;
		}
		render() {
			const link = this.ctx.formatters.getAll().link;
			return h('main', {}, [
				h('h1', {}, [text(this.ctx.i18n.t('title'))]),
				h('a', { class: 'home', href: link('/') }, [text('home')]),
				h('a', { class: 'about', href: link('/about') }, [text('about')]),
				h('a', { class: 'en', href: link('/about', { locale: 'en' }) }, [text('en')]),
				h('a', { class: 'pdf', href: link('/cv.pdf', { locale: false }) }, [text('cv')]),
			]);
		}
	}

	async function mountAt(url, { routerBase, tables = { en: EN, es: ES }, manifest = ROUTED, ...seam } = {}) {
		history.replaceState(null, '', url);
		seen = null;
		await mountStatic({
			target: '#app',
			views: [Page],
			route: { path: '/about', params: {}, chain: [{ path: '/about' }] },
			routerBase,
			__i18n: { manifest, tables, ...seam },
		});
		const href = (cls) => document.querySelector(`a.${cls}`).getAttribute('href');
		return { i18n: seen.i18n, href };
	}

	it('the URL prefix decides the locale, ahead of the stored choice and the browser', async () => {
		const { i18n, href } = await mountAt('/es/about');
		expect(i18n.locale).toBe('es');
		expect(document.querySelector('h1').textContent).toBe('Bienvenido');
		expect(href('home')).toBe('/es/');
		expect(href('about')).toBe('/es/about');
		expect(href('en')).toBe('/about');
		expect(href('pdf')).toBe('/cv.pdf');
	});

	it("an unprefixed page is the page's island locale (the default), whatever was stored", async () => {
		vi.stubGlobal('localStorage', memoryStorage({ __puzzleLocale: 'es' }));
		vi.stubGlobal('navigator', { languages: ['es'], language: 'es' });
		document.body.innerHTML =
			'<div id="app"></div>' +
			`<script type="application/json" data-puzzle-locale="en">${JSON.stringify(EN)}</script>`;
		const { i18n, href } = await mountAt('/about');
		expect(i18n.locale).toBe('en');
		expect(href('about')).toBe('/about');
	});

	it('an unprefixed page with no island is the default locale, whatever was stored', async () => {
		vi.stubGlobal('localStorage', memoryStorage({ __puzzleLocale: 'es' }));
		vi.stubGlobal('navigator', { languages: ['es'], language: 'es' });
		const { i18n, href } = await mountAt('/about');
		expect(i18n.locale).toBe('en');
		expect(document.querySelector('h1').textContent).toBe('Welcome');
		expect(href('about')).toBe('/about');
	});

	it('falls back to the island tag when the URL carries no prefix', async () => {
		document.body.innerHTML =
			'<div id="app"></div>' +
			`<script type="application/json" data-puzzle-locale="es">${JSON.stringify(ES)}</script>`;
		const { i18n } = await mountAt('/about', { tables: {} });
		expect(i18n.locale).toBe('es');
		expect(document.querySelector('h1').textContent).toBe('Bienvenido');
	});

	it('i18n.locales is this page under every prefix, query and fragment kept', async () => {
		const { i18n } = await mountAt('/docs/es/about?tab=2#faq', { routerBase: '/docs' });
		expect(i18n.locales).toEqual([
			{ locale: 'en', label: 'English', href: '/docs/about?tab=2#faq', active: false },
			{ locale: 'es', label: 'Español', href: '/docs/es/about?tab=2#faq', active: true },
			{ locale: 'pt-BR', label: 'Português (Brasil)', href: '/docs/pt-BR/about?tab=2#faq', active: false },
		]);
	});

	it('setLocale stores the choice and loads the same page under the other prefix — no fetch, no remount', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const navigate = vi.fn();
		const { i18n } = await mountAt('/docs/es/about/?tab=2#faq', { routerBase: '/docs', navigate });
		const main = document.querySelector('main');

		await i18n.setLocale('en');
		expect(navigate).toHaveBeenCalledWith('/docs/about/?tab=2#faq');
		expect(localStorage.getItem('__puzzleLocale')).toBe('en');
		expect(fetch).not.toHaveBeenCalled();
		expect(document.querySelector('main')).toBe(main);
		expect(i18n.locale).toBe('es');

		await i18n.setLocale('pt-BR');
		expect(navigate).toHaveBeenLastCalledWith('/docs/pt-BR/about/?tab=2#faq');
		navigate.mockClear();
		await i18n.setLocale('es');
		expect(navigate).not.toHaveBeenCalled();
	});

	it('a Spanish page fetches its locale file from the BARE routerBase, never under /es', async () => {
		const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ES }));
		vi.stubGlobal('fetch', fetch);
		const { i18n, href } = await mountAt('/docs/es/about', { routerBase: '/docs', tables: {} });
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0][0]).toBe('/docs/locales/es.BBBB.json');
		expect(i18n.locale).toBe('es');
		expect(href('about')).toBe('/docs/es/about');
		expect(href('pdf')).toBe('/docs/cv.pdf');
	});

	it('without routing in the manifest the URL decides nothing and links carry no prefix', async () => {
		const { routing, ...plain } = ROUTED;
		void routing;
		const { i18n, href } = await mountAt('/es/about', { manifest: plain });
		// The stored English choice wins, exactly as before D177.
		expect(i18n.locale).toBe('en');
		expect(href('about')).toBe('/about');
		expect(href('en')).toBe('/about');
		expect(i18n.locales.map((entry) => entry.href)).toEqual(['/es/about', '/es/about', '/es/about']);
	});
});

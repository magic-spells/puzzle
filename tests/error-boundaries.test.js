// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../client-runtime/testing/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
	};
}

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, attrs = {}, children = []) => new ViewNode(Class, attrs, children);

const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
		await Promise.resolve();
	}
};

const apps = [];
const views = [];

afterEach(() => {
	for (const app of apps.splice(0)) app.destroy();
	for (const view of views.splice(0)) view.destroy();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

class Home extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('home')]);
	}
}

describe('PuzzleApp onError', () => {
	it('reports a component mount failure with the stable mount info shape', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const reports = [];
		let failedView;

		class Broken extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				failedView = this;
			}
			data() {
				throw new Error('mount boom');
			}
			render() {
				return h('span', { class: 'broken' });
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'host' }, [comp(Broken)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);
		await flush();

		expect(reports).toHaveLength(1);
		expect(reports[0].error.message).toBe('mount boom');
		expect(reports[0].info).toEqual({
			phase: 'mount',
			view: failedView,
			route: null,
		});
		expect(Object.isFrozen(reports[0].info)).toBe(true);
	});

	it('reports a router-owned mount failure without destroying the committed view', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const reports = [];
		let routedView;

		class BrokenMount extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				routedView = this;
			}
			mounted() {
				throw new Error('routed mount boom');
			}
			render() {
				return h('puzzle-view', { class: 'routed' }, [text('routed')]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: BrokenMount }],
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);
		await flush();

		expect(reports).toHaveLength(1);
		expect(reports[0].error.message).toBe('routed mount boom');
		expect(reports[0].info).toEqual({
			phase: 'mount',
			view: routedView,
			route: expect.objectContaining({ path: '/' }),
		});
		expect(routedView.isDestroyed).toBe(false);
		expect(app.find('.routed')).not.toBeNull();
	});

	it('reports a background refresh failure with the failing view', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const reports = [];
		let host;
		let child;

		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				child = this;
			}
			data(_params, props) {
				if (props.fail) throw new Error('refresh boom');
				return {};
			}
			render() {
				return h('span', { class: 'child' }, [text('ok')]);
			}
		}
		class Host extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				host = this;
			}
			render() {
				return h('puzzle-view', {}, [
					comp(Child, { fail: this.getData().fail ?? false }),
				]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);

		host.setData({ fail: true });
		await flush();

		expect(reports).toHaveLength(1);
		expect(reports[0].error.message).toBe('refresh boom');
		expect(reports[0].info).toEqual({
			phase: 'refresh',
			view: child,
			route: null,
		});
	});

	it('reports a failed route load with the destination route snapshot', async () => {
		const reports = [];
		class BrokenRoute extends PuzzleView {
			data() {
				throw new Error('navigation boom');
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', view: Home },
				{ path: '/broken', view: BrokenRoute },
			],
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);

		await app.router.push('/broken');

		expect(reports).toHaveLength(1);
		expect(reports[0].error.message).toBe('navigation boom');
		expect(reports[0].info.phase).toBe('navigation');
		expect(reports[0].info.view).toBeNull();
		expect(reports[0].info.route.path).toBe('/broken');
		expect(app.router.current.path).toBe('/');
	});

	it('reports a thrown navigation guard with the guarded destination snapshot', async () => {
		const reports = [];
		const app = await createTestApp({
			routes: [
				{ path: '/', view: Home },
				{
					path: '/guarded',
					view: Home,
					guard() {
						throw new Error('guard boom');
					},
				},
			],
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);

		await app.router.push('/guarded');

		expect(reports).toHaveLength(1);
		expect(reports[0].error.message).toBe('guard boom');
		expect(reports[0].info.phase).toBe('navigation');
		expect(reports[0].info.route.path).toBe('/guarded');
		expect(app.router.current.path).toBe('/');
	});

	it('reports contained app lifecycle hook failures with app phases', async () => {
		const phases = [];
		const app = await createTestApp({
			routes: [{ path: '/', view: Home }],
			mounted() {
				throw new Error('mounted boom');
			},
			beforeUnmount() {
				throw new Error('unmount boom');
			},
			onError(_error, info) {
				phases.push(info.phase);
			},
		});
		apps.push(app);

		expect(phases).toEqual(['app-mount']);
		app.destroy();
		expect(phases).toEqual(['app-mount', 'app-unmount']);
	});

	it('swallows an onError failure, logs it once, and never recurses', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const onError = vi.fn(() => {
			throw new Error('reporter boom');
		});
		class BrokenRoute extends PuzzleView {
			data() {
				throw new Error('navigation boom');
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', view: Home },
				{ path: '/broken', view: BrokenRoute },
			],
			onError,
		});
		apps.push(app);

		await app.router.push('/broken');

		expect(onError).toHaveBeenCalledTimes(1);
		expect(consoleError).toHaveBeenCalledTimes(1);
		expect(consoleError).toHaveBeenCalledWith(
			'[puzzle] onError hook failed:',
			expect.objectContaining({ message: 'reporter boom' })
		);
	});
});

describe('PuzzleView errorContent boundaries', () => {
	it('renders a failed child mount fallback and owner.refresh() remounts a fresh child', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let shouldFail = true;
		let host;
		const children = [];

		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				children.push(this);
			}
			data() {
				if (shouldFail) throw new Error('child boom');
				return {};
			}
			errorContent(error) {
				return h('section', { class: 'fallback' }, [text(error.message)]);
			}
			render() {
				return h('span', { class: 'child' }, [text('ready')]);
			}
		}
		class Host extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				host = this;
			}
			render() {
				return h('div', { class: 'host' }, [comp(Child)]);
			}
		}

		const app = await createTestApp({ routes: [{ path: '/', view: Host }] });
		apps.push(app);
		await flush();

		expect(app.find('.fallback').textContent).toBe('child boom');
		expect(app.find('.child')).toBeNull();
		expect(children).toHaveLength(1);
		expect(children[0].isDestroyed).toBe(true);

		shouldFail = false;
		host.refresh();
		await flush();

		expect(app.find('.fallback')).toBeNull();
		expect(app.find('.child').textContent).toBe('ready');
		expect(children).toHaveLength(2);
		expect(children[1].isDestroyed).toBe(false);
	});

	it('renders a router-owned mount fallback while keeping the committed view live', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let routedView;
		class BrokenMount extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				routedView = this;
			}
			mounted() {
				throw new Error('routed mount failed');
			}
			errorContent(error) {
				return h('puzzle-view', { class: 'fallback' }, [text(error.message)]);
			}
			render() {
				return h('puzzle-view', { class: 'content' }, [text('content')]);
			}
		}

		const app = await createTestApp({ routes: [{ path: '/', view: BrokenMount }] });
		apps.push(app);
		await flush();

		expect(app.find('.fallback').textContent).toBe('routed mount failed');
		expect(app.find('.content')).toBeNull();
		expect(routedView.isDestroyed).toBe(false);
	});

	it('renders a fallback for a live refresh failure and a successful refresh restores content', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let fail = false;
		class Refreshing extends PuzzleView {
			data() {
				if (fail) throw new Error('refresh failed');
				return {};
			}
			errorContent(error) {
				return h('p', { class: 'fallback' }, [text(error.message)]);
			}
			render() {
				return h('p', { class: 'content' }, [text('content')]);
			}
		}

		const container = document.createElement('div');
		document.body.appendChild(container);
		const view = await new Refreshing().mount(container);
		views.push(view);
		expect(container.querySelector('.content')).not.toBeNull();

		fail = true;
		view.onStoreChange();
		await flush();
		expect(container.querySelector('.fallback').textContent).toBe('refresh failed');

		fail = false;
		view.refresh();
		await flush();
		expect(container.querySelector('.fallback')).toBeNull();
		expect(container.querySelector('.content')).not.toBeNull();
	});

	it('uses the nearest ancestor boundary for subtree failures', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});

		class Broken extends PuzzleView {
			data() {
				throw new Error('deep boom');
			}
		}
		class InnerBoundary extends PuzzleView {
			errorContent() {
				return h('p', { class: 'inner-fallback' }, [text('inner')]);
			}
			render() {
				return h('section', {}, [comp(Broken)]);
			}
		}
		class OuterBoundary extends PuzzleView {
			errorContent() {
				return h('p', { class: 'outer-fallback' }, [text('outer')]);
			}
			render() {
				return h('puzzle-view', {}, [comp(InnerBoundary)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: OuterBoundary }],
		});
		apps.push(app);
		await flush();

		expect(app.find('.inner-fallback')).not.toBeNull();
		expect(app.find('.outer-fallback')).toBeNull();
	});

	it('keeps the existing placeholder and console behavior when no boundary or onError exists', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		class Broken extends PuzzleView {
			data() {
				throw new Error('plain boom');
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('div', { class: 'host' }, [comp(Broken)]);
			}
		}

		const app = await createTestApp({ routes: [{ path: '/', view: Host }] });
		apps.push(app);
		await flush();

		expect(consoleError).toHaveBeenCalledWith(
			'[puzzle] component mount failed — the component was destroyed and will remount on the next patch:',
			expect.objectContaining({ message: 'plain boom' })
		);
		const node = app.find('.host').firstChild;
		expect(node.nodeType).toBe(8);
		expect(node.nodeValue).toBe('puzzle');
	});

	it('mounts the boundary face fresh after a mid-patch throw, leaving no orphans', async () => {
		// A patch that throws PARTWAY leaves the DOM matching neither the old tree
		// nor the new one. Here the first of five children changes tag, so it is
		// REPLACED (its old element is detached) and then the third child's ref
		// throws. Diffing the boundary face against that stale tree resolves its
		// insertion ref to the detached element — insertBefore throws NotFoundError,
		// the boundary is reported as a second 'boundary' failure, and the user is
		// left with the half-patched DOM. The manager must clear its whole range and
		// mount the face fresh instead.
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const reports = [];
		let host;

		class Poisoned extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				host = this;
			}
			errorContent(error) {
				// Same root tag as render(), so patch() would descend into the stale
				// children rather than replacing the root wholesale.
				return h('section', { class: 'shell' }, [h('p', { class: 'fallback' }, [text(error.message)])]);
			}
			render() {
				const poisoned = this.getData().poisoned ?? false;
				const rows = [1, 2, 3, 4, 5].map((i) =>
					h(
						poisoned && i === 1 ? 'span' : 'div',
						{
							class: `row row-${i}`,
							...(poisoned && i === 3
								? {
										ref: () => {
											throw new Error('patch boom');
										},
									}
								: {}),
						},
						[text(`row ${i}`)]
					)
				);
				return h('section', { class: 'shell' }, rows);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Poisoned }],
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);
		await flush();
		expect(app.findAll('.row')).toHaveLength(5);

		host.setData({ poisoned: true });
		await flush();

		expect(app.find('.fallback').textContent).toBe('patch boom');
		// Nothing from the aborted patch survives beside the boundary face.
		expect(app.findAll('.row')).toHaveLength(0);
		expect(app.findAll('section')).toHaveLength(1);
		expect(app.container.querySelectorAll('.fallback')).toHaveLength(1);
		// One render report, and NO second 'boundary' report — the boundary drew
		// successfully rather than throwing against a stale insertion ref.
		expect(reports.map((r) => r.info.phase)).toEqual(['render']);
	});

	it('releases the aborted patch subtrees — subscriptions, instances and outside listeners', async () => {
		// renderFresh() clears the corrupt range by raw DOM removal, which releases
		// nothing that does not live in those nodes: component instances keep their
		// store subscriptions, and `outside` listeners sit on document. The vnode
		// trees still name WHAT exists (only WHERE is a lie), so both of them — the
		// old one and the partially-applied new one — get the non-DOM release walk.
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let host;
		let outsideFired = 0;
		let early;
		let late;

		class EarlyWatcher extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				early = this;
			}
			data() {
				return { name: this.ctx.store.findOne('todo', '1')?.title ?? '?' };
			}
			render() {
				return h('em', { class: 'early' }, [text(this.getData().name)]);
			}
		}
		class LateWatcher extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				late = this;
			}
			data() {
				return { name: this.ctx.store.findOne('todo', '2')?.title ?? '?' };
			}
			render() {
				return h('em', { class: 'late' }, [text(this.getData().name)]);
			}
		}
		class Poisoned extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				host = this;
			}
			errorContent(error) {
				return h('section', { class: 'shell' }, [
					h('p', { class: 'fallback' }, [text(error.message)]),
				]);
			}
			render() {
				const poisoned = this.getData().poisoned ?? false;
				return h('section', { class: 'shell' }, [
					// Only in the NEW tree: mounted (and subscribed) by the patch that
					// then threw, so this instance is reachable from that tree alone.
					poisoned ? comp(LateWatcher) : h('div', { class: 'row row-1' }, [text('one')]),
					h('div', {
						class: 'row row-2',
						'@click:outside': () => {
							outsideFired++;
						},
					}),
					h(
						'div',
						{
							class: 'row row-3',
							...(poisoned
								? {
										ref: () => {
											throw new Error('patch boom');
										},
									}
								: {}),
						},
						[text('three')]
					),
					// Never reached by the aborted patch, so this one is reachable from
					// the OLD tree alone.
					comp(EarlyWatcher),
				]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Poisoned }],
			models: { todo: Todo },
		});
		apps.push(app);
		app.store.upsert('todo', { id: '1', title: 'one' });
		await flush();

		expect(app.find('.early')).not.toBeNull();
		expect(app.store.keysBySubscriber.get(early)?.size ?? 0).toBeGreaterThan(0);

		host.setData({ poisoned: true });
		await flush();

		expect(app.find('.fallback').textContent).toBe('patch boom');
		// The new tree's component subscribed during the aborted patch...
		expect(late).toBeDefined();
		expect(late.isDestroyed).toBe(true);
		expect(app.store.keysBySubscriber.get(late)?.size ?? 0).toBe(0);
		// ...and the old tree's component was never reached by it.
		expect(early.isDestroyed).toBe(true);
		expect(app.store.keysBySubscriber.get(early)?.size ?? 0).toBe(0);
		// A store write must not wake either of them.
		app.store.upsert('todo', { id: '1', title: 'ONE!' });
		await flush();
		expect(app.find('.early')).toBeNull();
		expect(app.find('.fallback')).not.toBeNull();

		// The document-level `outside` listener is detached, not merely orphaned.
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flush();
		expect(outsideFired).toBe(0);
	});

	it('surfaces a pre-mount data() rejection behind a skeleton through the boundary', async () => {
		// The router starts a skeleton view's preload() un-awaited, so a prompt
		// rejection lands BEFORE mount() ever creates the ViewManager — here the
		// mount waits on the layout's gated data(). The error is buffered on the
		// instance and flushed at the end of mount(); without that the user sits on
		// the skeleton forever (F8).
		vi.spyOn(console, 'error').mockImplementation(() => {});

		class SlowShell extends PuzzleView {
			async data() {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return {};
			}
			render() {
				return h('div', { class: 'shell' }, [new ViewNode(SLOT_TAG)]);
			}
		}
		class FastFail extends PuzzleView {
			async data() {
				throw new Error('missing id');
			}
			renderSkeleton() {
				return h('div', { class: 'skeleton' });
			}
			errorContent(error) {
				return h('p', { class: 'fallback' }, [text(error.message)]);
			}
			render() {
				return h('puzzle-view', { class: 'post' });
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', view: Home },
				{ path: '/post', view: FastFail, layout: SlowShell },
			],
		});
		apps.push(app);

		await app.router.push('/post');
		await flush();

		expect(app.find('.fallback').textContent).toBe('missing id');
		expect(app.find('.skeleton')).toBeNull();
		expect(app.container.querySelectorAll('.fallback')).toHaveLength(1);
	});

	it('still surfaces a SLOW skeleton data() rejection through the boundary', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});

		class SlowFail extends PuzzleView {
			async data() {
				await new Promise((resolve) => setTimeout(resolve, 10));
				throw new Error('late boom');
			}
			renderSkeleton() {
				return h('div', { class: 'skeleton' });
			}
			errorContent(error) {
				return h('p', { class: 'fallback' }, [text(error.message)]);
			}
			render() {
				return h('puzzle-view', { class: 'post' });
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', view: Home },
				{ path: '/post', view: SlowFail },
			],
		});
		apps.push(app);

		await app.router.push('/post');
		await flush();

		expect(app.find('.fallback').textContent).toBe('late boom');
		expect(app.find('.skeleton')).toBeNull();
		expect(app.container.querySelectorAll('.fallback')).toHaveLength(1);
	});

	it('rebuilds the routed chain after a layout boundary swallowed it', async () => {
		// The layout is the error parent of the whole routed chain, so its boundary
		// render DESTROYS router-owned views. The router must be told, or the next
		// navigation reuses the destroyed instances and the layout freezes on the
		// old route forever (F2).
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const layouts = [];
		let dataRuns = 0;
		let thrown = false;

		class ProjectLayout extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				layouts.push(this);
			}
			data(params) {
				dataRuns++;
				return { id: params.id ?? this.route?.params?.id ?? '?' };
			}
			errorContent(error) {
				return h('p', { class: 'layout-fallback' }, [text(error.message)]);
			}
			render() {
				return h('div', { class: 'layout' }, [
					h('h1', { class: 'header' }, [text(String(this.getData().id))]),
					new ViewNode(SLOT_TAG),
				]);
			}
		}
		class Leaf extends PuzzleView {
			mounted() {
				if (!thrown) {
					thrown = true;
					throw new Error('leaf boom');
				}
			}
			render() {
				return h('puzzle-view', { class: 'leaf' }, [text(`leaf ${this.params.id}`)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/projects/:id', view: Leaf, layout: ProjectLayout }],
			routerInitialPath: '/projects/1',
		});
		apps.push(app);
		await flush();

		// The layout boundary took the whole page.
		expect(app.find('.layout-fallback').textContent).toBe('leaf boom');
		expect(app.find('.leaf')).toBeNull();
		const runsAtFailure = dataRuns;

		await app.router.push('/projects/2');
		await flush();

		// A FRESH layout whose data() re-ran — not the frozen destroyed chain.
		expect(app.find('.layout-fallback')).toBeNull();
		expect(app.find('.header').textContent).toBe('2');
		expect(app.find('.leaf').textContent).toBe('leaf 2');
		expect(dataRuns).toBeGreaterThan(runsAtFailure);
		expect(layouts).toHaveLength(2);
		expect(layouts[0].isDestroyed).toBe(true);
		expect(layouts[1].isDestroyed).toBe(false);

		// And the rebuilt chain keeps navigating normally.
		await app.router.push('/projects/3');
		await flush();
		expect(app.find('.header').textContent).toBe('3');
		expect(app.find('.leaf').textContent).toBe('leaf 3');
	});
});

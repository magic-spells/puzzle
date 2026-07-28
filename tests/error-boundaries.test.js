// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../client-runtime/testing/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';

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
});

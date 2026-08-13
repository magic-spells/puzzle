// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, settled } from '../client-runtime/testing/index.js';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { PORTAL_TAG, SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (View, props = {}, children = []) => new ViewNode(View, props, children);

const apps = [];

afterEach(() => {
	for (const app of apps.splice(0)) app.destroy();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

async function flush() {
	for (let i = 0; i < 4; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
		await settled();
	}
}

class Home extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('home')]);
	}
}

function errorViewClass(instances = []) {
	return class AppError extends PuzzleView {
		constructor(ctx) {
			super(ctx);
			instances.push(this);
		}
		events = { retry: () => this.props.retry() };
		render() {
			return h('section', { class: 'app-error' }, [
				h('span', { class: 'message' }, [text(this.props.error.message)]),
				h('button', { class: 'retry', '@click': this.events.retry }, [text('retry')]),
			]);
		}
	};
}

describe('PuzzleApp errorView config', () => {
	it('validates the view constructor during app construction', () => {
		class AppError extends PuzzleView {}
		expect(() => new PuzzleApp({ errorView: AppError })).not.toThrow();
		expect(() => new PuzzleApp({ errorView: {} })).toThrow(
			'[puzzle] config.errorView must be a PuzzleView constructor when set'
		);
		expect(() => new PuzzleApp({ errorView: class NotAView {} })).toThrow(
			'[puzzle] config.errorView must be a PuzzleView constructor when set'
		);
		expect(() => new PuzzleApp({ errorView: () => null })).toThrow(
			'[puzzle] config.errorView must be a PuzzleView constructor when set'
		);
	});
});

describe('app-level error view replacement', () => {
	it('replaces only a failed child and gives it the same frozen info reported to onError', async () => {
		const errorViews = [];
		const ErrorView = errorViewClass(errorViews);
		const reports = [];
		let failed;

		class Broken extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				failed = this;
			}
			data() {
				throw new Error('child boom');
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'host' }, [
					h('span', { class: 'before' }, [text('before')]),
					comp(Broken),
					h('span', { class: 'after' }, [text('after')]),
				]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			errorView: ErrorView,
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);
		await flush();

		expect(app.find('.host').textContent).toBe('beforechild boomretryafter');
		expect(failed.isDestroyed).toBe(true);
		expect(errorViews).toHaveLength(1);
		expect(errorViews[0].props.info).toBe(reports[0].info);
		expect(errorViews[0].props.error).toBe(reports[0].error);
		expect(Object.isFrozen(reports[0].info)).toBe(true);
		expect(reports[0].info).toEqual({ phase: 'mount', view: failed, route: null });
	});

	it('replaces a failed routed root and navigation away destroys the replacement', async () => {
		const errors = [];
		let failedRoot;
		let errorDestroyed = 0;
		let staleRetry;

		class ErrorView extends PuzzleView {
			mounted() {
				staleRetry = this.props.retry;
			}
			destroyed() {
				errorDestroyed++;
			}
			render() {
				return h('puzzle-view', { class: 'route-error' }, [text(this.props.error.message)]);
			}
		}
		class BrokenRoot extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				failedRoot = this;
			}
			mounted() {
				throw new Error('root boom');
			}
			render() {
				return h('puzzle-view', { class: 'broken-root' });
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', view: BrokenRoot },
				{ path: '/home', view: Home },
			],
			errorView: ErrorView,
			onError(error, info) {
				errors.push({ error, info });
			},
		});
		apps.push(app);
		await flush();

		expect(app.router.current.path).toBe('/');
		expect(app.find('.route-error').textContent).toBe('root boom');
		expect(failedRoot.isDestroyed).toBe(true);

		await app.router.push('/home');
		await flush();
		expect(app.find('.home')).not.toBeNull();
		expect(app.find('.route-error')).toBeNull();
		expect(errorDestroyed).toBe(1);

		staleRetry();
		await flush();
		expect(app.router.current.path).toBe('/home');
		expect(errors).toHaveLength(1);
	});
});

describe('errorView retry', () => {
	it('retries a failed routed layout through a full current-location replacement', async () => {
		let shouldFail = true;
		let retry;
		let layouts = 0;
		let pages = 0;
		let layoutData = 0;
		let pageData = 0;
		const errorViews = [];

		class ErrorView extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				errorViews.push(this);
			}
			mounted() {
				retry = this.props.retry;
			}
			render() {
				return h('p', { class: 'layout-error' }, [text('layout failed')]);
			}
		}
		class Layout extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				layouts++;
			}
			data() {
				layoutData++;
				return {};
			}
			mounted() {
				if (shouldFail) throw new Error('layout boom');
			}
			render() {
				return h('main', { class: 'layout' }, [new ViewNode(SLOT_TAG)]);
			}
		}
		class Page extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				pages++;
			}
			data() {
				pageData++;
				return {};
			}
			render() {
				return h('span', { class: 'page' }, [text(this.route.path)]);
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/', view: Page, layout: Layout },
				{ path: '/next', view: Page, layout: Layout },
			],
			errorView: ErrorView,
			onError() {},
		});
		apps.push(app);
		await flush();
		expect(app.find('.layout-error')).not.toBeNull();

		const stableRetry = retry;
		await retry();
		await flush();
		expect(app.find('.layout-error')).not.toBeNull();
		expect(errorViews).toHaveLength(2);
		expect(errorViews[0].props.retry).toBe(stableRetry);
		expect(retry).not.toBe(stableRetry);
		expect(layouts).toBe(2);
		expect(pages).toBe(2);
		expect(layoutData).toBe(2);
		expect(pageData).toBe(2);

		await stableRetry();
		await flush();
		expect(layouts).toBe(2);
		expect(pages).toBe(2);

		shouldFail = false;
		await retry();
		await flush();
		expect(app.find('.layout .page').textContent).toBe('/');
		expect(layouts).toBe(3);
		expect(pages).toBe(3);
		expect(layoutData).toBe(3);
		expect(pageData).toBe(3);

		await app.router.push('/next');
		await flush();
		expect(app.find('.layout .page').textContent).toBe('/next');
		expect(layouts).toBe(3);
	});

	it('rebuilds router-pinned descendants when a routed ancestor fails inside a layout', async () => {
		let shouldFail = true;
		let retry;
		let parents = 0;
		let leaves = 0;

		class ErrorView extends PuzzleView {
			mounted() {
				retry = this.props.retry;
			}
			render() {
				return h('p', { class: 'ancestor-error' }, [text('ancestor failed')]);
			}
		}
		class Layout extends PuzzleView {
			render() {
				return h('main', { class: 'nested-layout' }, [new ViewNode(SLOT_TAG)]);
			}
		}
		class Parent extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				parents++;
			}
			mounted() {
				if (shouldFail) throw new Error('ancestor boom');
			}
			render() {
				return h('section', { class: 'parent-route' }, [new ViewNode(SLOT_TAG)]);
			}
		}
		class Leaf extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				leaves++;
			}
			render() {
				return h('span', { class: 'leaf-route' }, [text('leaf')]);
			}
		}
		class Index extends PuzzleView {
			render() {
				return h('span', { class: 'index-route' }, [text('index')]);
			}
		}

		const app = await createTestApp({
			routes: [
				{
					path: '/',
					view: Parent,
					layout: Layout,
					children: [
						{ path: '', view: Index },
						{ path: 'child', view: Leaf },
					],
				},
			],
			routerInitialPath: '/child',
			errorView: ErrorView,
			onError() {},
		});
		apps.push(app);
		await flush();
		expect(app.find('.ancestor-error')).not.toBeNull();

		shouldFail = false;
		await retry();
		await flush();
		expect(app.find('.nested-layout .parent-route .leaf-route').textContent).toBe('leaf');
		expect(parents).toBe(2);
		expect(leaves).toBe(2);

		await app.router.push('/');
		await flush();
		expect(app.find('.parent-route')).not.toBeNull();
		expect(app.find('.leaf-route')).toBeNull();
		expect(app.find('.index-route')).not.toBeNull();
		expect(parents).toBe(2);
	});

	it('refreshes the owner and mounts the component fresh from constructor through mount', async () => {
		let attempts = 0;
		let shouldFail = true;
		let retry;
		let hostData = 0;
		const lifecycle = [];

		class ErrorView extends PuzzleView {
			mounted() {
				retry = this.props.retry;
			}
			render() {
				return h('p', { class: 'app-error' }, [text(this.props.error.message)]);
			}
		}
		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				attempts++;
				lifecycle.push('constructor');
			}
			created() {
				lifecycle.push('created');
			}
			data() {
				lifecycle.push('data');
				if (shouldFail) throw new Error('not yet');
				return {};
			}
			mounted() {
				lifecycle.push('mounted');
			}
			render() {
				lifecycle.push('render');
				return h('strong', { class: 'ready' }, [text('ready')]);
			}
		}
		class Host extends PuzzleView {
			data() {
				hostData++;
				return {};
			}
			render() {
				return h('puzzle-view', {}, [comp(Child)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			errorView: ErrorView,
			onError() {},
		});
		apps.push(app);
		await flush();
		expect(app.find('.app-error')).not.toBeNull();

		shouldFail = false;
		await retry();
		await flush();
		expect(app.find('.ready').textContent).toBe('ready');
		expect(app.find('.app-error')).toBeNull();
		expect(attempts).toBe(2);
		expect(hostData).toBe(2);
		expect(lifecycle.slice(-5)).toEqual(['constructor', 'created', 'data', 'render', 'mounted']);
	});

	it('is single-flight while a retry data load is pending', async () => {
		let attempts = 0;
		let retry;
		let release;

		class ErrorView extends PuzzleView {
			mounted() {
				retry = this.props.retry;
			}
			render() {
				return h('p', { class: 'app-error' });
			}
		}
		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				attempts++;
			}
			data() {
				if (attempts === 1) throw new Error('first');
				return new Promise((resolve) => {
					release = resolve;
				});
			}
			render() {
				return h('span', { class: 'ready' });
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('puzzle-view', {}, [comp(Child)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			errorView: ErrorView,
			onError() {},
		});
		apps.push(app);
		await flush();

		const first = retry();
		const second = retry();
		expect(attempts).toBe(2);
		release({});
		await Promise.all([first, second]);
		await flush();
		expect(attempts).toBe(2);
		expect(app.find('.ready')).not.toBeNull();
	});

	it('mounts a fresh error view after a failed retry with the new error', async () => {
		let attempts = 0;
		const errorViews = [];
		const reports = [];
		const ErrorView = errorViewClass(errorViews);

		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				attempts++;
			}
			data() {
				throw new Error(attempts === 1 ? 'first failure' : 'retry failure');
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('puzzle-view', {}, [comp(Child)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			errorView: ErrorView,
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);
		await flush();

		await errorViews[0].props.retry();
		await flush();
		expect(errorViews).toHaveLength(2);
		expect(errorViews[1].props.error.message).toBe('retry failure');
		expect(app.find('.message').textContent).toBe('retry failure');
		expect(reports.map((r) => r.info.phase)).toEqual(['mount', 'mount']);
	});

	it('is a no-op after a parent patch removes the failed position', async () => {
		let attempts = 0;
		let host;
		let retry;

		class ErrorView extends PuzzleView {
			mounted() {
				retry = this.props.retry;
			}
			render() {
				return h('p', { class: 'app-error' });
			}
		}
		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				attempts++;
			}
			data() {
				throw new Error('boom');
			}
		}
		class Host extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				host = this;
			}
			render() {
				return h('puzzle-view', {}, [
					this.getData().show === false ? h('span', { class: 'gone' }) : comp(Child),
				]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			errorView: ErrorView,
			onError() {},
		});
		apps.push(app);
		await flush();
		host.setData('show', false);
		await flush();
		expect(app.find('.gone')).not.toBeNull();

		await retry();
		await flush();
		expect(attempts).toBe(1);
		expect(app.find('.gone')).not.toBeNull();
	});
});

describe('error view terminal failure and defaults', () => {
	it("reports an error-view failure once with phase 'error-view' and never recurses", async () => {
		const reports = [];
		let errorConstructors = 0;

		class BrokenErrorView extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				errorConstructors++;
			}
			render() {
				throw new Error('error ui broke');
			}
		}
		class Broken extends PuzzleView {
			data() {
				throw new Error('app broke');
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'host' }, [comp(Broken)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			errorView: BrokenErrorView,
			onError(error, info) {
				reports.push({ error, info });
			},
		});
		apps.push(app);
		await flush();

		expect(reports.map((r) => r.info.phase)).toEqual(['mount', 'error-view']);
		expect(errorConstructors).toBe(1);
		const marker = app.find('.host').firstChild;
		expect(marker.nodeType).toBe(8);
		expect(marker.nodeValue).toBe('puzzle');
	});

	it('keeps the invisible recovery marker without errorView and owner refresh remounts', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let fail = true;
		let host;
		let attempts = 0;

		class Child extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				attempts++;
			}
			data() {
				if (fail) throw new Error('plain boom');
				return {};
			}
			render() {
				return h('span', { class: 'ready' }, [text('ready')]);
			}
		}
		class Host extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				host = this;
			}
			render() {
				return h('puzzle-view', { class: 'host' }, [comp(Child)]);
			}
		}

		const app = await createTestApp({ routes: [{ path: '/', view: Host }] });
		apps.push(app);
		await flush();
		expect(app.find('.host').firstChild.nodeType).toBe(8);

		fail = false;
		host.refresh();
		await flush();
		expect(app.find('.ready').textContent).toBe('ready');
		expect(attempts).toBe(2);
	});
});

describe('replacement cleanup', () => {
	it('releases subscriptions, descendants, refs, outside listeners, and portals exactly once', async () => {
		class Todo extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), title: Puzzle.string() };
		}
		let failed;
		let descendantDestroyed = 0;
		let refClears = 0;
		let outsideFires = 0;

		class ErrorView extends PuzzleView {
			render() {
				return h('p', { class: 'app-error' }, [text('contained')]);
			}
		}
		class Descendant extends PuzzleView {
			destroyed() {
				descendantDestroyed++;
			}
			render() {
				return h('em', { class: 'descendant' });
			}
		}
		class Broken extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				failed = this;
			}
			data() {
				this.ctx.store.findMany('todo');
				return {};
			}
			mounted() {
				throw new Error('mounted boom');
			}
			render() {
				return h('section', {
					class: 'broken',
					ref: (el) => {
						if (el == null) refClears++;
					},
					'@click:outside': () => outsideFires++,
				}, [
					comp(Descendant),
					new ViewNode(PORTAL_TAG, {}, [h('div', { class: 'portaled' })]),
				]);
			}
		}
		class Host extends PuzzleView {
			render() {
				return h('puzzle-view', {}, [comp(Broken)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/', view: Host }],
			models: { todo: Todo },
			errorView: ErrorView,
			onError() {},
		});
		apps.push(app);
		await flush();

		expect(failed.isDestroyed).toBe(true);
		expect(app.store.keysBySubscriber.get(failed)?.size ?? 0).toBe(0);
		expect(descendantDestroyed).toBe(1);
		expect(refClears).toBe(1);
		expect(document.querySelector('.portaled')).toBeNull();

		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flush();
		expect(outsideFires).toBe(0);
		expect(descendantDestroyed).toBe(1);
		expect(refClears).toBe(1);
	});
});

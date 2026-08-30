// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazy } from '../client-runtime/index.js';
import { Router } from '../client-runtime/router/router.js';
import { setErrorConfig } from '../client-runtime/errors.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

class LazyView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'lazy' }, [text('LAZY')]);
	}
}

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [slot()]);
	}
}

const routers = [];

async function boot(routes, { onError } = {}) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const context = { store: null, router: null, formatters: null };
	if (onError) setErrorConfig(context, onError, null);
	const router = new Router(routes);
	context.router = router;
	routers.push({ router, context });
	await router.start(el, context);
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
});

afterEach(() => {
	for (const { router, context } of routers.splice(0)) {
		router.stop();
		setErrorConfig(context, null, null);
	}
	document.body.replaceChildren();
});

describe('lazy route views', () => {
	it('memoizes fulfillment for the marker lifetime', async () => {
		const loader = vi.fn(async () => ({ default: LazyView }));
		const Lazy = lazy(loader);
		const { router, el } = await boot([
			{ path: '/', view: HomeView, layout: DefaultLayout },
			{ path: '/lazy', view: Lazy, layout: DefaultLayout },
		]);

		await router.push('/lazy');
		expect(el.querySelector('.lazy')).not.toBeNull();
		await router.push('/');
		await router.push('/lazy');

		expect(loader).toHaveBeenCalledTimes(1);
		expect(el.textContent).toContain('LAZY');
	});

	it('shares one in-flight loader across concurrent navigations', async () => {
		const pending = deferred();
		const loader = vi.fn(() => pending.promise);
		const Lazy = lazy(loader);
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/one', view: Lazy },
			{ path: '/two', view: Lazy },
		]);

		const first = router.push('/one');
		await tick();
		const second = router.push('/two');
		await tick();
		expect(loader).toHaveBeenCalledTimes(1);

		pending.resolve({ default: LazyView });
		await Promise.all([first, second]);
		expect(router.current.path).toBe('/two');
		expect(el.querySelector('.lazy')).not.toBeNull();
	});

	it('leaves URL and DOM untouched on rejection and reports navigation phase', async () => {
		const failure = new Error('chunk unavailable');
		const errors = [];
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/lazy', view: lazy(() => Promise.reject(failure)), layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		await router.push('/lazy');

		expect(location.pathname).toBe('/');
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.lazy')).toBeNull();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
	});

	it('does not memoize rejection, so retry invokes the loader again', async () => {
		let attempt = 0;
		const loader = vi.fn(async () => {
			if (++attempt === 1) throw new Error('first attempt');
			return LazyView;
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/lazy', view: lazy(loader) },
		]);

		await router.push('/lazy');
		expect(router.current.path).toBe('/');
		await router.push('/lazy');

		expect(loader).toHaveBeenCalledTimes(2);
		expect(router.current.path).toBe('/lazy');
		expect(el.querySelector('.lazy')).not.toBeNull();
		errorSpy.mockRestore();
	});

	it('runs guards before starting a lazy download', async () => {
		const loader = vi.fn(async () => LazyView);
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/admin', view: lazy(loader), guard: () => false },
		]);

		await router.push('/admin');

		expect(loader).not.toHaveBeenCalled();
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('starts lazy layout and nested index-chain loaders in parallel', async () => {
		class ShellView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'shell' }, [slot()]);
			}
		}
		class IndexView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'index' }, [text('INDEX')]);
			}
		}

		const shell = deferred();
		const index = deferred();
		const layout = deferred();
		const calls = [];
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{
				path: '/settings',
				view: lazy(() => {
					calls.push('shell');
					return shell.promise;
				}),
				layout: lazy(() => {
					calls.push('layout');
					return layout.promise;
				}),
				children: [
					{
						path: '',
						view: lazy(() => {
							calls.push('index');
							return index.promise;
						}),
					},
				],
			},
		]);

		const navigation = router.push('/settings');
		await tick();
		expect(calls.sort()).toEqual(['index', 'layout', 'shell']);

		shell.resolve(ShellView);
		index.resolve({ default: IndexView });
		layout.resolve({ default: DefaultLayout });
		await navigation;

		expect(el.querySelector('.layout .shell .index')).not.toBeNull();
		expect(el.textContent).toContain('INDEX');
	});

	it('accepts a lazy catch-all route', async () => {
		const { router, el } = await boot([
			{ path: '/', view: HomeView },
			{ path: '*', view: lazy(async () => ({ default: LazyView })) },
		]);

		await router.push('/missing');

		expect(router.current.path).toBe('/missing');
		expect(el.querySelector('.lazy')).not.toBeNull();
	});

	it('names a module with no default export and explains the fix', async () => {
		const errors = [];
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView },
				{
					path: '/bad-module',
					view: lazy(() => import('./fixtures/lazy-route-named-only.js')),
				},
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		await router.push('/bad-module');

		expect(errors).toHaveLength(1);
		expect(errors[0].error.message).toContain('lazy-route-named-only.js');
		expect(errors[0].error.message).toContain('default export');
		expect(errors[0].info.phase).toBe('navigation');
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('rejects bare loader functions instead of guessing class versus loader', () => {
		expect(
			() => new Router([{ path: '/', view: () => import('./fixtures/lazy-route-named-only.js') }])
		).toThrow(/wrap dynamic imports with lazy\(\(\) => import/);
		expect(
			() =>
				new Router([
					{
						path: '/',
						view: HomeView,
						layout: () => import('./fixtures/lazy-route-named-only.js'),
					},
				])
		).toThrow(/wrap dynamic imports with lazy\(\(\) => import/);
	});
});

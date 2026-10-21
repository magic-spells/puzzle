// @vitest-environment jsdom
//
// router.push()/replace() resolve a NavigationResult (D182): `ok: true` with the
// committed route snapshot, or `ok: false` with the reason nothing committed —
// 'blocked', 'superseded', 'not-found' or 'error'. The promise never rejects,
// and a push deferred inside the commit window settles when it actually runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazy } from '../client-runtime/index.js';
import { Router } from '../client-runtime/router/router.js';
import { hashRouter, memoryRouter } from '../client-runtime/router/modes.js';
import { setErrorConfig } from '../client-runtime/errors.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const view = (cls) =>
	class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: cls }, [text(cls)]);
		}
	};

class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
	}
}

/** A view whose data() waits for `release()` — keeps its navigation in flight. */
function gated() {
	let release;
	const gate = new Promise((r) => (release = r));
	const View = class extends PuzzleView {
		async data() {
			await gate;
			return {};
		}
		render() {
			return h('puzzle-view', { class: 'slow' }, [text('SLOW')]);
		}
	};
	return { View, release: () => release() };
}

const HomeView = view('home');
const AboutView = view('about');

const routers = [];

async function boot(routes, { mode, url = '/', onError, ...options } = {}) {
	history.replaceState({}, '', url);
	const el = document.createElement('div');
	document.body.appendChild(el);
	const context = { store: null, router: null, formatters: null };
	if (onError) setErrorConfig(context, onError, null);
	const router = new Router(routes, { ...(mode ? { mode } : {}), ...options });
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
	vi.restoreAllMocks();
});

describe('router.push() — committed navigations (D182)', () => {
	it('resolves ok with the committed route snapshot', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/user/:id', name: 'user', view: AboutView, layout: DefaultLayout },
		]);

		const result = await router.push('/user/7?tab=posts#bio');

		expect(result.ok).toBe(true);
		expect(result.route).toEqual(router.current);
		expect(result.route).toMatchObject({
			path: '/user/7?tab=posts#bio',
			pathname: '/user/7',
			query: { tab: 'posts' },
			hash: '#bio',
			params: { id: '7' },
		});
		expect(result.route.route.name).toBe('user');
		expect('redirectedFrom' in result).toBe(false);
	});

	it('a params-only navigation (the whole chain reused) also resolves ok', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/user/:id', name: 'user', view: AboutView },
		]);
		await router.push('/user/1');

		const result = await router.push('/user/2');

		expect(result).toEqual({ ok: true, route: router.current });
		expect(result.route.params.id).toBe('2');
	});

	it('the catch-all route is a commit, not a miss', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '*', name: 'not-found', view: view('nf') },
		]);

		const result = await router.push('/nowhere');

		expect(result.ok).toBe(true);
		expect(result.route.route.name).toBe('not-found');
		expect(result.route.path).toBe('/nowhere');
	});

	it('a same-path push is a no-op that resolves ok with the current route', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/about', name: 'about', view: AboutView },
		]);
		await router.push('/about');
		const before = history.length;

		const result = await router.push('/about');

		expect(result).toEqual({ ok: true, route: router.current });
		expect(result.route.path).toBe('/about');
		expect(history.length).toBe(before);
	});

	it('a same-path push while that path is in flight returns the in-flight result', async () => {
		const slow = gated();
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/slow', name: 'slow', view: slow.View },
		]);

		const first = router.push('/slow');
		const second = router.push('/slow');
		expect(second).toBe(first);
		slow.release();

		const [a, b] = await Promise.all([first, second]);
		expect(a).toBe(b);
		expect(a.ok).toBe(true);
		expect(a.route.path).toBe('/slow');
	});

	it('replace() resolves the same shape', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/about', name: 'about', view: AboutView },
		]);

		const result = await router.replace('/about?x=1');
		expect(result.ok).toBe(true);
		expect(result.route.query).toEqual({ x: '1' });

		expect(await router.replace('/about?x=1')).toEqual({ ok: true, route: router.current });
		expect(await router.replace('/missing')).toMatchObject({ ok: false, reason: 'not-found' });
	});
});

describe('router.push() — navigations that do not commit (D182)', () => {
	it("a guard returning false resolves 'blocked'", async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/private', name: 'private', view: AboutView, guard: () => false },
		]);

		const result = await router.push('/private');

		expect(result).toEqual({ ok: false, reason: 'blocked' });
		expect(router.current.path).toBe('/');
	});

	it("a throwing guard is reported and resolves 'blocked', like false", async () => {
		const errors = [];
		const failure = new Error('guard blew up');
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{
					path: '/private',
					name: 'private',
					view: AboutView,
					guard: () => {
						throw failure;
					},
				},
			],
			{ onError: (error) => errors.push(error) }
		);

		expect(await router.push('/private')).toEqual({ ok: false, reason: 'blocked' });
		expect(errors).toEqual([failure]);
	});

	it('a guard redirect resolves the final navigation plus redirectedFrom', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/login', name: 'login', view: view('login') },
			{ path: '/private', name: 'private', view: AboutView, guard: () => '/login' },
		]);

		const result = await router.push('/private');

		expect(result).toEqual({ ok: true, route: router.current, redirectedFrom: '/private' });
		expect(result.route.path).toBe('/login');
	});

	it('a redirect chain names the originally requested path', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/a', name: 'a', view: view('a'), guard: () => '/b' },
			{ path: '/b', name: 'b', view: view('b'), guard: () => '/c' },
			{ path: '/c', name: 'c', view: view('c') },
		]);

		const result = await router.push('/a');

		expect(result.ok).toBe(true);
		expect(result.route.path).toBe('/c');
		expect(result.redirectedFrom).toBe('/a');
	});

	it('a redirect onto the current route resolves ok with the current route', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/private', name: 'private', view: AboutView, guard: () => '/' },
		]);

		const result = await router.push('/private');

		expect(result).toEqual({ ok: true, route: router.current, redirectedFrom: '/private' });
		expect(result.route.path).toBe('/');
	});

	it('a redirect that is refused carries the refusal, without redirectedFrom', async () => {
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/login', name: 'login', view: view('login'), guard: () => false },
			{ path: '/private', name: 'private', view: AboutView, guard: () => '/login' },
		]);

		expect(await router.push('/private')).toEqual({ ok: false, reason: 'blocked' });
	});

	it("a navigation a later one overtakes resolves 'superseded'", async () => {
		const slow = gated();
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/slow', name: 'slow', view: slow.View },
			{ path: '/about', name: 'about', view: AboutView },
		]);

		const first = router.push('/slow');
		const second = router.push('/about');
		slow.release();

		expect(await first).toEqual({ ok: false, reason: 'superseded' });
		expect((await second).route.path).toBe('/about');
	});

	it("a navigation superseded during its guard resolves 'superseded'", async () => {
		let allow;
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{
				path: '/private',
				name: 'private',
				view: AboutView,
				guard: () => new Promise((r) => (allow = r)),
			},
			{ path: '/about', name: 'about', view: AboutView },
		]);

		const first = router.push('/private');
		const second = router.push('/about');
		allow(true);

		expect(await first).toEqual({ ok: false, reason: 'superseded' });
		expect((await second).ok).toBe(true);
	});

	it("no match and no catch-all resolves 'not-found' and still warns", async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { router } = await boot([{ path: '/', name: 'home', view: HomeView }]);

		const result = await router.push('/nowhere');

		expect(result).toEqual({ ok: false, reason: 'not-found' });
		expect(warn).toHaveBeenCalledWith('[puzzle] no route matched:', '/nowhere');
		expect(router.current.path).toBe('/');
	});

	it("a data() failure resolves 'error' with the error and still reports it", async () => {
		const errors = [];
		const failure = new Error('data failed');
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{
					path: '/broken',
					name: 'broken',
					view: class extends PuzzleView {
						async data() {
							throw failure;
						}
						render() {
							return h('puzzle-view', {}, []);
						}
					},
				},
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		const result = await router.push('/broken');

		expect(result).toEqual({ ok: false, reason: 'error', error: failure });
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
		expect(router.current.path).toBe('/');
	});

	it("a lazy view that fails to load resolves 'error' and still reports it", async () => {
		const errors = [];
		const failure = new Error('chunk missing');
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{ path: '/lazy', name: 'lazy', view: lazy(() => Promise.reject(failure)) },
			],
			{ onError: (error) => errors.push(error) }
		);

		expect(await router.push('/lazy')).toEqual({ ok: false, reason: 'error', error: failure });
		expect(errors).toEqual([failure]);
	});

	it("a view constructor throw resolves 'error' and still reports it", async () => {
		const errors = [];
		const failure = new Error('constructor blew up');
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{
					path: '/boom',
					name: 'boom',
					view: class extends PuzzleView {
						constructor(ctx) {
							super(ctx);
							throw failure;
						}
					},
				},
			],
			{ onError: (error) => errors.push(error) }
		);

		expect(await router.push('/boom')).toEqual({ ok: false, reason: 'error', error: failure });
		expect(errors).toEqual([failure]);
	});

	it("never rejects: a synchronous commit throw resolves 'error' and is reported", async () => {
		const errors = [];
		const failure = new Error('afterUpdate boom');
		let throwOnUpdate = false;
		class FlakyLayout extends PuzzleView {
			afterUpdate() {
				if (throwOnUpdate) {
					throwOnUpdate = false;
					throw failure;
				}
			}
			render() {
				return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
			}
		}
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView, layout: FlakyLayout },
				{ path: '/about', name: 'about', view: AboutView, layout: FlakyLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		throwOnUpdate = true;
		const result = await router.push('/about');

		expect(result).toEqual({ ok: false, reason: 'error', error: failure });
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
	});
});

describe('router.push() — commit-window deferral (D182)', () => {
	it('a push from mounted() resolves when the deferred navigation lands', async () => {
		let deferred;
		let pathWhenSettled;
		class RedirectView extends PuzzleView {
			mounted() {
				deferred = this.ctx.router.push('/target');
				deferred.then(() => (pathWhenSettled = this.ctx.router.current.path));
			}
			render() {
				return h('puzzle-view', { class: 'redirect' }, [text('REDIRECT')]);
			}
		}
		const slow = gated();
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/redirect', name: 'redirect', view: RedirectView, layout: DefaultLayout },
			{ path: '/target', name: 'target', view: slow.View, layout: DefaultLayout },
		]);

		await router.push('/redirect');
		expect(deferred).toBeDefined();
		// The deferred navigation is running now (its data() is held), so the
		// caller's promise is still pending — it did not resolve at deferral time.
		let settled = false;
		deferred.then(() => (settled = true));
		await new Promise((r) => setTimeout(r, 0));
		expect(settled).toBe(false);

		slow.release();
		const result = await deferred;
		expect(result.ok).toBe(true);
		expect(result.route.path).toBe('/target');
		expect(pathWhenSettled).toBe('/target');
	});

	it("last wins: the displaced deferral resolves 'superseded'", async () => {
		const deferred = [];
		class RedirectView extends PuzzleView {
			mounted() {
				deferred.push(this.ctx.router.push('/a'));
				deferred.push(this.ctx.router.replace('/b'));
			}
			render() {
				return h('puzzle-view', { class: 'redirect' }, [text('REDIRECT')]);
			}
		}
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/redirect', name: 'redirect', view: RedirectView },
			{ path: '/a', name: 'a', view: view('a') },
			{ path: '/b', name: 'b', view: view('b') },
		]);

		await router.push('/redirect');
		const [a, b] = await Promise.all(deferred);

		expect(a).toEqual({ ok: false, reason: 'superseded' });
		expect(b.ok).toBe(true);
		expect(b.route.path).toBe('/b');
		expect(router.current.path).toBe('/b');
	});

	it("stop() settles a deferral it drops as 'superseded'", async () => {
		let deferred;
		let router;
		class RedirectView extends PuzzleView {
			mounted() {
				deferred = this.ctx.router.push('/a');
				router.stop();
			}
			render() {
				return h('puzzle-view', { class: 'redirect' }, [text('REDIRECT')]);
			}
		}
		({ router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/redirect', name: 'redirect', view: RedirectView },
			{ path: '/a', name: 'a', view: view('a') },
		]));

		await router.push('/redirect');
		expect(await deferred).toEqual({ ok: false, reason: 'superseded' });
	});
});

describe('router.push() — every router mode (D182)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView },
		{ path: '/about', name: 'about', view: AboutView },
		{ path: '/private', name: 'private', view: AboutView, guard: () => false },
	];

	it('hash mode', async () => {
		const { router } = await boot(routes, { mode: hashRouter() });

		const result = await router.push('/about');

		expect(result).toEqual({ ok: true, route: router.current });
		expect(location.hash).toBe('#/about');
		expect(await router.push('/private')).toEqual({ ok: false, reason: 'blocked' });
	});

	it('memory mode', async () => {
		const { router } = await boot(routes, { mode: memoryRouter() });

		const result = await router.push('/about');

		expect(result).toEqual({ ok: true, route: router.current });
		expect(result.route.path).toBe('/about');
		expect(await router.push('/about')).toEqual({ ok: true, route: router.current });
		expect(await router.push('/private')).toEqual({ ok: false, reason: 'blocked' });
	});

	it('a locale-prefixed push (D177) lands on the catch-all and warns', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{ path: '/about', name: 'about', view: AboutView },
				{ path: '*', name: 'not-found', view: view('nf') },
			],
			{ url: '/es/', locale: 'es', defaultLocale: 'en', locales: ['en', 'es'] }
		);

		const result = await router.push('/es/about');

		expect(result.ok).toBe(true);
		expect(result.route.route.name).toBe('not-found');
		expect(warn.mock.calls.some(([m]) => /starts with a locale prefix/.test(m))).toBe(true);
		expect((await router.push('/about')).route.route.name).toBe('about');
	});
});

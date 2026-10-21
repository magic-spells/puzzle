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
import { installFakeAnimate } from './helpers/fake-waapi.js';

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
		expect('catchAll' in result).toBe(false);
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
		expect(result.catchAll).toBe(true);
		expect(result.route.route.name).toBe('not-found');
		expect(result.route.path).toBe('/nowhere');
	});

	it.each(['push', 'replace'])('%s preserves the catch-all flag for reused routes and no-ops', async (verb) => {
		const { router } = await boot([
			{ path: '/', view: HomeView },
			{ path: '*', view: view('nf') },
		]);
		for (const path of ['/missing', '/other-missing', '/other-missing']) {
			const result = await router[verb](path);
			expect(result).toEqual({ ok: true, route: router.current, catchAll: true });
			expect(result.route.path).toBe(path);
		}
		expect(await router[verb]('/')).toEqual({ ok: true, route: router.current });
	});

	it('a redirect reports whether its final landing is the catch-all', async () => {
		const { router } = await boot([
			{ path: '/', view: HomeView },
			{ path: '/redirect', view: AboutView, guard: () => '/missing' },
			{ path: '*', view: view('nf') },
		]);
		expect(await router.push('/redirect')).toEqual({
			ok: true, route: router.current, catchAll: true, redirectedFrom: '/redirect',
		});
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

	it('a push back to the committed path while another navigation is in flight supersedes it', async () => {
		const slow = gated();
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/slow', name: 'slow', view: slow.View },
		]);

		const pSlow = router.push('/slow');
		const pHome = router.push('/');
		slow.release();

		expect(await pSlow).toEqual({ ok: false, reason: 'superseded' });
		expect(await pHome).toEqual({ ok: true, route: router.current });
		expect(router.current.path).toBe('/');

		const pSlow2 = router.push('/slow');
		const rHome = router.replace('/');
		expect(await pSlow2).toEqual({ ok: false, reason: 'superseded' });
		expect((await rHome).ok).toBe(true);
		expect(router.current.path).toBe('/');
	});

	it('a same-path push from created() of the view being loaded returns the in-flight result', async () => {
		let inner;
		let router;
		class X extends PuzzleView {
			created() {
				inner = router.push('/x');
			}
			async data() {
				await null;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'x' }, [text('X')]);
			}
		}
		({ router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/x', name: 'x', view: X },
		]));

		const outer = await router.push('/x');
		const result = await inner;

		expect(outer.ok).toBe(true);
		expect(result).toBe(outer);
		expect(result.route.path).toBe('/x');
	});

	it("a same-path push from created() whose navigation a sibling push supersedes resolves 'superseded'", async () => {
		let inner;
		let other;
		let router;
		class X extends PuzzleView {
			created() {
				inner = router.push('/x');
				other = router.push('/about');
			}
			render() {
				return h('puzzle-view', { class: 'x' }, [text('X')]);
			}
		}
		({ router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/x', name: 'x', view: X },
			{ path: '/about', name: 'about', view: AboutView },
		]));

		const outer = await router.push('/x');
		expect(outer).toEqual({ ok: false, reason: 'superseded' });
		expect((await other).ok).toBe(true);
		expect(await inner).toEqual({ ok: false, reason: 'superseded' });
		expect(router.current.path).toBe('/about');
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

	it("a throwing guard is reported and resolves 'error' with the error", async () => {
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

		expect(await router.push('/private')).toEqual({ ok: false, reason: 'error', error: failure });
		expect(errors).toEqual([failure]);
		expect(router.current.path).toBe('/');
	});

	it("the redirect cycle cap is reported and resolves 'error' with the cap's error", async () => {
		const errors = [];
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{ path: '/login', name: 'login', view: view('login'), guard: () => '/login' },
			],
			{ onError: (error) => errors.push(error) }
		);

		const result = await router.push('/login');

		expect(result.ok).toBe(false);
		expect(result.reason).toBe('error');
		expect(result.error).toBe(errors[0]);
		expect(errors).toHaveLength(1);
		expect(String(errors[0].message)).toMatch(/redirect limit exceeded/);
		expect(router.current.path).toBe('/');
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

	it('after a commit throw, a retry navigates again and the old path is not a stale no-op', async () => {
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
		const { router, el } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView, layout: FlakyLayout },
				{ path: '/about', name: 'about', view: AboutView, layout: FlakyLayout },
			],
			{ onError: () => {} }
		);

		throwOnUpdate = true;
		const first = await router.push('/about');
		expect(first.reason).toBe('error');

		// The latch is released: the retry is a fresh navigation that commits.
		const retry = await router.push('/about');
		expect(retry).not.toBe(first);
		expect(retry).toEqual({ ok: true, route: router.current });
		expect(router.current.path).toBe('/about');

		// And after a throw that left #state on '/' while the DOM moved, a push to
		// '/' rebuilds instead of claiming "already there".
		throwOnUpdate = true;
		expect((await router.push('/')).reason).toBe('error');
		const home = await router.push('/about');
		expect(home.ok).toBe(true);
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.home')).toBeNull();
	});

	it('a push that supersedes navigation zero resolves even when its commit throws', async () => {
		const failure = new Error('title setter boom');
		const slow = gated();
		history.replaceState({}, '', '/slow');
		const el = document.createElement('div');
		document.body.appendChild(el);
		const context = { store: null, router: null, formatters: null };
		const errors = [];
		setErrorConfig(context, (error) => errors.push(error), null);
		const router = new Router([
			{ path: '/slow', name: 'slow', view: slow.View },
			{ path: '/boom', name: 'boom', view: AboutView, meta: { title: 'Boom' } },
		]);
		context.router = router;
		routers.push({ router, context });
		const started = router.start(el, context);

		// #commitLocation's title sync throws inside the commit window. Nothing has
		// committed yet, but this is a push, not start()'s navigation: it resolves.
		vi.spyOn(document, 'title', 'set').mockImplementationOnce(() => {
			throw failure;
		});
		const result = await router.push('/boom');
		slow.release();
		await expect(started).resolves.toBe(router);

		expect(result).toEqual({ ok: false, reason: 'error', error: failure });
		expect(errors).toEqual([failure]);
	});

	it('a push after a blocked navigation zero resolves even when its commit throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('title setter boom');
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView, guard: () => false },
				{ path: '/about', name: 'about', view: AboutView, meta: { title: 'About' } },
			],
			{ onError: () => {} }
		);
		expect(router.current).toBeNull();

		vi.spyOn(document, 'title', 'set').mockImplementationOnce(() => {
			throw failure;
		});
		await expect(router.push('/about')).resolves.toEqual({ ok: false, reason: 'error', error: failure });
		await expect(router.replace('/about')).resolves.toMatchObject({ ok: true });
	});
});

describe('router.push() — the committed path when it is not a no-op (D182)', () => {
	// One test per row of D182's "target equals the committed path" table.
	const tick = () => new Promise((r) => setTimeout(r, 0));
	function loadingView(cls) {
		const View = class extends PuzzleView {
			static gate = null;
			static runs = 0;
			async data() {
				View.runs++;
				if (View.gate) await View.gate;
				return {};
			}
			render() {
				return h('puzzle-view', { class: cls }, [text(cls)]);
			}
		};
		return View;
	}

	it('row 1 — nothing in flight, chain intact: no-op, ok, data() not re-run', async () => {
		const A = loadingView('a');
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/a', name: 'a', view: A },
		]);
		await router.push('/a');
		const runs = A.runs;
		const before = history.length;

		expect(await router.push('/a')).toEqual({ ok: true, route: router.current });
		expect(A.runs).toBe(runs);
		expect(history.length).toBe(before);
	});

	it('row 3 — a replace in flight: superseded, rebuilt with replace semantics, history unchanged', async () => {
		const slow = gated();
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/slow', name: 'slow', view: slow.View },
		]);
		const before = history.length;

		const pSlow = router.replace('/slow');
		const pHome = router.push('/');
		slow.release();

		expect(await pSlow).toEqual({ ok: false, reason: 'superseded' });
		expect((await pHome).ok).toBe(true);
		expect(location.pathname).toBe('/');
		expect(history.length).toBe(before);
	});

	for (const [label, mode] of [
		['path', undefined],
		['hash', hashRouter()],
	]) {
		it(`row 4 — a pop in flight, ${label} mode: a normal push over the popped entry`, async () => {
			const Prev = loadingView('prev');
			const { router } = await boot(
				[
					{ path: '/', name: 'prev', view: Prev },
					{ path: '/a', name: 'a', view: AboutView },
				],
				{ mode }
			);
			await router.push('/a'); // history: [/, /a]
			const before = history.length;
			Prev.gate = new Promise(() => {}); // Back to / never finishes loading
			history.back();
			await tick();
			await tick();
			expect(router.current.path).toBe('/a'); // the pop is still loading

			const first = router.push('/a');
			const second = router.push('/a');
			expect(second).toBe(first);
			expect((await first).ok).toBe(true);
			expect(router.current.path).toBe('/a');
			// The popped / entry survives: [/, /a] again, not [/a, /a].
			expect(history.length).toBe(before);
			Prev.gate = null;
			history.back();
			await tick();
			await tick();
			await tick();
			expect(router.current.path).toBe('/');
		});
	}

	it('row 4 — a pop redirected by a guard is still a pop: the push keeps the popped entry', async () => {
		const Login = loadingView('login');
		let redirect = false;
		const { router } = await boot([
			{
				path: '/',
				name: 'home',
				view: HomeView,
				guard: () => (redirect ? ((redirect = false), '/login') : true),
			},
			{ path: '/login', name: 'login', view: Login },
			{ path: '/a', name: 'a', view: AboutView },
		]);
		await router.push('/a');
		Login.gate = new Promise(() => {}); // the redirect target never finishes loading
		redirect = true;
		history.back(); // pop to '/', whose guard redirects (as a replace) to /login
		await tick();
		await tick();
		expect(router.current.path).toBe('/a');
		expect(location.pathname).toBe('/'); // the browser stands on the popped entry

		const pushState = vi.spyOn(history, 'pushState');
		const replaceState = vi.spyOn(history, 'replaceState');
		expect((await router.push('/a')).ok).toBe(true);

		// An ordinary push over the popped entry, never a rewrite of it.
		expect(pushState).toHaveBeenCalledTimes(1);
		expect(replaceState.mock.calls.some(([, , url]) => url === '/a')).toBe(false);
		expect(router.current.path).toBe('/a');
		Login.gate = null;
	});

	it('row 6 — called twice: one promise and one data() run (push in flight, failed view, memory pop)', async () => {
		const A = loadingView('a');
		const Other = loadingView('other');
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/a', name: 'a', view: A },
			{ path: '/other', name: 'other', view: Other },
		]);
		await router.push('/a');

		// A push in flight.
		Other.gate = new Promise(() => {});
		router.push('/other');
		let release;
		A.gate = new Promise((r) => (release = r));
		const runs = A.runs;
		const p1 = router.push('/a');
		const p2 = router.push('/a');
		expect(p2).toBe(p1);
		release();
		expect((await p1).ok).toBe(true);
		expect(A.runs - runs).toBe(1);

		// Memory mode with a back() in flight.
		const M = loadingView('m');
		const mem = await boot(
			[
				{ path: '/m', name: 'm', view: M },
				{ path: '/a', name: 'a', view: AboutView },
			],
			{ mode: memoryRouter({ initialPath: '/m' }) }
		);
		await mem.router.push('/a');
		M.gate = new Promise(() => {});
		mem.router.back();
		const m1 = mem.router.push('/a');
		expect(mem.router.push('/a')).toBe(m1);
		expect((await m1).ok).toBe(true);
	});

	it('row 6 — after a failed view, a double click on the active link rebuilds once', async () => {
		let failing = true;
		let runs = 0;
		class Flaky extends PuzzleView {
			renderSkeleton() {
				return h('puzzle-view', {}, [text('…')]);
			}
			async data() {
				runs++;
				if (failing) throw new Error('data boom');
				await null;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'flaky' }, [text('OK')]);
			}
		}
		const { router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{ path: '/f', name: 'f', view: Flaky },
			],
			{ onError: () => {} }
		);
		await router.push('/f');
		await tick();
		failing = false;
		const before = runs;

		const p1 = router.push('/f');
		const p2 = router.push('/f');
		expect(p2).toBe(p1);
		await p1;
		await tick();
		expect(runs - before).toBe(1);
	});

	it('row 2 — a rebuild whose constructor throws is not latched: the next push retries', async () => {
		let failing = true;
		let throwing = false;
		let constructed = 0;
		class Flaky extends PuzzleView {
			constructor(ctx) {
				super(ctx);
				constructed++;
				if (throwing) throw new Error('constructor boom');
			}
			renderSkeleton() {
				return h('puzzle-view', {}, [text('…')]);
			}
			async data() {
				if (failing) throw new Error('data boom');
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'flaky' }, [text('OK')]);
			}
		}
		const { router, el } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{ path: '/f', name: 'f', view: Flaky },
			],
			{ onError: () => {} }
		);
		await router.push('/f'); // the skeleton commits, then data() fails: chain invalid
		await tick();
		throwing = true;
		expect(await router.push('/f')).toMatchObject({ ok: false, reason: 'error' });
		expect(constructed).toBe(2);

		failing = throwing = false;
		expect((await router.push('/f')).ok).toBe(true);
		await tick();
		expect(constructed).toBe(3);
		expect(el.querySelector('.flaky')).not.toBeNull();
	});

	it('row 3 — a push in flight: superseded, rebuilt with replace semantics, history unchanged', async () => {
		const slow = gated();
		const { router } = await boot([
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/slow', name: 'slow', view: slow.View },
		]);
		const before = history.length;

		const pSlow = router.push('/slow');
		const pHome = router.push('/');
		slow.release();

		expect(await pSlow).toEqual({ ok: false, reason: 'superseded' });
		expect((await pHome).ok).toBe(true);
		expect(router.current.path).toBe('/');
		expect(history.length).toBe(before);
	});

	it('row 2 — nothing in flight, chain invalid (failed view): rebuilt, history unchanged', async () => {
		let failing = true;
		let runs = 0;
		class Flaky extends PuzzleView {
			renderSkeleton() {
				return h('puzzle-view', { class: 'skeleton' }, [text('…')]);
			}
			async data() {
				runs++;
				if (failing) throw new Error('data boom');
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'flaky' }, [text('OK')]);
			}
		}
		const { router, el } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{ path: '/f', name: 'f', view: Flaky },
			],
			{ onError: () => {} }
		);
		await router.push('/f'); // a skeleton view commits, then its data() fails
		await new Promise((r) => setTimeout(r, 0));
		failing = false;
		const before = history.length;

		const result = await router.push('/f');
		await new Promise((r) => setTimeout(r, 0));

		expect(result.ok).toBe(true);
		expect(runs).toBe(2);
		expect(el.querySelector('.flaky')).not.toBeNull();
		expect(history.length).toBe(before);
	});

	it('row 5 — a pop in flight, memory mode: replace semantics, one stack entry', async () => {
		let release;
		let gate = Promise.resolve();
		class Prev extends PuzzleView {
			async data() {
				await gate;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'prev' }, [text('PREV')]);
			}
		}
		const { router } = await boot(
			[
				{ path: '/prev', name: 'prev', view: Prev },
				{ path: '/a', name: 'a', view: AboutView },
			],
			{ mode: memoryRouter({ initialPath: '/prev' }) }
		);
		await router.push('/a');
		gate = new Promise((r) => (release = r));

		const back = router.back(); // in flight to /prev
		const result = await router.push('/a');
		release();
		await back;

		expect(result.ok).toBe(true);
		expect(router.current.path).toBe('/a');
		// The stack is still [/prev, /a]: one back() reaches /prev, a second is a no-op.
		await router.back();
		expect(router.current.path).toBe('/prev');
		expect(router.back()).toBeUndefined();
	});

	// A push to the committed path rewrites the entry (replace semantics), and
	// #navigate runs synchronously into created() when the route has no guards or
	// lazy(). A same-path push from that created() must join the rebuild, exactly
	// as it joins a plain push ('a same-path push from created() of the view
	// being loaded returns the in-flight result', above).
	it('a same-path push from created() during a rebuild over a navigation in flight shares its result', async () => {
		const waapi = installFakeAnimate();
		try {
			let router;
			let armed = false;
			let inner = null;
			let release;
			const gate = new Promise((r) => (release = r));
			class Home extends PuzzleView {
				animations = { out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 } };
				created() {
					if (armed && !inner) inner = router.push('/');
				}
				async data() {
					if (armed) {
						await gate;
						throw new Error('rebuild failed');
					}
					return {};
				}
				render() {
					return h('puzzle-view', { class: 'home' }, [text('HOME')]);
				}
			}
			({ router } = await boot(
				[
					{ path: '/', name: 'home', view: Home },
					{ path: '/about', name: 'about', view: AboutView },
				],
				{ onError: () => {} }
			));
			router.push('/about'); // Home's out animation holds this navigation in flight
			for (let i = 0; i < 4; i++) await tick();
			armed = true;
			const outer = router.push('/'); // the committed path with a navigation in flight: a rebuild
			let early = null;
			inner.then((r) => (early ??= r));
			await tick();
			expect(early).toBeNull(); // not the old snapshot's { ok: true }
			release();
			for (let i = 0; i < 8; i++) {
				waapi.finishAll();
				await tick();
			}
			expect(await outer).toMatchObject({ ok: false, reason: 'error' });
			expect(await inner).toBe(await outer);
		} finally {
			waapi.uninstall();
		}
	});

	it('a same-path push from created() during a rebuild over an invalidated chain joins it once', async () => {
		let router;
		let failing = true;
		let armed = false;
		let created = 0;
		let inner = null;
		class Flaky extends PuzzleView {
			renderSkeleton() {
				return h('puzzle-view', {}, [text('…')]);
			}
			created() {
				created++;
				// Capped so a regression fails the count instead of overflowing the stack.
				if (armed && created < 10) inner ??= router.push('/f');
			}
			async data() {
				if (failing) throw new Error('boom');
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'flaky' }, [text('OK')]);
			}
		}
		({ router } = await boot(
			[
				{ path: '/', name: 'home', view: HomeView },
				{ path: '/f', name: 'f', view: Flaky },
			],
			{ onError: () => {} }
		));
		await router.push('/f'); // the skeleton commits, data() fails: the chain is invalid
		await tick();
		failing = false;
		armed = true;
		created = 0;
		const outer = await router.push('/f');
		expect(created).toBe(1);
		expect(outer.ok).toBe(true);
		expect(await inner).toBe(outer);
		expect(router.current.path).toBe('/f');
	});
});

describe('router.push() — pops during navigation zero (D182)', () => {
	it('a popped route whose guard throws during a guarded navigation zero is reported, not a crash', async () => {
		let allow;
		const errors = [];
		const failure = new Error('guard boom');
		history.replaceState({}, '', '/slow');
		const el = document.createElement('div');
		document.body.appendChild(el);
		const context = { store: null, router: null, formatters: null };
		setErrorConfig(context, (error) => errors.push(error), null);
		const router = new Router([
			{
				path: '/slow',
				name: 'slow',
				view: view('slow'),
				guard: () => new Promise((r) => (allow = r)),
			},
			{
				path: '/bad',
				name: 'bad',
				view: view('bad'),
				guard: () => {
					throw failure;
				},
			},
		]);
		context.router = router;
		routers.push({ router, context });
		const started = router.start(el, context);
		await new Promise((r) => setTimeout(r, 0));

		// The browser moves to /bad and fires popstate while nothing is committed.
		history.pushState({}, '', '/bad');
		window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
		await new Promise((r) => setTimeout(r, 0));
		allow(true);

		await expect(started).resolves.toBe(router);
		expect(errors).toEqual([failure]);
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

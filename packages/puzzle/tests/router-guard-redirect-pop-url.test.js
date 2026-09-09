// @vitest-environment jsdom
//
// The guard-redirect arm of the failed-POP URL invariant (companion to
// router-failed-pop-url.test.js). A redirect that never commits leaves the
// address bar on the guarded entry the browser already moved to, so the
// continuation repairs it — but ONLY while the redirect chain still owns the
// location. The chain re-enters #navigate through replace(), which bumps the
// cancellation token unconditionally, so a bare `token === this.#token` check
// would disable every legitimate repair; the router tracks the token the CHAIN
// itself claims (its own re-entry re-stamps it) and compares against that. A
// newer pop still in its load phase shares the same committed `#state`, and a
// pop commit writes no URL of its own, so an unguarded replaceState here would
// strand the address bar permanently.
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
const settle = async (n = 4) => {
	for (let i = 0; i < n; i++) await tick();
};
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};

const viewClass = (className, label) =>
	class extends PuzzleView {
		render() {
			return h('puzzle-view', { class: className }, [text(label)]);
		}
	};

const HomeView = viewClass('home', 'HOME');
const GuardedView = viewClass('guarded', 'GUARDED');
const RedirectView = viewClass('redirect', 'REDIRECT');
const WinnerView = viewClass('winner', 'WINNER');

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

/**
 * Traverse onto another history entry the way a browser does: URL and state move
 * FIRST, then popstate fires. replaceState (not pushState) keeps history.length
 * still, so the "no new entry" assertions measure the repair and nothing else.
 * `startTraverse` returns without settling so a second navigation can overlap it.
 */
function startTraverse(path) {
	history.replaceState(history.state, '', path);
	window.dispatchEvent(new PopStateEvent('popstate'));
}

async function traverseTo(path) {
	startTraverse(path);
	await settle();
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

describe('a superseded guard redirect leaves the winner URL alone', () => {
	it('does not repair the URL when a newer POP is still loading', async () => {
		const failure = new Error('redirect chunk 404');
		const redirectLoad = deferred();
		const winnerData = deferred();
		const errors = [];

		class SlowWinnerView extends PuzzleView {
			async data() {
				await winnerData.promise;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'winner' }, [text('WINNER')]);
			}
		}

		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => '/redirect' },
				{
					path: '/redirect',
					view: lazy(() => redirectLoad.promise),
					layout: DefaultLayout,
				},
				{ path: '/winner', view: SlowWinnerView, layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		// Pop onto the guarded entry: its guard redirects, and the redirect's lazy
		// marker is still downloading.
		startTraverse('/guarded');
		await settle();

		// A second pop supersedes the whole redirect chain while it is in flight.
		startTraverse('/winner');
		await settle();

		// The loser's redirect target fails during the winner's load phase, when
		// #state is still the home route both navigations started from.
		redirectLoad.reject(failure);
		await settle();

		winnerData.resolve();
		await settle();

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
		expect(router.current.path).toBe('/winner');
		expect(el.querySelector('.winner')).not.toBeNull();
		// The stranded address bar was the bug: the loser must not drag the URL back
		// to the route the winner already left.
		expect(location.pathname).toBe('/winner');
	});

	it('does not repair the URL when a newer PUSH is still loading', async () => {
		const failure = new Error('redirect chunk 404');
		const redirectLoad = deferred();
		const winnerData = deferred();
		const errors = [];

		class SlowWinnerView extends PuzzleView {
			async data() {
				await winnerData.promise;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'winner' }, [text('WINNER')]);
			}
		}

		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => '/redirect' },
				{
					path: '/redirect',
					view: lazy(() => redirectLoad.promise),
					layout: DefaultLayout,
				},
				{ path: '/winner', view: SlowWinnerView, layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		startTraverse('/guarded');
		await settle();

		const pushed = router.push('/winner');
		await settle();

		// The push has not committed yet (pushState fires at commit), so the URL is
		// still '/guarded' — a stale repair here would be masked by the later commit.
		// Watch the repair itself instead of only its end state.
		const replaceSpy = vi.spyOn(history, 'replaceState');
		redirectLoad.reject(failure);
		await settle();
		expect(replaceSpy).not.toHaveBeenCalled();
		replaceSpy.mockRestore();

		winnerData.resolve();
		await pushed;
		await settle();

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure });
		expect(router.current.path).toBe('/winner');
		expect(el.querySelector('.winner')).not.toBeNull();
		expect(location.pathname).toBe('/winner');
	});
});

describe('a guard redirect that still owns the location repairs the URL', () => {
	it('repairs when the redirect target fails to load', async () => {
		const failure = new Error('redirect chunk 404');
		const redirectLoad = deferred();
		const errors = [];
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => '/redirect' },
				{
					path: '/redirect',
					view: lazy(() => redirectLoad.promise),
					layout: DefaultLayout,
				},
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);
		const entries = history.length;

		startTraverse('/guarded');
		await settle();
		redirectLoad.reject(failure);
		await settle();

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure });
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(location.pathname).toBe('/');
		expect(history.length).toBe(entries);
	});

	it('repairs when the redirect target matches no route', async () => {
		const { router, el } = await boot([
			{ path: '/', view: HomeView, layout: DefaultLayout },
			{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => '/nowhere' },
		]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const entries = history.length;

		await traverseTo('/guarded');

		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(location.pathname).toBe('/');
		expect(history.length).toBe(entries);
		warn.mockRestore();
	});

	it('repairs when the guard blocks the pop outright', async () => {
		const { router, el } = await boot([
			{ path: '/', view: HomeView, layout: DefaultLayout },
			{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => false },
		]);
		const entries = history.length;

		await traverseTo('/guarded');

		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.guarded')).toBeNull();
		expect(location.pathname).toBe('/');
		expect(history.length).toBe(entries);
	});
});

describe('a committed guard redirect keeps the redirect target URL', () => {
	it('leaves the URL on the redirect target and fires no repair', async () => {
		const { router, el } = await boot([
			{ path: '/', view: HomeView, layout: DefaultLayout },
			{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => '/redirect' },
			{ path: '/redirect', view: RedirectView, layout: DefaultLayout },
		]);

		await traverseTo('/guarded');

		expect(router.current.path).toBe('/redirect');
		expect(el.querySelector('.redirect')).not.toBeNull();
		expect(location.pathname).toBe('/redirect');
	});

	it('follows a nested redirect chain to its end', async () => {
		// guard → /a, /a's guard → /b. The chain re-enters #navigate twice, so its
		// own token changes twice; that must not read as external supersession (which
		// would suppress a legitimate repair) nor as continued ownership after a real
		// one (which would strand the URL).
		const { router, el } = await boot([
			{ path: '/', view: HomeView, layout: DefaultLayout },
			{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => '/a' },
			{ path: '/a', view: RedirectView, layout: DefaultLayout, guard: () => '/b' },
			{ path: '/b', view: WinnerView, layout: DefaultLayout },
		]);

		await traverseTo('/guarded');

		expect(router.current.path).toBe('/b');
		expect(el.querySelector('.winner')).not.toBeNull();
		expect(location.pathname).toBe('/b');
	});

	it('repairs when a nested redirect chain fails at its last hop', async () => {
		const failure = new Error('chunk 404');
		const load = deferred();
		const errors = [];
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/guarded', view: GuardedView, layout: DefaultLayout, guard: () => '/a' },
				{ path: '/a', view: RedirectView, layout: DefaultLayout, guard: () => '/b' },
				{ path: '/b', view: lazy(() => load.promise), layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		startTraverse('/guarded');
		await settle();
		load.reject(failure);
		await settle();

		expect(errors).toHaveLength(1);
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(location.pathname).toBe('/');
	});
});

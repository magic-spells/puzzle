// @vitest-environment jsdom
//
// The failed-navigation invariant, stated for POPSTATE: after any failure the
// address bar matches the mounted tree. A push never moved the URL (pushState
// fires at commit, D61), so staying put is already correct there. A POP is the
// asymmetric case — the browser moved the address bar BEFORE the router ran, so
// a failure that leaves the tree on the committed route has to put the URL back,
// or a reload lands on a page the app was not showing.
//
// The guard paths (blocked guard, no-op guard redirect) always did this through
// #restoreCommittedUrl. These three cover the other three ways a pop can fail
// pre-commit: a lazy marker whose loader rejects (D163), a view constructor /
// field-initializer throw, and a data() rejection. The repair is a replaceState,
// so it must never add a history entry.
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

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
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

/**
 * Traverse onto another history entry the way a browser does: the URL and state
 * move FIRST, then popstate fires. replaceState (not pushState) keeps
 * history.length still, so the "no new entry" assertions below measure the
 * router's repair and nothing else.
 */
async function traverseTo(path) {
	history.replaceState(history.state, '', path);
	window.dispatchEvent(new PopStateEvent('popstate'));
	await tick();
	await tick();
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

describe('a failed popstate restores the committed URL', () => {
	it('puts the URL back when a lazy route view fails to load', async () => {
		const failure = new Error('chunk 404');
		const errors = [];
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{
					path: '/lazy',
					view: lazy(() => Promise.reject(failure)),
					layout: DefaultLayout,
				},
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);
		const entries = history.length;

		await traverseTo('/lazy');

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(location.pathname).toBe('/');
		expect(history.length).toBe(entries);
	});

	it('puts the URL back when a routed view constructor throws', async () => {
		const failure = new Error('field initializer blew up');
		const errors = [];
		class BoomView extends PuzzleView {
			boom = (() => {
				throw failure;
			})();
			render() {
				return h('puzzle-view', { class: 'boom' }, [text('BOOM')]);
			}
		}
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/boom', view: BoomView, layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);
		const entries = history.length;

		await traverseTo('/boom');

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure, info: { phase: 'navigation' } });
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.boom')).toBeNull();
		expect(location.pathname).toBe('/');
		expect(history.length).toBe(entries);
	});

	it('puts the URL back when a routed view data() rejects', async () => {
		const failure = new Error('load failed');
		const errors = [];
		class DataBoomView extends PuzzleView {
			async data() {
				throw failure;
			}
			render() {
				return h('puzzle-view', { class: 'databoom' }, [text('DATA')]);
			}
		}
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/databoom', view: DataBoomView, layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);
		const entries = history.length;

		await traverseTo('/databoom');

		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0]).toMatchObject({ error: failure });
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.databoom')).toBeNull();
		expect(location.pathname).toBe('/');
		expect(history.length).toBe(entries);
	});

	it('does not fire the repair on a failed PUSH', async () => {
		const failure = new Error('field initializer blew up');
		const errors = [];
		class BoomView extends PuzzleView {
			boom = (() => {
				throw failure;
			})();
			render() {
				return h('puzzle-view', { class: 'boom' }, [text('BOOM')]);
			}
		}
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{ path: '/boom', view: BoomView, layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);
		// Move off the root so a repair, if one wrongly fired, would be visible as a
		// URL change rather than a no-op back to the path we already sit on.
		await router.push('/');
		const replaceSpy = vi.spyOn(history, 'replaceState');

		await router.push('/boom');

		expect(errors).toHaveLength(1);
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		// A push never moved the URL in the first place (pushState fires at commit,
		// D61), so there is nothing to put back — the repair must not run at all.
		expect(replaceSpy).not.toHaveBeenCalled();
		expect(location.pathname).toBe('/');
		replaceSpy.mockRestore();
	});
});

// The repair is a replaceState, and #commitLocation writes NO url for a pop
// commit — so an unguarded repair from a superseded navigation wins permanently.
// `#state === cur` cannot catch that on its own: a newer pop still in its load
// phase has not committed yet, so it shares the same `cur`. The token is what
// separates them.
describe('a superseded failed pop leaves the winner URL alone', () => {
	it('does not restore the URL when a newer pop is still loading', async () => {
		const failure = new Error('chunk 404');
		const errors = [];
		class SlowView extends PuzzleView {
			async data() {
				await new Promise((r) => setTimeout(r, 30));
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'slow' }, [text('SLOW')]);
			}
		}
		const { router, el } = await boot(
			[
				{ path: '/', view: HomeView, layout: DefaultLayout },
				{
					path: '/lazy',
					view: lazy(
						() =>
							new Promise((_, reject) => {
								setTimeout(() => reject(failure), 10);
							})
					),
					layout: DefaultLayout,
				},
				{ path: '/slow', view: SlowView, layout: DefaultLayout },
			],
			{ onError: (error, info) => errors.push({ error, info }) }
		);

		// Pop onto the lazy route; its loader has not rejected yet.
		history.replaceState(history.state, '', '/lazy');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await new Promise((r) => setTimeout(r, 0));

		// A second pop supersedes it while the first is still in flight. The loser's
		// rejection lands during the winner's load phase, when #state is still the
		// home route both navigations started from.
		history.replaceState(history.state, '', '/slow');
		window.dispatchEvent(new PopStateEvent('popstate'));

		await new Promise((r) => setTimeout(r, 120));

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ error: failure });
		expect(router.current.path).toBe('/slow');
		expect(el.querySelector('.slow')).not.toBeNull();
		// The loser must not have dragged the address bar back to the route the
		// winner already left.
		expect(location.pathname).toBe('/slow');
	});
});

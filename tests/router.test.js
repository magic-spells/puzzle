// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

// Hand-written stand-ins for what the compiler emits: a view/layout render()
// returns a ViewNode tree, `<Slot/>` is a SLOT_TAG node, and a routed view is a
// <puzzle-view> root element (D20).
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setTimeout(r, 0));

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

const ctx = (store = null) => ({ store, router: null, formatters: null });

// A layout with a single <Slot/> the routed view renders into.
class DefaultLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [
			h('header', {}, [text('HEADER')]),
			h('main', {}, [slot()]),
		]);
	}
}

class HomeView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'home' }, [text('HOME')]);
	}
}

class AboutView extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
	}
}

// Track live routers so listeners never leak into the next test.
let routers = [];
async function boot(routes, ctxObj = ctx()) {
	const el = container();
	const router = new Router(routes);
	routers.push(router);
	await router.start(el, ctxObj);
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
	document.title = '';
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
});

describe('Router — initial navigation (D19)', () => {
	it('renders the initial route view inside its layout at location.pathname', async () => {
		const routes = [{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }];
		const { el } = await boot(routes);

		expect(el.querySelector('.layout')).not.toBeNull();
		expect(el.querySelector('.layout main .home')).not.toBeNull();
		expect(el.textContent).toContain('HEADER');
		expect(el.textContent).toContain('HOME');
	});

	it('does not pushState on the initial navigation', async () => {
		const spy = vi.spyOn(history, 'pushState');
		await boot([{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout }]);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('Router — commit ordering (D19)', () => {
	class SlowView extends PuzzleView {
		async data() {
			await delay(15);
			return { msg: 'SLOW' };
		}
		render() {
			return h('puzzle-view', { class: 'slow' }, [text(this.getData().msg ?? '')]);
		}
	}

	it('push() updates the URL only AFTER async data() resolves', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/slow', name: 'slow', view: SlowView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);

		const p = router.push('/slow');
		// mid-flight: data() has not resolved, so nothing committed
		expect(location.pathname).toBe('/');
		expect(el.querySelector('.slow')).toBeNull();

		await p;
		expect(location.pathname).toBe('/slow');
		expect(el.querySelector('.slow')).not.toBeNull();
		expect(el.textContent).toContain('SLOW');
	});

	it('a rejecting data() leaves URL and current view untouched, logs, adds no history entry', async () => {
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/bad', name: 'bad', view: BadView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const pushSpy = vi.spyOn(history, 'pushState');

		await router.push('/bad');

		expect(location.pathname).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.bad')).toBeNull();
		expect(router.current.route.name).toBe('home');
		expect(errSpy).toHaveBeenCalled();
		expect(pushSpy).not.toHaveBeenCalled();

		errSpy.mockRestore();
		pushSpy.mockRestore();
	});

	it('a standalone failing navigation destroys its fresh instances; a subsequent navigation works', async () => {
		let badDestroyed = 0;
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			destroyed() {
				badDestroyed++;
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
			{ path: '/bad', name: 'bad', view: BadView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await router.push('/bad');
		expect(badDestroyed).toBe(1); // the failing nav's fresh instance, torn down
		expect(router.current.route.name).toBe('home'); // state unchanged
		expect(el.querySelector('.home')).not.toBeNull();

		await router.push('/about'); // navigation pipeline unaffected afterwards
		expect(router.current.route.name).toBe('about');
		expect(el.querySelector('.about')).not.toBeNull();
		errSpy.mockRestore();
	});
});

describe('Router — cancellation (D19, monotonic token)', () => {
	it('rapid double-push: last wins, the first view never mounts and is destroyed', async () => {
		let aMounted = 0;
		let aDestroyed = 0;
		class ViewA extends PuzzleView {
			async data() {
				await delay(30);
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'a' }, [text('A')]);
			}
			mounted() {
				aMounted++;
			}
			destroyed() {
				aDestroyed++;
			}
		}
		class ViewB extends PuzzleView {
			async data() {
				await delay(5);
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'b' }, [text('B')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/a', name: 'a', view: ViewA, layout: DefaultLayout },
			{ path: '/b', name: 'b', view: ViewB, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);

		const pa = router.push('/a');
		const pb = router.push('/b');
		await Promise.all([pa, pb]);
		// let ViewA's slow data() land after B already committed
		await delay(40);

		expect(location.pathname).toBe('/b');
		expect(el.querySelector('.b')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();
		expect(aMounted).toBe(0);
		expect(aDestroyed).toBe(1);
	});
});

describe('Router — route guards (D87)', () => {
	const guardedRoutes = (guard) => [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/private', name: 'private', view: AboutView, layout: DefaultLayout, guard },
		{ path: '/login', name: 'login', view: HomeView, layout: DefaultLayout },
	];

	it('allows undefined/true verdicts and passes frozen { to, from, ctx } snapshots', async () => {
		const seen = [];
		const ctxObj = ctx();
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/account',
				name: 'account',
				view: DefaultLayout,
				layout: DefaultLayout,
				guard(nav) {
					seen.push(nav);
				},
				children: [
					{
						path: 'profile',
						name: 'profile',
						view: AboutView,
						guard() {
							return true;
						},
					},
				],
			},
		];
		const { router, el } = await boot(routes, ctxObj);

		await router.push('/account/profile');

		expect(router.current.path).toBe('/account/profile');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(seen).toHaveLength(1);
		expect(seen[0].ctx).toBe(ctxObj);
		expect(seen[0].to.path).toBe('/account/profile');
		expect(seen[0].from.path).toBe('/');
		expect(Object.isFrozen(seen[0].to)).toBe(true);
		expect(Object.isFrozen(seen[0].from)).toBe(true);
	});

	it('blocks without constructing the denied view or committing URL/history/state', async () => {
		let constructed = 0;
		class DeniedView extends PuzzleView {
			constructor(...args) {
				super(...args);
				constructed++;
			}
			render() {
				return h('puzzle-view', { class: 'denied' }, [text('DENIED')]);
			}
		}
		const routes = guardedRoutes(() => false);
		routes[1].view = DeniedView;
		const { router, el } = await boot(routes);
		const pushSpy = vi.spyOn(history, 'pushState');

		await router.push('/private');

		expect(constructed).toBe(0);
		expect(location.pathname).toBe('/');
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(el.querySelector('.denied')).toBeNull();
		expect(pushSpy).not.toHaveBeenCalled();
		pushSpy.mockRestore();
	});

	it('redirects through replace(), so the denied URL never becomes a history entry', async () => {
		const { router, el } = await boot(guardedRoutes(() => '/login'));
		const length = history.length;
		const pushSpy = vi.spyOn(history, 'pushState');
		const replaceSpy = vi.spyOn(history, 'replaceState');

		await router.push('/private');

		expect(router.current.path).toBe('/login');
		expect(location.pathname).toBe('/login');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(history.length).toBe(length);
		expect(pushSpy).not.toHaveBeenCalled();
		expect(replaceSpy).toHaveBeenCalledTimes(1);
		expect(replaceSpy.mock.calls[0][2]).toBe('/login');
		pushSpy.mockRestore();
		replaceSpy.mockRestore();
	});

	it('composes parent auth then child admin guards in root→leaf order', async () => {
		const order = [];
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/account',
				name: 'account',
				view: DefaultLayout,
				layout: DefaultLayout,
				guard() {
					order.push('auth');
				},
				children: [
					{
						path: 'admin',
						name: 'admin',
						view: AboutView,
						guard() {
							order.push('admin');
						},
					},
				],
			},
		];
		const { router } = await boot(routes);

		await router.push('/account/admin');

		expect(order).toEqual(['auth', 'admin']);
		expect(router.current.route.name).toBe('admin');
	});

	it('short-circuits the inherited chain on the first blocking guard', async () => {
		const order = [];
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/account',
				name: 'account',
				view: DefaultLayout,
				layout: DefaultLayout,
				guard() {
					order.push('auth');
					return false;
				},
				children: [
					{
						path: 'admin',
						name: 'admin',
						view: AboutView,
						guard() {
							order.push('admin');
						},
					},
				],
			},
		];
		const { router } = await boot(routes);

		await router.push('/account/admin');

		expect(order).toEqual(['auth']);
		expect(router.current.path).toBe('/');
	});

	it('awaits an async guard, then silently abandons it when a newer navigation wins', async () => {
		let release;
		const held = new Promise((resolve) => {
			release = resolve;
		});
		let constructed = 0;
		class SlowGuardView extends PuzzleView {
			constructor(...args) {
				super(...args);
				constructed++;
			}
			render() {
				return h('puzzle-view', { class: 'slow-guard' }, [text('SLOW')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/slow',
				name: 'slow',
				view: SlowGuardView,
				layout: DefaultLayout,
				async guard() {
					await held;
				},
			},
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);

		const slow = router.push('/slow');
		await tick();
		expect(constructed).toBe(0);
		const newer = router.push('/about');
		release();
		await Promise.all([slow, newer]);

		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.slow-guard')).toBeNull();
		expect(constructed).toBe(0);
	});

	it('redirects on navigation #0 with from === null', async () => {
		history.replaceState({}, '', '/private');
		let seenFrom = 'unset';
		let seenTo = null;
		const routes = guardedRoutes(({ to, from }) => {
			seenFrom = from;
			seenTo = to;
			return '/login';
		});

		const { router } = await boot(routes);

		expect(seenFrom).toBeNull();
		expect(seenTo.path).toBe('/private');
		expect(Object.isFrozen(seenTo)).toBe(true);
		expect(router.current.path).toBe('/login');
		expect(location.pathname).toBe('/login');
	});

	it('re-runs guards on params-only navigation', async () => {
		history.replaceState({}, '', '/user/1');
		const ids = [];
		const routes = [
			{
				path: '/user/:id',
				name: 'user',
				view: AboutView,
				layout: DefaultLayout,
				guard({ to }) {
					ids.push(to.params.id);
				},
			},
		];
		const { router } = await boot(routes);

		await router.push('/user/2');

		expect(ids).toEqual(['1', '2']);
		expect(router.current.params.id).toBe('2');
	});

	it('treats a thrown guard like a data() failure: logs and stays put', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { router, el } = await boot(
			guardedRoutes(() => {
				throw new Error('nope');
			})
		);

		await router.push('/private');

		expect(router.current.path).toBe('/');
		expect(location.pathname).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] navigation guard failed:',
			expect.objectContaining({ message: 'nope' })
		);
		errSpy.mockRestore();
	});

	it('leaves a blocked browser pop on the committed view without URL resync', async () => {
		let allowed = true;
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/private',
				name: 'private',
				view: AboutView,
				layout: DefaultLayout,
				guard() {
					return allowed;
				},
			},
			{ path: '/after', name: 'after', view: HomeView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		await router.push('/private');
		await router.push('/after');
		allowed = false;

		history.back();
		await delay(20);

		// The browser already moved before popstate. D87 deliberately shares the
		// existing data()-failure asymmetry: no URL rewrite, but nothing commits.
		expect(location.pathname).toBe('/private');
		expect(router.current.path).toBe('/after');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('self-heals a redirected browser pop because replace() rewrites the moved entry', async () => {
		let redirect = false;
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/private',
				name: 'private',
				view: AboutView,
				layout: DefaultLayout,
				guard() {
					return redirect ? '/login' : undefined;
				},
			},
			{ path: '/after', name: 'after', view: AboutView, layout: DefaultLayout },
			{ path: '/login', name: 'login', view: HomeView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		await router.push('/private');
		await router.push('/after');
		redirect = true;

		history.back();
		await delay(20);

		expect(location.pathname).toBe('/login');
		expect(router.current.path).toBe('/login');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('rejects non-function guards at construction, including child and catch-all routes', () => {
		expect(
			() =>
				new Router([
					{ path: '/', name: 'bad', view: HomeView, layout: DefaultLayout, guard: 'nope' },
				])
		).toThrow(/guard on route "\/" must be a function/);
		expect(
			() =>
				new Router([
					{
						path: '/parent',
						name: 'parent',
						view: HomeView,
						layout: DefaultLayout,
						children: [{ path: 'child', name: 'child', view: AboutView, guard: false }],
					},
				])
		).toThrow(/guard on route "child" must be a function/);
		expect(
			() =>
				new Router([
					{ path: '*', name: 'bad-catch', view: HomeView, layout: DefaultLayout, guard: {} },
				])
		).toThrow(/guard on the catch-all route must be a function/);
	});
});

describe('Router — same-path push is a no-op (v-next)', () => {
	it('a push byte-identical to the committed path adds no history entry and does not re-run data()', async () => {
		let dataRuns = 0;
		class CountView extends PuzzleView {
			data() {
				dataRuns++;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'count' }, [text('COUNT')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/count', name: 'count', view: CountView, layout: DefaultLayout },
		];
		const { router } = await boot(routes);
		await router.push('/count'); // real navigation — data() runs once
		expect(dataRuns).toBe(1);

		const pushSpy = vi.spyOn(history, 'pushState');
		await router.push('/count'); // byte-identical to the committed path → no-op
		expect(pushSpy).not.toHaveBeenCalled();
		expect(dataRuns).toBe(1); // data() was NOT re-run
		expect(router.current.path).toBe('/count');
		pushSpy.mockRestore();
	});

	it('pushing the SAME anchor twice is a no-op; a DIFFERENT anchor still navigates', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/docs', name: 'docs', view: AboutView, layout: DefaultLayout },
		];
		const { router } = await boot(routes);
		await router.push('/docs#faq');

		const noopSpy = vi.spyOn(history, 'pushState');
		await router.push('/docs#faq'); // byte-identical (path + anchor) → no-op
		expect(noopSpy).not.toHaveBeenCalled();
		expect(router.current.path).toBe('/docs#faq');
		noopSpy.mockRestore();

		const navSpy = vi.spyOn(history, 'pushState');
		await router.push('/docs#top'); // same path, DIFFERENT anchor → real navigation
		expect(navSpy).toHaveBeenCalledTimes(1);
		expect(router.current.path).toBe('/docs#top');
		navSpy.mockRestore();
	});

	it('a single trailing slash is insignificant: state "/docs/" + push("/docs") is a no-op', async () => {
		// Reproduces the SSG bug: a page hosted at the directory URL '/docs/' commits
		// #state.path === '/docs/' (trailing slash preserved), and a nav link
		// push('/docs') must NOT re-navigate on every click.
		let dataRuns = 0;
		class DocsView extends PuzzleView {
			data() {
				dataRuns++;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'docs' }, [text('DOCS')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/docs', name: 'docs', view: DocsView, layout: DefaultLayout },
		];
		const { router } = await boot(routes);
		await router.push('/docs/'); // land at the directory URL — #state.path keeps the slash
		expect(dataRuns).toBe(1);
		expect(router.current.path).toBe('/docs/');

		const pushSpy = vi.spyOn(history, 'pushState');
		await router.push('/docs'); // slashless — matches after normalization → no-op
		expect(pushSpy).not.toHaveBeenCalled();
		expect(dataRuns).toBe(1);
		expect(router.current.path).toBe('/docs/');
		pushSpy.mockRestore();
	});

	it('the reverse also holds: state "/docs" + push("/docs/") is a no-op', async () => {
		let dataRuns = 0;
		class DocsView extends PuzzleView {
			data() {
				dataRuns++;
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'docs' }, [text('DOCS')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/docs', name: 'docs', view: DocsView, layout: DefaultLayout },
		];
		const { router } = await boot(routes);
		await router.push('/docs');
		expect(dataRuns).toBe(1);

		const pushSpy = vi.spyOn(history, 'pushState');
		await router.push('/docs/'); // trailing slash — normalizes to the committed path → no-op
		expect(pushSpy).not.toHaveBeenCalled();
		expect(dataRuns).toBe(1);
		expect(router.current.path).toBe('/docs');
		pushSpy.mockRestore();
	});

	it('root "/" is unaffected (never stripped) and a genuinely different path still navigates', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/docs', name: 'docs', view: AboutView, layout: DefaultLayout },
		];
		const { router } = await boot(routes);
		// At '/', push('/') is a no-op — the root slash is never trimmed to ''.
		const rootSpy = vi.spyOn(history, 'pushState');
		await router.push('/');
		expect(rootSpy).not.toHaveBeenCalled();
		expect(router.current.path).toBe('/');
		rootSpy.mockRestore();

		// Land at the directory URL, then a DIFFERENT path still navigates.
		await router.push('/docs/');
		expect(router.current.path).toBe('/docs/');
		const navSpy = vi.spyOn(history, 'pushState');
		await router.push('/');
		expect(navSpy).toHaveBeenCalledTimes(1);
		expect(router.current.path).toBe('/');
		navSpy.mockRestore();
	});

	it('/user/1 → /user/2 params-only refresh still works (only byte-identical short-circuits)', async () => {
		let seen;
		class UserView extends PuzzleView {
			data(params) {
				seen = params.id;
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', { class: 'user' }, [text('user ' + this.getData().id)]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		await router.push('/user/1');
		expect(seen).toBe('1');

		await router.push('/user/2'); // different rawPath, same route → params-only refresh
		expect(seen).toBe('2');
		expect(el.textContent).toContain('user 2');
		expect(router.current.path).toBe('/user/2');
	});
});

describe('Router — matching', () => {
	it('a catch-all path:"*" route matches unknown paths (checked last)', async () => {
		class NotFound extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'nf' }, [text('404')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: '404' } },
		];
		const { router, el } = await boot(routes);
		expect(el.querySelector('.home')).not.toBeNull();

		await router.push('/nope/does/not/exist');
		expect(el.querySelector('.nf')).not.toBeNull();
		expect(router.current.route.name).toBe('not-found');
		expect(location.pathname).toBe('/nope/does/not/exist');
	});

	it('decodes URI-encoded param values', async () => {
		let seen;
		class UserView extends PuzzleView {
			data(params) {
				seen = params.id;
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', {}, [text(this.getData().id)]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
		];
		const { router } = await boot(routes);
		await router.push('/user/a%20b');
		expect(seen).toBe('a b');
	});
});

describe('Router — params-only change (D19 §5)', () => {
	it('reuses the same view instance, re-running data() with the new params', async () => {
		const created = [];
		const seenParams = [];
		class UserView extends PuzzleView {
			created() {
				created.push(this);
			}
			data(params) {
				seenParams.push(params.id);
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', { class: 'user' }, [text('user ' + this.getData().id)]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);

		await router.push('/user/42');
		await router.push('/user/7');

		expect(created).toHaveLength(1); // instantiated once
		expect(seenParams).toEqual(['42', '7']); // data() ran per param change
		expect(el.textContent).toContain('user 7');
		expect(location.pathname).toBe('/user/7');
	});

	it('a rejecting data() on a params-only change leaves the URL untouched (D19)', async () => {
		class UserView extends PuzzleView {
			async data(params) {
				if (params.id === 'bad') throw new Error('boom');
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', { class: 'user' }, [text('user ' + this.getData().id)]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		await router.push('/user/42');

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const pushSpy = vi.spyOn(history, 'pushState');

		await router.push('/user/bad'); // must not throw out of push()

		expect(location.pathname).toBe('/user/42'); // URL never moved
		expect(pushSpy).not.toHaveBeenCalled();
		expect(el.textContent).toContain('user 42'); // model kept
		expect(errSpy).toHaveBeenCalled();

		errSpy.mockRestore();
		pushSpy.mockRestore();
	});
});

describe('Router — layouts (D19 §5)', () => {
	it('reuses the layout instance across routes sharing its class (created once)', async () => {
		let layoutCreated = 0;
		class SharedLayout extends PuzzleView {
			created() {
				layoutCreated++;
			}
			render() {
				return h('puzzle-view', { class: 'shared' }, [h('main', {}, [slot()])]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: SharedLayout },
			{ path: '/one', name: 'one', view: AboutView, layout: SharedLayout },
			{ path: '/two', name: 'two', view: HomeView, layout: SharedLayout },
		];
		const { router, el } = await boot(routes);

		await router.push('/one');
		await router.push('/two');

		expect(layoutCreated).toBe(1);
		expect(el.querySelector('.shared')).not.toBeNull();
	});

	it('a different layout class remounts: old layout destroyed, new one mounted', async () => {
		let aDestroyed = 0;
		let bCreated = 0;
		class LayoutA extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'la' }, [slot()]);
			}
			destroyed() {
				aDestroyed++;
			}
		}
		class LayoutB extends PuzzleView {
			created() {
				bCreated++;
			}
			render() {
				return h('puzzle-view', { class: 'lb' }, [slot()]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: LayoutA },
			{ path: '/other', name: 'other', view: AboutView, layout: LayoutB },
		];
		const { router, el } = await boot(routes);
		expect(el.querySelector('.la')).not.toBeNull();

		await router.push('/other');
		expect(el.querySelector('.lb')).not.toBeNull();
		expect(el.querySelector('.la')).toBeNull();
		expect(aDestroyed).toBe(1);
		expect(bCreated).toBe(1);
	});
});

describe('Router — history integration', () => {
	it('popstate navigates WITHOUT adding a history entry', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		await router.push('/about');
		expect(el.querySelector('.about')).not.toBeNull();

		// simulate back to '/': move the URL (setup), then fire popstate
		history.replaceState({}, '', '/');
		const spy = vi.spyOn(history, 'pushState');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		expect(spy).not.toHaveBeenCalled();
		expect(router.current.route.name).toBe('home');
		expect(el.querySelector('.home')).not.toBeNull();
		spy.mockRestore();
	});

	it("writes meta.title to document.title on navigation", async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home Page' } },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout, meta: { title: 'About Us' } },
		];
		const { router } = await boot(routes);
		expect(document.title).toBe('Home Page');

		await router.push('/about');
		expect(document.title).toBe('About Us');
	});
});

describe('Router — click interceptor (D19)', () => {
	it('intercepts plain same-origin link clicks and ignores modified/external ones', async () => {
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		];
		const { router } = await boot(routes);
		const pushSpy = vi.spyOn(router, 'push');

		// Registered AFTER the router's listener: for links the router leaves
		// alone this stops jsdom's unimplemented real navigation (noise only).
		const suppress = (e) => e.preventDefault();
		document.addEventListener('click', suppress);

		// external origin — left alone
		const ext = document.createElement('a');
		ext.setAttribute('href', 'https://example.com/x');
		document.body.appendChild(ext);
		ext.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(pushSpy).not.toHaveBeenCalled();

		// modifier key (cmd/ctrl-click to open a new tab) — left alone
		const mod = document.createElement('a');
		mod.setAttribute('href', '/about');
		document.body.appendChild(mod);
		mod.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
		expect(pushSpy).not.toHaveBeenCalled();

		// target attribute — left alone
		const blank = document.createElement('a');
		blank.setAttribute('href', '/about');
		blank.setAttribute('target', '_blank');
		document.body.appendChild(blank);
		blank.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(pushSpy).not.toHaveBeenCalled();

		// plain left-click on an in-app link — intercepted
		const plain = document.createElement('a');
		plain.setAttribute('href', '/about');
		document.body.appendChild(plain);
		const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		plain.dispatchEvent(evt);
		expect(pushSpy).toHaveBeenCalledWith('/about');
		expect(evt.defaultPrevented).toBe(true);

		await tick();
		expect(router.current.route.name).toBe('about');
		expect(location.pathname).toBe('/about');

		document.removeEventListener('click', suppress);
	});
});

describe('route snapshot (v1.15, D47)', () => {
	it("a fresh view's data() sees this.route as the TARGET while location.pathname is still the old route", async () => {
		let router;
		const snaps = [];
		class AboutRec extends PuzzleView {
			data() {
				snaps.push({ routePath: this.route?.path, pathname: location.pathname });
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'about' }, [text('ABOUT')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutRec, layout: DefaultLayout },
		];
		const booted = await boot(routes);
		router = booted.router;

		await router.push('/about');

		// The gating data() ran while the URL still showed '/', seeing the target.
		expect(snaps).toHaveLength(1);
		expect(snaps[0]).toEqual({ routePath: '/about', pathname: '/' });
		// After the nav resolves, the URL and current caught up.
		expect(location.pathname).toBe('/about');
		expect(router.current.path).toBe('/about');
	});
});

describe('Router — redirect from mounted() (commit-window defer)', () => {
	// Boot with the router injected into ctx so a view's mounted() can call
	// this.ctx.router.push(...) — the redirect-from-mounted pattern (pyramid-puzzle
	// RootRedirect/BoardRedirect/Home). Needed before start() so the hook on the
	// initial navigation already sees it.
	async function bootWithRouter(routes, path = '/') {
		const el = container();
		history.replaceState({}, '', path);
		const router = new Router(routes);
		routers.push(router);
		await router.start(el, { store: null, router, formatters: null });
		return { router, el };
	}
	const settle = async (n = 10) => {
		for (let i = 0; i < n; i++) await tick();
	};

	it('a push() from mounted() reuses the shared layout (single mount) and lands on the target', async () => {
		let layoutCreated = 0;
		class CountLayout extends PuzzleView {
			created() {
				layoutCreated++;
			}
			render() {
				return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
			}
		}
		class RootRedirect extends PuzzleView {
			mounted() {
				if (this._redirected) return;
				this._redirected = true;
				this.ctx.router.push('/elsewhere'); // straight from mounted(), no setTimeout
			}
			render() {
				return h('puzzle-view', { class: 'redirect' }, [text('REDIRECT')]);
			}
		}
		const routes = [
			{ path: '/', name: 'root', view: RootRedirect, layout: CountLayout },
			{ path: '/elsewhere', name: 'elsewhere', view: AboutView, layout: CountLayout },
		];
		const { router, el } = await bootWithRouter(routes, '/');
		await settle();

		// The redirect target committed…
		expect(location.pathname).toBe('/elsewhere');
		expect(router.current.route.name).toBe('elsewhere');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.redirect')).toBeNull();
		// …reusing the ONE shared layout (no stacked second layout root, the bug).
		expect(layoutCreated).toBe(1);
		expect(el.querySelectorAll('.layout')).toHaveLength(1);
		expect(el.querySelectorAll('.layout main .about')).toHaveLength(1);
	});

	it('a two-hop redirect chain (each mounted() pushes onward) settles on the final route, one layout', async () => {
		let layoutCreated = 0;
		class CountLayout extends PuzzleView {
			created() {
				layoutCreated++;
			}
			render() {
				return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
			}
		}
		const redirectTo = (cls, target) =>
			class extends PuzzleView {
				mounted() {
					if (this._redirected) return;
					this._redirected = true;
					this.ctx.router.push(target);
				}
				render() {
					return h('puzzle-view', { class: cls }, [text(cls)]);
				}
			};
		const HopA = redirectTo('hopa', '/b');
		const HopB = redirectTo('hopb', '/c');
		class HopC extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'hopc' }, [text('C')]);
			}
		}
		const routes = [
			{ path: '/', name: 'a', view: HopA, layout: CountLayout },
			{ path: '/b', name: 'b', view: HopB, layout: CountLayout },
			{ path: '/c', name: 'c', view: HopC, layout: CountLayout },
		];
		const { router, el } = await bootWithRouter(routes, '/');
		await settle(16);

		expect(location.pathname).toBe('/c');
		expect(router.current.route.name).toBe('c');
		expect(el.querySelector('.hopc')).not.toBeNull();
		expect(el.querySelector('.hopa')).toBeNull();
		expect(el.querySelector('.hopb')).toBeNull();
		expect(layoutCreated).toBe(1); // shared layout reused across both hops
		expect(el.querySelectorAll('.layout')).toHaveLength(1);
	});

	it('a redirect to the path being committed is a no-op (deferred push honors the same-path guard)', async () => {
		// The auth-guard case: a view lands on '/login' and its mounted() pushes
		// '/login' (guarding against an already-current route). The push is deferred
		// into #pendingPush during the commit window, then re-dispatched by
		// #runPendingPush AFTER #committing clears — routing through push() so the
		// same-path no-op guard applies. Without it, a full redundant params-only
		// navigation + duplicate history entry fires after the commit.
		let dataRuns = 0;
		class LoginView extends PuzzleView {
			data() {
				dataRuns++;
				return {};
			}
			mounted() {
				if (this._redirected) return;
				this._redirected = true;
				this.ctx.router.push('/login'); // the SAME path being committed
			}
			render() {
				return h('puzzle-view', { class: 'login' }, [text('LOGIN')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/login', name: 'login', view: LoginView, layout: DefaultLayout },
		];
		// Spy BEFORE boot: the deferred push runs synchronously inside start().
		const pushSpy = vi.spyOn(history, 'pushState');
		const { router, el } = await bootWithRouter(routes, '/login');
		await settle();

		expect(pushSpy).not.toHaveBeenCalled(); // no duplicate history entry
		expect(dataRuns).toBe(1); // data() NOT re-run by a redundant navigation
		expect(router.current.path).toBe('/login');
		expect(el.querySelector('.login')).not.toBeNull();
		pushSpy.mockRestore();
	});

	it('a deferred redirect to a DIFFERENT path still navigates', async () => {
		class LoginView extends PuzzleView {
			mounted() {
				if (this._redirected) return;
				this._redirected = true;
				this.ctx.router.push('/dashboard');
			}
			render() {
				return h('puzzle-view', { class: 'login' }, [text('LOGIN')]);
			}
		}
		class DashView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'dash' }, [text('DASH')]);
			}
		}
		const routes = [
			{ path: '/login', name: 'login', view: LoginView, layout: DefaultLayout },
			{ path: '/dashboard', name: 'dashboard', view: DashView, layout: DefaultLayout },
		];
		const pushSpy = vi.spyOn(history, 'pushState');
		const { router, el } = await bootWithRouter(routes, '/login');
		await settle();

		expect(pushSpy).toHaveBeenCalledTimes(1); // the deferred redirect navigated
		expect(router.current.path).toBe('/dashboard');
		expect(el.querySelector('.dash')).not.toBeNull();
		expect(el.querySelector('.login')).toBeNull();
		pushSpy.mockRestore();
	});
});

describe('Router — teardown of the outgoing view', () => {
	class Todo extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			text: Puzzle.string().required(),
		};
	}

	it('destroys the old view on navigation so its store subscriptions go dead', async () => {
		let listInstance;
		class ListView extends PuzzleView {
			created() {
				listInstance = this;
			}
			data() {
				const todos = this.ctx.store.findMany('todo'); // auto-subscribes
				return { n: todos.length };
			}
			render() {
				return h('puzzle-view', { class: 'list' }, [text('n=' + this.getData().n)]);
			}
		}
		const routes = [
			{ path: '/', name: 'list', view: ListView, layout: DefaultLayout },
			{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		];
		const store = new Store({ todo: Todo });
		const { router, el } = await boot(routes, ctx(store));
		expect(el.querySelector('.list')).not.toBeNull();

		const renderSpy = vi.spyOn(listInstance, 'render');
		await router.push('/about');
		expect(el.querySelector('.list')).toBeNull();

		// the destroyed view must not react to a matching store change
		store.createRecord('todo', { id: 't1', text: 'x' });
		store.flush();
		expect(renderSpy).not.toHaveBeenCalled();
	});
});

describe('Router — skeleton views skip the data() gate (v1.8, D39)', () => {
	const deferred = () => {
		let resolve, reject;
		const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
		return { promise, resolve, reject };
	};

	// Hand-written stand-in for a routed view compiled from a .pzl carrying a
	// <puzzle-skeleton>: renderSkeleton attached via prototype assignment.
	const makePostView = (gate) => {
		class PostView extends PuzzleView {
			async data() {
				const post = await gate.promise;
				return { post };
			}
		}
		PostView.prototype.render = function () {
			return h('puzzle-view', { class: 'post' }, [text(this.getData().post)]);
		};
		PostView.prototype.renderSkeleton = function () {
			return h('puzzle-view', { class: 'post is-loading' }, [
				h('div', { class: 'bg-skeleton' }),
			]);
		};
		return PostView;
	};

	it('push() commits URL + skeleton immediately; the real render patches in when data() lands', async () => {
		const gate = deferred();
		const PostView = makePostView(gate);
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/post', name: 'post', view: PostView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);

		await router.push('/post');
		// committed WITHOUT waiting for data(): URL moved, skeleton on screen
		expect(location.pathname).toBe('/post');
		expect(el.querySelector('.layout main .post.is-loading .bg-skeleton')).not.toBeNull();

		gate.resolve('REAL POST');
		await tick();
		expect(el.querySelector('.post.is-loading')).toBeNull();
		expect(el.textContent).toContain('REAL POST');
		expect(location.pathname).toBe('/post'); // unchanged by the late commit
	});

	it('initial navigation first-paints the skeleton', async () => {
		const gate = deferred();
		const PostView = makePostView(gate);
		history.replaceState({}, '', '/post');
		const { el } = await boot([
			{ path: '/post', name: 'post', view: PostView, layout: DefaultLayout },
		]);
		expect(el.querySelector('.post.is-loading')).not.toBeNull();
		gate.resolve('LOADED');
		await tick();
		expect(el.textContent).toContain('LOADED');
	});

	it('with a real store, the skeleton still paints before the un-awaited data() lands (gated loads start first)', async () => {
		// Regression: Store.withTracking serializes evaluations — an async data()
		// holds the tracking scope open for its whole await, deferring every later
		// withTracking call behind it. If the router starts the skeleton view's
		// (un-awaited) preload BEFORE the layout's gated one, the gate queues
		// behind the skeleton's own fetch and nothing paints until it resolves —
		// exactly the load D39 exempts. Surfaced by examples/chirp's Home feed.
		const gate = deferred();
		class Item extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		const store = new Store({ item: Item });

		class FeedView extends PuzzleView {
			async data() {
				this.ctx.store.findMany('item'); // subscribe inside the tracked eval
				const value = await gate.promise; // ...then hold the scope open
				return { value };
			}
		}
		FeedView.prototype.render = function () {
			return h('puzzle-view', { class: 'feed' }, [text(this.getData().value)]);
		};
		FeedView.prototype.renderSkeleton = function () {
			return h('puzzle-view', { class: 'feed is-loading' }, [
				h('div', { class: 'bg-skeleton' }),
			]);
		};

		// A store-backed layout: its synchronous data() is a GATED load that must
		// not end up queued behind the skeleton view's in-flight tracking scope.
		class StoreLayout extends PuzzleView {
			data() {
				return { count: this.ctx.store.findMany('item').length };
			}
		}
		StoreLayout.prototype.render = function () {
			return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
		};

		history.replaceState({}, '', '/feed');
		const { el } = await boot(
			[{ path: '/feed', name: 'feed', view: FeedView, layout: StoreLayout }],
			ctx(store)
		);

		// boot resolved with the async data() still pending: skeleton on screen.
		expect(el.querySelector('.layout main .feed.is-loading .bg-skeleton')).not.toBeNull();

		gate.resolve('FED');
		await tick();
		expect(el.querySelector('.feed.is-loading')).toBeNull();
		expect(el.textContent).toContain('FED');
	});

	it('a rejecting data() behind a skeleton logs; the URL has already moved and the skeleton stays', async () => {
		const gate = deferred();
		const PostView = makePostView(gate);
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/post', name: 'post', view: PostView, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await router.push('/post');
		expect(location.pathname).toBe('/post');

		gate.reject(new Error('load failed'));
		await tick();
		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] skeleton view data() failed:',
			expect.any(Error)
		);
		expect(el.querySelector('.post.is-loading')).not.toBeNull(); // still up
		errSpy.mockRestore();
	});

	it('a skeleton-less sibling still gates the commit (D19 unchanged)', async () => {
		const gate = deferred();
		class SlowPlain extends PuzzleView {
			async data() {
				const msg = await gate.promise;
				return { msg };
			}
			render() {
				return h('puzzle-view', { class: 'plain' }, [text(this.getData().msg)]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{ path: '/plain', name: 'plain', view: SlowPlain, layout: DefaultLayout },
		];
		const { router, el } = await boot(routes);

		const p = router.push('/plain');
		await tick();
		expect(location.pathname).toBe('/'); // still gated
		expect(el.querySelector('.plain')).toBeNull();
		gate.resolve('PLAIN');
		await p;
		expect(location.pathname).toBe('/plain');
		expect(el.textContent).toContain('PLAIN');
	});

	it('a pending skeleton PARENT mounts its routed child when its real template (and <Slot/>) lands — and no missing-slot warning fires', async () => {
		const gate = deferred();
		class ShellView extends PuzzleView {
			async data() {
				const label = await gate.promise;
				return { label };
			}
		}
		ShellView.prototype.render = function () {
			return h('puzzle-view', { class: 'shell' }, [
				h('h1', {}, [text(this.getData().label)]),
				h('section', {}, [slot()]),
			]);
		};
		ShellView.prototype.renderSkeleton = function () {
			return h('puzzle-view', { class: 'shell is-loading' }, []);
		};
		class ChildView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'child' }, [text('CHILD')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
			{
				path: '/shell',
				name: 'shell',
				view: ShellView,
				layout: DefaultLayout,
				children: [{ path: 'child', name: 'shell-child', view: ChildView }],
			},
		];
		const { router, el } = await boot(routes);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await router.push('/shell/child');
		expect(location.pathname).toBe('/shell/child');
		expect(el.querySelector('.shell.is-loading')).not.toBeNull();
		expect(el.querySelector('.child')).toBeNull(); // no slot in the skeleton yet
		expect(warnSpy).not.toHaveBeenCalled(); // pending skeleton parent ≠ missing <Slot/>

		gate.resolve('SHELL');
		await tick();
		expect(el.querySelector('.shell.is-loading')).toBeNull();
		expect(el.querySelector('.shell section .child')).not.toBeNull();
		expect(el.textContent).toContain('CHILD');
		warnSpy.mockRestore();
	});
});

// Fix 1: mount() is async, so a synchronous render()/mounted() throw inside a
// router-owned mount() (bare root view, layout swap, initial-nav layout) surfaces
// as a REJECTED promise. The router now observes it (#observeMount) so it is logged
// once instead of becoming an unhandled rejection — the commit still lands (no
// rollback, D19/D61) and a later navigation replaces + destroys the failed view.
describe('Router — router-owned mount() rejections are observed (Fix 1)', () => {
	let unhandled;
	const onUnhandled = (reason) => unhandled.push(reason);
	beforeEach(() => {
		unhandled = [];
		process.on('unhandledRejection', onUnhandled);
	});
	afterEach(() => {
		process.off('unhandledRejection', onUnhandled);
	});

	// Give any would-be unhandled rejection the microtask + macrotask turns Node
	// needs to report it, so an empty `unhandled` is meaningful.
	const drainRejections = async () => {
		await tick();
		await tick();
	};

	it("a bare root view whose render() throws logs the mount failure, not an unhandled rejection, and the router still navigates", async () => {
		class BadRenderView extends PuzzleView {
			render() {
				throw new Error('render boom');
			}
		}
		// No layout ⇒ the router mounts the view DIRECTLY (the #observeMount site),
		// rather than through the ViewManager's already-caught child-mount path.
		const routes = [
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/bad', name: 'bad', view: BadRenderView },
		];
		const { router, el } = await boot(routes);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await router.push('/bad');
		await drainRejections();

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] view mount failed after commit:',
			expect.any(Error)
		);
		expect(unhandled).toHaveLength(0);
		// Commit still landed (no rollback) — the URL moved.
		expect(router.current.path).toBe('/bad');

		// Router not wedged: a subsequent navigation replaces + destroys the failed view.
		await router.push('/');
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
		errSpy.mockRestore();
	});

	it("a bare root view whose mounted() throws logs the mount failure, not an unhandled rejection", async () => {
		class BadMountedView extends PuzzleView {
			mounted() {
				throw new Error('mounted boom');
			}
			render() {
				return h('puzzle-view', { class: 'badmount' }, [text('BAD')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView },
			{ path: '/bad', name: 'bad', view: BadMountedView },
		];
		const { router, el } = await boot(routes);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await router.push('/bad');
		await drainRejections();

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] view mount failed after commit:',
			expect.any(Error)
		);
		expect(unhandled).toHaveLength(0);
		expect(router.current.path).toBe('/bad');
		expect(el.querySelector('.badmount')).not.toBeNull(); // rendered before mounted() threw

		await router.push('/');
		expect(router.current.path).toBe('/');
		errSpy.mockRestore();
	});

	it("a layout whose mounted() throws (initial nav) logs the mount failure, not an unhandled rejection", async () => {
		class BadMountedLayout extends PuzzleView {
			mounted() {
				throw new Error('layout mounted boom');
			}
			render() {
				return h('puzzle-view', { class: 'badlayout' }, [h('main', {}, [slot()])]);
			}
		}
		const routes = [{ path: '/', name: 'home', view: HomeView, layout: BadMountedLayout }];
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		// The initial nav mounts the layout directly (#observeMount initial-nav site).
		const { router } = await boot(routes);
		await drainRejections();

		expect(errSpy).toHaveBeenCalledWith(
			'[puzzle] view mount failed after commit:',
			expect.any(Error)
		);
		expect(unhandled).toHaveLength(0);
		expect(router.current.path).toBe('/');
		errSpy.mockRestore();
	});
});

// Fix 2: #runPendingPush now sits in an OUTER finally, so a redirect a mounted()
// hook deferred during the commit window (#pendingPush) still runs even when a
// SYNCHRONOUS commit-block throw (an applyParentUpdate render/afterUpdate throw)
// bails out of the commit — previously it stranded until the next successful commit.
describe('Router — a deferred redirect survives a synchronous commit throw (Fix 2)', () => {
	it('a reused layout whose afterUpdate throws once, while the incoming view redirects from mounted(), still lands the redirect', async () => {
		let throwOnUpdate = false;
		// A reused root layout whose afterUpdate throws ONCE (on the update that swaps
		// the view in). The commit block's `layout.applyParentUpdate(...)` re-renders
		// the layout synchronously, so the throw escapes the commit block.
		class FlakyLayout extends PuzzleView {
			afterUpdate() {
				if (throwOnUpdate) {
					throwOnUpdate = false;
					throw new Error('afterUpdate boom');
				}
			}
			render() {
				return h('puzzle-view', { class: 'layout' }, [h('main', {}, [slot()])]);
			}
		}
		// The redirect SOURCE: its mounted() pushes to the target during the commit
		// window (#committing true ⇒ deferred into #pendingPush).
		class RedirectView extends PuzzleView {
			mounted() {
				this.ctx.router.push('/target');
			}
			render() {
				return h('puzzle-view', { class: 'redirect' }, [text('REDIRECT')]);
			}
		}
		class TargetView extends PuzzleView {
			render() {
				return h('puzzle-view', { class: 'target' }, [text('TARGET')]);
			}
		}
		const routes = [
			{ path: '/', name: 'home', view: HomeView, layout: FlakyLayout },
			{ path: '/redirect', name: 'redirect', view: RedirectView, layout: FlakyLayout },
			{ path: '/target', name: 'target', view: TargetView, layout: FlakyLayout },
		];
		// Inject the router into ctx so RedirectView.mounted() can push (the
		// redirect-from-mounted pattern), same wiring as bootWithRouter above.
		const el = container();
		history.replaceState({}, '', '/');
		const router = new Router(routes);
		routers.push(router);
		await router.start(el, { store: null, router, formatters: null });

		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		// Navigate home → /redirect. The layout is reused (applyParentUpdate path); its
		// afterUpdate throws AFTER RedirectView.mounted() has deferred the '/target' push.
		throwOnUpdate = true;
		await router.push('/redirect').catch(() => {}); // the throw rejects this nav's promise
		await tick();
		await tick();

		// The deferred redirect ran despite the commit throw → we end up on /target.
		expect(router.current.path).toBe('/target');
		expect(el.querySelector('.target')).not.toBeNull();
		errSpy.mockRestore();
	});
});

// ---- v1.49, D83: router.replace() + parsed query snapshot (history mode) ----
// Memory mode (router-memory.test.js) proves the stack semantics precisely;
// this block proves the HISTORY seams: replaceState (never pushState), a
// constant history.length, the preserved __puzzleScrollKey entry identity, real
// jsdom back-traversal after a replace, and the leave-scroll-alone default.
describe('router.replace() — history mode (v1.49, D83)', () => {
	class DocsView extends PuzzleView {
		render() {
			return h('puzzle-view', { class: 'docs' }, [text('DOCS')]);
		}
	}
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
		{ path: '/docs', name: 'docs', view: DocsView, layout: DefaultLayout },
	];

	let scrollSpy;
	beforeEach(() => {
		scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	});
	afterEach(() => {
		scrollSpy.mockRestore();
	});

	it('does not grow history: length constant, URL + view swap, pushState never called', async () => {
		const { router, el } = await boot(routes);
		await router.push('/about');
		const len = history.length;

		const pushSpy = vi.spyOn(history, 'pushState');
		await router.replace('/docs');

		expect(history.length).toBe(len); // replaceState adds no entry
		expect(location.pathname).toBe('/docs');
		expect(el.querySelector('.docs')).not.toBeNull();
		expect(el.querySelector('.about')).toBeNull();
		expect(router.current.path).toBe('/docs');
		expect(pushSpy).not.toHaveBeenCalled();
		pushSpy.mockRestore();
	});

	it('preserves the entry identity: the existing __puzzleScrollKey rides the replacement state', async () => {
		const { router } = await boot(routes);
		await router.push('/about'); // mints this entry's key
		const keyBefore = history.state.__puzzleScrollKey;
		expect(keyBefore).toBeTruthy();

		await router.replace('/docs');
		// Same key, no new mint — a later pop restores whatever position was saved
		// under this entry as if it had never been rewritten (D83).
		expect(history.state.__puzzleScrollKey).toBe(keyBefore);
	});

	it('back after replace lands on the pre-replace previous entry (real jsdom traversal)', async () => {
		const { router, el } = await boot(routes);
		await router.push('/about');
		await router.replace('/docs'); // the '/about' entry now reads '/docs'

		history.back(); // jsdom fires popstate asynchronously → the router pops
		await delay(20);
		expect(location.pathname).toBe('/');
		expect(router.current.path).toBe('/');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('leaves scroll untouched by default (a push scrolls, the replace does not)', async () => {
		const { router } = await boot(routes);
		await router.push('/about'); // default push → top
		expect(scrollSpy).toHaveBeenCalled();
		scrollSpy.mockClear();

		await router.replace('/docs');
		expect(scrollSpy).not.toHaveBeenCalled(); // replace default: leave alone
	});

	it('a custom scrollBehavior still runs on replace (savedPosition null) and may override', async () => {
		const behavior = vi.fn(() => ({ x: 5, y: 7 }));
		const el = container();
		const router = new Router(routes, { scrollBehavior: behavior });
		routers.push(router);
		await router.start(el, ctx());
		behavior.mockClear();
		scrollSpy.mockClear();

		await router.replace('/docs');
		expect(behavior).toHaveBeenCalledTimes(1);
		const [to, , savedPosition] = behavior.mock.calls[0];
		expect(to.path).toBe('/docs');
		expect(savedPosition).toBeNull();
		expect(scrollSpy).toHaveBeenCalledWith(5, 7);
	});

	it("an explicit #anchor on a replace target still resolves like push's (D41 composition)", async () => {
		const { router } = await boot(routes);
		await router.push('/about');
		scrollSpy.mockClear();

		// The anchor id is absent from the committed DOM → the D41 fallback lands
		// at top {0,0}. The scrollTo CALL is the point: the anchor sentinel
		// resolved instead of the plain-replace null (which never scrolls).
		await router.replace('/docs#missing');
		expect(scrollSpy).toHaveBeenCalledWith(0, 0);
	});

	it('a failed replace commits nothing: URL, view and history untouched', async () => {
		class BadView extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		}
		const { router, el } = await boot([
			...routes,
			{ path: '/bad', name: 'bad', view: BadView, layout: DefaultLayout },
		]);
		await router.push('/about');
		const len = history.length;
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const replaceSpy = vi.spyOn(history, 'replaceState');

		await router.replace('/bad');

		expect(location.pathname).toBe('/about');
		expect(router.current.path).toBe('/about');
		expect(el.querySelector('.about')).not.toBeNull();
		expect(el.querySelector('.bad')).toBeNull();
		expect(replaceSpy).not.toHaveBeenCalled(); // never reached #commitLocation
		expect(history.length).toBe(len);
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
		replaceSpy.mockRestore();
	});
});

describe('route snapshot query/hash — history mode (v1.49, D83)', () => {
	const routes = [
		{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
		{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout },
	];

	it('a deep link with query decodes into the initial snapshot; push carries query into location.search', async () => {
		history.replaceState({}, '', '/?q=hello%20world&debug');
		const { router } = await boot(routes);
		expect(router.current.pathname).toBe('/');
		expect(router.current.query.q).toBe('hello world');
		expect(router.current.query.debug).toBe('');
		expect(router.current.hash).toBe('');

		const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		await router.push('/about?tab=2');
		expect(location.pathname).toBe('/about');
		expect(location.search).toBe('?tab=2');
		expect(router.current.pathname).toBe('/about');
		expect(router.current.query.tab).toBe('2');
		scrollSpy.mockRestore();
	});
});

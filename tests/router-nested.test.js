// @vitest-environment jsdom
//
// Nested routes & nested view slots (constellation/doc/DOC-DECISIONS.md D30, v1.3). Exercises the
// chain-prefix navigation pipeline: relative-path composition, index children,
// bare-parent no-match, merged params at every level, the four fail-fast config
// throws, deep composition through nested <Slot/>s, prefix REUSE (ancestor kept +
// awaited pre-commit, URL gated on all loads), the same-view-class sibling key
// trap, params-only nested refresh, and failure/cancel teardown of the fresh
// sub-chain only. Mirrors tests/router.test.js's fake view/layout helpers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

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

// A layout with a single <Slot/> the root view renders into.
class AppLayout extends PuzzleView {
	render() {
		return h('puzzle-view', { class: 'layout' }, [
			h('header', {}, [text('CHROME')]),
			h('main', {}, [slot()]),
		]);
	}
}

// A parent SHELL view that hosts its child route at a <Slot/>.
function makeShell(name, onData) {
	return class extends PuzzleView {
		data(params, props) {
			if (onData) onData(params, props, this);
			return { name };
		}
		render() {
			return h('puzzle-view', { class: name }, [
				h('h1', {}, [text(name.toUpperCase())]),
				h('section', { class: name + '-outlet' }, [slot()]),
			]);
		}
	};
}

// A leaf view (no <Slot/>).
function makeLeaf(name, onData) {
	return class extends PuzzleView {
		data(params, props) {
			if (onData) onData(params, props, this);
			return { name };
		}
		render() {
			return h('puzzle-view', { class: name }, [text(name.toUpperCase())]);
		}
	};
}

let routers = [];
async function boot(routes, ctxObj = ctx(), startPath = null) {
	const el = container();
	if (startPath) history.replaceState({}, '', startPath);
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
	vi.restoreAllMocks();
});

// ---- matching & composition -------------------------------------------------

describe('Router nested — matching & composition', () => {
	it('composes a relative child path and renders leaf-in-parent-in-layout', async () => {
		const Settings = makeShell('settings');
		const Profile = makeLeaf('profile');
		const routes = [
			{
				path: '/settings',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [{ path: 'profile', name: 'profile', view: Profile }],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/settings/profile');

		// layout > settings shell > profile leaf, three levels deep
		expect(el.querySelector('.layout .settings .settings-outlet .profile')).not.toBeNull();
		expect(el.textContent).toContain('CHROME');
		expect(el.textContent).toContain('SETTINGS');
		expect(el.textContent).toContain('PROFILE');
		expect(router.current.route.name).toBe('profile');
		expect(router.current.chain.map((n) => n.name)).toEqual(['settings', 'profile']);
	});

	it('composes a three-deep chain', async () => {
		const A = makeShell('a');
		const B = makeShell('b');
		const C = makeLeaf('c');
		const routes = [
			{
				path: '/a',
				name: 'a',
				layout: AppLayout,
				view: A,
				children: [
					{ path: 'b', name: 'b', view: B, children: [{ path: 'c', name: 'c', view: C }] },
				],
			},
		];
		const { el } = await boot(routes, ctx(), '/a/b/c');
		expect(el.querySelector('.layout .a .a-outlet .b .b-outlet .c')).not.toBeNull();
	});

	it('an index child (path:"") matches the parent bare URL', async () => {
		const Settings = makeShell('settings');
		const Overview = makeLeaf('overview');
		const Profile = makeLeaf('profile');
		const routes = [
			{
				path: '/settings',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [
					{ path: '', name: 'overview', view: Overview },
					{ path: 'profile', name: 'profile', view: Profile },
				],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/settings');
		expect(el.querySelector('.settings .overview')).not.toBeNull();
		expect(router.current.route.name).toBe('overview');
		expect(location.pathname).toBe('/settings');
	});

	it('a parent WITH children but NO index child does not match its bare URL (→ catch-all)', async () => {
		const Settings = makeShell('settings');
		const Profile = makeLeaf('profile');
		const NotFound = makeLeaf('nf');
		const routes = [
			{
				path: '/settings',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [{ path: 'profile', name: 'profile', view: Profile }],
			},
			{ path: '*', name: 'not-found', view: NotFound, layout: AppLayout },
		];
		const { router, el } = await boot(routes, ctx(), '/settings');
		expect(router.current.route.name).toBe('not-found');
		expect(el.querySelector('.nf')).not.toBeNull();
		expect(el.querySelector('.settings')).toBeNull();
	});

	it('a bare-parent no-match with no catch-all warns and stays put', async () => {
		const Home = makeLeaf('home');
		const Settings = makeShell('settings');
		const Profile = makeLeaf('profile');
		const routes = [
			{ path: '/', name: 'home', layout: AppLayout, view: Home },
			{
				path: '/settings',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [{ path: 'profile', name: 'profile', view: Profile }],
			},
		];
		const { router, el } = await boot(routes);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await router.push('/settings'); // no index child, no catch-all

		expect(warnSpy).toHaveBeenCalled();
		expect(location.pathname).toBe('/'); // stayed put
		expect(router.current.route.name).toBe('home');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it('every level receives the full merged (and decoded) params', async () => {
		const seen = {};
		const Org = makeShell('org', (p) => (seen.org = { ...p }));
		const Team = makeShell('team', (p) => (seen.team = { ...p }));
		const Member = makeLeaf('member', (p) => (seen.member = { ...p }));
		const routes = [
			{
				path: '/org/:orgId',
				name: 'org',
				layout: AppLayout,
				view: Org,
				children: [
					{
						path: 'team/:teamId',
						name: 'team',
						view: Team,
						children: [{ path: 'member/:memberId', name: 'member', view: Member }],
					},
				],
			},
		];
		await boot(routes, ctx(), '/org/a%20b/team/9/member/42');

		const full = { orgId: 'a b', teamId: '9', memberId: '42' };
		expect(seen.org).toEqual(full);
		expect(seen.team).toEqual(full);
		expect(seen.member).toEqual(full);
	});

	it('meta.title resolves nearest-defined walking leaf → root', async () => {
		const Settings = makeShell('settings');
		const Profile = makeLeaf('profile');
		const Billing = makeLeaf('billing');
		const routes = [
			{
				path: '/settings',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				meta: { title: 'Settings' },
				children: [
					{ path: 'profile', name: 'profile', view: Profile, meta: { title: 'Your Profile' } },
					{ path: 'billing', name: 'billing', view: Billing }, // no title → inherits parent
				],
			},
		];
		const { router } = await boot(routes, ctx(), '/settings/profile');
		expect(document.title).toBe('Your Profile'); // leaf wins

		await router.push('/settings/billing');
		expect(document.title).toBe('Settings'); // leaf undefined → parent
	});
});

// ---- fail-fast config throws ------------------------------------------------

describe('Router nested — constructor config throws', () => {
	const V = makeLeaf('v');
	const P = makeShell('p');

	it('throws on a child path with a leading "/"', () => {
		expect(
			() =>
				new Router([
					{ path: '/p', view: P, children: [{ path: '/abs', view: V }] },
				])
		).toThrow(/relative/);
	});

	it('throws on a layout declared on a non-root node', () => {
		expect(
			() =>
				new Router([
					{ path: '/p', view: P, children: [{ path: 'c', view: V, layout: AppLayout }] },
				])
		).toThrow(/top-level/);
	});

	it('throws on path:"*" inside children', () => {
		expect(
			() =>
				new Router([
					{ path: '/p', view: P, children: [{ path: '*', view: V }] },
				])
		).toThrow(/catch-all/);
	});

	it('throws on a duplicate :param within one chain', () => {
		expect(
			() =>
				new Router([
					{ path: '/u/:id', view: P, children: [{ path: 'x/:id', view: V }] },
				])
		).toThrow(/duplicate route param/);
	});
});

// ---- prefix reuse -----------------------------------------------------------

describe('Router nested — prefix reuse', () => {
	it('a sibling-leaf swap keeps the parent instance and awaits its refresh pre-commit', async () => {
		let settingsCreated = 0;
		const settingsParams = [];
		const Settings = class extends PuzzleView {
			created() {
				settingsCreated++;
			}
			data(params) {
				settingsParams.push(params.id ?? null);
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'settings' }, [h('div', {}, [slot()])]);
			}
		};
		const Profile = makeLeaf('profile');
		const Billing = makeLeaf('billing');
		const routes = [
			{
				path: '/s/:id',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [
					{ path: 'profile', name: 'profile', view: Profile },
					{ path: 'billing', name: 'billing', view: Billing },
				],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/s/1/profile');
		expect(el.querySelector('.settings .profile')).not.toBeNull();

		await router.push('/s/1/billing');

		expect(settingsCreated).toBe(1); // parent instance reused across the sibling swap
		expect(settingsParams).toEqual(['1', '1']); // refreshed with params on the swap
		expect(el.querySelector('.settings .billing')).not.toBeNull();
		expect(el.querySelector('.profile')).toBeNull();
		expect(router.current.route.name).toBe('billing');
	});

	it('URL moves only AFTER a slow ancestor refresh resolves (D19 gate)', async () => {
		const Settings = class extends PuzzleView {
			async data() {
				await delay(15);
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'settings' }, [h('div', {}, [slot()])]);
			}
		};
		const Profile = makeLeaf('profile');
		const Billing = makeLeaf('billing');
		const routes = [
			{
				path: '/s',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [
					{ path: 'profile', name: 'profile', view: Profile },
					{ path: 'billing', name: 'billing', view: Billing },
				],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/s/profile');

		const p = router.push('/s/billing');
		// ancestor refresh (15ms) has not resolved → nothing committed yet
		expect(location.pathname).toBe('/s/profile');
		expect(el.querySelector('.billing')).toBeNull();

		await p;
		expect(location.pathname).toBe('/s/billing');
		expect(el.querySelector('.billing')).not.toBeNull();
	});

	it('same view CLASS on sibling leaves still swaps (compile-time key trap)', async () => {
		const created = [];
		const Pane = class extends PuzzleView {
			created() {
				created.push(this);
			}
			data(params) {
				return { pane: params.pane ?? this.props.pane };
			}
			render() {
				return h('puzzle-view', { class: 'pane' }, [text('pane')]);
			}
		};
		const Shell = makeShell('shell');
		const routes = [
			{
				path: '/x',
				name: 'x',
				layout: AppLayout,
				view: Shell,
				children: [
					{ path: 'one', name: 'one', view: Pane },
					{ path: 'two', name: 'two', view: Pane }, // SAME class, different node/key
				],
			},
		];
		const { router } = await boot(routes, ctx(), '/x/one');
		expect(created).toHaveLength(1);

		await router.push('/x/two');
		// different fullPaths key ⇒ patchComponent does NOT reuse ⇒ fresh instance
		expect(created).toHaveLength(2);
		expect(router.current.route.name).toBe('two');
	});
});

// ---- params-only nested -----------------------------------------------------

describe('Router nested — params-only chain refresh', () => {
	it('re-navigating the same leaf refreshes the WHOLE chain with zero new instances', async () => {
		let orgCreated = 0;
		let memberCreated = 0;
		const orgSeen = [];
		const memberSeen = [];
		const Org = class extends PuzzleView {
			created() {
				orgCreated++;
			}
			data(params) {
				orgSeen.push(params.orgId);
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'org' }, [h('div', {}, [slot()])]);
			}
		};
		const Member = class extends PuzzleView {
			created() {
				memberCreated++;
			}
			data(params) {
				memberSeen.push(params.memberId);
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'member' }, [text('m ' + this.getData().memberId)]);
			}
		};
		const routes = [
			{
				path: '/org/:orgId',
				name: 'org',
				layout: AppLayout,
				view: Org,
				children: [{ path: 'member/:memberId', name: 'member', view: Member }],
			},
		];
		const { router } = await boot(routes, ctx(), '/org/1/member/10');

		await router.push('/org/2/member/20');

		expect(orgCreated).toBe(1); // no new instances
		expect(memberCreated).toBe(1);
		expect(orgSeen).toEqual(['1', '2']); // whole chain refreshed
		expect(memberSeen).toEqual(['10', '20']);
		expect(location.pathname).toBe('/org/2/member/20');
	});

	it('a rejection during a params-only chain refresh leaves the URL untouched', async () => {
		const Org = makeShell('org');
		const Member = class extends PuzzleView {
			async data(params) {
				if (params.memberId === 'bad') throw new Error('boom');
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'member' }, [text('ok')]);
			}
		};
		const routes = [
			{
				path: '/org/:orgId',
				name: 'org',
				layout: AppLayout,
				view: Org,
				children: [{ path: 'member/:memberId', name: 'member', view: Member }],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/org/1/member/10');
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const pushSpy = vi.spyOn(history, 'pushState');

		await router.push('/org/1/member/bad'); // must not throw out of push()

		expect(location.pathname).toBe('/org/1/member/10');
		expect(pushSpy).not.toHaveBeenCalled();
		expect(el.querySelector('.member')).not.toBeNull();
		expect(errSpy).toHaveBeenCalled();
	});
});

// ---- failure & cancellation -------------------------------------------------

describe('Router nested — failure & cancellation', () => {
	it('a leaf preload rejection destroys the fresh sub-chain but NOT the reused ancestor', async () => {
		let settingsDestroyed = 0;
		let profileDestroyed = 0;
		const Settings = class extends PuzzleView {
			data() {
				return {};
			}
			destroyed() {
				settingsDestroyed++;
			}
			render() {
				return h('puzzle-view', { class: 'settings' }, [h('div', {}, [slot()])]);
			}
		};
		const Profile = makeLeaf('profile');
		const Billing = class extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			destroyed() {
				profileDestroyed++; // reuse the counter name loosely — this is Billing
			}
			render() {
				return h('puzzle-view', { class: 'billing' }, [text('B')]);
			}
		};
		const routes = [
			{
				path: '/s',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [
					{ path: 'profile', name: 'profile', view: Profile },
					{ path: 'billing', name: 'billing', view: Billing },
				],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/s/profile');
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await router.push('/s/billing'); // billing preload rejects

		expect(location.pathname).toBe('/s/profile'); // stayed put
		expect(settingsDestroyed).toBe(0); // reused ancestor NOT destroyed
		expect(profileDestroyed).toBe(1); // fresh Billing instance destroyed
		expect(el.querySelector('.settings .profile')).not.toBeNull();
		expect(errSpy).toHaveBeenCalled();
	});

	it('supersession during a nested load destroys the loser fresh chain only, last wins', async () => {
		const created = { one: 0, two: 0 };
		const destroyed = { one: 0, two: 0 };
		const Shell = makeShell('shell');
		function pane(name, ms) {
			return class extends PuzzleView {
				created() {
					created[name]++;
				}
				async data() {
					await delay(ms);
					return {};
				}
				destroyed() {
					destroyed[name]++;
				}
				render() {
					return h('puzzle-view', { class: name }, [text(name)]);
				}
			};
		}
		const routes = [
			{
				path: '/x',
				name: 'x',
				layout: AppLayout,
				view: Shell,
				children: [
					{ path: 'home', name: 'home', view: makeLeaf('xhome') },
					{ path: 'one', name: 'one', view: pane('one', 30) },
					{ path: 'two', name: 'two', view: pane('two', 5) },
				],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/x/home');

		const p1 = router.push('/x/one'); // slow
		const p2 = router.push('/x/two'); // fast — wins
		await Promise.all([p1, p2]);
		await delay(40); // let one's slow data() land after two committed

		expect(location.pathname).toBe('/x/two');
		expect(el.querySelector('.two')).not.toBeNull();
		expect(el.querySelector('.one')).toBeNull();
		expect(created.two).toBe(1);
		expect(destroyed.two).toBe(0); // winner alive
		expect(destroyed.one).toBe(1); // loser fresh instance torn down, never mounted
	});
});

// ---- ancestor re-renders after a swap ----------------------------------------
//
// After a mid-chain swap the router hands the FULL rebuilt vnode chain to the
// topmost host, so every host's slot content describes the new chain (D30). If
// only the survivor were updated, a later re-render of any host ABOVE it (store
// change, setData) would push its stale slot vnodes back down through
// patchComponent and revert the swap, resurrecting destroyed instances.

describe('Router nested — ancestor re-renders after a swap', () => {
	class StatefulLayout extends PuzzleView {
		created() {
			StatefulLayout.last = this;
		}
		render() {
			return h('puzzle-view', { class: 'layout' }, [
				h('span', {}, [text('z=' + (this.getData().z ?? 0))]),
				h('main', {}, [slot()]),
			]);
		}
	}

	it('a layout re-render after a sibling-leaf swap does not revert the swap', async () => {
		const Shell = makeShell('shell');
		const routes = [
			{
				path: '/x',
				name: 'x',
				layout: StatefulLayout,
				view: Shell,
				children: [
					{ path: 'one', name: 'one', view: makeLeaf('one') },
					{ path: 'two', name: 'two', view: makeLeaf('two') },
				],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/x/one');
		await router.push('/x/two'); // mid-chain swap: keep=1, survivor = shell
		expect(el.querySelector('.two')).not.toBeNull();

		// The layout (ABOVE the survivor) re-renders from local UI state.
		StatefulLayout.last.setData('z', 1);
		StatefulLayout.last.flushUpdates();
		await tick();

		expect(el.textContent).toContain('z=1'); // the re-render happened
		expect(el.querySelector('.two')).not.toBeNull(); // the swap survived it
		expect(el.querySelector('.one')).toBeNull();
	});

	it('a top-shell re-render after a deeper swap does not revert it (3 levels)', async () => {
		class TopShell extends PuzzleView {
			created() {
				TopShell.last = this;
			}
			render() {
				return h('puzzle-view', { class: 'a' }, [h('section', {}, [slot()])]);
			}
		}
		const B = makeShell('b');
		const routes = [
			{
				path: '/a',
				name: 'a',
				layout: StatefulLayout,
				view: TopShell,
				children: [
					{
						path: 'b',
						name: 'b',
						view: B,
						children: [
							{ path: 'c1', name: 'c1', view: makeLeaf('c1') },
							{ path: 'c2', name: 'c2', view: makeLeaf('c2') },
						],
					},
				],
			},
		];
		const { router, el } = await boot(routes, ctx(), '/a/b/c1');
		await router.push('/a/b/c2'); // keep=2, survivor = B; TopShell + layout sit above
		expect(el.querySelector('.c2')).not.toBeNull();

		TopShell.last.setData('z', 1);
		TopShell.last.flushUpdates();
		await tick();

		expect(el.querySelector('.c2')).not.toBeNull();
		expect(el.querySelector('.c1')).toBeNull();
	});
});

// ---- skeleton leaf under a reused ancestor ----------------------------------
//
// D39 skeleton exemption meets D30 reused ancestors. A slow async leaf data()
// must NOT serialize the reused ancestor's SYNCHRONOUS refresh behind it in the
// store's tracking scope — if it did, the router would await the very promise
// the skeleton exemption was meant to bypass, and the skeleton would never
// render until data() lands (the store.withTracking inline-sync fix).

describe('Router nested — skeleton leaf under a reused ancestor', () => {
	const deferred = () => {
		let resolve, reject;
		const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
		return { promise, resolve, reject };
	};

	it('a skeleton leaf under a reused ancestor commits immediately (ancestor sync refresh not serialized behind the leaf)', async () => {
		const { Store } = await import('../client-runtime/datastore/store.js');
		const store = new Store();
		const gate = deferred();

		// Parent SHELL: SYNCHRONOUS data() + a <Slot/>. Its refresh is the thing
		// that must not get deferred behind the leaf's async preload.
		let shellDataRuns = 0;
		class Shell extends PuzzleView {
			data() {
				shellDataRuns++;
				// A tracked query so the parent's refresh actually enters withTracking.
				this.ctx.store.findMany('todo');
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'shell' }, [h('div', {}, [slot()])]);
			}
		}
		const Home = makeLeaf('home');

		// Skeleton leaf: async data() gated on the promise, plus renderSkeleton.
		class Post extends PuzzleView {
			async data() {
				const post = await gate.promise;
				return { post };
			}
		}
		Post.prototype.render = function () {
			return h('puzzle-view', { class: 'post' }, [text(this.getData().post)]);
		};
		Post.prototype.renderSkeleton = function () {
			return h('puzzle-view', { class: 'post is-loading' }, [
				h('div', { class: 'bg-skeleton' }),
			]);
		};

		const routes = [
			{
				path: '/s',
				name: 'settings',
				layout: AppLayout,
				view: Shell,
				children: [
					{ path: '', name: 'home', view: Home },
					{ path: 'post', name: 'post', view: Post },
				],
			},
		];
		const { router, el } = await boot(routes, ctx(store), '/s');
		expect(el.querySelector('.shell .home')).not.toBeNull();

		const runsBefore = shellDataRuns;
		const p = router.push('/s/post');

		// Let the microtasks that DON'T depend on the gate flush.
		await tick();

		// The commit happened WITHOUT waiting on the leaf's gated data(): the URL
		// moved and the skeleton is on screen, even though gate is unresolved.
		expect(location.pathname).toBe('/s/post');
		expect(el.querySelector('.shell .post.is-loading .bg-skeleton')).not.toBeNull();
		expect(shellDataRuns).toBeGreaterThan(runsBefore); // ancestor refresh ran (inline)

		// Release the gate: the real template replaces the skeleton.
		gate.resolve('REAL POST');
		await p;
		await tick();
		expect(el.querySelector('.post.is-loading')).toBeNull();
		expect(el.textContent).toContain('REAL POST');
		expect(location.pathname).toBe('/s/post');
	});
});

// ---- redirect from a nested mounted() (commit-window defer) ------------------
//
// A leaf whose mounted() pushes to a sibling re-enters the router before
// #commitState has recorded the just-committed chain. The commit-window guard
// defers that push until #state is consistent, so the redirect reuses the shared
// layout + parent shell prefix instead of double-mounting them.

describe('Router nested — redirect from a nested leaf mounted()', () => {
	async function bootR(routes, path) {
		const el = container();
		if (path) history.replaceState({}, '', path);
		const router = new Router(routes);
		routers.push(router);
		await router.start(el, { store: null, router, formatters: null });
		return { router, el };
	}
	const settle = async (n = 10) => {
		for (let i = 0; i < n; i++) await tick();
	};

	it('reuses the shared layout + parent shell and settles on the sibling target with a single shell', async () => {
		let shellCreated = 0;
		class Shell extends PuzzleView {
			created() {
				shellCreated++;
			}
			render() {
				return h('puzzle-view', { class: 'shell' }, [h('section', {}, [slot()])]);
			}
		}
		class LeafA extends PuzzleView {
			mounted() {
				if (this._redirected) return;
				this._redirected = true;
				this.ctx.router.push('/s/b'); // straight from mounted(), no setTimeout
			}
			render() {
				return h('puzzle-view', { class: 'a' }, [text('A')]);
			}
		}
		const LeafB = makeLeaf('b');
		const routes = [
			{
				path: '/s',
				name: 's',
				layout: AppLayout,
				view: Shell,
				children: [
					{ path: 'a', name: 'a', view: LeafA },
					{ path: 'b', name: 'b', view: LeafB },
				],
			},
		];
		const { router, el } = await bootR(routes, '/s/a');
		await settle();

		expect(location.pathname).toBe('/s/b');
		expect(router.current.route.name).toBe('b');
		expect(shellCreated).toBe(1); // parent shell reused across the redirect
		expect(el.querySelectorAll('.layout')).toHaveLength(1); // single layout root
		expect(el.querySelectorAll('.shell')).toHaveLength(1); // single shell root
		expect(el.querySelector('.layout .shell section .b')).not.toBeNull();
		expect(el.querySelector('.a')).toBeNull();
	});
});

// ---- route snapshot (v1.15, D47) --------------------------------------------
//
// The router threads a frozen `to` ({ path, route, params, chain } — the shape of
// `current`) into every gated preload/refresh BEFORE the D19 commit; views read it
// as `this.route`. The invariant: inside a gating data(), `this.route` is the
// navigation TARGET while `router.current`/`location.pathname` still hold the OLD
// route (pushState/#commitState run after the gate). A failed/superseded nav never
// commits, so current/URL stay put; the reused-layout branch was reordered so a
// reused layout's post-commit data() reads a FRESH `router.current`.

describe('route snapshot (v1.15, D47)', () => {
	it('CORE: a reused ancestor gate sees this.route as the target while router.current/pathname hold the old route', async () => {
		let router;
		const snaps = [];
		const Settings = makeShell('settings', (params, props, inst) => {
			snaps.push({
				routePath: inst.route?.path,
				routeName: inst.route?.route?.name,
				currentPath: router?.current?.path,
				pathname: location.pathname,
			});
		});
		const Overview = makeLeaf('overview');
		const Profile = makeLeaf('profile');
		const routes = [
			{
				path: '/settings',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [
					{ path: '', name: 'settings-index', view: Overview },
					{ path: 'profile', name: 'settings-profile', view: Profile },
				],
			},
		];
		const booted = await boot(routes, ctx(), '/settings');
		router = booted.router;

		await router.push('/settings/profile');

		// The reused shell's data() re-ran during the push gate: this.route is the
		// TARGET, while current/pathname still described /settings.
		const gate = snaps.at(-1);
		expect(gate.routePath).toBe('/settings/profile');
		expect(gate.routeName).toBe('settings-profile');
		expect(gate.currentPath).toBe('/settings'); // pre-commit: old route
		expect(gate.pathname).toBe('/settings'); // pre-commit: URL unmoved
		// After the nav resolves, current caught up to the new path.
		expect(router.current.path).toBe('/settings/profile');
	});

	it('params-only degenerate: the reused leaf gate sees the new target path + params, old current', async () => {
		let router;
		const snaps = [];
		const User = makeLeaf('user', (params, props, inst) => {
			snaps.push({
				routePath: inst.route?.path,
				routeId: inst.route?.params?.id,
				currentPath: router?.current?.path,
			});
		});
		const routes = [
			{ path: '/user/:id', name: 'user', layout: AppLayout, view: User },
		];
		const booted = await boot(routes, ctx(), '/user/1');
		router = booted.router;

		await router.push('/user/2');

		const gate = snaps.at(-1);
		expect(gate.routePath).toBe('/user/2');
		expect(gate.routeId).toBe('2');
		expect(gate.currentPath).toBe('/user/1'); // pre-commit: old route
		expect(router.current.path).toBe('/user/2');
	});

	it('failed nav: URL + current stay put; a subsequent successful nav delivers a consistent snapshot', async () => {
		let router;
		let goodGate = null;
		const Settings = makeShell('settings');
		const Profile = makeLeaf('profile');
		const Bad = class extends PuzzleView {
			async data() {
				throw new Error('boom');
			}
			render() {
				return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
			}
		};
		const Other = makeLeaf('other', (params, props, inst) => {
			goodGate = { routePath: inst.route?.path, currentPath: router?.current?.path };
		});
		const routes = [
			{
				path: '/s',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [
					{ path: 'profile', name: 'profile', view: Profile },
					{ path: 'bad', name: 'bad', view: Bad },
					{ path: 'other', name: 'other', view: Other },
				],
			},
		];
		const booted = await boot(routes, ctx(), '/s/profile');
		router = booted.router;
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await router.push('/s/bad'); // rejects — must not commit
		expect(location.pathname).toBe('/s/profile');
		expect(router.current.path).toBe('/s/profile');
		expect(errSpy).toHaveBeenCalled();

		await router.push('/s/other'); // succeeds
		expect(goodGate.routePath).toBe('/s/other'); // fresh view saw the target
		expect(goodGate.currentPath).toBe('/s/profile'); // pre-commit: old route
		expect(router.current.path).toBe('/s/other');
	});

	it('superseded nav: the reused shell ends holding the WINNER B, and B is committed', async () => {
		let shellInst;
		const Shell = makeShell('shell', (params, props, inst) => {
			shellInst = inst;
		});
		function pane(name, ms) {
			return class extends PuzzleView {
				async data() {
					await delay(ms);
					return {};
				}
				render() {
					return h('puzzle-view', { class: name }, [text(name)]);
				}
			};
		}
		const routes = [
			{
				path: '/x',
				name: 'x',
				layout: AppLayout,
				view: Shell,
				children: [
					{ path: 'home', name: 'home', view: makeLeaf('xhome') },
					{ path: 'a', name: 'a', view: pane('a', 30) }, // slow — loses
					{ path: 'b', name: 'b', view: pane('b', 5) }, // fast — wins
				],
			},
		];
		const { router } = await boot(routes, ctx(), '/x/home');

		const pA = router.push('/x/a'); // slow
		const pB = router.push('/x/b'); // fast — supersedes A
		await Promise.all([pA, pB]);
		await delay(40); // let A's slow data() land after B committed

		// The shell was refreshed by both navs; the last write (B) wins and B is
		// the committed route.
		expect(shellInst.route.path).toBe('/x/b');
		expect(router.current.path).toBe('/x/b');
		expect(location.pathname).toBe('/x/b');
	});

	it('reused-layout reorder: the layout post-commit data() reads a FRESH router.current matching this.route', async () => {
		let router;
		const snaps = [];
		class SharedLayout extends PuzzleView {
			data() {
				snaps.push({
					routePath: this.route?.path,
					currentPath: router?.current?.path,
				});
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'shared' }, [h('main', {}, [slot()])]);
			}
		}
		const routes = [
			{ path: '/one', name: 'one', layout: SharedLayout, view: makeLeaf('one') },
			{ path: '/two', name: 'two', layout: SharedLayout, view: makeLeaf('two') },
		];
		const booted = await boot(routes, ctx(), '/one');
		router = booted.router;

		await router.push('/two'); // layout reused, view swapped

		// The reused layout re-runs data() POST-commit (chrome): it must see the
		// NEW committed path in router.current, and this.route matches it.
		const gate = snaps.at(-1);
		expect(gate.currentPath).toBe('/two'); // fresh current, post-commit
		expect(gate.routePath).toBe('/two');
		expect(router.current.path).toBe('/two');
	});

	it('back/forward: during a pop gate the reused ancestor sees this.route as the pop target', async () => {
		let router;
		const snaps = [];
		const Settings = makeShell('settings', (params, props, inst) => {
			snaps.push({ routePath: inst.route?.path, currentPath: router?.current?.path });
		});
		const routes = [
			{
				path: '/s',
				name: 'settings',
				layout: AppLayout,
				view: Settings,
				children: [
					{ path: 'a', name: 'a', view: makeLeaf('a') },
					{ path: 'b', name: 'b', view: makeLeaf('b') },
				],
			},
		];
		const booted = await boot(routes, ctx(), '/s/a');
		router = booted.router;

		await router.push('/s/b');
		expect(router.current.path).toBe('/s/b');

		// Simulate back to /s/a: move the URL (setup), then fire popstate.
		history.replaceState({}, '', '/s/a');
		const before = snaps.length;
		window.dispatchEvent(new PopStateEvent('popstate'));
		await tick();

		// The reused shell refreshed during the pop's gate: this.route is the pop
		// TARGET (/s/a), while router.current still held /s/b at record time.
		const gate = snaps.at(-1);
		expect(snaps.length).toBeGreaterThan(before);
		expect(gate.routePath).toBe('/s/a');
		expect(gate.currentPath).toBe('/s/b'); // pre-commit: old route
		expect(router.current.path).toBe('/s/a');
	});
});

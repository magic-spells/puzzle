// @vitest-environment jsdom
//
// D146 — transactional reused-ancestor refresh. A gated navigation PREPARES each
// reused ancestor (data() runs with the destination params/route snapshot, nothing
// renders) and COMMITS every prepared ancestor inside the same synchronous window as
// #commitLocation + mount. A failed or superseded navigation discards the prepared
// results — the ancestor keeps the committed route's params, route snapshot, data,
// DOM, and store subscriptions.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../client-runtime/router/router.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

class Org extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		name: Puzzle.string().required(),
	};
}
const makeStore = () => new Store({ org: Org });

const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

let routers = [];
async function boot(routes, ctxObj, startPath) {
	const el = container();
	history.replaceState({}, '', startPath);
	const router = new Router(routes);
	routers.push(router);
	await router.start(el, ctxObj);
	return { router, el };
}

beforeEach(() => {
	history.replaceState({}, '', '/');
});

afterEach(() => {
	routers.forEach((r) => r.stop());
	routers = [];
	vi.restoreAllMocks();
});

// Total (key, subscriber) links currently held by the store.
const subCount = (store) => {
	let n = 0;
	for (const keys of store.keysBySubscriber.values()) n += keys.size;
	return n;
};

function makeFixture() {
	const store = makeStore();
	store.upsert('org', { id: '1', name: 'ORG 1' });
	store.upsert('org', { id: '2', name: 'ORG 2' });

	let shell = null;
	class OrgShell extends PuzzleView {
		created() {
			shell = this;
		}
		data(params) {
			// A tracked query keyed by the CURRENT params — the subscription set moves
			// with the org id, which is what makes discard/commit observable.
			const org = this.ctx.store.findOne('org', params.id);
			return { org, seenRoute: this.route?.route?.name ?? null };
		}
		render() {
			return h('puzzle-view', { class: 'org' }, [
				h('h1', {}, [text(this.getData().org?.name ?? '?')]),
				h('section', {}, [slot()]),
			]);
		}
	}
	class HomeLeaf extends PuzzleView {
		data() {
			return {};
		}
		render() {
			return h('puzzle-view', { class: 'home' }, [text('HOME')]);
		}
	}
	class BadLeaf extends PuzzleView {
		async data() {
			throw new Error('boom');
		}
		render() {
			return h('puzzle-view', { class: 'bad' }, [text('BAD')]);
		}
	}
	const routes = [
		{
			path: '/org/:id',
			name: 'org',
			view: OrgShell,
			children: [
				{ path: 'home', name: 'home', view: HomeLeaf },
				{ path: 'bad', name: 'bad', view: BadLeaf },
			],
		},
	];
	return { store, routes, getShell: () => shell };
}

describe('Router — transactional reused-ancestor refresh (D146)', () => {
	it('a failed gated navigation leaves the reused ancestor entirely on the old route', async () => {
		const { store, routes, getShell } = makeFixture();
		const { router, el } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const shell = getShell();

		expect(el.querySelector('h1').textContent).toBe('ORG 1');

		await router.push('/org/2/bad'); // leaf data() rejects → nav fails

		expect(errSpy).toHaveBeenCalled();
		// Router location stayed put...
		expect(router.current.path).toBe('/org/1/home');
		expect(location.pathname).toBe('/org/1/home');
		// ...and so did EVERY piece of ancestor state (the D19/D30 soft-violation).
		expect(shell.params.id).toBe('1');
		expect(shell.route.params.id).toBe('1');
		expect(shell.route.route.name).toBe('home');
		expect(shell.getData().org.name).toBe('ORG 1');
		expect(shell.getData().seenRoute).toBe('home');
		expect(el.querySelector('h1').textContent).toBe('ORG 1');
		expect(el.querySelector('.home')).not.toBeNull();
	});

	it("the ancestor's prepared data() sees the DESTINATION params and route snapshot", async () => {
		const seen = [];
		const store = makeStore();
		class Shell extends PuzzleView {
			data(params) {
				seen.push({ arg: params.id, route: this.route?.params?.id ?? null });
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'org' }, [h('section', {}, [slot()])]);
			}
		}
		class Leaf extends PuzzleView {
			data() {
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'leaf' }, [text('L')]);
			}
		}
		const routes = [
			{
				path: '/org/:id',
				name: 'org',
				view: Shell,
				children: [
					{ path: 'home', name: 'home', view: Leaf },
					{ path: 'other', name: 'other', view: Leaf },
				],
			},
		];
		const { router } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');
		seen.length = 0;

		await router.push('/org/2/other');

		expect(seen.at(-1)).toEqual({ arg: '2', route: '2' });
		expect(router.current.params.id).toBe('2');
	});

	it('a successful navigation still moves the ancestor (params, route, data, DOM)', async () => {
		const { store, routes, getShell } = makeFixture();
		const { router, el } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');
		const shell = getShell();

		await router.push('/org/2/home');

		expect(shell.params.id).toBe('2');
		expect(shell.route.params.id).toBe('2');
		expect(shell.getData().org.name).toBe('ORG 2');
		expect(el.querySelector('h1').textContent).toBe('ORG 2');
		// Same instance — this was a REUSED ancestor, not a rebuild.
		expect(getShell()).toBe(shell);
	});

	it('N failed navigations leave the store subscription count stable', async () => {
		const { store, routes } = makeFixture();
		const { router } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const before = subCount(store);
		expect(before).toBeGreaterThan(0);

		for (let i = 0; i < 5; i++) {
			await router.push('/org/2/bad');
			await tick();
		}

		expect(subCount(store)).toBe(before);
		// And the surviving subscription set is still the OLD org's — no org-2 key
		// leaked in from a prepared-then-discarded run.
		const keys = [...store.keysBySubscriber.values()].flatMap((s) => [...s]);
		expect(keys.some((k) => k.includes('2'))).toBe(false);
	});

	it('a superseded navigation discards its prepared ancestor state', async () => {
		const store = makeStore();
		store.upsert('org', { id: '1', name: 'ORG 1' });
		store.upsert('org', { id: '2', name: 'ORG 2' });
		store.upsert('org', { id: '3', name: 'ORG 3' });

		let shell = null;
		class Shell extends PuzzleView {
			created() {
				shell = this;
			}
			data(params) {
				return { org: this.ctx.store.findOne('org', params.id) };
			}
			render() {
				return h('puzzle-view', { class: 'org' }, [
					h('h1', {}, [text(this.getData().org?.name ?? '?')]),
					h('section', {}, [slot()]),
				]);
			}
		}
		const slow = (ms) =>
			class extends PuzzleView {
				async data() {
					await new Promise((r) => setTimeout(r, ms));
					return {};
				}
				render() {
					return h('puzzle-view', { class: 'leaf' }, [text('L')]);
				}
			};
		const routes = [
			{
				path: '/org/:id',
				name: 'org',
				view: Shell,
				children: [
					{ path: 'home', name: 'home', view: slow(0) },
					{ path: 'slow', name: 'slow', view: slow(30) },
					{ path: 'fast', name: 'fast', view: slow(0) },
				],
			},
		];
		const { router, el } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');
		const subsBefore = subCount(store);

		const loser = router.push('/org/2/slow');
		await tick();
		const winner = router.push('/org/3/fast');
		await Promise.all([loser, winner]);
		await tick();

		expect(router.current.params.id).toBe('3');
		expect(shell.params.id).toBe('3');
		expect(shell.getData().org.name).toBe('ORG 3');
		expect(el.querySelector('h1').textContent).toBe('ORG 3');
		// The loser's prepared org-2 subscription was discarded, not stranded.
		expect(subCount(store)).toBe(subsBefore);
	});
});

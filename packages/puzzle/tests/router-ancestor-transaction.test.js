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
import { adapter } from '../client-runtime/datastore/adapter.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

adapter.install();

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);
const tick = () => new Promise((r) => setTimeout(r, 0));

class Org extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		name: Puzzle.string().required(),
	};
	static adapter = { endpoint: '/orgs' };
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

// ---------------------------------------------------------------------------
// Overlapping prepares, conflicting commits, exception safety, and the mid-gate
// scope fence — the four holes the 0.5.0 review opened on D146.
// ---------------------------------------------------------------------------

// A leaf whose data() blocks until the returned release() is called.
function gatedLeaf() {
	let release;
	const gate = new Promise((r) => {
		release = r;
	});
	class Gated extends PuzzleView {
		async data() {
			await gate;
			return {};
		}
		render() {
			return h('puzzle-view', { class: 'leaf' }, [text('L')]);
		}
	}
	return { Gated, release: () => release() };
}

describe('Router — D146 overlapping prepares (F1)', () => {
	it('a second push while a leaf data() is gated does not deaden the reused ancestor', async () => {
		const store = makeStore();
		store.upsert('org', { id: '1', name: 'ORG 1' });
		store.upsert('org', { id: '2', name: 'ORG 2' });

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
		class Fast extends PuzzleView {
			data() {
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'leaf' }, [text('L')]);
			}
		}
		const { Gated, release } = gatedLeaf();
		const routes = [
			{
				path: '/org/:id',
				name: 'org',
				view: Shell,
				children: [
					{ path: 'home', name: 'home', view: Fast },
					{ path: 'a', name: 'a', view: Gated },
					{ path: 'b', name: 'b', view: Fast },
				],
			},
		];
		const { router, el } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');

		// Nav 1 prepares the ancestor against org 2 and parks on the leaf's gate.
		const nav1 = router.push('/org/2/a');
		await tick();
		// Nav 2 supersedes it — and prepares the SAME org-2 key on the same ancestor.
		const nav2 = router.push('/org/2/b');
		release();
		await Promise.all([nav1, nav2]);
		await tick();

		expect(router.current.path).toBe('/org/2/b');
		expect(el.querySelector('h1').textContent).toBe('ORG 2');
		// The winner's key survived the loser's discard.
		const keys = [...(store.keysBySubscriber.get(shell) ?? [])];
		expect(keys.length).toBeGreaterThan(0);

		// The real symptom: the ancestor is still REACTIVE to the record it displays.
		store.upsert('org', { id: '2', name: 'RENAMED' });
		store.flush?.();
		await tick();
		expect(el.querySelector('h1').textContent).toBe('RENAMED');
	});
});

describe('Router — D146 conflicting commit convergence (F5)', () => {
	it('a mid-gate store edit is not clobbered by the prepared model (RENAMED! survives)', async () => {
		const store = makeStore();
		store.upsert('org', { id: '2', name: 'ORG 2' });

		let runs = 0;
		class Shell extends PuzzleView {
			data(params) {
				runs++;
				// A DERIVED value — the shape that cannot self-heal through the record.
				return { label: (this.ctx.store.findOne('org', params.id)?.name ?? '?') + '!' };
			}
			render() {
				return h('puzzle-view', { class: 'org' }, [
					h('h1', {}, [text(this.getData().label)]),
					h('section', {}, [slot()]),
				]);
			}
		}
		class Fast extends PuzzleView {
			data() {
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'leaf' }, [text('L')]);
			}
		}
		const { Gated, release } = gatedLeaf();
		const routes = [
			{
				path: '/org/:id',
				name: 'org',
				view: Shell,
				children: [
					{ path: 'home', name: 'home', view: Fast },
					{ path: 'a', name: 'a', view: Gated },
				],
			},
		];
		const { router, el } = await boot(routes, { store, router: null, formatters: null }, '/org/2/home');
		expect(el.querySelector('h1').textContent).toBe('ORG 2!');

		const nav = router.push('/org/2/a');
		await tick();
		// The user edits the record while the gate is open.
		store.upsert('org', { id: '2', name: 'RENAMED' });
		store.flush?.();
		await tick();
		expect(el.querySelector('h1').textContent).toBe('RENAMED!'); // the refresh landed

		release();
		await nav;
		await tick();
		await tick();

		expect(router.current.path).toBe('/org/2/a');
		// The prepared model predates the edit; committing it would revert the header.
		expect(el.querySelector('h1').textContent).toBe('RENAMED!');
		expect(runs).toBeGreaterThan(1);
	});

	it('the NON-conflicting path commits the prepared model with no extra data() run', async () => {
		const store = makeStore();
		store.upsert('org', { id: '1', name: 'ORG 1' });
		store.upsert('org', { id: '2', name: 'ORG 2' });

		let runs = 0;
		let renders = 0;
		class Shell extends PuzzleView {
			data(params) {
				runs++;
				return { org: this.ctx.store.findOne('org', params.id) };
			}
			render() {
				renders++;
				return h('puzzle-view', { class: 'org' }, [
					h('h1', {}, [text(this.getData().org?.name ?? '?')]),
					h('section', {}, [slot()]),
				]);
			}
		}
		class Fast extends PuzzleView {
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
					{ path: 'home', name: 'home', view: Fast },
					{ path: 'other', name: 'other', view: Fast },
				],
			},
		];
		const { router, el } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');
		// Drain the setup upserts' pending flush: a notify landing mid-gate would be a
		// legitimate F5 conflict and re-derive, which is not what this test measures.
		store.flush();
		await tick();
		runs = 0;
		renders = 0;

		await router.push('/org/2/other');
		await tick();

		expect(el.querySelector('h1').textContent).toBe('ORG 2');
		// Exactly the prepared run — D146's performance claim. The conflict path
		// (F5) would have re-derived, so this pins that it did not fire.
		expect(runs).toBe(1);
		// One commit render plus the chain's slot-content patch — no extra render
		// from a re-derive.
		expect(renders).toBe(2);
	});
});

describe('Router — D146 exception-safe prepared handles (F6)', () => {
	it('a throw inside the commit window still releases every prepared hold', async () => {
		const store = makeStore();
		store.upsert('org', { id: '1', name: 'ORG 1' });
		store.upsert('org', { id: '2', name: 'ORG 2' });
		vi.spyOn(console, 'error').mockImplementation(() => {});

		let shell = null;
		let boom = false;
		class Shell extends PuzzleView {
			created() {
				shell = this;
			}
			data(params) {
				return { org: this.ctx.store.findOne('org', params.id) };
			}
			render() {
				if (boom) throw new Error('render blew up in the commit window');
				return h('puzzle-view', { class: 'org' }, [
					h('h1', {}, [text(this.getData().org?.name ?? '?')]),
					h('section', {}, [slot()]),
				]);
			}
		}
		class Fast extends PuzzleView {
			data() {
				return {};
			}
			render() {
				return h('puzzle-view', { class: 'leaf' }, [text('L')]);
			}
		}
		const { Gated, release } = gatedLeaf();
		const routes = [
			{
				path: '/org/:id',
				name: 'org',
				view: Shell,
				children: [
					{ path: 'home', name: 'home', view: Fast },
					{ path: 'other', name: 'other', view: Gated },
				],
			},
		];
		const { router } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');

		const nav = router.push('/org/2/other');
		await tick();
		boom = true; // arms only for the commit-time render
		release();
		await nav.catch(() => {});
		await tick();
		boom = false;

		// No hold survives the throw — otherwise the ancestor's org-2 key is fenced
		// from every later reconcile for the rest of the session.
		const held = store._heldKeys.get(shell);
		expect(held === undefined || held.size === 0).toBe(true);

		// And a later navigation can still garbage-collect the ancestor's stale keys.
		await router.push('/org/1/home');
		await tick();
		const keys = [...(store.keysBySubscriber.get(shell) ?? [])];
		expect(keys.some((k) => k.includes('2'))).toBe(false);
	});
});

describe('Router — D146 mid-gate scope fence (F4)', () => {
	it('a DOM event handler mid-gate reads the COMMITTED params/route, and data() still sees the destination', async () => {
		const store = makeStore();
		store.upsert('org', { id: '1', name: 'ORG 1' });
		store.upsert('org', { id: '2', name: 'ORG 2' });

		let shell = null;
		const dataSaw = [];
		const clicks = [];
		let gate = null;
		class Shell extends PuzzleView {
			created() {
				shell = this;
			}
			async data(params) {
				// D47: the prepared run must see the DESTINATION.
				dataSaw.push({ arg: params.id, params: this.params.id, route: this.route?.params?.id ?? null });
				if (gate) await gate;
				return { org: this.ctx.store.findOne('org', params.id) };
			}
			onPoke() {
				clicks.push({ params: this.params.id, route: this.route?.params?.id ?? null });
			}
			render() {
				return h('puzzle-view', { class: 'org' }, [
					h('button', { '@click': () => this.onPoke() }, [text('poke')]),
					h('section', {}, [slot()]),
				]);
			}
		}
		class Fast extends PuzzleView {
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
					{ path: 'home', name: 'home', view: Fast },
					{ path: 'other', name: 'other', view: Fast },
				],
			},
		];
		const { router, el } = await boot(routes, { store, router: null, formatters: null }, '/org/1/home');
		dataSaw.length = 0;

		let release;
		gate = new Promise((r) => {
			release = r;
		});
		const nav = router.push('/org/2/other');
		await tick(); // the prepared data() is suspended on `gate`

		// Nothing has committed: URL and DOM are still org 1.
		expect(router.current.params.id).toBe('1');
		el.querySelector('button').dispatchEvent(new Event('click'));
		expect(clicks.at(-1)).toEqual({ params: '1', route: '1' });
		// Plain method calls from the runtime's own reentry points agree.
		expect(shell.getData().org.name).toBe('ORG 1');

		gate = null;
		release();
		await nav;
		await tick();

		// D47 invariant intact: the prepared data() itself saw the destination.
		expect(dataSaw.at(-1)).toEqual({ arg: '2', params: '2', route: '2' });
		// And after the commit the handler reads the new route.
		el.querySelector('button').dispatchEvent(new Event('click'));
		expect(clicks.at(-1)).toEqual({ params: '2', route: '2' });
	});
});

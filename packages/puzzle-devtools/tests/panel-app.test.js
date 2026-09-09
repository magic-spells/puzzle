import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * End-to-end-ish check of the PANEL APP against a stub bridge: protocol events
 * in, rendered DOM out. It runs the real compiled bundle, so it needs one, and
 * skips when there is none (a clean checkout, CI before `npm run build`).
 *
 *   node scripts/build.mjs   # or: cd panel && $PUZZLE_BIN build
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'panel', 'dist', 'app.js');
const built = existsSync(BUNDLE);

/**
 * The transcript the stub bridge answers from — the same shapes SPEC §55 and
 * test/fixture-page/index.html define, trimmed to what the panels render.
 *
 * A five-node, three-level tree: enough that collapsing FixtureHome visibly
 * removes rows, and that indentation has more than one step to get wrong.
 */
function transcript() {
	return {
		views: [
			{
				id: 1,
				name: 'FixtureLayout',
				module: 'layouts/Fixture.pzl',
				children: [
					{
						id: 2,
						name: 'FixtureHome',
						module: 'views/Home.pzl',
						children: [
							{ id: 3, name: 'FixtureRow', module: 'components/Row.pzl', children: [] },
							{ id: 4, name: 'FixtureRow', module: 'components/Row.pzl', children: [] },
						],
					},
					{ id: 5, name: 'FixtureNav', module: 'components/Nav.pzl', children: [] },
				],
			},
		],
		inspect: {
			// A layout that queries nothing — absent from byView, so it exercises
			// the inspector's "no store subscriptions" case.
			1: {
				name: 'FixtureLayout',
				module: 'layouts/Fixture.pzl',
				params: {},
				props: {},
				model: { title: 'Fixture' },
				local: {},
			},
			2: {
				name: 'FixtureHome',
				module: 'views/Home.pzl',
				params: { filter: 'active' },
				props: {},
				// `note` is longer than PREVIEW_MAX, so its cell is elided — the full
				// value then has to survive somewhere reachable. See the title test.
				model: { todos: 3, activeTodos: 2, note: 'n'.repeat(240) },
				local: { newTodoText: 'half typed', currentFilter: 'active' },
			},
			// `completed` lives in BOTH layers with different values — the split the
			// Views panel exists to show.
			3: {
				name: 'FixtureRow',
				module: 'components/Row.pzl',
				params: {},
				props: { todo: 't2', index: 1 },
				model: { label: 'Ship the panel', completed: false },
				local: { completed: true, draft: 'Ship the panel now' },
			},
		},
		records: {
			todo: [
				{ id: 't1', text: 'Ship the bridge', completed: true, priority: 1, _synced: true },
				{ id: 't2', text: 'Ship the panel', completed: false, priority: 2, _synced: false },
			],
			user: [{ id: 'u1', name: 'Ada', email: 'ada@example.com', active: true, _synced: true }],
		},
		// Both rail groups populated. Record keys use the runtime's REC_SEP, a SPACE
		// (store.js) — live keys read `todo t2`, never `todo:t2`.
		subscriptions: {
			byKey: {
				todo: [2, 3],
				user: ['fn'],
				'todo t2': [3, 4],
			},
			byView: {
				2: ['todo'],
				3: ['todo', 'todo t2'],
				4: ['todo t2'],
				fn: ['user'],
			},
			// Nothing is mid-navigation by default: the held-key tests fill this in,
			// so every other assertion here also covers the empty case (and a
			// runtime that predates `held` entirely).
			held: {},
		},
		route: {
			path: '/todos?filter=active',
			pathname: '/todos',
			query: { filter: 'active' },
			hash: '',
			params: { id: 't2' },
			route: '/todos/:id',
			routes: ['/', '/todos/:id'],
			chain: ['FixtureLayout', 'FixtureHome'],
			title: 'Todos',
		},
		// Nothing has been profiled yet — what `snapshot:profile` answers before
		// the first `perf:start`.
		profile: idleProfile(),
	};
}

const ZERO_TOTALS = {
	renders: 0,
	wastedRenders: 0,
	domMutations: 0,
	dataRuns: 0,
	storeFlushes: 0,
	storeNotifications: 0,
};

function idleProfile() {
	return {
		recording: false,
		durationMs: 0,
		totals: { ...ZERO_TOTALS },
		views: [],
		flushes: [],
		warnings: [],
	};
}

/**
 * A recorded profile over the transcript's five views.
 *
 * #3 is the pathological one — 24 renders, 21 of which changed nothing — so the
 * default wasted-descending sort has an unambiguous top row, and #1 is the
 * honest one (2 renders, none wasted) so the table is not uniformly alarming.
 * Totals are summed from the rows rather than written out, so they cannot drift
 * from the numbers the table prints.
 */
function recordedProfile() {
	const views = [
		{
			id: 1, name: 'FixtureLayout', module: 'layouts/Fixture.pzl',
			renders: 2, wastedRenders: 0, domMutations: 3,
			renderMs: 0.8, patchMs: 0.6, dataMs: 0.4,
			causes: { route: 2 }, memoHits: 1, memoMisses: 0, propsBailouts: 0, propsReruns: 2,
		},
		{
			id: 2, name: 'FixtureHome', module: 'views/Home.pzl',
			renders: 9, wastedRenders: 2, domMutations: 14,
			renderMs: 17.1, patchMs: 12.6, dataMs: 8.1,
			causes: { data: 5, store: 3, route: 1 }, memoHits: 6, memoMisses: 3, propsBailouts: 2, propsReruns: 7,
		},
		{
			id: 3, name: 'FixtureRow', module: 'components/Row.pzl',
			renders: 24, wastedRenders: 21, domMutations: 2,
			renderMs: 74.4, patchMs: 62.4, dataMs: 28.8,
			causes: { store: 18, parent: 6 }, memoHits: 2, memoMisses: 22, propsBailouts: 0, propsReruns: 24,
		},
		{
			id: 4, name: 'FixtureRow', module: 'components/Row.pzl',
			renders: 11, wastedRenders: 3, domMutations: 9,
			renderMs: 16.5, patchMs: 12.1, dataMs: 6.6,
			causes: { store: 7, parent: 4 }, memoHits: 5, memoMisses: 6, propsBailouts: 3, propsReruns: 8,
		},
		{
			id: 5, name: 'FixtureNav', module: 'components/Nav.pzl',
			renders: 6, wastedRenders: 4, domMutations: 1,
			renderMs: 4.8, patchMs: 3.6, dataMs: 3,
			causes: { data: 4, parent: 2 }, memoHits: 1, memoMisses: 5, propsBailouts: 1, propsReruns: 5,
		},
	];

	const totals = views.reduce(
		(acc, view) => ({
			...acc,
			renders: acc.renders + view.renders,
			wastedRenders: acc.wastedRenders + view.wastedRenders,
			domMutations: acc.domMutations + view.domMutations,
			dataRuns: acc.dataRuns + (view.causes.data ?? 0) + (view.causes.store ?? 0),
		}),
		{ ...ZERO_TOTALS }
	);

	const flushes = [
		{ at: 1000, keys: ['todo'], notified: 2, durationMs: 0.7 },
		{ at: 2000, keys: ['todo', 'todo t2'], notified: 3, durationMs: 1.2 },
	];
	totals.storeFlushes = flushes.length;
	totals.storeNotifications = flushes.reduce((sum, flush) => sum + flush.notified, 0);

	return { recording: true, durationMs: 4200, totals, views, flushes, warnings: [] };
}

/**
 * Stand-in for panel-glue's bridge: the same surface, driven by the test.
 *
 * `request` reproduces panel-glue's error contract exactly — the runtime is
 * total and reports failures as an `{ error }` RESULT, which the glue unwraps
 * into a REJECTION. Mirroring that here is what lets the panel handle a §20
 * validation failure on one code path instead of two.
 */
function stubBridge() {
	const subs = { message: [], status: [], nav: [] };
	const requests = [];
	const world = transcript();

	return {
		tabId: 1,
		themeName: 'dark',
		requests,
		world,
		/** Every request type the panels can issue; values may be functions of the payload. */
		responses: {
			'snapshot:views': () => ({ roots: world.views }),
			'inspect:view': ({ id }) =>
				world.inspect[id] ?? { error: `no live view with id ${JSON.stringify(id)}` },
			'snapshot:records': ({ type } = {}) => {
				const types = {};
				for (const name of Object.keys(world.records)) {
					if (type != null && type !== name) continue;
					types[name] = world.records[name].map((row) => ({ ...row }));
				}
				return { types };
			},
			'edit:record': ({ type, id, patch }) => {
				const row = (world.records[type] ?? []).find((r) => String(r.id) === String(id));
				if (!row) return { error: `no ${type} record with id ${JSON.stringify(id)}` };
				// One canned validation rule, matching the fixture page's.
				if ('text' in patch && String(patch.text).trim() === '') {
					return { error: 'text cannot be empty' };
				}
				Object.assign(row, patch);
				return { ok: true };
			},
			'snapshot:subscriptions': () => ({
				byKey: { ...world.subscriptions.byKey },
				byView: { ...world.subscriptions.byView },
				held: { ...world.subscriptions.held },
			}),
			'snapshot:route': () => ({ ...world.route }),
			'highlight:view': () => ({ ok: true }),
			'log:view': () => ({ ok: true }),
			'perf:start': () => {
				world.profile = recordedProfile();
				return { ok: true };
			},
			'perf:stop': () => {
				world.profile = { ...world.profile, recording: false };
				return { ok: true };
			},
			// Deep-cloned: the panel stores the report whole, and a shared
			// reference would let a rendered sample mutate the world behind it.
			'snapshot:profile': () => JSON.parse(JSON.stringify(world.profile)),
		},
		onMessage(cb) {
			subs.message.push(cb);
			return () => {};
		},
		onStatus(cb) {
			subs.status.push(cb);
			return () => {};
		},
		onNavigated(cb) {
			subs.nav.push(cb);
			return () => {};
		},
		async request(type, payload) {
			requests.push([type, payload]);
			if (!(type in this.responses)) throw new Error(`stub has no answer for ${type}`);
			const answer = this.responses[type];
			const result = typeof answer === 'function' ? answer(payload ?? {}) : answer;
			if (result && typeof result === 'object' && typeof result.error === 'string') {
				throw new Error(result.error);
			}
			return result;
		},
		sendListening: () => true,
		emit(type, payload = {}) {
			subs.message.forEach((cb) => cb({ puzzle: 1, v: 1, type, payload }, 1));
		},
		setStatus(status) {
			subs.status.forEach((cb) => cb(status));
		},
		/** What panel-glue fires from chrome.devtools.network.onNavigated. */
		navigate(url = 'https://example.test/next') {
			subs.nav.forEach((cb) => cb(url));
		},
		/** Request types issued so far, in order. */
		typesRequested() {
			return requests.map(([type]) => type);
		},
		/** Payloads of every request of one type. */
		payloadsFor(type) {
			return requests.filter(([t]) => t === type).map(([, payload]) => payload);
		},
	};
}

/** Writes the CopyButton piece made, newest last. Reset by every boot(). */
const clipboardWrites = [];

/**
 * jsdom ships no Clipboard API, and CopyButton bails silently without one
 * (`if (!navigator.clipboard?.writeText) return`) — so a missing stub would make
 * every copy assertion pass vacuously. Install a recorder instead.
 */
function stubClipboard() {
	clipboardWrites.length = 0;
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: (text) => {
				clipboardWrites.push(text);
				return Promise.resolve();
			},
		},
	});
}

async function boot(bridge) {
	// jsdom keeps one location per test FILE, so a nav in an earlier test would
	// otherwise decide where the next boot lands.
	window.history.replaceState(null, '', '/');
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.setAttribute('data-theme', 'dark');
	// SplitPanel persists committed sizes under `split-panel:<storageKey>`; a
	// leftover from an earlier test would decide the next boot's pane widths.
	window.localStorage?.clear?.();
	stubClipboard();
	window.__PUZZLE_DEVTOOLS_PANEL__ = bridge;
	vi.resetModules();
	const mod = await import(/* @vite-ignore */ BUNDLE);
	await settle();
	return mod.default;
}

/**
 * Let the store's batched flush and the router's async commit land.
 *
 * `ms` covers the panels' own debounces (120ms tree, 150ms inspect, 200ms store
 * re-snapshot); the trailing flush picks up store writes the awaited request
 * made partway through the wait.
 */
async function settle(app, ms = 30) {
	app?.store?.flush?.();
	await new Promise((r) => setTimeout(r, ms));
	app?.store?.flush?.();
	await new Promise((r) => setTimeout(r, 10));
}

/** hello + app-mounted — the handshake every panel gates its requests on. */
async function connect(bridge, app) {
	bridge.emit('hello', { protocolVersion: 1, frameworkVersion: '0.2.0-fixture' });
	bridge.emit('app-mounted');
	await settle(app);
}

/** Route to a panel and give its mount-time request time to land. */
async function open(app, path, ms = 60) {
	await app.router.push(path);
	await settle(app, ms);
}

/* ---- DOM readers ---------------------------------------------------------- */

const treeRow = (id) => document.querySelector(`[data-view-id="${id}"]`);
const treeIds = () =>
	[...document.querySelectorAll('[data-view-id]')].map((el) => el.getAttribute('data-view-id'));
const typeNames = () =>
	[...document.querySelectorAll('[data-type]')].map((el) => el.getAttribute('data-type'));
const rowKeys = () =>
	[...document.querySelectorAll('[data-row]')].map((el) => el.getAttribute('data-row'));
const fieldNames = () =>
	[...document.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field'));

/** A StateGroup's own root, found by its title — not the section that wraps the pair. */
function groupFor(title) {
	return [...document.querySelectorAll('h3')]
		.find((h) => h.textContent.trim() === title)
		?.closest('section');
}

/** The SplitPanel piece's own structure: two named panes around one separator. */
const splitPane = (which) => document.querySelector(`[data-split-pane="${which}"]`);
const splitDivider = () => document.querySelector('[data-split-divider]');

/** The Empty piece's root — its base class string is the only stable handle. */
const emptyBlocks = () => [...document.querySelectorAll('div.text-center.items-center')];
/** Subscription rail rows, per group. */
const subKeysIn = (group) =>
	[...document.querySelectorAll(`[data-group="${group}"] [data-sub-key]`)].map((el) =>
		el.getAttribute('data-sub-key')
	);
const subscriberRows = () => [...document.querySelectorAll('[data-subscriber]')];
/** CopyButton renders an icon-only <button aria-label="Copy">. */
const copyButtonIn = (root) => root?.querySelector('button[aria-label="Copy"]');

/* Performance panel readers. */
const recordButton = () => document.querySelector('[data-perf-record]');
const perfRow = (id) => document.querySelector(`[data-perf-view="${id}"]`);
const perfRowIds = () =>
	[...document.querySelectorAll('[data-perf-view]')].map((el) => el.getAttribute('data-perf-view'));
const perfHeader = (key) => document.querySelector(`[data-perf-sort="${key}"]`);
const perfHeatIn = (id) => perfRow(id)?.querySelector('[data-perf-heat]');
const perfTotal = (key) => document.querySelector(`[data-perf-total="${key}"]`);
const profilePulls = (bridge) =>
	bridge.typesRequested().filter((type) => type === 'snapshot:profile').length;

function type(input, value) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe.skipIf(!built)('panel app (compiled bundle)', () => {
	let bridge;

	beforeEach(() => {
		bridge = stubBridge();
	});

	it('gives the Connection panel the same refresh guidance', async () => {
		await boot(bridge);
		// Connection's no-hello state is hand-written rather than an Empty piece,
		// so it needs its own assertion that the guidance is there too.
		expect(document.body.textContent).toContain(
			'If this page loaded before the extension was installed or updated, refresh the page.'
		);
	});

	it('renders the "no Puzzle app detected" state before any hello', async () => {
		await boot(bridge);
		expect(document.body.textContent).toContain('No Puzzle app detected');
		// Nav shell is present too.
		expect(document.body.textContent).toContain('Connection');
		expect(document.body.textContent).toContain('Views');
		expect(document.body.textContent).toContain('Store');
	});

	it('puts the nav and the status chip in one top bar', async () => {
		const app = await boot(bridge);

		// Nav lives IN the header now, not in a left sidebar.
		const header = document.querySelector('header');
		const nav = header.querySelector('nav[aria-label="Panels"]');
		expect(nav).toBeTruthy();
		expect([...nav.querySelectorAll('a')].map((a) => a.textContent.trim())).toEqual([
			'Connection',
			'Views',
			'Store',
			'Subscriptions',
			'Router',
			'Performance',
		]);

		// The status chip is the last child of the bar and pushed right by ml-auto.
		const chip = header.lastElementChild;
		expect(chip.className).toContain('ml-auto');
		expect(chip.textContent).toContain('no app');
		expect(chip.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

		bridge.emit('hello', { protocolVersion: 1, frameworkVersion: '0.2.0' });
		bridge.emit('app-mounted');
		await settle(app);
		expect(document.querySelector('header').lastElementChild.textContent).toContain('connected');
	});

	it('marks the active panel in the top-bar nav', async () => {
		const app = await boot(bridge);
		await connect(bridge, app);
		await open(app, '/views');

		const active = [...document.querySelectorAll('nav a')].filter((a) =>
			a.className.includes('bg-accent-soft')
		);
		expect(active.map((a) => a.textContent.trim())).toEqual(['Views']);
	});

	it('writes hash-mode nav hrefs, so panel.html stays loadable on reload', async () => {
		await boot(bridge);
		const hrefs = [...document.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual([
			'#/',
			'#/views',
			'#/store',
			'#/subscriptions',
			'#/router',
			'#/performance',
		]);
	});

	it('routes between panels', async () => {
		// Driven through the router rather than by clicking the anchor: jsdom does
		// not implement link navigation, so a click would never change the hash.
		const app = await boot(bridge);
		await connect(bridge, app);

		await open(app, '/views');
		expect(document.body.textContent).toContain('Tree');
		expect(document.body.textContent).toContain('Select a view to inspect');

		await open(app, '/store');
		expect(document.body.textContent).toContain('Types');
		expect(typeNames()).toEqual(['todo', 'user']);
	});

	it('subscribes to the page hook on install', async () => {
		const spy = vi.spyOn(bridge, 'sendListening');
		await boot(bridge);
		expect(spy).toHaveBeenCalled();
	});

	it('moves to the connected state on hello + app-mounted', async () => {
		const app = await boot(bridge);
		bridge.emit('hello', { protocolVersion: 1, frameworkVersion: '0.2.0-fixture' });
		bridge.emit('app-mounted');
		await settle(app);

		expect(document.body.textContent).toContain('Puzzle app connected');
		expect(document.body.textContent).toContain('0.2.0-fixture');
	});

	it('shows the version-mismatch state for an unsupported protocol', async () => {
		const app = await boot(bridge);
		bridge.emit('hello', { protocolVersion: 99, frameworkVersion: '9.9.9' });
		await settle(app);

		expect(document.body.textContent).toContain('Protocol version mismatch');
		expect(document.body.textContent).toContain('v99');
	});

	it('tracks view mount/destroy into the pview model', async () => {
		const app = await boot(bridge);
		bridge.emit('hello', { protocolVersion: 1, frameworkVersion: '0.2.0' });
		bridge.emit('app-mounted');
		bridge.emit('view-mounted', { id: 1, name: 'FixtureLayout', module: 'layouts/Fixture.pzl' });
		bridge.emit('view-mounted', { id: 2, name: 'FixtureHome', module: 'views/Home.pzl' });
		bridge.emit('view-destroyed', { id: 2 });
		await settle(app);

		const views = app.store.findMany('pview');
		expect(views.map((v) => [v.id, v.name, v.live])).toEqual([
			[1, 'FixtureLayout', true],
			[2, 'FixtureHome', false],
		]);
	});

	it('records protocol messages into the capped event ring', async () => {
		const app = await boot(bridge);
		bridge.emit('hello', { protocolVersion: 1, frameworkVersion: '0.2.0' });
		bridge.emit('flush', { keys: ['todo'], notified: [1, 2] });
		bridge.emit('route-commit', {
			pathname: '/todos',
			query: {},
			params: {},
			chain: ['FixtureLayout'],
			title: 'Todos',
		});
		await settle(app);

		const events = app.store.findMany('event');
		expect(events.map((e) => e.type)).toEqual(['hello', 'flush', 'route-commit']);
		expect(app.store.findOne('connection', 'main').route.pathname).toBe('/todos');
		expect(document.body.textContent).toContain('route-commit');
	});

	it('marks a record type stale when a flush names its key', async () => {
		const app = await boot(bridge);
		// createRecord, not upsert: `store.upsert()` is the server-sync merge and
		// sits behind the opt-in adapter capability (D157), which this panel does
		// not enable.
		app.store.createRecord('recordType', { id: 'todo', records: [], count: 0, dirty: false });
		bridge.emit('flush', { keys: ['todo t2', 'todo'], notified: [1] });
		await settle(app);

		expect(app.store.findOne('recordType', 'todo').dirty).toBe(true);
	});

	it('clears the session when the inspected page navigates', async () => {
		const app = await boot(bridge);
		bridge.emit('hello', { protocolVersion: 1, frameworkVersion: '0.2.0' });
		bridge.emit('view-mounted', { id: 1, name: 'A', module: null });
		await settle(app);
		expect(app.store.findMany('pview')).toHaveLength(1);

		bridge.navigate();
		await settle(app);

		expect(app.store.findMany('pview')).toHaveLength(0);
		expect(app.store.findOne('connection', 'main').state).toBe('waiting');
		expect(document.body.textContent).toContain('No Puzzle app detected');
	});
});

/* ========================================================================== */

describe.skipIf(!built)('Views panel', () => {
	let bridge;
	let app;

	beforeEach(async () => {
		bridge = stubBridge();
		app = await boot(bridge);
		await connect(bridge, app);
		await open(app, '/views');
	});

	it('lays the panes out in a resizable SplitPanel', () => {
		const first = splitPane('first');
		const second = splitPane('second');
		expect(first).toBeTruthy();
		expect(second).toBeTruthy();

		// Tree on the left, inspector on the right — the piece's named slots.
		expect(first.contains(treeRow('1'))).toBe(true);
		expect(first.textContent).toContain('Tree');
		expect(second.textContent).toContain('Select a view to inspect');

		const divider = splitDivider();
		expect(divider.getAttribute('role')).toBe('separator');
		// A horizontal split has a vertically-oriented separator.
		expect(divider.getAttribute('aria-orientation')).toBe('vertical');
		expect(divider.getAttribute('aria-disabled')).toBe('false');
		expect(divider.getAttribute('tabindex')).toBe('0');
		expect(Number(divider.getAttribute('aria-valuenow'))).toBe(30); // defaultSizes[0]

		// Exactly one scrolling element per pane: the slot root clips, so the
		// piece's own overflow-auto pane never gets a second scrollbar.
		expect(first.firstElementChild.className).toContain('overflow-hidden');
		expect(second.firstElementChild.className).toContain('overflow-hidden');

		// The old fixed-width rail is gone; width is the piece's business now.
		expect(document.querySelector('.w-64')).toBeNull();
	});

	it('renders the tree from a snapshot:views transcript, indented by depth', () => {
		expect(bridge.typesRequested()).toContain('snapshot:views');
		expect(treeIds()).toEqual(['1', '2', '3', '4', '5']);

		expect(document.body.textContent).toContain('FixtureLayout');
		// The row prints the BASENAME only; the full path moved to the tooltip.
		expect(treeRow('1').textContent).toContain('Fixture.pzl');
		expect(treeRow('1').textContent).not.toContain('layouts/Fixture.pzl');
		expect(treeRow('1').getAttribute('title')).toBe('layouts/Fixture.pzl');

		// One flat keyed list; depth is padding, not nesting.
		expect(treeRow('1').style.paddingLeft).toBe('7px');
		expect(treeRow('2').style.paddingLeft).toBe('19px');
		expect(treeRow('3').style.paddingLeft).toBe('31px');
		expect(treeRow('5').style.paddingLeft).toBe('19px');
	});

	it('draws one indent guide per ancestor level', () => {
		// The guide gradient is clipped by background-size, so its width IS the
		// ancestor count times the step. Roots draw none.
		expect(treeRow('1').style.backgroundSize).toBe('0px 100%');
		expect(treeRow('2').style.backgroundSize).toBe('12px 100%');
		expect(treeRow('3').style.backgroundSize).toBe('24px 100%');
		expect(treeRow('5').style.backgroundSize).toBe('12px 100%');
		expect(treeRow('3').className).toContain('dt-tree-row');
	});

	it('renders chevrons as inlined SVG that rotates when open', async () => {
		const twisty = document.querySelector('[data-twisty="2"]');
		const svg = twisty.querySelector('svg');

		// {#svg} inlines the real file, so there is a live <path>, not a text glyph.
		// A FILLED triangle (matching the pieces Tree's disclosure), not a stroked caret.
		expect(svg).toBeTruthy();
		expect(svg.querySelector('path')).toBeTruthy();
		expect(svg.getAttribute('fill')).toBe('currentColor');
		expect(twisty.textContent.trim()).toBe('');

		// Open → rotated, so one glyph serves both states.
		expect(twisty.className).toContain('rotate-90');
		expect(twisty.className).toContain('transition-transform');

		twisty.click();
		await settle(app);
		expect(document.querySelector('[data-twisty="2"]').className).not.toContain('rotate-90');
	});

	it('colors a kind dot per row and bars the active row', async () => {
		const dot = (id) => treeRow(id).querySelector('[data-kind-dot]').className;
		expect(dot('1')).toContain('bg-accent'); // layouts/
		expect(dot('2')).toContain('bg-ok'); // views/
		expect(dot('3')).toContain('bg-faint'); // components/

		treeRow('3').click();
		await settle(app, 60);
		expect(treeRow('3').className).toContain('dt-row-selected');
		expect(treeRow('3').className).toContain('bg-accent-soft');

		// Selection and pulse now ride different CSS properties, so a selected row
		// that re-renders shows both at once.
		bridge.emit('flush', { keys: ['todo'], notified: [3] });
		await settle(app);
		expect(treeRow('3').className).toContain('dt-row-selected');
		expect(treeRow('3').className).toContain('dt-pulse');
	});

	it('collapses and re-expands a node without selecting it', async () => {
		document.querySelector('[data-twisty="2"]').click();
		await settle(app);
		expect(treeIds()).toEqual(['1', '2', '5']);

		// @click:stop keeps the twisty from also selecting the row.
		expect(bridge.typesRequested()).not.toContain('inspect:view');

		document.querySelector('[data-twisty="2"]').click();
		await settle(app);
		expect(treeIds()).toEqual(['1', '2', '3', '4', '5']);
	});

	it('keeps collapse state across a re-snapshot', async () => {
		document.querySelector('[data-twisty="2"]').click();
		await settle(app);
		expect(treeIds()).toEqual(['1', '2', '5']);

		bridge.emit('view-mounted', { id: 5, name: 'FixtureNav', module: 'components/Nav.pzl' });
		await settle(app, 200);

		expect(bridge.typesRequested().filter((t) => t === 'snapshot:views')).toHaveLength(2);
		expect(treeIds()).toEqual(['1', '2', '5']);
	});

	it('selection requests inspect:view and renders BOTH state layers', async () => {
		treeRow('3').click();
		await settle(app, 60);

		expect(bridge.payloadsFor('inspect:view')).toEqual([{ id: 3 }]);

		const model = groupFor('data() model layer');
		const local = groupFor('setData() local layer');
		expect(model).toBeTruthy();
		expect(local).toBeTruthy();

		// `completed` exists in both layers with DIFFERENT values — the split is
		// the panel's whole reason to exist, so each side must show only its own.
		expect(model.textContent).toMatch(/completed[\s\S]*false/);
		expect(local.textContent).toMatch(/completed[\s\S]*true/);
		expect(model.textContent).toContain('Ship the panel');
		expect(local.textContent).toContain('Ship the panel now');
		expect(model.textContent).not.toContain('draft');

		// params and props are their own groups, above the pair.
		expect(groupFor('props').textContent).toContain('t2');
		expect(groupFor('params').textContent).toContain('no route params');

		// And the explainer that says which one wins.
		expect(document.body.textContent).toContain(
			'a later setData() wins until the next data() commit'
		);
	});

	it('lets the value win the width fight against the key', async () => {
		treeRow('3').click();
		await settle(app, 60);

		const key = [...groupFor('props').querySelectorAll('dt')].find(
			(dt) => dt.textContent.trim() === 'todo'
		);
		const value = key.nextElementSibling;

		// The bug this pins: with a `shrink-0` key and no basis on the value, the
		// key took whatever it wanted and the value was left with zero effective
		// width — rendering as nothing but its ellipsis in a half-width card.
		expect(key.className).toContain('max-w-[40%]');
		expect(key.className).toContain('truncate');
		expect(value.className).toContain('flex-1'); // basis 0 → takes the remainder
		expect(value.className).toContain('min-w-0'); // ...and may shrink below content
		expect(value.className).toContain('truncate');
	});

	it('keeps the full value reachable when the cell elides it', async () => {
		treeRow('2').click();
		await settle(app, 60);

		const key = [...groupFor('data() model layer').querySelectorAll('dt')].find(
			(dt) => dt.textContent.trim() === 'note'
		);
		const value = key.nextElementSibling;

		expect(value.textContent.trim().endsWith('…')).toBe(true);
		expect(value.textContent.trim().length).toBeLessThan(200);
		// Truncation is presentational only — hover still yields the whole thing.
		expect(value.getAttribute('title')).toBe(`"${'n'.repeat(240)}"`);

		// Short values get a title too, so hover is never a guess about length.
		const short = [...groupFor('props').querySelectorAll('dd')];
		expect(short.every((dd) => dd.hasAttribute('title'))).toBe(true);
	});

	it('renders the Empty piece for the no-selection state', () => {
		const empty = emptyBlocks();
		expect(empty).toHaveLength(1);
		expect(empty[0].textContent).toContain('Select a view to inspect');
		// The hand-rolled dashed card it replaced is gone.
		expect(document.querySelector('.border-dashed')).toBeNull();
	});

	it('copies an inspector row value to the clipboard', async () => {
		treeRow('3').click();
		await settle(app, 60);

		const local = groupFor('setData() local layer');
		const row = [...local.querySelectorAll('dt')].find(
			(dt) => dt.textContent.trim() === 'draft'
		).parentElement;

		// The button sits inside the row, after the value, and must not have
		// disturbed the value-wins layout.
		const button = copyButtonIn(row);
		expect(button).toBeTruthy();
		expect(button.className).toContain('shrink-0');
		expect(row.querySelector('dd').className).toContain('flex-1');

		button.click();
		await settle(app, 40);

		// A string copies as its CONTENTS, not as the quoted literal the cell shows.
		expect(clipboardWrites).toEqual(['Ship the panel now']);
		expect(row.querySelector('dd').getAttribute('title')).toBe('"Ship the panel now"');
	});

	it('shows the selected view’s store subscriptions beside its state', async () => {
		treeRow('3').click();
		await settle(app, 80);

		const group = groupFor('subscriptions');
		expect(group).toBeTruthy();
		expect(group.textContent).toContain('todo');
		expect(group.textContent).toContain('todo t2');
		expect(group.textContent).toContain("re-runs this view's data()");

		// One snapshot serves inspect AND the Subscriptions panel — not two.
		expect(bridge.typesRequested().filter((t) => t === 'snapshot:subscriptions')).toHaveLength(1);
	});

	it('marks the keys a prepared, uncommitted data() run added', async () => {
		// D146: #3 is mid-navigation, so `todo t2` is subscribed but not committed.
		// It is a REAL subscription and shows up in byView too — the mark is what
		// keeps a reused ancestor listing two routes' keys from reading as a leak.
		bridge.world.subscriptions.held = { 3: ['todo t2'] };

		treeRow('3').click();
		await settle(app, 80);

		const rows = [...groupFor('subscriptions').querySelectorAll('dl > div')];
		const labels = rows.map((row) => row.querySelector('dt').textContent);
		expect(labels).toEqual(['todo', 'todo t2']);
		expect(rows[0].querySelector('dd').textContent).toBe(''); // committed
		expect(rows[1].querySelector('dd').textContent).toContain('pending');
		expect(rows[1].querySelector('dd').getAttribute('title')).toContain('uncommitted');
	});

	it('says so when a view subscribes to nothing', async () => {
		treeRow('1').click(); // FixtureLayout is absent from byView
		await settle(app, 80);

		expect(groupFor('subscriptions').textContent).toContain('no store subscriptions');
	});

	it('reports an inspect:view failure inline instead of blanking the pane', async () => {
		// No transcript entry for id 5 → the bridge answers { error }, which
		// panel-glue turns into a rejection.
		treeRow('5').click();
		await settle(app, 60);

		expect(document.body.textContent).toContain('no live view with id 5');
	});

	it('pulses exactly the rows a flush notified', async () => {
		expect(document.querySelectorAll('.dt-pulse')).toHaveLength(0);

		// 'fn' is the literal SPEC §55 uses for function subscribers; it matches no row.
		bridge.emit('flush', { keys: ['todo'], notified: [2, 4, 'fn'] });
		await settle(app);

		const lit = [...document.querySelectorAll('.dt-pulse')].map((el) =>
			el.getAttribute('data-view-id')
		);
		expect(lit.sort()).toEqual(['2', '4']);
	});

	it('re-inspects the selected view only when the flush named it', async () => {
		treeRow('3').click();
		await settle(app, 60);
		const before = bridge.payloadsFor('inspect:view').length;

		bridge.emit('flush', { keys: ['todo'], notified: [4] });
		await settle(app, 220);
		expect(bridge.payloadsFor('inspect:view')).toHaveLength(before);

		bridge.emit('flush', { keys: ['todo'], notified: [3] });
		await settle(app, 220);
		expect(bridge.payloadsFor('inspect:view')).toHaveLength(before + 1);
		expect(bridge.payloadsFor('inspect:view').at(-1)).toEqual({ id: 3 });
	});

	it('sends highlight:view on hover and clears it on mouseleave', async () => {
		treeRow('2').dispatchEvent(new MouseEvent('mouseenter'));
		await settle(app);
		treeRow('2').dispatchEvent(new MouseEvent('mouseleave'));
		await settle(app);

		expect(bridge.payloadsFor('highlight:view')).toEqual([
			{ id: 2, on: true },
			{ id: 2, on: false },
		]);
	});

	it('clears the previous highlight when the selection moves', async () => {
		treeRow('2').click();
		await settle(app, 60);
		treeRow('3').click();
		await settle(app, 60);

		expect(bridge.payloadsFor('highlight:view')).toEqual([{ id: 2, on: false }]);
		expect(bridge.payloadsFor('inspect:view')).toEqual([{ id: 2 }, { id: 3 }]);
	});

	it('sends log:view and confirms with a $p hint', async () => {
		document.querySelector('[data-log="3"]').click();
		await settle(app, 60);

		expect(bridge.payloadsFor('log:view')).toEqual([{ id: 3 }]);
		expect(document.body.textContent).toContain('#3 logged as $p');
		// @click:stop again: logging a row must not select it.
		expect(bridge.typesRequested()).not.toContain('inspect:view');
	});

	it('coalesces a burst of view-mounted events into one re-snapshot', async () => {
		const before = bridge.typesRequested().filter((t) => t === 'snapshot:views').length;

		bridge.world.views[0].children[0].children.push({
			id: 9,
			name: 'FixtureRow',
			module: 'components/Row.pzl',
			children: [],
		});
		bridge.emit('view-mounted', { id: 9, name: 'FixtureRow', module: 'components/Row.pzl' });
		bridge.emit('view-mounted', { id: 10, name: 'Ghost', module: null });
		await settle(app, 220);

		const after = bridge.typesRequested().filter((t) => t === 'snapshot:views').length;
		expect(after).toBe(before + 1);

		expect(treeIds()).toContain('9');
		// The snapshot is authoritative about what is live, so a view it does not
		// name is dropped from the tree even though its mount event arrived.
		expect(treeIds()).not.toContain('10');
	});

	it('walks the visible rows with the arrow keys', async () => {
		const list = document.querySelector('[aria-label="View tree"]');
		list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await settle(app, 60);
		expect(bridge.payloadsFor('inspect:view')).toEqual([{ id: 1 }]);

		list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await settle(app, 60);
		list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		await settle(app, 60);
		expect(bridge.payloadsFor('inspect:view').at(-1)).toEqual({ id: 3 });

		list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		await settle(app, 60);
		expect(bridge.payloadsFor('inspect:view').at(-1)).toEqual({ id: 2 });
	});

	it('shows an empty state and asks for nothing when no app is connected', async () => {
		const fresh = stubBridge();
		const other = await boot(fresh);
		await open(other, '/views');

		expect(document.body.textContent).toContain('No Puzzle app detected');
		expect(treeIds()).toHaveLength(0);
		expect(fresh.typesRequested()).toEqual([]);

		// The Empty piece, in its title + description form.
		const empty = emptyBlocks();
		expect(empty).toHaveLength(1);
		expect(empty[0].querySelector('p.font-medium').textContent).toBe('No Puzzle app detected');
		expect(empty[0].textContent).toContain('dev-only runtime bridge');
		// The page-hook injects at document_start, so a tab opened before the
		// extension existed can never connect without a reload. Say so.
		expect(empty[0].textContent).toContain(
			'If this page loaded before the extension was installed or updated, refresh the page.'
		);
	});
});

/* ========================================================================== */

describe.skipIf(!built)('Store panel', () => {
	let bridge;
	let app;

	beforeEach(async () => {
		bridge = stubBridge();
		app = await boot(bridge);
		await connect(bridge, app);
		await open(app, '/store');
	});

	it('lays the rail and the table out in a resizable SplitPanel', () => {
		const first = splitPane('first');
		const second = splitPane('second');
		expect(first).toBeTruthy();
		expect(second).toBeTruthy();

		expect(first.textContent).toContain('Types');
		expect(first.querySelector('[data-type="todo"]')).toBeTruthy();
		expect(second.querySelector('[data-row="t1"]')).toBeTruthy();

		const divider = splitDivider();
		expect(divider.getAttribute('role')).toBe('separator');
		expect(divider.getAttribute('aria-orientation')).toBe('vertical');
		expect(Number(divider.getAttribute('aria-valuenow'))).toBe(25); // defaultSizes[0]

		expect(first.firstElementChild.className).toContain('overflow-hidden');
		expect(second.firstElementChild.className).toContain('overflow-hidden');
		expect(document.querySelector('.w-40')).toBeNull();
	});

	it('lists record types with counts and auto-selects the first', () => {
		expect(bridge.payloadsFor('snapshot:records')).toEqual([{}]);
		expect(typeNames()).toEqual(['todo', 'user']);

		const todo = document.querySelector('[data-type="todo"]');
		expect(todo.textContent).toContain('2');
		expect(document.querySelector('[data-type="user"]').textContent).toContain('1');
		expect(rowKeys()).toEqual(['t1', 't2']);
	});

	it('renders a compact table: pk first, then fields, with _synced as a badge', () => {
		const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent.trim());
		expect(headers[0]).toBe('id');
		expect(headers).toEqual(['id', 'text', 'completed', 'priority', 'sync']);
		// _synced is a badge column, never a data column.
		expect(headers).not.toContain('_synced');

		expect(document.querySelector('[data-row="t1"]').textContent).toContain('synced');
		expect(document.querySelector('[data-row="t2"]').textContent).toContain('local');
		expect(document.querySelector('[data-row="t1"]').textContent).toContain('Ship the bridge');
	});

	it('renders _synced provenance with the Badge piece', () => {
		const synced = document.querySelector('[data-row="t1"] td:last-child span');
		const local = document.querySelector('[data-row="t2"] td:last-child span');

		expect(synced.textContent.trim()).toBe('synced');
		expect(local.textContent.trim()).toBe('local');
		// Badge's own base class, compacted to DevTools scale by the class prop.
		expect(synced.className).toContain('rounded-full');
		expect(synced.className).toContain('text-[9px]!');
		// Distinct variants, not just distinct text.
		expect(synced.className).not.toBe(local.className);
	});

	it('copies a field value and the whole record as JSON', async () => {
		document.querySelector('[data-row="t2"]').click();
		await settle(app);

		copyButtonIn(document.querySelector('[data-field="text"]')).click();
		await settle(app, 40);
		expect(clipboardWrites).toEqual(['Ship the panel']);

		// The detail header's button copies the record, pretty-printed.
		const header = document.querySelector('[data-apply]').closest('header');
		copyButtonIn(header).click();
		await settle(app, 40);

		expect(clipboardWrites).toHaveLength(2);
		expect(JSON.parse(clipboardWrites[1])).toEqual({
			id: 't2',
			text: 'Ship the panel',
			completed: false,
			priority: 2,
			_synced: false,
		});
		expect(clipboardWrites[1]).toContain('\n'); // pretty-printed, not one line
	});

	it('renders the Empty piece when a type has no records', async () => {
		bridge.world.records.user = [];
		document.querySelector('[data-type="user"]').click();
		await settle(app);
		await bridge.request('snapshot:records', { type: 'user' });

		// Force a re-read so the emptied bucket reaches the table.
		bridge.emit('flush', { keys: ['user'], notified: [] });
		await settle(app, 260);

		expect(rowKeys()).toEqual([]);
		const empty = emptyBlocks();
		expect(empty.length).toBeGreaterThan(0);
		expect(empty.map((e) => e.textContent).join(' ')).toContain('No records of this type');
	});

	it('switches the active type', async () => {
		document.querySelector('[data-type="user"]').click();
		await settle(app);

		expect(rowKeys()).toEqual(['u1']);
		expect(document.querySelector('[data-row="u1"]').textContent).toContain('ada@example.com');
	});

	it('opens a detail card listing every field, with the pk read-only', async () => {
		document.querySelector('[data-row="t2"]').click();
		await settle(app);

		expect(fieldNames()).toEqual(['id', 'text', 'completed', 'priority', '_synced']);
		// The pk is immutable in the app's store, and _synced is bridge provenance.
		expect(document.querySelector('[data-field="id"] input')).toBeNull();
		expect(document.querySelector('[data-field="_synced"] input')).toBeNull();
		expect(document.querySelector('[data-field="completed"] input').type).toBe('checkbox');
		expect(document.querySelector('[data-field="text"] input').value).toBe('Ship the panel');

		// Same width discipline as the inspector: bounded key, value takes the rest,
		// full text on hover for the read-only fields that truncate.
		const key = document.querySelector('[data-field="text"] dt');
		expect(key.className).toContain('max-w-[35%]');
		expect(key.className).toContain('truncate');
		expect(document.querySelector('[data-field="_synced"] span[title]')).toBeTruthy();
		expect(document.querySelector('[data-row="t1"] td[title]')).toBeTruthy();
	});

	it('applies an edit through edit:record and re-snapshots the type', async () => {
		document.querySelector('[data-row="t2"]').click();
		await settle(app);

		type(document.querySelector('[data-field="text"] input'), 'Ship the panel v2');
		document.querySelector('[data-apply]').click();
		await settle(app, 80);

		expect(bridge.payloadsFor('edit:record')).toEqual([
			{ type: 'todo', id: 't2', patch: { text: 'Ship the panel v2' } },
		]);
		// Re-read after the write, so the table shows the app's store, not our patch.
		expect(bridge.payloadsFor('snapshot:records').at(-1)).toEqual({ type: 'todo' });
		expect(document.querySelector('[data-row="t2"]').textContent).toContain('Ship the panel v2');
	});

	it('coerces a checkbox and a number back into their original types', async () => {
		document.querySelector('[data-row="t2"]').click();
		await settle(app);

		const done = document.querySelector('[data-field="completed"] input');
		done.checked = true;
		done.dispatchEvent(new Event('change', { bubbles: true }));
		type(document.querySelector('[data-field="priority"] input'), '5');

		document.querySelector('[data-apply]').click();
		await settle(app, 80);

		expect(bridge.payloadsFor('edit:record')).toEqual([
			{ type: 'todo', id: 't2', patch: { completed: true, priority: 5 } },
		]);
	});

	it('renders a validation error inline without losing the typed input', async () => {
		document.querySelector('[data-row="t1"]').click();
		await settle(app);

		type(document.querySelector('[data-field="text"] input'), '   ');
		document.querySelector('[data-apply]').click();
		await settle(app, 80);

		expect(document.body.textContent).toContain('text cannot be empty');
		expect(document.querySelector('[data-field="text"] input').value).toBe('   ');
		// The store was not touched, so the table still shows the old value.
		expect(document.querySelector('[data-row="t1"]').textContent).toContain('Ship the bridge');
	});

	it('reports a malformed number before it ever reaches the wire', async () => {
		document.querySelector('[data-row="t1"]').click();
		await settle(app);

		type(document.querySelector('[data-field="priority"] input'), 'soon');
		document.querySelector('[data-apply]').click();
		await settle(app, 80);

		expect(document.body.textContent).toContain('priority: expected a number');
		expect(bridge.typesRequested()).not.toContain('edit:record');
	});

	it('records a changelog for the watched record as flushes land', async () => {
		document.querySelector('[data-row="t2"]').click();
		await settle(app);
		expect(document.querySelector('[data-history]').textContent).toContain('No changes yet');

		// Something else mutates the record; the flush makes us re-read it.
		bridge.world.records.todo[1].text = 'Ship the panel v2';
		bridge.world.records.todo[1].priority = 9;
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		await settle(app, 260);

		const entries = [...document.querySelectorAll('[data-history-entry]')];
		expect(entries).toHaveLength(2);
		const text = entries.map((e) => e.textContent.replace(/\s+/g, ' ')).join(' | ');
		expect(text).toContain('text');
		expect(text).toContain('Ship the panel');
		expect(text).toContain('Ship the panel v2');
		expect(text).toContain('priority');

		// A flush that changes nothing appends nothing.
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		await settle(app, 260);
		expect(document.querySelectorAll('[data-history-entry]')).toHaveLength(2);
	});

	it('clears the changelog when the watched record changes', async () => {
		document.querySelector('[data-row="t2"]').click();
		await settle(app);
		bridge.world.records.todo[1].text = 'changed';
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		await settle(app, 260);
		expect(document.querySelectorAll('[data-history-entry]').length).toBeGreaterThan(0);

		document.querySelector('[data-row="t1"]').click();
		await settle(app);
		expect(document.querySelectorAll('[data-history-entry]')).toHaveLength(0);
		expect(document.querySelector('[data-history]').textContent).toContain('No changes yet');
	});

	it('re-snapshots only the active type when a flush arrives', async () => {
		const before = bridge.payloadsFor('snapshot:records').length;

		bridge.world.records.todo[0].text = 'Changed elsewhere';
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		await settle(app, 260);

		const payloads = bridge.payloadsFor('snapshot:records');
		expect(payloads).toHaveLength(before + 1);
		expect(payloads.at(-1)).toEqual({ type: 'todo' });
		expect(document.querySelector('[data-row="t1"]').textContent).toContain('Changed elsewhere');
	});

	it('shows an empty state and asks for nothing when no app is connected', async () => {
		const fresh = stubBridge();
		const other = await boot(fresh);
		await open(other, '/store');

		expect(document.body.textContent).toContain('No Puzzle app detected');
		expect(typeNames()).toHaveLength(0);
		expect(fresh.typesRequested()).toEqual([]);
		expect(document.body.textContent).toContain(
			'If this page loaded before the extension was installed or updated, refresh the page.'
		);
	});
});

/* ========================================================================== */

describe.skipIf(!built)('Subscriptions panel', () => {
	let bridge;
	let app;

	beforeEach(async () => {
		bridge = stubBridge();
		app = await boot(bridge);
		await connect(bridge, app);
		await open(app, '/subscriptions');
	});

	it('splits the rail into Collections and Records with subscriber counts', () => {
		expect(bridge.typesRequested()).toContain('snapshot:subscriptions');

		// Bare `type` keys are collections; `type:id` keys are records.
		expect(subKeysIn('collection')).toEqual(['todo', 'user']);
		expect(subKeysIn('record')).toEqual(['todo t2']);

		const todo = document.querySelector('[data-sub-key="todo"]');
		expect(todo.textContent).toContain('2'); // two subscribers
		expect(document.querySelector('[data-sub-key="todo t2"]').textContent).toContain('2');

		expect(document.body.textContent).toContain('Collections');
		expect(document.body.textContent).toContain('Records');
	});

	it('lists the subscriber views for the selected key', async () => {
		document.querySelector('[data-sub-key="todo"]').click();
		await settle(app);

		expect(document.querySelector('[data-sub-key="todo"]').className).toContain(
			'dt-row-selected'
		);

		// Ids resolve against the pview collection for name + module.
		const rows = subscriberRows();
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('FixtureHome');
		expect(rows[1].textContent).toContain('FixtureRow');
		// Same row language as the tree: a kind dot per entry.
		expect(rows[0].querySelector('[data-kind-dot]')).toBeTruthy();
	});

	it('labels the merged function-subscriber bucket', async () => {
		document.querySelector('[data-sub-key="user"]').click();
		await settle(app);

		const rows = subscriberRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain('function subscriber');
		// Not navigable — there is no identity behind it to show.
		expect(rows[0].textContent).not.toContain('show in views');
	});

	it('pulses the keys a flush names', async () => {
		expect(document.querySelectorAll('.dt-pulse')).toHaveLength(0);

		bridge.emit('flush', { keys: ['todo', 'todo t2'], notified: [2, 3] });
		await settle(app);

		const lit = [...document.querySelectorAll('[data-sub-key].dt-pulse')].map((el) =>
			el.getAttribute('data-sub-key')
		);
		expect(lit.sort()).toEqual(['todo', 'todo t2']);
	});

	it('re-snapshots the graph on flush, debounced', async () => {
		const before = bridge.typesRequested().filter((t) => t === 'snapshot:subscriptions').length;

		bridge.world.subscriptions.byKey.todo = [2];
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		await settle(app, 260);

		const after = bridge.typesRequested().filter((t) => t === 'snapshot:subscriptions').length;
		expect(after).toBe(before + 1); // coalesced
		expect(document.querySelector('[data-sub-key="todo"]').textContent).toContain('1');
	});

	it('marks held keys pending instead of counting them as settled subscribers', async () => {
		// An open navigation: #3 prepared both keys, #4 prepared the record key.
		// `todo` is then partly held (1 of 2) and `todo t2` wholly held (2 of 2) —
		// the two states the chip has to tell apart.
		bridge.world.subscriptions.held = { 3: ['todo', 'todo t2'], 4: ['todo t2'] };
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		await settle(app, 260);

		expect(document.querySelector('[data-held="todo"]').textContent).toContain('1 pending');
		expect(document.querySelector('[data-held="todo t2"]').textContent.trim()).toBe('pending');
		// Held subscribers are still subscribers: the count is unchanged.
		expect(document.querySelector('[data-sub-key="todo"]').textContent).toContain('2');
		// A key with nothing held carries no chip at all.
		expect(document.querySelector('[data-held="user"]')).toBeNull();
	});

	it('explains a held key on the detail side, per subscriber', async () => {
		bridge.world.subscriptions.held = { 3: ['todo'] };
		bridge.emit('flush', { keys: ['todo'], notified: [2] });
		await settle(app, 260);

		document.querySelector('[data-sub-key="todo"]').click();
		await settle(app);

		expect(document.querySelector('[data-held-note]').textContent).toContain('not a leak');

		const rows = subscriberRows();
		expect(rows[0].textContent).toContain('FixtureHome'); // #2, committed
		expect(rows[0].querySelector('[data-subscriber-held]')).toBeNull();
		expect(rows[1].textContent).toContain('FixtureRow'); // #3, prepared
		expect(rows[1].querySelector('[data-subscriber-held]')).toBeTruthy();
	});

	it('shows no held marks against a runtime that does not report them', () => {
		// `held` absent (or empty) has to render exactly as this panel did before
		// the field existed — the whole reason it went in additively.
		expect(document.querySelector('[data-held]')).toBeNull();
		expect(document.querySelector('[data-held-note]')).toBeNull();
	});

	it('clicking a subscriber opens it in the Views panel, already selected', async () => {
		document.querySelector('[data-sub-key="todo"]').click();
		await settle(app);

		subscriberRows()[1].click(); // FixtureRow, view #3
		await settle(app, 120);

		// Navigated...
		expect(window.location.hash).toBe('#/views');
		expect(treeIds().length).toBeGreaterThan(0);
		// ...and the Views panel adopted the hand-off.
		expect(treeRow('3').className).toContain('dt-row-selected');
		expect(bridge.payloadsFor('inspect:view')).toContainEqual({ id: 3 });

		// The intent is consumed, not sticky.
		expect(app.store.findOne('ui', 'main').pendingViewId).toBeNull();
	});

	it('shows the refresh guidance when no app is connected', async () => {
		const fresh = stubBridge();
		const other = await boot(fresh);
		await open(other, '/subscriptions');

		expect(document.body.textContent).toContain('No Puzzle app detected');
		expect(document.body.textContent).toContain(
			'If this page loaded before the extension was installed or updated, refresh the page.'
		);
		expect(fresh.typesRequested()).toEqual([]);
	});
});

/* ========================================================================== */

describe.skipIf(!built)('Router panel', () => {
	let bridge;
	let app;

	beforeEach(async () => {
		bridge = stubBridge();
		app = await boot(bridge);
		await connect(bridge, app);
		await open(app, '/router');
	});

	it('renders the current-route card from snapshot:route', () => {
		expect(bridge.typesRequested()).toContain('snapshot:route');

		expect(document.querySelector('[data-pathname]').textContent.trim()).toBe('/todos');
		expect(document.body.textContent).toContain('/todos/:id'); // matched pattern

		// params and query render as key/value groups.
		expect(groupFor('params').textContent).toContain('id');
		expect(groupFor('params').textContent).toContain('t2');
		expect(groupFor('query').textContent).toContain('filter');
		expect(groupFor('query').textContent).toContain('active');
	});

	it('renders the matched chain root to leaf with the leaf emphasized', () => {
		const rows = [...document.querySelectorAll('[data-chain-row]')];
		expect(rows.map((r) => r.getAttribute('data-chain-row'))).toEqual([
			'0-FixtureLayout',
			'1-FixtureHome',
		]);
		// Pattern beside the view name, zipped by index.
		expect(rows[0].textContent).toContain('/');
		expect(rows[1].textContent).toContain('/todos/:id');
		// Only the leaf is marked.
		expect(rows[1].textContent).toContain('leaf');
		expect(rows[0].textContent).not.toContain('leaf');
		expect(rows[1].className).toContain('bg-accent-soft');
	});

	it('builds a newest-first history feed from the event ring', async () => {
		// No extra recording: these are the same route-commit events the
		// Connection panel's message list already holds.
		bridge.emit('route-commit', { pathname: '/todos', query: {}, params: {}, title: 'Todos' });
		bridge.emit('route-commit', { pathname: '/about', query: {}, params: {}, title: 'About' });
		await settle(app, 140);

		const rows = [...document.querySelectorAll('[data-history-row]')];
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('/about'); // newest first
		expect(rows[0].textContent).toContain('About');
		expect(rows[1].textContent).toContain('/todos');
	});

	it('re-reads the route after a commit', async () => {
		const before = bridge.typesRequested().filter((t) => t === 'snapshot:route').length;

		bridge.world.route.pathname = '/about';
		bridge.world.route.route = '/about';
		bridge.emit('route-commit', { pathname: '/about', query: {}, params: {}, title: 'About' });
		await settle(app, 160);

		expect(bridge.typesRequested().filter((t) => t === 'snapshot:route').length).toBe(before + 1);
		expect(document.querySelector('[data-pathname]').textContent.trim()).toBe('/about');
	});

	it('shows the refresh guidance when no app is connected', async () => {
		const fresh = stubBridge();
		const other = await boot(fresh);
		await open(other, '/router');

		expect(document.body.textContent).toContain('No Puzzle app detected');
		expect(document.body.textContent).toContain('refresh the page.');
		expect(fresh.typesRequested()).toEqual([]);
	});
});

/* ========================================================================== */

describe.skipIf(!built)('Performance panel', () => {
	let bridge;
	let app;

	beforeEach(async () => {
		bridge = stubBridge();
		app = await boot(bridge);
		await connect(bridge, app);
		await open(app, '/performance');
	});

	/** Press Record and let perf:start + the first profile pull land. */
	async function record() {
		recordButton().click();
		await settle(app, 80);
	}

	it('pulls a profile on arrival and shows the idle state until there is one', () => {
		expect(bridge.typesRequested()).toContain('snapshot:profile');
		// A report full of zeros is not worth a screen of empty tiles.
		expect(document.body.textContent).toContain('Nothing profiled yet');
		expect(perfRowIds()).toEqual([]);
		expect(recordButton().textContent).toContain('Record');
		expect(recordButton().getAttribute('aria-pressed')).toBe('false');
	});

	it('starts a recording with perf:start and renders the report', async () => {
		await record();

		expect(bridge.payloadsFor('perf:start')).toEqual([{}]);
		expect(recordButton().textContent).toContain('Stop');
		expect(recordButton().getAttribute('aria-pressed')).toBe('true');
		expect(document.querySelector('[data-perf-elapsed]').textContent.trim()).toBe('4.2s');
		expect(document.body.textContent).not.toContain('Nothing profiled yet');
	});

	it('gives wasted renders the headline, with its share of all renders', async () => {
		await record();

		// 0 + 2 + 21 + 3 + 4 across the five views.
		expect(document.querySelector('[data-perf-wasted]').textContent.trim()).toBe('30');
		expect(perfTotal('wastedRenders').textContent).toContain('58%');
		expect(perfTotal('wastedRenders').textContent).toContain('Wasted renders');
		expect(perfTotal('wastedRenders').textContent).toContain('no DOM mutations');

		// The supporting tiles are present but visually secondary.
		expect(perfTotal('renders').textContent).toContain('52');
		expect(perfTotal('domMutations').textContent).toContain('29');
		expect(perfTotal('storeFlushes').textContent).toContain('2');
	});

	it('opens on worst-waste-first, the metric the panel is about', async () => {
		await record();
		// wasted: #3=21, #5=4, #4=3, #2=2, #1=0
		expect(perfRowIds()).toEqual(['3', '5', '4', '2', '1']);

		const wasted = perfHeader('wasted');
		expect(wasted.getAttribute('aria-sort')).toBe('descending');
		// The arrow, not just the colour, marks the sorted column.
		expect(wasted.textContent).toContain('▼');
	});

	it('re-sorts on a column click and toggles that column on a second click', async () => {
		await record();

		perfHeader('renders').click();
		await settle(app, 40);
		expect(perfRowIds()).toEqual(['3', '4', '2', '5', '1']);
		expect(perfHeader('renders').getAttribute('aria-sort')).toBe('descending');
		expect(perfHeader('wasted').getAttribute('aria-sort')).toBe('none');

		perfHeader('renders').click();
		await settle(app, 40);
		expect(perfRowIds()).toEqual(['1', '5', '2', '4', '3']);
		expect(perfHeader('renders').textContent).toContain('▲');

		// A name sort opens ascending, because that is what sorting names means.
		perfHeader('name').click();
		await settle(app, 40);
		expect(perfHeader('name').getAttribute('aria-sort')).toBe('ascending');
	});

	it('prints every timing column beside the counts', async () => {
		await record();
		const row = perfRow('3');
		expect(row.textContent).toContain('24'); // renders
		expect(row.textContent).toContain('21'); // wasted
		expect(row.textContent).toContain('74.4'); // render ms
		expect(row.textContent).toContain('62.4'); // patch ms
		expect(row.textContent).toContain('28.8'); // data ms
		expect(row.getAttribute('title')).toContain('causes: store 18 · parent 6');
	});

	it('scales the heat bar against the busiest view', async () => {
		await record();

		const hottest = perfHeatIn('3'); // 24 of 24 renders
		expect(hottest.getAttribute('data-perf-heat')).toBe('4');
		expect(hottest.className).toContain('bg-heat-4');
		expect(hottest.style.width).toBe('100%');

		const coldest = perfHeatIn('1'); // 2 of 24
		expect(coldest.getAttribute('data-perf-heat')).toBe('1');
		expect(coldest.className).toContain('bg-heat-1');
		expect(coldest.style.width).toBe('8%');
	});

	it('never lets colour be the only signal', async () => {
		await record();

		// High waste is hatched as well as hot, so the two facts stay separable
		// without hue; and the count is printed either way.
		expect(perfHeatIn('3').className).toContain('dt-heat-hatch');
		expect(perfHeatIn('1').className).not.toContain('dt-heat-hatch');
		expect(perfRow('3').textContent).toContain('88%');
		// The bar itself is decorative — the numbers beside it carry the meaning.
		expect(perfHeatIn('3').closest('[aria-hidden="true"]')).toBeTruthy();
	});

	it('surfaces a pushed perf-warning prominently, without waiting for a poll', async () => {
		await record();
		expect(document.querySelector('[data-perf-warnings]')).toBeNull();

		bridge.emit('perf-warning', {
			kind: 'runaway-rerender',
			viewId: 3,
			name: 'FixtureRow',
			detail: 'rendered 24 times with no DOM change',
			count: 3,
		});
		await settle(app, 220);

		const warnings = document.querySelector('[data-perf-warnings]');
		expect(warnings).toBeTruthy();
		expect(warnings.textContent).toContain('Render loops detected');
		expect(warnings.textContent).toContain('runaway re-render');
		expect(warnings.textContent).toContain('FixtureRow');
		expect(warnings.textContent).toContain('rendered 24 times with no DOM change');
		expect(warnings.textContent).toContain('×3');
		expect(document.querySelector('[data-perf-warning="runaway-rerender"]')).toBeTruthy();
	});

	it('pulls a fresh profile when a warning fires, even while not recording', async () => {
		const before = profilePulls(bridge);
		bridge.emit('perf-warning', { kind: 'recursive-loop', viewId: 2, name: 'FixtureHome', count: 1 });
		await settle(app, 220);

		// The event bumps a counter; the panel debounces one pull off it. That is
		// the same mechanism every other panel uses — not a second polling path.
		expect(profilePulls(bridge)).toBe(before + 1);
		expect(document.querySelector('[data-perf-warnings]').textContent).toContain('recursive loop');
	});

	it('summarizes a perf-warning in the shared event ring', async () => {
		bridge.emit('perf-warning', {
			kind: 'runaway-rerender',
			viewId: 3,
			name: 'FixtureRow',
			count: 5,
		});
		await settle(app, 60);

		const event = app.store.findMany('event').at(-1);
		expect(event.type).toBe('perf-warning');
		expect(event.summary).toBe('runaway-rerender · FixtureRow ×5');
	});

	it('polls the profile while recording, and only while recording', async () => {
		const idle = profilePulls(bridge);
		// Nothing is recording yet, so nothing is being polled.
		await settle(app, 1200);
		expect(profilePulls(bridge)).toBe(idle);

		await record();
		const started = profilePulls(bridge);
		await settle(app, 1200);
		const polled = profilePulls(bridge);
		expect(polled).toBeGreaterThan(started);

		// ...and the tree is NOT polled along with it.
		expect(bridge.typesRequested().filter((t) => t === 'snapshot:views').length).toBeLessThan(3);
	});

	it('stops the recording and the polling with perf:stop', async () => {
		await record();
		recordButton().click();
		await settle(app, 80);

		expect(bridge.payloadsFor('perf:stop')).toEqual([{}]);
		expect(recordButton().textContent).toContain('Record');
		expect(document.body.textContent).toContain('showing the last report');

		const settled = profilePulls(bridge);
		await settle(app, 1200);
		expect(profilePulls(bridge)).toBe(settled);

		// Stopped is not blank: the counters stay on screen.
		expect(perfRowIds()).toEqual(['3', '5', '4', '2', '1']);
	});

	it('adopts a recording that was already running when the panel mounted', async () => {
		// Someone pressed Record, then switched to another panel and back.
		bridge.world.profile = recordedProfile();
		await open(app, '/views');
		await open(app, '/performance');

		expect(recordButton().textContent).toContain('Stop');
		// No second perf:start — the runtime is authoritative about what is running.
		expect(bridge.typesRequested()).not.toContain('perf:start');
	});

	it('clicking a view row opens it in the Views panel, already selected', async () => {
		await record();

		perfRow('3').click();
		await settle(app, 120);

		expect(window.location.hash).toBe('#/views');
		expect(treeRow('3').className).toContain('dt-row-selected');
		expect(bridge.payloadsFor('inspect:view')).toContainEqual({ id: 3 });
		// The intent is consumed, not sticky.
		expect(app.store.findOne('ui', 'main').pendingViewId).toBeNull();
	});

	it('renders a profiled view the page has since destroyed, but does not link it', async () => {
		await record();
		bridge.emit('view-destroyed', { id: 3 });
		// The snapshot is authoritative about what is live; drop #3 from the tree.
		bridge.world.views[0].children[0].children = [
			{ id: 4, name: 'FixtureRow', module: 'components/Row.pzl', children: [] },
		];
		await settle(app, 260);
		recordButton().click(); // stop, which re-pulls both profile and tree
		await settle(app, 120);

		const gone = perfRow('3');
		expect(gone).toBeTruthy();
		expect(gone.getAttribute('title')).toContain('no longer mounted');
		gone.click();
		await settle(app, 80);
		// Still on the Performance panel — there is nothing to select.
		expect(window.location.hash).not.toBe('#/views');
	});

	it('lists the store flushes the recording captured', async () => {
		await record();
		const flushes = document.querySelector('[data-perf-flushes]');
		expect(flushes.textContent).toContain('todo, todo t2');
		expect(flushes.textContent).toContain('3 notified');
		expect(document.querySelectorAll('[data-perf-flush]')).toHaveLength(2);
	});

	it('clears the profile when the inspected page navigates', async () => {
		await record();
		expect(app.store.findMany('profileSample').length).toBeGreaterThan(0);

		bridge.navigate();
		await settle(app);

		// A profile names views by session-scoped ids the new document is about
		// to reuse — keeping it would report the old page's counters under the
		// new page's views.
		expect(app.store.findMany('profileSample')).toHaveLength(0);
		expect(document.body.textContent).toContain('No Puzzle app detected');
	});

	it('reports a framework with no profiler inline instead of blanking', async () => {
		// What a pre-profiler runtime does: an { error } result, which panel-glue
		// turns into a rejection.
		bridge.responses['perf:start'] = () => ({ error: 'unknown devtools request "perf:start"' });
		await record();

		expect(document.querySelector('[data-perf-error]').textContent).toContain(
			'unknown devtools request'
		);
		expect(recordButton().textContent).toContain('Record');
	});

	it('shows the refresh guidance and asks for nothing when no app is connected', async () => {
		const fresh = stubBridge();
		const other = await boot(fresh);
		await open(other, '/performance');

		expect(document.body.textContent).toContain('No Puzzle app detected');
		expect(document.body.textContent).toContain(
			'If this page loaded before the extension was installed or updated, refresh the page.'
		);
		expect(fresh.typesRequested()).toEqual([]);
	});
});

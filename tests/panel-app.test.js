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
	};
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
			'highlight:view': () => ({ ok: true }),
			'log:view': () => ({ ok: true }),
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

async function boot(bridge) {
	// jsdom keeps one location per test FILE, so a nav in an earlier test would
	// otherwise decide where the next boot lands.
	window.history.replaceState(null, '', '/');
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.setAttribute('data-theme', 'dark');
	// SplitPanel persists committed sizes under `split-panel:<storageKey>`; a
	// leftover from an earlier test would decide the next boot's pane widths.
	window.localStorage?.clear?.();
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

function type(input, value) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe.skipIf(!built)('panel app (compiled bundle)', () => {
	let bridge;

	beforeEach(() => {
		bridge = stubBridge();
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
		expect(hrefs).toEqual(['#/', '#/views', '#/store']);
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
		app.store.upsert('recordType', { id: 'todo', records: [], count: 0, dirty: false });
		bridge.emit('flush', { keys: ['todo:t2', 'todo'], notified: [1] });
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
		expect(document.body.textContent).toContain('layouts/Fixture.pzl');

		// One flat keyed list; depth is padding, not nesting.
		expect(treeRow('1').style.paddingLeft).toBe('8px');
		expect(treeRow('2').style.paddingLeft).toBe('20px');
		expect(treeRow('3').style.paddingLeft).toBe('32px');
		expect(treeRow('5').style.paddingLeft).toBe('20px');
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
	});
});

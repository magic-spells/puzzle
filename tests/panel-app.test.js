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

/** Stand-in for panel-glue's bridge: the same surface, driven by the test. */
function stubBridge() {
	const subs = { message: [], status: [], nav: [] };
	const requests = [];
	return {
		tabId: 1,
		themeName: 'dark',
		requests,
		responses: {
			'snapshot:views': {
				roots: [
					{
						id: 1,
						name: 'FixtureLayout',
						module: 'layouts/Fixture.pzl',
						children: [{ id: 2, name: 'FixtureHome', module: 'views/Home.pzl', children: [] }],
					},
				],
			},
			'snapshot:records': { types: { todo: [{ id: 't1' }, { id: 't2' }], user: [{ id: 'u1' }] } },
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
			if (type in this.responses) return this.responses[type];
			throw new Error(`stub has no answer for ${type}`);
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
	};
}

async function boot(bridge) {
	// jsdom keeps one location per test FILE, so a nav in an earlier test would
	// otherwise decide where the next boot lands.
	window.history.replaceState(null, '', '/');
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.setAttribute('data-theme', 'dark');
	window.__PUZZLE_DEVTOOLS_PANEL__ = bridge;
	vi.resetModules();
	const mod = await import(/* @vite-ignore */ BUNDLE);
	await settle();
	return mod.default;
}

/** Let the store's batched flush and the router's async commit land. */
async function settle(app) {
	app?.store?.flush?.();
	await new Promise((r) => setTimeout(r, 30));
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

	it('writes hash-mode nav hrefs, so panel.html stays loadable on reload', async () => {
		await boot(bridge);
		const hrefs = [...document.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(['#/', '#/views', '#/store']);
	});

	it('routes between panels', async () => {
		// Driven through the router rather than by clicking the anchor: jsdom does
		// not implement link navigation, so a click would never change the hash.
		const app = await boot(bridge);

		await app.router.push('/views');
		await settle(app);
		expect(document.body.textContent).toContain('The component tree, per-view inspector');

		await app.router.push('/store');
		await settle(app);
		expect(document.body.textContent).toContain('Record browsing by type');
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

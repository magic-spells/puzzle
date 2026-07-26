import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { extensionSource, repoFile } from './helpers/sandbox.js';
import { EVENTS, REQUESTS, SOURCE_HOOK, SOURCE_PANEL, CONTROL } from '../protocol/constants.js';

/*
 * The fixture page is the permanent protocol test double: it plays the part of
 * the framework's dev-only runtime bridge so the extension can be exercised
 * without a Puzzle app. This suite drives the REAL page-hook against the REAL
 * fixture script and asserts both halves of the contract — the event stream and
 * every request's response shape.
 *
 * Chrome is not involved; the transport under test is the page-hook side of
 * window.postMessage, which is where the fixture and the extension actually meet.
 */

const FIXTURE_HTML = repoFile('test', 'fixture-page', 'index.html');

/** The fixture's single inline script — its whole bridge implementation. */
function fixtureScript() {
	const match = FIXTURE_HTML.match(/<script>([\s\S]*?)<\/script>/);
	if (!match) throw new Error('fixture page has no inline script');
	return match[1];
}

describe('fixture page ↔ page hook', () => {
	let dom;
	let window;
	let sent;
	let nextId;

	beforeEach(() => {
		dom = new JSDOM(FIXTURE_HTML, {
			runScripts: 'outside-only', // inline scripts stay inert until we eval them
			url: 'http://localhost:5177/',
			pretendToBeVisual: true,
		});
		window = dom.window;
		sent = [];
		window.postMessage = (message) => sent.push(message);
		nextId = 1;

		window.eval(extensionSource('page-hook.js'));
		window.eval(fixtureScript());
	});

	afterEach(() => {
		// The fixture arms a 2s flush interval and a 5s route-commit timer.
		dom.window.close();
	});

	function attach() {
		window.dispatchEvent(
			new window.MessageEvent('message', {
				data: { source: SOURCE_PANEL, control: CONTROL.LISTENING },
				source: window,
			})
		);
	}

	/** Issue a request the way panel-glue does and return the hook's answer. */
	function request(type, payload = {}) {
		const id = nextId++;
		window.dispatchEvent(
			new window.MessageEvent('message', {
				data: {
					source: SOURCE_PANEL,
					id,
					message: { puzzle: 1, v: 1, type, payload },
				},
				source: window,
			})
		);
		const reply = sent.find((m) => m.id === id);
		expect(reply, `no answer for ${type}`).toBeTruthy();
		expect(reply.source).toBe(SOURCE_HOOK);
		return reply;
	}

	it('registers with the hook and reports it in the page', () => {
		expect(window.document.getElementById('status').textContent).toMatch(/hook found/);
	});

	it('replays hello → app-mounted → one view-mounted per live view, in order', () => {
		attach();

		const types = sent.filter((m) => m.message).map((m) => m.message.type);
		expect(types).toEqual([
			EVENTS.HELLO,
			EVENTS.APP_MOUNTED,
			EVENTS.VIEW_MOUNTED,
			EVENTS.VIEW_MOUNTED,
			EVENTS.VIEW_MOUNTED,
			EVENTS.VIEW_MOUNTED,
			EVENTS.VIEW_MOUNTED,
			EVENTS.VIEW_MOUNTED,
		]);
	});

	it('sends a well-formed hello payload', () => {
		attach();
		const hello = sent.find((m) => m.message?.type === EVENTS.HELLO).message;
		expect(hello.puzzle).toBe(1);
		expect(hello.v).toBe(1);
		expect(hello.payload.protocolVersion).toBe(1);
		expect(typeof hello.payload.frameworkVersion).toBe('string');
	});

	it('identifies every mounted view, with no internal parent link on the wire', () => {
		attach();
		const mounted = sent
			.filter((m) => m.message?.type === EVENTS.VIEW_MOUNTED)
			.map((m) => m.message.payload);
		expect(mounted).toEqual([
			{ id: 1, name: 'FixtureLayout', module: 'layouts/Fixture.pzl' },
			{ id: 2, name: 'FixtureHome', module: 'views/Home.pzl' },
			{ id: 3, name: 'FixtureRow', module: 'components/Row.pzl' },
			{ id: 4, name: 'FixtureRow', module: 'components/Row.pzl' },
			{ id: 5, name: 'FixtureFilters', module: 'components/Filters.pzl' },
			{ id: 6, name: 'FixtureNav', module: 'components/Nav.pzl' },
		]);
	});

	it('answers snapshot:views with a six-node, three-level tree under one root', () => {
		const { result } = request(REQUESTS.SNAPSHOT_VIEWS);
		expect(result.roots).toHaveLength(1);

		const count = (nodes) =>
			nodes.reduce((total, node) => total + 1 + count(node.children ?? []), 0);
		const depth = (nodes) =>
			nodes.reduce((deepest, node) => Math.max(deepest, 1 + depth(node.children ?? [])), 0);

		expect(count(result.roots)).toBe(6);
		expect(depth(result.roots)).toBe(3);
		expect(result.roots[0].name).toBe('FixtureLayout');
		expect(result.roots[0].children[0].children[0].name).toBe('FixtureRow');
		// Siblings keep mount order, which is what the panel's tree relies on.
		expect(result.roots[0].children.map((n) => n.name)).toEqual(['FixtureHome', 'FixtureNav']);
		expect(result.roots[0].children[0].children.map((n) => n.id)).toEqual([3, 4, 5]);
	});

	it('answers inspect:view with the model and local layers reported separately', () => {
		const { result } = request(REQUESTS.INSPECT_VIEW, { id: 2 });
		expect(Object.keys(result).sort()).toEqual(['local', 'model', 'module', 'name', 'params', 'props']);
		expect(result.model).toEqual({ todos: 3, activeTodos: 2 });
		expect(result.local).toEqual({ newTodoText: '', currentFilter: 'active' });
	});

	it('reports a key that exists in BOTH layers with different values', () => {
		// The whole reason the panel splits the two layers: `completed` is false in
		// the last data() commit and true in the local layer that overrides it.
		const { result } = request(REQUESTS.INSPECT_VIEW, { id: 3 });
		expect(result.model.completed).toBe(false);
		expect(result.local.completed).toBe(true);
		expect(result.props).toEqual({ todo: 't2', index: 1 });
	});

	it('answers inspect:view for a missing id with an { error } result', () => {
		const { result } = request(REQUESTS.INSPECT_VIEW, { id: 999 });
		expect(result.error).toMatch(/no live view with id/);
	});

	it('answers snapshot:records with two types', () => {
		const { result } = request(REQUESTS.SNAPSHOT_RECORDS);
		expect(Object.keys(result.types).sort()).toEqual(['todo', 'user']);
		expect(result.types.todo).toHaveLength(3);
		expect(result.types.user).toHaveLength(2);
		expect(result.types.todo[0]).toHaveProperty('_synced');
	});

	it('carries a boolean and a number in every type, so the editor has both', () => {
		const { result } = request(REQUESTS.SNAPSHOT_RECORDS);
		const todo = result.types.todo[0];
		const user = result.types.user[0];

		// 5+ real fields per type, excluding the synthesized provenance flag.
		expect(Object.keys(todo).filter((k) => k !== '_synced').length).toBeGreaterThanOrEqual(5);
		expect(Object.keys(user).filter((k) => k !== '_synced').length).toBeGreaterThanOrEqual(5);

		expect(typeof todo.completed).toBe('boolean');
		expect(typeof todo.priority).toBe('number');
		expect(typeof user.active).toBe('boolean');
		expect(typeof user.loginCount).toBe('number');
	});

	it('filters snapshot:records by type', () => {
		const { result } = request(REQUESTS.SNAPSHOT_RECORDS, { type: 'user' });
		expect(Object.keys(result.types)).toEqual(['user']);
	});

	it('answers snapshot:subscriptions in both directions', () => {
		const { result } = request(REQUESTS.SNAPSHOT_SUBSCRIPTIONS);
		expect(result.byKey.todo).toEqual([2, 3]);
		expect(result.byKey.user).toEqual(['fn']); // function subscribers report as 'fn'
		expect(result.byView['3']).toEqual(['todo', 'todo t2']);
	});

	it('answers snapshot:route with the parsed URL state', () => {
		const { result } = request(REQUESTS.SNAPSHOT_ROUTE);
		expect(result.pathname).toBe('/todos');
		expect(result.query).toEqual({ filter: 'active' });
		expect(result.chain).toEqual(['FixtureLayout', 'FixtureHome']);
	});

	it('applies edit:record and emits a flush for the change', () => {
		attach();
		const before = sent.length;
		const { result } = request(REQUESTS.EDIT_RECORD, {
			type: 'todo',
			id: 't2',
			patch: { completed: true },
		});
		expect(result).toEqual({ ok: true });

		const flush = sent.slice(before).find((m) => m.message?.type === EVENTS.FLUSH);
		expect(flush.message.payload.keys).toEqual(['todo', 'todo t2']);

		const { result: after } = request(REQUESTS.SNAPSHOT_RECORDS, { type: 'todo' });
		expect(after.types.todo.find((r) => r.id === 't2').completed).toBe(true);
	});

	it('rejects an edit:record with no patch object', () => {
		const { result } = request(REQUESTS.EDIT_RECORD, { type: 'todo', id: 't2' });
		expect(result.error).toMatch(/object patch/);
	});

	it('rejects an empty required string with the validation message', () => {
		const { result } = request(REQUESTS.EDIT_RECORD, {
			type: 'todo',
			id: 't1',
			patch: { text: '' },
		});
		expect(result).toEqual({ error: 'text cannot be empty' });

		// Rejected means UNCHANGED — the row must not be half-written.
		const { result: after } = request(REQUESTS.SNAPSHOT_RECORDS, { type: 'todo' });
		expect(after.types.todo.find((r) => r.id === 't1').text).toBe('Ship the bridge');
	});

	it('rejects a primary-key change and an out-of-range number', () => {
		expect(
			request(REQUESTS.EDIT_RECORD, { type: 'todo', id: 't1', patch: { id: 'nope' } }).result.error
		).toMatch(/primary key/);

		expect(
			request(REQUESTS.EDIT_RECORD, { type: 'todo', id: 't1', patch: { priority: 99 } }).result
				.error
		).toBe('priority must be between 1 and 5');

		expect(
			request(REQUESTS.EDIT_RECORD, { type: 'user', id: 'u1', patch: { email: 'nope' } }).result
				.error
		).toBe('email must contain @');
	});

	it('validates the whole patch before applying any of it', () => {
		const { result } = request(REQUESTS.EDIT_RECORD, {
			type: 'todo',
			id: 't3',
			patch: { text: 'renamed', priority: 42 },
		});
		expect(result.error).toMatch(/priority/);

		const { result: after } = request(REQUESTS.SNAPSHOT_RECORDS, { type: 'todo' });
		const row = after.types.todo.find((r) => r.id === 't3');
		expect(row.text).toBe('Write the fixture');
		expect(row.priority).toBe(3);
	});

	it('applies a valid multi-field edit to its canned collection', () => {
		const { result } = request(REQUESTS.EDIT_RECORD, {
			type: 'user',
			id: 'u2',
			patch: { role: 'admin', active: true, loginCount: 8 },
		});
		expect(result).toEqual({ ok: true });

		const { result: after } = request(REQUESTS.SNAPSHOT_RECORDS, { type: 'user' });
		expect(after.types.user.find((r) => r.id === 'u2')).toMatchObject({
			role: 'admin',
			active: true,
			loginCount: 8,
		});
	});

	it('draws and clears the highlight overlay', () => {
		expect(request(REQUESTS.HIGHLIGHT_VIEW, { id: 2, on: true }).result.ok).toBe(true);
		expect(window.document.querySelector('[data-puzzle-devtools]')).toBeTruthy();

		expect(request(REQUESTS.HIGHLIGHT_VIEW, { id: 2, on: false }).result.ok).toBe(true);
		expect(window.document.querySelector('[data-puzzle-devtools]')).toBeNull();
	});

	it('binds window.$p on log:view and log:record', () => {
		expect(request(REQUESTS.LOG_VIEW, { id: 3 }).result).toEqual({ ok: true });
		expect(window.$p.name).toBe('FixtureRow');

		expect(request(REQUESTS.LOG_RECORD, { type: 'user', id: 'u1' }).result).toEqual({ ok: true });
		expect(window.$p.name).toBe('Ada');
	});

	it('reports an unknown request type without throwing', () => {
		const { result } = request('snapshot:nonsense');
		expect(result.error).toBe('unknown devtools request "snapshot:nonsense"');
	});

	it('streams events emitted after attach instead of buffering them', () => {
		attach();
		const before = sent.length;
		window.document.querySelector('[data-act="view-mounted"]').click();
		expect(sent.length).toBe(before + 1);
		expect(sent[sent.length - 1].message.type).toBe(EVENTS.VIEW_MOUNTED);
		expect(sent[sent.length - 1].message.payload.id).toBe(7);
	});

	it('grows the tree when a view mounts at runtime', () => {
		attach();
		window.document.querySelector('[data-act="view-mounted"]').click();

		const { result } = request(REQUESTS.SNAPSHOT_VIEWS);
		const home = result.roots[0].children[0];
		expect(home.name).toBe('FixtureHome');
		// Appended under FixtureHome, after its existing children.
		expect(home.children.map((n) => n.id)).toEqual([3, 4, 5, 7]);
	});

	it('emits one view-destroyed per instance when a subtree goes away', () => {
		attach();
		window.document.querySelector('[data-act="view-destroyed"]').click();

		const destroyed = sent
			.filter((m) => m.message?.type === EVENTS.VIEW_DESTROYED)
			.map((m) => m.message.payload.id);
		expect(destroyed).toEqual([6]);

		const { result } = request(REQUESTS.SNAPSHOT_VIEWS);
		expect(result.roots[0].children.map((n) => n.name)).toEqual(['FixtureHome']);
	});

	/* ---- profiler --------------------------------------------------------- */

	/*
	 * The profiler is PULLED, not pushed: perf:start flips a switch, the counters
	 * accumulate in the page, and snapshot:profile reports them. The only thing
	 * that travels as an event is a loop detection. These assertions pin both
	 * halves of that split, because it is the part of the contract the panel's
	 * polling design depends on.
	 */

	const profile = () => request(REQUESTS.SNAPSHOT_PROFILE).result;

	it('answers snapshot:profile before any recording with a zeroed report', () => {
		const report = profile();
		expect(Object.keys(report).sort()).toEqual([
			'durationMs',
			'flushes',
			'recording',
			'totals',
			'views',
			'warnings',
		]);
		expect(report.recording).toBe(false);
		expect(report.durationMs).toBe(0);
		expect(report.views).toEqual([]);
		expect(report.warnings).toEqual([]);
		expect(report.totals).toEqual({
			renders: 0,
			wastedRenders: 0,
			domMutations: 0,
			dataRuns: 0,
			storeFlushes: 0,
			storeNotifications: 0,
		});
	});

	it('answers perf:start and perf:stop with the plain ok result', () => {
		expect(request(REQUESTS.PERF_START).result).toEqual({ ok: true });
		expect(request(REQUESTS.PERF_STOP).result).toEqual({ ok: true });
	});

	it('starts counting immediately, so a snapshot right after start is not empty', () => {
		request(REQUESTS.PERF_START);
		const report = profile();

		expect(report.recording).toBe(true);
		expect(report.views.length).toBe(6);
		expect(report.totals.renders).toBeGreaterThan(0);
	});

	it('reports every per-view counter the Performance panel reads', () => {
		request(REQUESTS.PERF_START);
		const row = profile().views.find((view) => view.id === 3);

		expect(Object.keys(row).sort()).toEqual([
			'causes',
			'dataMs',
			'domMutations',
			'id',
			'memoHits',
			'memoMisses',
			'module',
			'name',
			'patchMs',
			'propsBailouts',
			'propsReruns',
			'renderMs',
			'renders',
			'wastedRenders',
		]);
		expect(row.name).toBe('FixtureRow');
		expect(row.module).toBe('components/Row.pzl');
		expect(Object.keys(row.causes).sort()).toEqual([
			'data',
			'manual',
			'parent',
			'route',
			'slot',
			'store',
		]);
	});

	it('keeps totals consistent with the rows they summarize', () => {
		request(REQUESTS.PERF_START);
		const report = profile();
		const sum = (field) => report.views.reduce((total, view) => total + view[field], 0);

		expect(report.totals.renders).toBe(sum('renders'));
		expect(report.totals.wastedRenders).toBe(sum('wastedRenders'));
		expect(report.totals.domMutations).toBe(sum('domMutations'));
	});

	it('models one pathological view, so the default sort has something to find', () => {
		request(REQUESTS.PERF_START);
		const views = profile().views;
		const worst = [...views].sort((a, b) => b.wastedRenders - a.wastedRenders)[0];

		// #3 renders constantly and changes almost nothing — the case the panel
		// exists to surface.
		expect(worst.id).toBe(3);
		expect(worst.wastedRenders / worst.renders).toBeGreaterThan(0.5);
		// ...and at least one view that is busy but honest, so the table is not
		// uniformly alarming.
		expect(views.some((view) => view.renders > 0 && view.wastedRenders === 0)).toBe(true);
	});

	it('does not advance the counters just because you asked for them', () => {
		request(REQUESTS.PERF_START);
		const first = profile();
		const second = profile();

		// Reading a profile is a pure read. If it were not, the panel's own
		// polling would inflate every number it displays.
		expect(second.totals).toEqual(first.totals);
		expect(second.views).toEqual(first.views);
	});

	it('keeps accumulating on its own clock while recording', async () => {
		request(REQUESTS.PERF_START);
		const first = profile().totals.renders;

		// The fixture accumulates every 500ms; wait out one tick for real.
		await new Promise((resolve) => setTimeout(resolve, 620));
		const second = profile().totals.renders;

		expect(second).toBeGreaterThan(first);
	});

	it('stops recording but keeps the counters readable', () => {
		request(REQUESTS.PERF_START);
		const during = profile();
		request(REQUESTS.PERF_STOP);
		const after = profile();

		expect(after.recording).toBe(false);
		// A stopped recording is still a report — this is what the panel shows
		// after Stop, and it must not blank out.
		expect(after.totals.renders).toBe(during.totals.renders);
		expect(after.views).toHaveLength(during.views.length);
	});

	it('records the flushes that land during a recording, with notified as a COUNT', () => {
		attach();
		request(REQUESTS.PERF_START);
		expect(profile().flushes).toEqual([]);

		window.document.querySelector('[data-act="flush"]').click();
		const report = profile();

		expect(report.flushes).toHaveLength(1);
		expect(report.flushes[0].keys).toEqual(['todo']);
		// The flush EVENT sends `notified` as a list of ids; the profile reports a
		// number. The panel tolerates both, and this is why.
		expect(report.flushes[0].notified).toBe(1);
		expect(typeof report.flushes[0].at).toBe('number');
		expect(typeof report.flushes[0].durationMs).toBe('number');
		expect(report.totals.storeFlushes).toBe(1);
		expect(report.totals.storeNotifications).toBe(1);
	});

	it('ignores flushes that land while nothing is recording', () => {
		attach();
		window.document.querySelector('[data-act="flush"]').click();
		request(REQUESTS.PERF_START);
		expect(profile().flushes).toEqual([]);
	});

	it('PUSHES a perf-warning event, unlike everything else in the profile', () => {
		attach();
		const before = sent.length;
		window.document.querySelector('[data-act="perf-warning"]').click();

		const warning = sent.slice(before).find((m) => m.message?.type === EVENTS.PERF_WARNING);
		expect(warning).toBeTruthy();
		expect(warning.message.payload).toEqual({
			kind: 'runaway-rerender',
			viewId: 3,
			name: 'FixtureRow',
			detail: 'rendered repeatedly with no DOM change',
			count: 1,
		});
	});

	it('emits both warning kinds', () => {
		attach();
		window.document.querySelector('[data-act="perf-loop"]').click();

		const warning = sent.filter((m) => m.message?.type === EVENTS.PERF_WARNING).at(-1);
		expect(warning.message.payload.kind).toBe('recursive-loop');
		expect(warning.message.payload.viewId).toBe(5);
		expect(warning.message.payload.detail).toMatch(/subscribes to/);
	});

	it('folds warnings into the report as well as emitting them', () => {
		attach();
		request(REQUESTS.PERF_START);
		window.document.querySelector('[data-act="perf-warning"]').click();

		const warnings = profile().warnings;
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ kind: 'runaway-rerender', viewId: 3, count: 1 });
	});

	it('counts a repeated detection up instead of adding a second row', () => {
		attach();
		request(REQUESTS.PERF_START);
		const button = window.document.querySelector('[data-act="perf-warning"]');
		button.click();
		button.click();
		button.click();

		const warnings = profile().warnings;
		expect(warnings).toHaveLength(1);
		expect(warnings[0].count).toBe(3);
		// The event carries the running count too, so a panel that only ever sees
		// the event still knows how bad it is.
		expect(sent.filter((m) => m.message?.type === EVENTS.PERF_WARNING).at(-1).message.payload.count).toBe(3);
	});

	it('still emits a warning when nothing is recording', () => {
		attach();
		window.document.querySelector('[data-act="perf-warning"]').click();

		expect(sent.some((m) => m.message?.type === EVENTS.PERF_WARNING)).toBe(true);
		// Nowhere to fold it, but the push is what the panel debounces a pull off.
		expect(profile().warnings).toEqual([]);
	});

	it('starts a fresh recording rather than resuming the previous one', () => {
		attach();
		request(REQUESTS.PERF_START);
		window.document.querySelector('[data-act="perf-warning"]').click();
		const first = profile().totals.renders;

		request(REQUESTS.PERF_STOP);
		request(REQUESTS.PERF_START);
		const second = profile();

		expect(second.totals.renders).toBe(first);
		expect(second.warnings).toEqual([]);
	});
});

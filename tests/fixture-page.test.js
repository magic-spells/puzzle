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

	it('replays hello → app-mounted → three view-mounted, in order', () => {
		attach();

		const types = sent.filter((m) => m.message).map((m) => m.message.type);
		expect(types).toEqual([
			EVENTS.HELLO,
			EVENTS.APP_MOUNTED,
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

	it('identifies the three mounted views', () => {
		attach();
		const mounted = sent
			.filter((m) => m.message?.type === EVENTS.VIEW_MOUNTED)
			.map((m) => m.message.payload);
		expect(mounted).toEqual([
			{ id: 1, name: 'FixtureLayout', module: 'layouts/Fixture.pzl' },
			{ id: 2, name: 'FixtureHome', module: 'views/Home.pzl' },
			{ id: 3, name: 'FixtureRow', module: 'components/Row.pzl' },
		]);
	});

	it('answers snapshot:views with a three-node tree under one root', () => {
		const { result } = request(REQUESTS.SNAPSHOT_VIEWS);
		expect(result.roots).toHaveLength(1);

		const count = (nodes) =>
			nodes.reduce((total, node) => total + 1 + count(node.children ?? []), 0);
		expect(count(result.roots)).toBe(3);
		expect(result.roots[0].name).toBe('FixtureLayout');
		expect(result.roots[0].children[0].children[0].name).toBe('FixtureRow');
	});

	it('answers inspect:view with the model and local layers reported separately', () => {
		const { result } = request(REQUESTS.INSPECT_VIEW, { id: 2 });
		expect(Object.keys(result).sort()).toEqual(['local', 'model', 'module', 'name', 'params', 'props']);
		expect(result.model).toEqual({ todos: 3, activeTodos: 2 });
		expect(result.local).toEqual({ newTodoText: '', currentFilter: 'active' });
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

	it('filters snapshot:records by type', () => {
		const { result } = request(REQUESTS.SNAPSHOT_RECORDS, { type: 'user' });
		expect(Object.keys(result.types)).toEqual(['user']);
	});

	it('answers snapshot:subscriptions in both directions', () => {
		const { result } = request(REQUESTS.SNAPSHOT_SUBSCRIPTIONS);
		expect(result.byKey.todo).toEqual([2, 3]);
		expect(result.byKey.user).toEqual(['fn']); // function subscribers report as 'fn'
		expect(result.byView['3']).toEqual(['todo', 'todo:t2']);
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
		expect(flush.message.payload.keys).toEqual(['todo', 'todo:t2']);

		const { result: after } = request(REQUESTS.SNAPSHOT_RECORDS, { type: 'todo' });
		expect(after.types.todo.find((r) => r.id === 't2').completed).toBe(true);
	});

	it('rejects an edit:record with no patch object', () => {
		const { result } = request(REQUESTS.EDIT_RECORD, { type: 'todo', id: 't2' });
		expect(result.error).toMatch(/object patch/);
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
		expect(sent[sent.length - 1].message.payload.id).toBe(4);
	});
});

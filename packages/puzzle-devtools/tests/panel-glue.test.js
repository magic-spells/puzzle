import { describe, it, expect, beforeEach } from 'vitest';
import { evalInSandbox } from './helpers/sandbox.js';
import {
	SOURCE_HOOK,
	SOURCE_PANEL,
	PORT_PANEL_PREFIX,
	CONTROL,
	PROTOCOL_VERSION,
} from '../protocol/constants.js';

/** Minimal chrome.runtime stub: one port, with listener + outbox capture. */
function stubRuntime() {
	const state = {
		connectArgs: [],
		posted: [],
		messageListeners: [],
		disconnectListeners: [],
		port: null,
	};

	state.port = {
		postMessage(message) {
			state.posted.push(message);
		},
		onMessage: {
			addListener(fn) {
				state.messageListeners.push(fn);
			},
		},
		onDisconnect: {
			addListener(fn) {
				state.disconnectListeners.push(fn);
			},
		},
	};

	return {
		state,
		runtime: {
			connect(info) {
				state.connectArgs.push(info);
				return state.port;
			},
		},
		/** Push a message down the port as if the page hook had answered. */
		deliver(message) {
			state.messageListeners.forEach((fn) => fn(message));
		},
		disconnect() {
			state.disconnectListeners.forEach((fn) => fn());
		},
	};
}

function answer(id, result) {
	return { source: SOURCE_HOOK, id, result };
}

describe('panel-glue', () => {
	let box;
	let chrome;
	let bridge;

	beforeEach(() => {
		// No `chrome.devtools` in the sandbox, so the file exports the factory
		// without auto-installing a live bridge.
		box = evalInSandbox('panel-glue.js');
		chrome = stubRuntime();
		bridge = box.window.__PUZZLE_DEVTOOLS_CREATE_BRIDGE__({
			runtime: chrome.runtime,
			tabId: 17,
			themeName: 'dark',
			timeoutMs: 40,
		});
	});

	it('does not auto-install outside a DevTools context', () => {
		expect(box.window.__PUZZLE_DEVTOOLS_PANEL__).toBeUndefined();
		expect(typeof box.window.__PUZZLE_DEVTOOLS_CREATE_BRIDGE__).toBe('function');
	});

	it('connects with a port name carrying the inspected tab id', () => {
		bridge.connect();
		expect(chrome.state.connectArgs).toEqual([{ name: `${PORT_PANEL_PREFIX}17` }]);
	});

	it('sends the listening control', () => {
		bridge.sendListening();
		expect(chrome.state.posted).toEqual([{ source: SOURCE_PANEL, control: CONTROL.LISTENING }]);
	});

	it('posts a well-formed protocol envelope for a request', () => {
		bridge.request('inspect:view', { id: 3 }).catch(() => {});
		expect(chrome.state.posted[0]).toEqual({
			source: SOURCE_PANEL,
			id: 1,
			message: { puzzle: 1, v: PROTOCOL_VERSION, type: 'inspect:view', payload: { id: 3 } },
		});
	});

	it('defaults a missing payload to an empty object', () => {
		bridge.request('snapshot:views').catch(() => {});
		expect(chrome.state.posted[0].message.payload).toEqual({});
	});

	it('correlates answers by id, including out-of-order delivery', async () => {
		const first = bridge.request('snapshot:views');
		const second = bridge.request('snapshot:route');

		const [idA, idB] = chrome.state.posted.map((m) => m.id);
		expect(idA).not.toBe(idB);

		chrome.deliver(answer(idB, { pathname: '/todos' }));
		chrome.deliver(answer(idA, { roots: [] }));

		await expect(first).resolves.toEqual({ roots: [] });
		await expect(second).resolves.toEqual({ pathname: '/todos' });
	});

	it('rejects when the hook reports a transport error', async () => {
		const pending = bridge.request('snapshot:views');
		chrome.deliver({ source: SOURCE_HOOK, id: chrome.state.posted[0].id, error: 'no-bridge' });
		await expect(pending).rejects.toThrow('no-bridge');
	});

	it('rejects when the bridge answers with an { error } result', async () => {
		const pending = bridge.request('inspect:view', { id: 99 });
		chrome.deliver(answer(chrome.state.posted[0].id, { error: 'no live view with id 99' }));
		await expect(pending).rejects.toThrow('no live view with id 99');
	});

	it('rejects after the timeout and stops tracking the id', async () => {
		const pending = bridge.request('snapshot:records');
		await expect(pending).rejects.toThrow(/timed out after 40ms/);

		// A late answer for a timed-out id must be a silent no-op, not a throw.
		expect(() => chrome.deliver(answer(chrome.state.posted[0].id, { types: {} }))).not.toThrow();
	});

	it('ignores foreign port traffic', () => {
		let received = 0;
		bridge.onMessage(() => {
			received += 1;
		});
		bridge.connect();
		chrome.deliver({ source: 'somebody-else', message: { puzzle: 1, v: 1, type: 'hello' } });
		chrome.deliver(null);
		expect(received).toBe(0);
	});

	it('delivers runtime events to onMessage subscribers with their seq', () => {
		const seen = [];
		const off = bridge.onMessage((message, seq) => seen.push([message.type, seq]));
		bridge.connect();

		chrome.deliver({
			source: SOURCE_HOOK,
			seq: 4,
			message: { puzzle: 1, v: 1, type: 'view-mounted', payload: { id: 1 } },
		});
		off();
		chrome.deliver({
			source: SOURCE_HOOK,
			seq: 5,
			message: { puzzle: 1, v: 1, type: 'view-destroyed', payload: { id: 1 } },
		});

		expect(seen).toEqual([['view-mounted', 4]]);
	});

	it('reports port status transitions', async () => {
		const statuses = [];
		bridge.onStatus((status) => statuses.push(status));
		bridge.connect();
		chrome.disconnect();
		expect(statuses).toEqual(['connected', 'disconnected']);
	});

	it('fails in-flight requests when the port drops', async () => {
		const pending = bridge.request('snapshot:views');
		chrome.disconnect();
		await expect(pending).rejects.toThrow('connection lost');
	});

	it('rejects immediately when there is no runtime to connect to', async () => {
		const offline = box.window.__PUZZLE_DEVTOOLS_CREATE_BRIDGE__({ runtime: null, tabId: 1 });
		await expect(offline.request('snapshot:views')).rejects.toThrow('not connected');
		expect(offline.sendListening()).toBe(false);
	});

	it('exposes the theme name it was constructed with', () => {
		expect(bridge.themeName).toBe('dark');
		expect(bridge.tabId).toBe(17);
	});
});

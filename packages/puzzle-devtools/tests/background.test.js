import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PORT_PAGE, PORT_PANEL_PREFIX, SOURCE_PANEL, CONTROL } from '../protocol/constants.js';

/**
 * background.js is a module service worker with no exports: it registers one
 * `chrome.runtime.onConnect` listener at load. The tests stub `chrome`, import
 * the module fresh, and drive that listener directly.
 */
function fakePort(name, tabId) {
	const port = {
		name,
		sender: tabId === undefined ? undefined : { tab: { id: tabId } },
		posted: [],
		disconnected: false,
		_message: [],
		_disconnect: [],
		onMessage: { addListener: (fn) => port._message.push(fn) },
		onDisconnect: { addListener: (fn) => port._disconnect.push(fn) },
		postMessage: (message) => port.posted.push(message),
		disconnect: () => {
			port.disconnected = true;
		},
		/** Simulate this side sending a message up to the worker. */
		send: (message) => port._message.forEach((fn) => fn(message)),
		/** Simulate this side going away. */
		drop: () => port._disconnect.forEach((fn) => fn()),
	};
	return port;
}

const listeningControl = { source: SOURCE_PANEL, control: CONTROL.LISTENING };

describe('background service worker routing', () => {
	let connect;

	beforeEach(async () => {
		let registered = null;
		globalThis.chrome = {
			runtime: {
				onConnect: {
					addListener(fn) {
						registered = fn;
					},
				},
			},
		};
		vi.resetModules();
		await import('../extension/background.js');
		connect = registered;
		expect(typeof connect).toBe('function');
	});

	it('routes page → panel for the same tab', () => {
		const page = fakePort(PORT_PAGE, 5);
		const panel = fakePort(`${PORT_PANEL_PREFIX}5`);
		connect(page);
		connect(panel);

		page.send({ source: 'puzzle-devtools-hook', seq: 1, message: { type: 'hello' } });

		expect(panel.posted).toEqual([
			{ source: 'puzzle-devtools-hook', seq: 1, message: { type: 'hello' } },
		]);
	});

	it('routes panel → page for the same tab', () => {
		const page = fakePort(PORT_PAGE, 5);
		const panel = fakePort(`${PORT_PANEL_PREFIX}5`);
		connect(page);
		connect(panel);

		panel.send({ source: SOURCE_PANEL, id: 1, message: { type: 'snapshot:views' } });

		expect(page.posted).toEqual([
			{ source: SOURCE_PANEL, id: 1, message: { type: 'snapshot:views' } },
		]);
	});

	it('does not cross tabs', () => {
		const page = fakePort(PORT_PAGE, 5);
		const otherPanel = fakePort(`${PORT_PANEL_PREFIX}6`);
		connect(page);
		connect(otherPanel);

		page.send({ source: 'puzzle-devtools-hook', message: { type: 'hello' } });

		expect(otherPanel.posted).toEqual([]);
	});

	it('drops traffic silently when the other side is absent', () => {
		const page = fakePort(PORT_PAGE, 9);
		connect(page);
		expect(() => page.send({ source: 'puzzle-devtools-hook', message: {} })).not.toThrow();
	});

	it('replays the panel listening control to a page port that connects later', () => {
		const panel = fakePort(`${PORT_PANEL_PREFIX}5`);
		connect(panel);
		panel.send(listeningControl);

		// The page reloads: a brand-new content script connects.
		const page = fakePort(PORT_PAGE, 5);
		connect(page);

		expect(page.posted).toEqual([listeningControl]);
	});

	it('forgets the listening control once the panel closes', () => {
		const panel = fakePort(`${PORT_PANEL_PREFIX}5`);
		connect(panel);
		panel.send(listeningControl);
		panel.drop();

		const page = fakePort(PORT_PAGE, 5);
		connect(page);

		expect(page.posted).toEqual([]);
	});

	it('replaces a stale page port for the same tab', () => {
		const first = fakePort(PORT_PAGE, 5);
		const second = fakePort(PORT_PAGE, 5);
		const panel = fakePort(`${PORT_PANEL_PREFIX}5`);
		connect(panel);
		connect(first);
		connect(second);

		expect(first.disconnected).toBe(true);

		panel.send({ source: SOURCE_PANEL, id: 1 });
		expect(second.posted).toHaveLength(1);
		expect(first.posted).toHaveLength(0);
	});

	it('stops routing to a disconnected panel', () => {
		const page = fakePort(PORT_PAGE, 5);
		const panel = fakePort(`${PORT_PANEL_PREFIX}5`);
		connect(page);
		connect(panel);
		panel.drop();

		page.send({ source: 'puzzle-devtools-hook', message: {} });
		expect(panel.posted).toEqual([]);
	});

	it('rejects a page port with no tab id', () => {
		const orphan = fakePort(PORT_PAGE, undefined);
		connect(orphan);
		expect(orphan.disconnected).toBe(true);
	});

	it('rejects a panel port whose name carries no integer tab id', () => {
		const bogus = fakePort(`${PORT_PANEL_PREFIX}not-a-number`);
		connect(bogus);
		expect(bogus.disconnected).toBe(true);
	});

	it('ignores ports that are not ours', () => {
		const foreign = fakePort('some-other-extension-port', 5);
		connect(foreign);
		expect(foreign.disconnected).toBe(false);
		expect(foreign._message).toHaveLength(0);
	});
});

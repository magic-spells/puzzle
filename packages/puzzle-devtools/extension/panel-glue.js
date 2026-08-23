/**
 * panel-glue.js — the chrome-side glue for the DevTools panel.
 *
 * Loaded as a CLASSIC script before the panel's module bundle, so
 * `window.__PUZZLE_DEVTOOLS_PANEL__` and the `data-theme` attribute both exist
 * before the Puzzle app constructs. The panel app never touches `chrome.*`;
 * this file is the whole seam.
 *
 * Bridge API (`window.__PUZZLE_DEVTOOLS_PANEL__`):
 *
 *   onMessage(cb)            cb(protocolEnvelope, seq) for every runtime event.
 *                            Returns an unsubscribe function.
 *   onStatus(cb)             cb('connected' | 'disconnected') for the port.
 *   onNavigated(cb)          cb(url) when the inspected page navigates/reloads.
 *   request(type, payload)   Promise of the runtime's result payload. Rejects on
 *                            a hook/bridge error and after REQUEST_TIMEOUT_MS.
 *   sendListening()          tell the page hook to replay its buffer and stream.
 *   tabId, themeName         inspected tab id and DevTools theme.
 *
 * `createBridge` is also exported on `window.__PUZZLE_DEVTOOLS_CREATE_BRIDGE__`
 * so tests can build one against a stub runtime.
 *
 * Constants are duplicated from protocol/constants.js (classic script, no
 * imports); tests/ asserts the copies agree.
 */
(function () {
	'use strict';

	var SOURCE_HOOK = 'puzzle-devtools-hook';
	var SOURCE_PANEL = 'puzzle-devtools-panel';
	var PORT_PANEL_PREFIX = 'puzzle-devtools-panel:';
	var CONTROL_LISTENING = 'listening';
	var PROTOCOL_VERSION = 1;
	var REQUEST_TIMEOUT_MS = 5000;
	var ENVELOPE_MARKER_VALUE = 1;

	/**
	 * @param {object} options
	 * @param {object} options.runtime      chrome.runtime (or a stub with connect())
	 * @param {number} options.tabId        inspected tab id
	 * @param {string} [options.themeName]  'dark' | 'default'
	 * @param {number} [options.timeoutMs]  request timeout override
	 */
	function createBridge(options) {
		var runtime = options && options.runtime;
		var tabId = options && options.tabId;
		var themeName = (options && options.themeName) || 'default';
		var timeoutMs = (options && options.timeoutMs) || REQUEST_TIMEOUT_MS;

		var port = null;
		var nextId = 1;
		var pending = new Map();
		var messageListeners = new Set();
		var statusListeners = new Set();
		var navigationListeners = new Set();
		var listening = false;

		function emitStatus(status) {
			statusListeners.forEach(function (fn) {
				try {
					fn(status);
				} catch (err) {
					console.error('[puzzle-devtools] status listener threw', err);
				}
			});
		}

		function ensurePort() {
			if (port) return port;
			if (!runtime || typeof runtime.connect !== 'function') return null;
			var next;
			try {
				next = runtime.connect({ name: PORT_PANEL_PREFIX + tabId });
			} catch (err) {
				return null;
			}
			port = next;
			next.onMessage.addListener(receive);
			next.onDisconnect.addListener(function () {
				if (port === next) port = null;
				failAllPending('puzzle-devtools: connection lost');
				emitStatus('disconnected');
				// The worker was recycled. Re-arm on the next tick so the page hook
				// keeps streaming into the reopened port.
				if (listening) {
					setTimeout(function () {
						if (ensurePort()) sendListening();
					}, 250);
				}
			});
			emitStatus('connected');
			return port;
		}

		function failAllPending(reason) {
			pending.forEach(function (entry) {
				clearTimeout(entry.timer);
				entry.reject(new Error(reason));
			});
			pending.clear();
		}

		function receive(data) {
			if (!data || typeof data !== 'object' || data.source !== SOURCE_HOOK) return;

			// Request answer — id-correlated.
			if (data.id !== undefined && data.id !== null) {
				var entry = pending.get(data.id);
				if (!entry) return; // already timed out
				pending.delete(data.id);
				clearTimeout(entry.timer);
				if (data.error !== undefined && data.error !== null) {
					entry.reject(new Error(String(data.error)));
					return;
				}
				// The framework bridge is total: it reports failures as an `{ error }`
				// RESULT rather than throwing, so unwrap that into a rejection too.
				var result = data.result;
				if (result && typeof result === 'object' && typeof result.error === 'string') {
					entry.reject(new Error(result.error));
					return;
				}
				entry.resolve(result);
				return;
			}

			// Runtime event.
			if (!data.message) return;
			messageListeners.forEach(function (fn) {
				try {
					fn(data.message, data.seq);
				} catch (err) {
					console.error('[puzzle-devtools] message listener threw', err);
				}
			});
		}

		function request(type, payload) {
			return new Promise(function (resolve, reject) {
				var active = ensurePort();
				if (!active) {
					reject(new Error('puzzle-devtools: not connected'));
					return;
				}
				var id = nextId++;
				var timer = setTimeout(function () {
					pending.delete(id);
					reject(
						new Error('puzzle-devtools: request "' + type + '" timed out after ' + timeoutMs + 'ms')
					);
				}, timeoutMs);
				pending.set(id, { resolve: resolve, reject: reject, timer: timer, type: type });
				try {
					active.postMessage({
						source: SOURCE_PANEL,
						id: id,
						message: {
							puzzle: ENVELOPE_MARKER_VALUE,
							v: PROTOCOL_VERSION,
							type: type,
							payload: payload === undefined ? {} : payload,
						},
					});
				} catch (err) {
					clearTimeout(timer);
					pending.delete(id);
					if (port === active) port = null;
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});
		}

		function sendListening() {
			listening = true;
			var active = ensurePort();
			if (!active) return false;
			try {
				active.postMessage({ source: SOURCE_PANEL, control: CONTROL_LISTENING });
				return true;
			} catch (err) {
				if (port === active) port = null;
				return false;
			}
		}

		function onMessage(cb) {
			messageListeners.add(cb);
			return function off() {
				messageListeners.delete(cb);
			};
		}

		function onStatus(cb) {
			statusListeners.add(cb);
			return function off() {
				statusListeners.delete(cb);
			};
		}

		function onNavigated(cb) {
			navigationListeners.add(cb);
			return function off() {
				navigationListeners.delete(cb);
			};
		}

		function notifyNavigated(url) {
			navigationListeners.forEach(function (fn) {
				try {
					fn(url);
				} catch (err) {
					console.error('[puzzle-devtools] navigation listener threw', err);
				}
			});
		}

		return {
			tabId: tabId,
			themeName: themeName,
			protocolVersion: PROTOCOL_VERSION,
			connect: ensurePort,
			onMessage: onMessage,
			onStatus: onStatus,
			onNavigated: onNavigated,
			notifyNavigated: notifyNavigated,
			request: request,
			sendListening: sendListening,
		};
	}

	// Exported for tests (and for a future second panel page).
	window.__PUZZLE_DEVTOOLS_CREATE_BRIDGE__ = createBridge;

	// Auto-install only inside a real DevTools panel. Loading this file anywhere
	// else (the vitest suite, `puzzle dev` on the panel app) is a no-op, and the
	// panel app falls back to its offline stub.
	var inDevTools =
		typeof chrome !== 'undefined' &&
		!!chrome.devtools &&
		!!chrome.devtools.inspectedWindow &&
		!!chrome.runtime;

	if (inDevTools) {
		var themeName = (chrome.devtools.panels && chrome.devtools.panels.themeName) || 'default';
		// Applied before the panel bundle runs so there is no light-mode flash.
		// v1 does not watch for live theme changes — reopening DevTools re-reads it.
		document.documentElement.setAttribute('data-theme', themeName === 'dark' ? 'dark' : 'light');

		var bridge = createBridge({
			runtime: chrome.runtime,
			tabId: chrome.devtools.inspectedWindow.tabId,
			themeName: themeName,
		});
		bridge.connect();

		if (chrome.devtools.network && chrome.devtools.network.onNavigated) {
			chrome.devtools.network.onNavigated.addListener(function (url) {
				bridge.notifyNavigated(url);
				// A fresh document means a fresh hook, buffering from zero.
				bridge.sendListening();
			});
		}

		window.__PUZZLE_DEVTOOLS_PANEL__ = bridge;
	}
})();

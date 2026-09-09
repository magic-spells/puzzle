/**
 * page-hook.js — MAIN-world content script, injected at document_start on every
 * page. It installs `window.__PUZZLE_DEVTOOLS_HOOK__`, the object the Puzzle
 * dev-only runtime bridge (framework SPEC §55) registers into.
 *
 * This file runs on EVERY page the user visits, Puzzle or not, so it stays
 * dependency-free, tiny, and side-effect-light: one global, one `message`
 * listener, no timers, no network, no DOM.
 *
 * The hook contract (owned by this repo, consumed by the framework bridge):
 *
 *   hook.emit(message)      runtime pushes a protocol envelope out
 *   hook.onRequest(handler) runtime registers handler(message) => payload
 *                           (the framework's handler is synchronous and total —
 *                           it returns `{ error }` rather than throwing — but a
 *                           throw and a promise are both handled here)
 *
 * Transport, both directions, is window.postMessage; the isolated-world content
 * script relays to the extension. Envelopes:
 *
 *   hook → panel  { source: 'puzzle-devtools-hook', seq, message }   event
 *                 { source: 'puzzle-devtools-hook', id, result }     answer
 *                 { source: 'puzzle-devtools-hook', id, error }      failure
 *   panel → hook  { source: 'puzzle-devtools-panel', id, message }   request
 *                 { source: 'puzzle-devtools-panel', control }       control
 *
 * Constants here are duplicated from protocol/constants.js on purpose — this
 * file cannot import (MV3 content scripts are classic scripts). tests/ asserts
 * the two copies agree.
 */
(function () {
	'use strict';

	var HOOK_KEY = '__PUZZLE_DEVTOOLS_HOOK__';

	// Idempotent: a second injection (SPA soft-navigation quirks, a manually
	// re-run script) must not replace a hook the bridge already registered into.
	if (typeof window === 'undefined' || window[HOOK_KEY]) return;

	var SOURCE_HOOK = 'puzzle-devtools-hook';
	var SOURCE_PANEL = 'puzzle-devtools-panel';
	var CONTROL_LISTENING = 'listening';
	var BUFFER_LIMIT = 500;
	var HOOK_API_VERSION = 1;
	var PROTOCOL_VERSION = 1;

	// Events emitted before the panel attaches, oldest first. Bounded: past
	// BUFFER_LIMIT the oldest entry is dropped. Emptied on replay; after that
	// `streaming` is true and events go straight out.
	var buffer = [];
	var seq = 0;
	var streaming = false;

	// The single handler the runtime registered, or null. Only one bridge can
	// own the request channel; a later registration replaces an earlier one.
	var handler = null;

	/** postMessage that never throws into the app. Returns false when it failed. */
	function post(envelope) {
		try {
			window.postMessage(envelope, '*');
			return true;
		} catch (err) {
			return false;
		}
	}

	function errorText(err) {
		if (!err) return 'unknown error';
		if (typeof err === 'string') return err;
		return String(err.message || err);
	}

	function emit(message) {
		if (!message || typeof message !== 'object') return;
		seq += 1;
		var envelope = { source: SOURCE_HOOK, seq: seq, message: message };
		if (streaming) {
			post(envelope);
			return;
		}
		buffer.push(envelope);
		if (buffer.length > BUFFER_LIMIT) buffer.shift();
	}

	function onRequest(fn) {
		if (typeof fn !== 'function') {
			throw new TypeError('__PUZZLE_DEVTOOLS_HOOK__.onRequest expects a function');
		}
		handler = fn;
		return function off() {
			if (handler === fn) handler = null;
		};
	}

	function respond(id, result) {
		if (!post({ source: SOURCE_HOOK, id: id, result: result })) {
			// A non-cloneable result would otherwise leave the panel waiting for
			// its 5s timeout; answer explicitly instead.
			post({ source: SOURCE_HOOK, id: id, error: 'result-not-serializable' });
		}
	}

	function respondError(id, error) {
		post({ source: SOURCE_HOOK, id: id, error: error });
	}

	function handleRequest(id, message) {
		if (!handler) {
			// No bridge registered: a production build, a pre-§55 framework, or a
			// page with no Puzzle app at all.
			respondError(id, 'no-bridge');
			return;
		}
		var result;
		try {
			result = handler(message);
		} catch (err) {
			respondError(id, errorText(err));
			return;
		}
		// The framework bridge answers synchronously; a thenable is tolerated so a
		// future async handler does not need a hook change.
		if (result && typeof result.then === 'function') {
			result.then(
				function (value) {
					respond(id, value === undefined ? null : value);
				},
				function (err) {
					respondError(id, errorText(err));
				}
			);
			return;
		}
		respond(id, result === undefined ? null : result);
	}

	function replay() {
		var pending = buffer;
		buffer = [];
		for (var i = 0; i < pending.length; i++) post(pending[i]);
	}

	window.addEventListener(
		'message',
		function (event) {
			// Only same-window traffic: an iframe or opener must not drive the hook.
			if (event.source !== window) return;
			var data = event.data;
			if (!data || typeof data !== 'object' || data.source !== SOURCE_PANEL) return;

			if (data.control === CONTROL_LISTENING) {
				// First attach replays the backlog; a later re-attach (service worker
				// recycled) only re-arms streaming — replaying again would duplicate
				// everything the panel already has.
				if (!streaming) {
					streaming = true;
					replay();
				}
				return;
			}

			if (data.id === undefined || data.id === null) return;
			handleRequest(data.id, data.message);
		},
		false
	);

	var hook = {
		hookVersion: HOOK_API_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		emit: emit,
		onRequest: onRequest,
	};

	try {
		// Non-enumerable so page code enumerating window does not trip over it;
		// configurable so tests can remove it.
		Object.defineProperty(window, HOOK_KEY, {
			value: hook,
			writable: false,
			enumerable: false,
			configurable: true,
		});
	} catch (err) {
		window[HOOK_KEY] = hook;
	}
})();

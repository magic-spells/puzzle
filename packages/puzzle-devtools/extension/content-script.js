/**
 * content-script.js — ISOLATED-world content script, document_start.
 *
 * A dumb bidirectional relay between the page's MAIN-world hook (which can only
 * speak window.postMessage) and the extension service worker (which can only
 * speak chrome.runtime ports). It knows nothing about the protocol beyond the
 * two `source` tags.
 *
 *   window message (source: 'puzzle-devtools-hook')  →  port.postMessage
 *   port message   (source: 'puzzle-devtools-panel') →  window.postMessage
 *
 * MV3 service workers are recycled aggressively, which tears the port down. The
 * relay therefore reconnects: after every disconnect (a dead extension context
 * ends the loop) and lazily before any outbound message.
 */
(function () {
	'use strict';

	var SOURCE_HOOK = 'puzzle-devtools-hook';
	var SOURCE_PANEL = 'puzzle-devtools-panel';
	var PORT_PAGE = 'puzzle-devtools-page';

	var RECONNECT_DELAY_MS = 500;

	var port = null;
	var reconnectTimer = null;

	function contextAlive() {
		try {
			return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
		} catch (err) {
			return false;
		}
	}

	function ensurePort() {
		if (port) return port;
		if (!contextAlive()) return null;
		var next;
		try {
			next = chrome.runtime.connect({ name: PORT_PAGE });
		} catch (err) {
			return null;
		}
		port = next;
		next.onMessage.addListener(fromExtension);
		next.onDisconnect.addListener(function () {
			if (port === next) port = null;
			scheduleReconnect();
		});
		return port;
	}

	function scheduleReconnect() {
		if (reconnectTimer || !contextAlive()) return;
		reconnectTimer = setTimeout(function () {
			reconnectTimer = null;
			ensurePort();
		}, RECONNECT_DELAY_MS);
	}

	function fromExtension(data) {
		if (!data || typeof data !== 'object' || data.source !== SOURCE_PANEL) return;
		try {
			window.postMessage(data, '*');
		} catch (err) {
			// A non-cloneable payload from our own panel would be a bug; drop it
			// rather than break the page.
		}
	}

	window.addEventListener(
		'message',
		function (event) {
			if (event.source !== window) return;
			var data = event.data;
			if (!data || typeof data !== 'object' || data.source !== SOURCE_HOOK) return;

			var active = ensurePort();
			if (!active) return;
			try {
				active.postMessage(data);
			} catch (err) {
				if (port === active) port = null;
				scheduleReconnect();
			}
		},
		false
	);

	// Connect eagerly so the panel can reach a freshly loaded page (its
	// `listening` control has to arrive before the hook will stream).
	ensurePort();
})();

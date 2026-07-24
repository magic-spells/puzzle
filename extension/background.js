/**
 * background.js — MV3 service worker. Pure port routing, no protocol knowledge.
 *
 *   content script  connects as 'puzzle-devtools-page'          (tab id from sender)
 *   devtools panel  connects as 'puzzle-devtools-panel:<tabId>' (tab id from the name;
 *                                                                a devtools page has no
 *                                                                sender.tab)
 *
 * Both maps are rebuilt from live ports, so a recycled worker recovers as soon
 * as each side reconnects; nothing is persisted. When one side is absent its
 * traffic is dropped silently — that is the normal state on every page the user
 * has not opened the Puzzle panel for.
 *
 * The one piece of remembered state is the panel's `listening` control per tab.
 * A page reload gives the panel a brand-new hook that is buffering and waiting
 * for that control, and the panel has no reliable "page reloaded" signal to
 * re-send it in time — so the worker replays it to each newly connected page
 * port. It is cleared when the panel disconnects.
 */

const PORT_PAGE = 'puzzle-devtools-page';
const PORT_PANEL_PREFIX = 'puzzle-devtools-panel:';
const SOURCE_PANEL = 'puzzle-devtools-panel';
const CONTROL_LISTENING = 'listening';

/** tabId → content-script port */
const pagePorts = new Map();
/** tabId → devtools panel port */
const panelPorts = new Map();
/** tabId → the panel's last `listening` control envelope */
const listeningControl = new Map();

chrome.runtime.onConnect.addListener((port) => {
	const name = port.name || '';
	if (name === PORT_PAGE) {
		attachPage(port);
		return;
	}
	if (name.startsWith(PORT_PANEL_PREFIX)) {
		attachPanel(port, name.slice(PORT_PANEL_PREFIX.length));
	}
	// Anything else is not ours — ignore it entirely.
});

function attachPage(port) {
	const tabId = port.sender?.tab?.id;
	if (typeof tabId !== 'number') {
		safeDisconnect(port);
		return;
	}

	// A reload replaces the previous port for this tab; drop the stale one.
	const previous = pagePorts.get(tabId);
	if (previous && previous !== port) safeDisconnect(previous);
	pagePorts.set(tabId, port);

	port.onMessage.addListener((message) => {
		panelPorts.get(tabId)?.postMessage(message);
	});
	port.onDisconnect.addListener(() => {
		if (pagePorts.get(tabId) === port) pagePorts.delete(tabId);
	});

	// Re-arm a panel that was already listening before this page loaded.
	const control = listeningControl.get(tabId);
	if (control) safePost(port, control);
}

function attachPanel(port, rawTabId) {
	const tabId = Number(rawTabId);
	if (!Number.isInteger(tabId)) {
		safeDisconnect(port);
		return;
	}

	const previous = panelPorts.get(tabId);
	if (previous && previous !== port) safeDisconnect(previous);
	panelPorts.set(tabId, port);

	port.onMessage.addListener((message) => {
		if (
			message &&
			typeof message === 'object' &&
			message.source === SOURCE_PANEL &&
			message.control === CONTROL_LISTENING
		) {
			listeningControl.set(tabId, message);
		}
		pagePorts.get(tabId)?.postMessage(message);
	});
	port.onDisconnect.addListener(() => {
		if (panelPorts.get(tabId) === port) {
			panelPorts.delete(tabId);
			listeningControl.delete(tabId);
		}
	});
}

function safePost(port, message) {
	try {
		port.postMessage(message);
	} catch (err) {
		// The other end went away between the map lookup and the post.
	}
}

function safeDisconnect(port) {
	try {
		port.disconnect();
	} catch (err) {
		// already gone
	}
}

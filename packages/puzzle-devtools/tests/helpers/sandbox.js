import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function extensionSource(name) {
	return readFileSync(join(ROOT, 'extension', name), 'utf8');
}

export function repoFile(...parts) {
	return readFileSync(join(ROOT, ...parts), 'utf8');
}

/**
 * Evaluate one of the extension's classic scripts inside a FRESH jsdom window.
 *
 * Per-test isolation matters here: both page-hook.js and panel-glue.js install
 * globals and attach listeners, and they are deliberately idempotent — a shared
 * window would let the first test's hook survive into the second.
 *
 * `window.postMessage` is replaced with a recorder before the script runs, so
 * outbound envelopes are captured synchronously instead of going through
 * jsdom's async message queue.
 */
export function evalInSandbox(scriptName, { globals = {} } = {}) {
	const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
		runScripts: 'outside-only',
		url: 'https://fixture.test/',
	});
	const { window } = dom;

	const sent = [];
	window.postMessage = (message) => {
		sent.push(message);
	};

	for (const [key, value] of Object.entries(globals)) {
		window[key] = value;
	}

	window.eval(extensionSource(scriptName));

	return {
		dom,
		window,
		sent,
		/** Deliver a message as if it came from this same window. */
		deliver(data) {
			window.dispatchEvent(new window.MessageEvent('message', { data, source: window }));
		},
		/** Deliver a message from a foreign window (must be ignored). */
		deliverForeign(data) {
			const other = new JSDOM('').window;
			window.dispatchEvent(new window.MessageEvent('message', { data, source: other }));
		},
	};
}

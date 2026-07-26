import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/** The record id of the one Connection record. There is never a second. */
export const CONNECTION_ID = 'main';

export const CONNECTION_STATE = Object.freeze({
	/** No `hello` yet: no Puzzle app, a production build, or a pre-§55 framework. */
	WAITING: 'waiting',
	/** `hello` arrived and its protocol version is one we render. */
	CONNECTED: 'connected',
	/** `hello` arrived speaking a protocol version this extension does not support. */
	MISMATCH: 'version-mismatch',
});

/**
 * Singleton: the state of the link to the inspected page.
 *
 * Two independent notions of "connected" live here on purpose. `port` is the
 * extension's own plumbing (panel → service worker → content script); `state`
 * is the PROTOCOL handshake. A healthy port with no `hello` is the common,
 * unremarkable case — every page without a dev-build Puzzle app on it.
 */
export default class Connection extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		state: Puzzle.string().default(CONNECTION_STATE.WAITING),
		/** 'connected' | 'disconnected' — the chrome.runtime port, not the protocol. */
		port: Puzzle.string().default('disconnected'),
		protocolVersion: Puzzle.number().default(() => null),
		frameworkVersion: Puzzle.string().default(() => null),
		appMounted: Puzzle.boolean().default(false),
		/** Last `route-commit` payload: { pathname, query, params, chain, title }. */
		route: Puzzle.object().default(() => null),
		lastFlushKeys: Puzzle.array().default(() => []),
		/**
		 * Monotonic counters the panels watch instead of the events themselves.
		 * `viewSeq` ticks on every view-mounted/view-destroyed, `flushSeq` on every
		 * flush — a subscribed `data()` sees the change and schedules its own
		 * debounced re-snapshot, without the bridge knowing which panel is open.
		 */
		viewSeq: Puzzle.number().default(0),
		flushSeq: Puzzle.number().default(0),
		/**
		 * Ticks on every `perf-warning`. The Performance panel debounces a
		 * `snapshot:profile` off it, so a loop detection pulls the authoritative
		 * report even when nothing is recording and nothing else is polling.
		 */
		perfSeq: Puzzle.number().default(0),
		eventCount: Puzzle.number().default(0),
		lastEventAt: Puzzle.number().default(0),
		/** Set when the panel's own request plumbing fails, so the UI can say so. */
		error: Puzzle.string().default(() => null),
	};

	get isConnected() {
		return this.state === CONNECTION_STATE.CONNECTED;
	}

	get isMismatch() {
		return this.state === CONNECTION_STATE.MISMATCH;
	}

	get isWaiting() {
		return this.state === CONNECTION_STATE.WAITING;
	}
}

/**
 * Puzzle DevTools wire protocol — single source of truth for THIS repo.
 *
 * The contract itself is owned by the framework: see `constellation/doc/DOC-SPEC.md`
 * §55 ("The DevTools bridge and wire protocol") in magic-spells/puzzle. The
 * framework ships a dev-only runtime bridge; this extension ships the page hook
 * the bridge registers into. Everything below must stay byte-identical to the
 * names in §55.
 *
 * Envelope (both directions): { puzzle: 1, v: <PROTOCOL_VERSION>, type, payload }
 */

/** Protocol version this extension speaks. Exchanged in `hello`. */
export const PROTOCOL_VERSION = 1;

/**
 * Protocol versions this extension can render. A `hello` outside this set puts
 * the panel in the explicit version-mismatch state rather than misrendering.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [1];

/** Marker key that identifies a Puzzle DevTools envelope. Always the number 1. */
export const ENVELOPE_MARKER = 'puzzle';
export const ENVELOPE_MARKER_VALUE = 1;

/**
 * The message set grows ADDITIVELY, without a version bump.
 *
 * Both ends already tolerate names they do not know: an unrecognized EVENT falls
 * through `bridge.js#receive`'s default case into the event ring, and an
 * unrecognized REQUEST comes back as a per-call `{ error }` result. So a panel
 * built against a newer name set still renders everything an older runtime sends,
 * and an older panel ignores what a newer runtime adds.
 *
 * That is why the profiler messages below are still v1. Bumping PROTOCOL_VERSION
 * would put every already-published app into the hard MISMATCH state and blank
 * all six panels — a much larger regression than one panel reporting an empty
 * profile because the runtime predates it.
 */

/** Events: runtime → extension, pushed through `hook.emit(message)`. */
export const EVENTS = Object.freeze({
	HELLO: 'hello',
	APP_MOUNTED: 'app-mounted',
	APP_UNMOUNTED: 'app-unmounted',
	VIEW_MOUNTED: 'view-mounted',
	VIEW_DESTROYED: 'view-destroyed',
	FLUSH: 'flush',
	ROUTE_COMMIT: 'route-commit',
	/**
	 * The profiler's loop detector fired: `{ kind, viewId, name, detail, count }`.
	 * Deliberately LOW VOLUME — there is no per-render event, because the page
	 * hook buffers only HOOK_BUFFER_LIMIT messages before the panel attaches and
	 * the panel's own ring holds 200. Per-render traffic would blow both, so
	 * render counts are POLLED through `snapshot:profile` while recording.
	 */
	PERF_WARNING: 'perf-warning',
});

/** Requests: extension → runtime, answered by the `hook.onRequest` handler. */
export const REQUESTS = Object.freeze({
	SNAPSHOT_VIEWS: 'snapshot:views',
	INSPECT_VIEW: 'inspect:view',
	SNAPSHOT_RECORDS: 'snapshot:records',
	SNAPSHOT_SUBSCRIPTIONS: 'snapshot:subscriptions',
	SNAPSHOT_ROUTE: 'snapshot:route',
	EDIT_RECORD: 'edit:record',
	HIGHLIGHT_VIEW: 'highlight:view',
	LOG_VIEW: 'log:view',
	LOG_RECORD: 'log:record',
	/** Begin profiling. `{}` → `{ ok: true }`. */
	PERF_START: 'perf:start',
	/** End profiling; the counters stay readable afterwards. `{}` → `{ ok: true }`. */
	PERF_STOP: 'perf:stop',
	/**
	 * The whole profile report: `{ recording, durationMs, totals, views[],
	 * flushes[], warnings[] }`. The Performance panel polls this on an interval
	 * while recording, and once on a `perf-warning`.
	 */
	SNAPSHOT_PROFILE: 'snapshot:profile',
});

export const EVENT_TYPES = Object.freeze(Object.values(EVENTS));
export const REQUEST_TYPES = Object.freeze(Object.values(REQUESTS));

/** The global the extension installs at document_start; the bridge looks for it. */
export const HOOK_GLOBAL = '__PUZZLE_DEVTOOLS_HOOK__';

/**
 * Hook API version. Distinct from PROTOCOL_VERSION: this numbers the shape of
 * `window.__PUZZLE_DEVTOOLS_HOOK__` itself (emit / onRequest), not the messages
 * that travel through it.
 */
export const HOOK_API_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Transport — internal to this extension, NOT part of SPEC §55.               */
/* -------------------------------------------------------------------------- */

/** window.postMessage `source` tags. Page hook → panel, and panel → page hook. */
export const SOURCE_HOOK = 'puzzle-devtools-hook';
export const SOURCE_PANEL = 'puzzle-devtools-panel';

/** chrome.runtime.connect port names. */
export const PORT_PAGE = 'puzzle-devtools-page';
export const PORT_PANEL_PREFIX = 'puzzle-devtools-panel:';

/**
 * Control messages (panel ↔ page hook) that ride the same envelopes as protocol
 * traffic but are not protocol messages. They carry `control:` instead of
 * `message:`.
 */
export const CONTROL = Object.freeze({
	/** Panel is attached: replay the hook's buffer, then stream. */
	LISTENING: 'listening',
});

/** Max events the page hook buffers before the panel attaches. */
export const HOOK_BUFFER_LIMIT = 500;

/** How long panel-glue waits for a request answer before rejecting. */
export const REQUEST_TIMEOUT_MS = 5000;

/** Build a protocol envelope. */
export function envelope(type, payload) {
	return { [ENVELOPE_MARKER]: ENVELOPE_MARKER_VALUE, v: PROTOCOL_VERSION, type, payload };
}

/** Shallow structural check for a protocol envelope. Version is NOT checked. */
export function isEnvelope(value) {
	return (
		!!value &&
		typeof value === 'object' &&
		value[ENVELOPE_MARKER] === ENVELOPE_MARKER_VALUE &&
		typeof value.type === 'string'
	);
}

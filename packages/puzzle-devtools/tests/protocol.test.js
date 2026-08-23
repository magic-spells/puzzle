import { describe, it, expect } from 'vitest';
import { extensionSource, repoFile } from './helpers/sandbox.js';
import {
	CONTROL,
	EVENTS,
	EVENT_TYPES,
	HOOK_BUFFER_LIMIT,
	HOOK_GLOBAL,
	PORT_PAGE,
	PORT_PANEL_PREFIX,
	PROTOCOL_VERSION,
	REQUESTS,
	REQUEST_TYPES,
	SOURCE_HOOK,
	SOURCE_PANEL,
	SUPPORTED_PROTOCOL_VERSIONS,
	envelope,
	isEnvelope,
} from '../protocol/constants.js';

/*
 * The authority for these names is the framework SPEC, §55 "The DevTools bridge
 * and wire protocol". They are transcribed literally here so a rename in the
 * framework breaks this suite instead of silently breaking the panel.
 */
const SPEC_EVENTS = [
	'hello',
	'app-mounted',
	'app-unmounted',
	'view-mounted',
	'view-destroyed',
	'flush',
	'route-commit',
	'perf-warning',
];

const SPEC_REQUESTS = [
	'snapshot:views',
	'inspect:view',
	'snapshot:records',
	'snapshot:subscriptions',
	'snapshot:route',
	'edit:record',
	'highlight:view',
	'log:view',
	'log:record',
	'perf:start',
	'perf:stop',
	'snapshot:profile',
];

describe('protocol constants', () => {
	it('is protocol version 1', () => {
		expect(PROTOCOL_VERSION).toBe(1);
		expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(1);
	});

	it('names every SPEC §55 event, and no others', () => {
		expect([...EVENT_TYPES].sort()).toEqual([...SPEC_EVENTS].sort());
	});

	it('names every SPEC §55 request, and no others', () => {
		expect([...REQUEST_TYPES].sort()).toEqual([...SPEC_REQUESTS].sort());
	});

	it('exposes the individual names the panel code reads', () => {
		expect(EVENTS.HELLO).toBe('hello');
		expect(EVENTS.ROUTE_COMMIT).toBe('route-commit');
		expect(REQUESTS.SNAPSHOT_VIEWS).toBe('snapshot:views');
		expect(REQUESTS.EDIT_RECORD).toBe('edit:record');
	});

	it('names the profiler messages the Performance panel speaks', () => {
		expect(EVENTS.PERF_WARNING).toBe('perf-warning');
		expect(REQUESTS.PERF_START).toBe('perf:start');
		expect(REQUESTS.PERF_STOP).toBe('perf:stop');
		expect(REQUESTS.SNAPSHOT_PROFILE).toBe('snapshot:profile');
	});

	/*
	 * The profiler was added WITHOUT a version bump, on purpose. Both ends already
	 * tolerate unknown names — an unknown event falls through to the ring, an
	 * unknown request fails per-call — so a v2 would have bought nothing and cost
	 * every already-published app a hard MISMATCH that blanks all six panels.
	 */
	it('keeps the profiler additive: still v1, and every older name intact', () => {
		expect(PROTOCOL_VERSION).toBe(1);
		expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([1]);

		for (const name of ['hello', 'app-mounted', 'flush', 'route-commit']) {
			expect(EVENT_TYPES).toContain(name);
		}
		for (const name of ['snapshot:views', 'inspect:view', 'edit:record']) {
			expect(REQUEST_TYPES).toContain(name);
		}
	});

	it('builds the SPEC §55 envelope', () => {
		expect(envelope('hello', { protocolVersion: 1 })).toEqual({
			puzzle: 1,
			v: 1,
			type: 'hello',
			payload: { protocolVersion: 1 },
		});
	});

	it('recognizes envelopes structurally, ignoring the version', () => {
		expect(isEnvelope({ puzzle: 1, v: 1, type: 'hello', payload: {} })).toBe(true);
		expect(isEnvelope({ puzzle: 1, v: 99, type: 'hello' })).toBe(true);
		expect(isEnvelope({ v: 1, type: 'hello' })).toBe(false);
		expect(isEnvelope({ puzzle: 1 })).toBe(false);
		expect(isEnvelope(null)).toBe(false);
	});

	it('names the hook global the framework bridge looks for', () => {
		expect(HOOK_GLOBAL).toBe('__PUZZLE_DEVTOOLS_HOOK__');
	});
});

/*
 * page-hook.js, content-script.js, background.js and panel-glue.js are classic
 * scripts (MV3 content scripts cannot be modules), so they cannot import the
 * constants module and duplicate its literals instead. These assertions are what
 * make that duplication safe.
 */
describe('duplicated transport constants agree with protocol/constants.js', () => {
	const FILES = ['page-hook.js', 'content-script.js', 'background.js', 'panel-glue.js'];

	it.each(FILES)('%s uses the shared source tags and port names', (name) => {
		const source = extensionSource(name);

		for (const [literal, value] of Object.entries(literalsIn(source))) {
			switch (literal) {
				case 'SOURCE_HOOK':
					expect(value).toBe(SOURCE_HOOK);
					break;
				case 'SOURCE_PANEL':
					expect(value).toBe(SOURCE_PANEL);
					break;
				case 'PORT_PAGE':
					expect(value).toBe(PORT_PAGE);
					break;
				case 'PORT_PANEL_PREFIX':
					expect(value).toBe(PORT_PANEL_PREFIX);
					break;
				case 'CONTROL_LISTENING':
					expect(value).toBe(CONTROL.LISTENING);
					break;
				case 'HOOK_KEY':
					expect(value).toBe(HOOK_GLOBAL);
					break;
				default:
					break;
			}
		}
	});

	it('page-hook.js declares the shared numeric limits', () => {
		const source = extensionSource('page-hook.js');
		expect(numberIn(source, 'BUFFER_LIMIT')).toBe(HOOK_BUFFER_LIMIT);
		expect(numberIn(source, 'PROTOCOL_VERSION')).toBe(PROTOCOL_VERSION);
	});

	it('panel-glue.js declares the shared protocol version', () => {
		const source = extensionSource('panel-glue.js');
		expect(numberIn(source, 'PROTOCOL_VERSION')).toBe(PROTOCOL_VERSION);
		expect(numberIn(source, 'ENVELOPE_MARKER_VALUE')).toBe(1);
	});
});

describe('manifest', () => {
	const manifest = JSON.parse(repoFile('extension', 'manifest.json'));

	it('is MV3', () => {
		expect(manifest.manifest_version).toBe(3);
	});

	it('injects the page hook into the MAIN world at document_start', () => {
		const hook = manifest.content_scripts.find((entry) => entry.js.includes('page-hook.js'));
		expect(hook.world).toBe('MAIN');
		expect(hook.run_at).toBe('document_start');
		expect(hook.matches).toEqual(['<all_urls>']);
	});

	it('injects the relay into the isolated world at document_start', () => {
		const relay = manifest.content_scripts.find((entry) => entry.js.includes('content-script.js'));
		expect(relay.world).toBe('ISOLATED');
		expect(relay.run_at).toBe('document_start');
	});

	it('registers a module service worker and a devtools page', () => {
		expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
		expect(manifest.devtools_page).toBe('devtools.html');
	});

	it('declares no host permissions — the content scripts are the whole surface', () => {
		expect(manifest.permissions).toBeUndefined();
		expect(manifest.host_permissions).toBeUndefined();
	});
});

/** Extract `var NAME = 'literal';` / `const NAME = 'literal';` string declarations. */
function literalsIn(source) {
	const out = {};
	for (const match of source.matchAll(/(?:var|const|let)\s+([A-Z_][A-Z0-9_]*)\s*=\s*'([^']*)'/g)) {
		out[match[1]] = match[2];
	}
	return out;
}

/** Extract a numeric `NAME = 123` declaration. */
function numberIn(source, name) {
	const match = source.match(new RegExp(`(?:var|const|let)\\s+${name}\\s*=\\s*(\\d+)`));
	return match ? Number(match[1]) : undefined;
}

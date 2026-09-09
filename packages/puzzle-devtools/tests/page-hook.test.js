import { describe, it, expect, beforeEach } from 'vitest';
import { evalInSandbox, extensionSource } from './helpers/sandbox.js';
import { HOOK_BUFFER_LIMIT, SOURCE_HOOK, SOURCE_PANEL, CONTROL } from '../protocol/constants.js';

const HOOK_KEY = '__PUZZLE_DEVTOOLS_HOOK__';

function envelope(type, payload = {}) {
	return { puzzle: 1, v: 1, type, payload };
}

function listening() {
	return { source: SOURCE_PANEL, control: CONTROL.LISTENING };
}

describe('page-hook: installation', () => {
	let box;
	beforeEach(() => {
		box = evalInSandbox('page-hook.js');
	});

	it('installs the hook with emit + onRequest', () => {
		const hook = box.window[HOOK_KEY];
		expect(typeof hook.emit).toBe('function');
		expect(typeof hook.onRequest).toBe('function');
		expect(hook.protocolVersion).toBe(1);
	});

	it('is non-enumerable so page code walking window does not trip on it', () => {
		expect(Object.keys(box.window)).not.toContain(HOOK_KEY);
	});

	it('is idempotent — a second injection keeps the first hook', () => {
		const first = box.window[HOOK_KEY];
		// Re-running the same source must not replace a hook the bridge has
		// already registered a handler into.
		box.window.eval(extensionSource('page-hook.js'));
		expect(box.window[HOOK_KEY]).toBe(first);
	});

	it('rejects a non-function request handler', () => {
		// Matched by message, not by constructor: the sandbox is a separate realm,
		// so its TypeError is not this realm's TypeError.
		expect(() => box.window[HOOK_KEY].onRequest('nope')).toThrow(/expects a function/);
	});
});

describe('page-hook: buffering and replay', () => {
	let box;
	beforeEach(() => {
		box = evalInSandbox('page-hook.js');
	});

	it('buffers events until the panel says it is listening', () => {
		const hook = box.window[HOOK_KEY];
		hook.emit(envelope('hello', { protocolVersion: 1, frameworkVersion: '0.2.0' }));
		hook.emit(envelope('app-mounted'));

		expect(box.sent).toHaveLength(0);

		box.deliver(listening());

		expect(box.sent).toHaveLength(2);
		expect(box.sent[0].source).toBe(SOURCE_HOOK);
		expect(box.sent[0].message.type).toBe('hello');
		expect(box.sent[1].message.type).toBe('app-mounted');
	});

	it('replays in emission order and numbers events monotonically', () => {
		const hook = box.window[HOOK_KEY];
		for (let i = 0; i < 5; i++) hook.emit(envelope('view-mounted', { id: i }));
		box.deliver(listening());

		expect(box.sent.map((m) => m.message.payload.id)).toEqual([0, 1, 2, 3, 4]);
		expect(box.sent.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
	});

	it('streams directly once listening', () => {
		const hook = box.window[HOOK_KEY];
		box.deliver(listening());
		hook.emit(envelope('flush', { keys: ['todo'], notified: [1] }));

		expect(box.sent).toHaveLength(1);
		expect(box.sent[0].message.type).toBe('flush');
	});

	it(`caps the buffer at ${HOOK_BUFFER_LIMIT}, keeping the newest events`, () => {
		const hook = box.window[HOOK_KEY];
		const overflow = HOOK_BUFFER_LIMIT + 100;
		for (let i = 0; i < overflow; i++) hook.emit(envelope('flush', { keys: [`k${i}`] }));

		box.deliver(listening());

		expect(box.sent).toHaveLength(HOOK_BUFFER_LIMIT);
		expect(box.sent[0].message.payload.keys[0]).toBe('k100');
		expect(box.sent[HOOK_BUFFER_LIMIT - 1].message.payload.keys[0]).toBe(`k${overflow - 1}`);
	});

	it('does not replay a second time when the panel re-attaches', () => {
		const hook = box.window[HOOK_KEY];
		hook.emit(envelope('hello'));
		box.deliver(listening());
		expect(box.sent).toHaveLength(1);

		box.deliver(listening());
		expect(box.sent).toHaveLength(1);
	});

	it('ignores non-object emissions', () => {
		const hook = box.window[HOOK_KEY];
		box.deliver(listening());
		hook.emit(null);
		hook.emit('nope');
		expect(box.sent).toHaveLength(0);
	});
});

describe('page-hook: request correlation', () => {
	let box;
	beforeEach(() => {
		box = evalInSandbox('page-hook.js');
	});

	it('answers with no-bridge when no handler is registered', () => {
		box.deliver({ source: SOURCE_PANEL, id: 7, message: envelope('snapshot:views') });

		expect(box.sent).toEqual([{ source: SOURCE_HOOK, id: 7, error: 'no-bridge' }]);
	});

	it('routes the request to the handler and echoes the id back', () => {
		const seen = [];
		box.window[HOOK_KEY].onRequest((message) => {
			seen.push(message);
			return { roots: [{ id: 1, name: 'Root', module: null, children: [] }] };
		});

		box.deliver({ source: SOURCE_PANEL, id: 42, message: envelope('snapshot:views') });

		expect(seen).toHaveLength(1);
		expect(seen[0].type).toBe('snapshot:views');
		expect(box.sent[0].id).toBe(42);
		expect(box.sent[0].result.roots[0].name).toBe('Root');
	});

	it('keeps ids distinct across interleaved requests', () => {
		box.window[HOOK_KEY].onRequest((message) => ({ echo: message.payload.n }));

		box.deliver({ source: SOURCE_PANEL, id: 1, message: envelope('inspect:view', { n: 'a' }) });
		box.deliver({ source: SOURCE_PANEL, id: 2, message: envelope('inspect:view', { n: 'b' }) });

		expect(box.sent).toEqual([
			{ source: SOURCE_HOOK, id: 1, result: { echo: 'a' } },
			{ source: SOURCE_HOOK, id: 2, result: { echo: 'b' } },
		]);
	});

	it('converts a handler throw into an { id, error } answer', () => {
		box.window[HOOK_KEY].onRequest(() => {
			throw new Error('boom');
		});

		box.deliver({ source: SOURCE_PANEL, id: 3, message: envelope('snapshot:route') });

		expect(box.sent).toEqual([{ source: SOURCE_HOOK, id: 3, error: 'boom' }]);
	});

	it('relays an { error } RESULT untouched — the real bridge never throws', () => {
		box.window[HOOK_KEY].onRequest(() => ({ error: 'no live view with id 9' }));

		box.deliver({ source: SOURCE_PANEL, id: 4, message: envelope('inspect:view', { id: 9 }) });

		expect(box.sent[0].result).toEqual({ error: 'no live view with id 9' });
	});

	it('awaits a thenable handler result', async () => {
		box.window[HOOK_KEY].onRequest(() => Promise.resolve({ ok: true }));

		box.deliver({ source: SOURCE_PANEL, id: 5, message: envelope('highlight:view', { id: 1 }) });
		expect(box.sent).toHaveLength(0);

		await Promise.resolve();
		await Promise.resolve();
		expect(box.sent[0]).toEqual({ source: SOURCE_HOOK, id: 5, result: { ok: true } });
	});

	it('normalizes an undefined handler result to null', () => {
		box.window[HOOK_KEY].onRequest(() => undefined);

		box.deliver({ source: SOURCE_PANEL, id: 6, message: envelope('log:view', { id: 1 }) });

		expect(box.sent[0]).toEqual({ source: SOURCE_HOOK, id: 6, result: null });
	});

	it('drops traffic from another window and traffic without our source tag', () => {
		box.window[HOOK_KEY].onRequest(() => ({ ok: true }));

		box.deliverForeign({ source: SOURCE_PANEL, id: 8, message: envelope('snapshot:views') });
		box.deliver({ source: 'something-else', id: 9, message: envelope('snapshot:views') });
		box.deliver({ source: SOURCE_HOOK, seq: 1, message: envelope('hello') });

		expect(box.sent).toHaveLength(0);
	});

	it('unregisters cleanly', () => {
		const off = box.window[HOOK_KEY].onRequest(() => ({ ok: true }));
		off();

		box.deliver({ source: SOURCE_PANEL, id: 10, message: envelope('snapshot:views') });

		expect(box.sent[0].error).toBe('no-bridge');
	});
});

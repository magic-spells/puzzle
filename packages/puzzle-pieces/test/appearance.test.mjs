// The appearance runtime and the pre-paint snippet, run under Node against a
// stub document + localStorage. The case that matters most is a stored
// `mode: null` — "follow the OS" — which is a real choice, not an empty store:
// pre-paint must NOT paint data-default-mode over it (that is the flash the
// snippet exists to prevent), and appearance.read() must keep it null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const prePaint = readFileSync(new URL('../registry/theme/pre-paint.js', import.meta.url), 'utf8');

function fakeDom({ stored, scriptAttrs = {} } = {}) {
	const attrs = new Map();
	const root = {
		style: {},
		setAttribute: (k, v) => attrs.set(k, String(v)),
		removeAttribute: (k) => attrs.delete(k),
		getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
		hasAttribute: (k) => attrs.has(k),
	};
	const store = new Map();
	if (stored !== undefined) store.set(scriptAttrs['data-key'] || 'puzzle:appearance', JSON.stringify(stored));
	const localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k),
	};
	const document = {
		documentElement: root,
		currentScript: { getAttribute: (k) => (k in scriptAttrs ? scriptAttrs[k] : null) },
	};
	return { root, attrs, localStorage, document, store };
}

function runPrePaint(opts) {
	const dom = fakeDom(opts);
	vm.runInNewContext(prePaint, { document: dom.document, localStorage: dom.localStorage, JSON });
	return dom;
}

test('pre-paint: stored mode null (follow OS) paints no mode even with data-default-mode', () => {
	const dom = runPrePaint({ stored: { scheme: 'warm', mode: null }, scriptAttrs: { 'data-default-mode': 'dark' } });
	assert.equal(dom.attrs.get('data-scheme'), 'warm');
	assert.equal(dom.attrs.has('data-theme'), false, 'data-theme must stay absent for a stored null mode');
	assert.equal(dom.root.style.colorScheme, undefined);
});

test('pre-paint: an EMPTY store takes data-default-mode; an unknown mode does too', () => {
	const empty = runPrePaint({ scriptAttrs: { 'data-default-mode': 'dark' } });
	assert.equal(empty.attrs.get('data-theme'), 'dark');
	assert.equal(empty.root.style.colorScheme, 'dark');
	const junk = runPrePaint({ stored: { mode: 'sepia' }, scriptAttrs: { 'data-default-mode': 'light' } });
	assert.equal(junk.attrs.get('data-theme'), 'light');
	assert.equal(junk.root.style.colorScheme, 'light');
});

test('pre-paint: mixed reads as medium, legacy { theme } as the scheme, default scheme sets no attribute', () => {
	const dom = runPrePaint({ stored: { theme: 'dim', mode: 'mixed' } });
	assert.equal(dom.attrs.get('data-scheme'), 'dim');
	assert.equal(dom.attrs.get('data-theme'), 'medium');
	assert.equal(dom.root.style.colorScheme, 'dark');
	const def = runPrePaint({ stored: { scheme: 'default', mode: 'light' } });
	assert.equal(def.attrs.has('data-scheme'), false);
	assert.equal(def.attrs.get('data-theme'), 'light');
});

test('appearance.js: read() keeps a stored null mode, apply() removes data-theme, set(null) persists null', async () => {
	const dom = fakeDom({ stored: { scheme: 'void', mode: null } });
	globalThis.document = dom.document;
	globalThis.localStorage = dom.localStorage;
	globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }) };
	try {
		const appearance = await import('../registry/theme/appearance.js');
		const booted = appearance.boot();
		assert.deepEqual(booted, { scheme: 'void', mode: null });
		assert.equal(dom.attrs.get('data-scheme'), 'void');
		assert.equal(dom.attrs.has('data-theme'), false);
		assert.equal(dom.root.style.colorScheme, '');

		appearance.set({ mode: 'medium' });
		assert.equal(dom.attrs.get('data-theme'), 'medium');
		assert.equal(dom.root.style.colorScheme, 'dark');
		assert.deepEqual(JSON.parse(dom.store.get('puzzle:appearance')), { scheme: 'void', mode: 'medium' });

		appearance.set({ mode: null });
		assert.equal(dom.attrs.has('data-theme'), false);
		assert.deepEqual(JSON.parse(dom.store.get('puzzle:appearance')), { scheme: 'void', mode: null });
		assert.deepEqual(appearance.read(), { scheme: 'void', mode: null });

		// pre-paint and boot() must agree on the same store.
		const painted = runPrePaint({ stored: JSON.parse(dom.store.get('puzzle:appearance')), scriptAttrs: { 'data-default-mode': 'dark' } });
		assert.equal(painted.attrs.get('data-scheme'), dom.attrs.get('data-scheme'));
		assert.equal(painted.attrs.has('data-theme'), dom.attrs.has('data-theme'));
	} finally {
		delete globalThis.document;
		delete globalThis.localStorage;
		delete globalThis.window;
	}
});

test('appearance.js: an OS flip notifies subscribers only while mode is null', async () => {
	let onChange = null;
	const dom = fakeDom({ stored: { scheme: 'default', mode: null } });
	globalThis.document = dom.document;
	globalThis.localStorage = dom.localStorage;
	globalThis.window = {
		addEventListener() {},
		matchMedia: () => ({ matches: false, addEventListener: (_, fn) => { onChange = fn; } }),
	};
	try {
		const appearance = await import('../registry/theme/appearance.js?os-flip');
		appearance.boot();
		let heard = 0;
		const off = appearance.subscribe(() => heard++);
		assert.equal(typeof onChange, 'function', 'subscribe() must arm the prefers-color-scheme listener');
		onChange();
		assert.equal(heard, 1);
		appearance.set({ mode: 'dark' });
		heard = 0;
		onChange();
		assert.equal(heard, 0, 'an explicit mode ignores OS flips');
		off();
	} finally {
		delete globalThis.document;
		delete globalThis.localStorage;
		delete globalThis.window;
	}
});

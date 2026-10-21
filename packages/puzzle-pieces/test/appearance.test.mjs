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

function fakeDom({ stored, raw, throws = false, scriptAttrs = {} } = {}) {
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
	if (raw !== undefined) store.set(scriptAttrs['data-key'] || 'puzzle:appearance', raw);
	const localStorage = {
		getItem: (k) => {
			if (throws) throw new Error('SecurityError: storage is disabled');
			return store.has(k) ? store.get(k) : null;
		},
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k),
	};
	const document = {
		documentElement: root,
		currentScript: { getAttribute: (k) => (k in scriptAttrs ? scriptAttrs[k] : null) },
	};
	const window = { addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }) };
	return { root, attrs, localStorage, document, store, window };
}

function runPrePaint(opts) {
	const dom = fakeDom(opts);
	vm.runInNewContext(prePaint, { window: dom.window, document: dom.document, localStorage: dom.localStorage, JSON });
	return dom;
}

// boot() in a page pre-paint already painted: the SAME document, store and
// window, with appearance.js imported fresh (its config is read at import time)
// and no configure() call — the documented setup.
async function bootAfterPrePaint(dom, tag) {
	globalThis.document = dom.document;
	globalThis.localStorage = dom.localStorage;
	globalThis.window = dom.window;
	globalThis.__puzzleAppearance = dom.window.__puzzleAppearance;
	try {
		const appearance = await import(`../registry/theme/appearance.js?${tag}`);
		return { appearance, booted: appearance.boot() };
	} finally {
		delete globalThis.document;
		delete globalThis.localStorage;
		delete globalThis.window;
		delete globalThis.__puzzleAppearance;
	}
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

test('pre-paint: 0.8 names alias forward (dim → cool, medium → dim), legacy { theme } is the scheme, default sets no attribute', () => {
	const dom = runPrePaint({ stored: { theme: 'dim', mode: 'medium' } });
	assert.equal(dom.attrs.get('data-scheme'), 'cool');
	assert.equal(dom.attrs.get('data-theme'), 'dim');
	assert.equal(dom.root.style.colorScheme, 'dark');
	const def = runPrePaint({ stored: { scheme: 'default', mode: 'light' } });
	assert.equal(def.attrs.has('data-scheme'), false);
	assert.equal(def.attrs.get('data-theme'), 'light');
});

test('pre-paint: mixed is its own style and paints color-scheme light', () => {
	const dom = runPrePaint({ stored: { scheme: 'warm', mode: 'mixed' } });
	assert.equal(dom.attrs.get('data-theme'), 'mixed');
	assert.equal(dom.root.style.colorScheme, 'light');
});

test('appearance.js and pre-paint agree on every alias and every style', async () => {
	const cases = [
		[{ scheme: 'dim', mode: 'medium' }, { scheme: 'cool', mode: 'dim' }],
		[{ theme: 'dim', mode: 'mixed' }, { scheme: 'cool', mode: 'mixed' }],
		[{ scheme: 'void', mode: 'dark' }, { scheme: 'void', mode: 'dark' }],
		[{ scheme: 'warm', mode: 'light' }, { scheme: 'warm', mode: 'light' }],
	];
	for (const [n, [stored, want]] of cases.entries()) {
		const dom = runPrePaint({ stored });
		const painted = { scheme: dom.attrs.get('data-scheme'), mode: dom.attrs.get('data-theme'), cs: dom.root.style.colorScheme };
		const { appearance, booted } = await bootAfterPrePaint(dom, `alias-${n}`);
		assert.deepEqual(booted, want, `boot() of ${JSON.stringify(stored)}`);
		assert.deepEqual(painted, { scheme: want.scheme, mode: want.mode, cs: appearance.resolveColorScheme(want.mode) }, `pre-paint of ${JSON.stringify(stored)}`);
	}
});

test('appearance.js and pre-paint agree on the fallbacks: aliased defaults, junk fields, unreadable storage', async () => {
	const defaults = { 'data-default-scheme': 'dim', 'data-default-mode': 'medium' };
	const cases = [
		// 0.8 names in the <script> parameters alias forward, like stored ones.
		[{ scriptAttrs: defaults }, { scheme: 'cool', mode: 'dim' }],
		// A junk scheme falls to the legacy `theme`, a junk mode to the default.
		[{ stored: { scheme: 'sepia', theme: 'warm', mode: 'sepia' }, scriptAttrs: defaults }, { scheme: 'warm', mode: 'dim' }],
		[{ stored: { scheme: 'sepia' }, scriptAttrs: { 'data-default-scheme': 'void' } }, { scheme: 'void', mode: null }],
		// Unparseable and throwing storage both read as the empty store.
		[{ raw: '{not json', scriptAttrs: { 'data-default-mode': 'mixed' } }, { scheme: 'default', mode: 'mixed' }],
		[{ throws: true, scriptAttrs: { 'data-default-mode': 'light', 'data-default-scheme': 'warm' } }, { scheme: 'warm', mode: 'light' }],
	];
	for (const [n, [opts, want]] of cases.entries()) {
		const dom = runPrePaint(opts);
		const painted = { scheme: dom.attrs.get('data-scheme') ?? 'default', mode: dom.attrs.get('data-theme') ?? null };
		const { booted } = await bootAfterPrePaint(dom, `fallback-${n}`);
		assert.deepEqual(painted, want, `pre-paint of case ${n}`);
		assert.deepEqual(booted, want, `boot() of case ${n}`);
	}
});

test('boot() keeps what pre-paint painted from data-default-mode / data-default-scheme on an empty store', async () => {
	const dom = runPrePaint({ scriptAttrs: { 'data-default-mode': 'dark', 'data-default-scheme': 'warm' } });
	assert.equal(dom.attrs.get('data-theme'), 'dark');
	assert.equal(dom.attrs.get('data-scheme'), 'warm');
	const { booted } = await bootAfterPrePaint(dom, 'seed-defaults');
	assert.deepEqual(booted, { scheme: 'warm', mode: 'dark' });
	assert.equal(dom.attrs.get('data-theme'), 'dark', 'boot() stripped the default mode pre-paint painted');
	assert.equal(dom.attrs.get('data-scheme'), 'warm', 'boot() stripped the default scheme pre-paint painted');
	assert.equal(dom.root.style.colorScheme, 'dark');
});

test('boot() reads the custom data-key pre-paint read, without configure()', async () => {
	const dom = runPrePaint({ stored: { scheme: 'cool', mode: 'light' }, scriptAttrs: { 'data-key': 'app:look' } });
	assert.equal(dom.attrs.get('data-scheme'), 'cool');
	const { appearance, booted } = await bootAfterPrePaint(dom, 'seed-key');
	assert.deepEqual(booted, { scheme: 'cool', mode: 'light' });
	assert.equal(dom.attrs.get('data-scheme'), 'cool');
	assert.equal(dom.attrs.get('data-theme'), 'light');
	assert.equal(appearance.configure().storageKey, 'app:look');
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

		appearance.set({ mode: 'dim' });
		assert.equal(dom.attrs.get('data-theme'), 'dim');
		assert.equal(dom.root.style.colorScheme, 'dark');
		assert.deepEqual(JSON.parse(dom.store.get('puzzle:appearance')), { scheme: 'void', mode: 'dim' });

		appearance.set({ mode: 'mixed' });
		assert.equal(dom.attrs.get('data-theme'), 'mixed');
		assert.equal(dom.root.style.colorScheme, 'light');

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

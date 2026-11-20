// Shared vitest setup. jsdom does not implement window.scrollTo, so every
// router navigation in a jsdom suite prints "Not implemented: window.scrollTo"
// to stderr. Stub it with a no-op (configurable, so suites like
// tests/router-scroll.test.js can install their own faithful stub on top).
if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
	Object.defineProperty(window, 'scrollTo', {
		value: () => {},
		writable: true,
		configurable: true,
	});
}

// Node 25+ defines its own global localStorage, undefined unless Node starts
// with --localstorage-file, and Vitest's jsdom environment keeps a global that
// already exists, so jsdom's working Storage stays hidden. Put jsdom's back.
if (typeof jsdom !== 'undefined') {
	Object.defineProperty(globalThis, 'localStorage', {
		value: jsdom.window.localStorage,
		configurable: true,
		writable: true,
	});
}

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

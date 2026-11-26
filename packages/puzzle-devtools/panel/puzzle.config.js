// Puzzle app config for the DevTools panel.
//
// The panel is a normal SPA build: `puzzle build` emits panel/dist/app.js +
// panel/dist/styles.css, which scripts/build.mjs copies into
// dist-extension/panel/. The extension's own panel.html replaces the shell in
// app/public/index.html (that shell exists only so `puzzle dev` can render the
// panel standalone, against the offline bridge stub).
export default {
	styles: {
		use: ['tailwindcss'],
	},
	build: {
		// This IS the debugging tool — keep its own console calls in the bundle.
		dropConsole: false,
		// Fixed names: extension/panel.html loads panel/app.js and
		// panel/styles.css by name, and a packaged extension has no HTTP cache
		// for hashed names to bust.
		hashNames: false,
	},
};

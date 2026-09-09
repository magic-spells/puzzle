import { PuzzleApp } from '@magic-spells/puzzle';
import { hashRouter } from '@magic-spells/puzzle/router-modes';
import routes from './routes.js';

// Create and configure the Puzzle app. The v1 config surface is intentionally
// small: target, routes, models, formatters, apiURL.
const app = new PuzzleApp({
	// Where the app mounts (matches #app in public/index.html)
	target: '#app',

	// Route definitions
	routes,

	// Hash-based routing so the static bundle deep-links correctly from any
	// host without server rewrites (GitHub Pages serves only real files).
	routerMode: hashRouter(),

	// Global formatters available in every template
	// (display transformation only — logic belongs in data())
	formatters: {
		shout: (value) => `${String(value).toUpperCase()}!`,
	},
});

// Start the app
app.mount();

export default app;

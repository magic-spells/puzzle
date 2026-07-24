import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';
import { installBridge } from './bridge.js';

/**
 * The DevTools panel, built as a normal Puzzle app — the extension dogfoods the
 * framework it inspects.
 *
 * Hash routing because the page is served from chrome-extension://<id>/panel.html.
 * The bridge is wired in `beforeMount`, which runs after ctx is assembled and is
 * awaited before navigation #0 — so the first render already sees whatever the
 * page hook replayed.
 */
const app = new PuzzleApp({
	target: '#app',
	routes,
	models,
	routerMode: 'hash',

	formatters: {
		/** Compact JSON for payload previews; unserializable values degrade to String(). */
		json: (value) => {
			try {
				return JSON.stringify(value);
			} catch (err) {
				return String(value);
			}
		},
	},

	beforeMount(instance) {
		installBridge(instance.store);
	},
});

app.mount();

export default app;

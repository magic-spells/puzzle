import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';

// Nothing about translations is configured here: puzzle.config.js lists the
// locales, and the build hands the runtime its manifest. Every view reaches the
// service as this.ctx.i18n, and templates use `{ 'key' | t }`.
const app = new PuzzleApp({
	target: '#app',
	routes,
});

app.mount();

export default app;

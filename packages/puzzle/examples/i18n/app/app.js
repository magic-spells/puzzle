import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

// Nothing about translations is configured here: puzzle.config.js lists the
// locales and turns on locale URL prefixes, and the build hands the runtime its
// manifest. Every view reaches the service as this.ctx.i18n, and templates use
// `{ t('key') }` and `{ link('/path') }`.
//
// A language switch is a page load under prefix routing (/about → /es/about), so
// the store persists to localStorage: the cart is still there in the new language.
// `storage` persists every model in the store to localStorage, not just the cart.
const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

const app = new PuzzleApp({
	target: '#app',
	routes,
	models,
	storage,
});

app.mount();

export default app;

import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

// Create and configure the Puzzle app.
// The v1 config surface is intentionally small: target, routes, models,
// formatters, apiURL — see constellation/doc/DOC-SPEC.md §2.
const app = new PuzzleApp({
  // Where the app mounts
  target: '#app',

  // Routes configuration
  routes,

  // Models registration
  models,

  // Install server sync once for every model with a static adapter config.
  // With it installed, store.findOne()/store.findMany() inside a view's data()
  // fetch whatever the store is missing and settle before the view commits
  // (D161) — no app has to seed anything by hand.
  adapter,

  // Base URL for the server read path. Adapter endpoints are joined onto this,
  // so `findMany('post')` GETs /api/posts.json — a static JSON file copied from
  // app/public/api/ into dist/api/ at build time.
  apiURL: '/api',

  // Global formatters available in all templates
  // (display transformation only — logic belongs in data())
  formatters: {
    byline: (name) => (name ? `By ${name}` : 'By an unknown author')
  }
});

app.mount();

export default app;

import { PuzzleApp } from '@magic-spells/puzzle';
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

  // Base URL for the D21 server read path. Adapter endpoints are joined onto
  // this, so store.loadAll('post') fetches /api/posts.json — a static JSON seed
  // copied from app/public/api/ into dist/api/ at build time.
  apiURL: '/api',

  // Global formatters available in all templates
  // (display transformation only — logic belongs in data())
  formatters: {
    byline: (name) => (name ? `By ${name}` : 'By an unknown author')
  },

  // Seed the store from the server (D21 read path) before navigation #0. loadAll
  // upserts by primary key and notifies subscribers, so it must NEVER run inside
  // data() — a view subscribed to that type would refetch forever. beforeMount is
  // the sanctioned home for it; seeding here is visible to the first data().
  beforeMount(app) {
    app.store.loadAll('user').catch((err) => console.error('[blog] user seed failed:', err));
    app.store.loadAll('post').catch((err) => console.error('[blog] post seed failed:', err));
  }
});

app.mount();

export default app;

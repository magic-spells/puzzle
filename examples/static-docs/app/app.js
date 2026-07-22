import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

// Create and configure the Puzzle app.
// The v1 config surface is intentionally small: target, routes, models,
// formatters, apiURL — see constellation/doc/DOC-SPEC.md §2.
const app = new PuzzleApp({
  // Where the app mounts. SSG (D67) requires an `'#id'` selector that points at
  // an empty element in the shell — the prerenderer injects each route's markup
  // there and stamps it `data-puzzle-ssg`.
  target: '#app',

  // Routes configuration
  routes,

  // Models registration
  models,

  // Global formatters available in all templates
  // (display transformation only — logic belongs in data())
  formatters: {
    // Uppercase the first letter — used on the guide section headings.
    titlecase: (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : ''),
    // Pluralize a unit against a count — used by the Home counter.
    plural: (n, unit) => (n === 1 ? unit : unit + 's'),
  },

  // App lifecycle hook (v1.28, D60). Under SSG (D67) this runs ONCE at build time
  // with a `{ store, config }` facade before the routes are prerendered, so any
  // records seeded here flow into the first data() of every page and land in the
  // static HTML. Destructuring `{ store }` works in both worlds: at runtime the
  // hook is handed the live app, which exposes the same `.store`.
  beforeMount({ store }) {
    // A trivial build-time model: three framework principles the About page reads
    // in its data(). No network, no async — just seed the store.
    store.createRecord('principle', {
      id: 'p1',
      title: 'One file per component',
      body: 'Template, styles, and logic live together in a .pzl file, so a component is a single thing you can read top to bottom.',
    });
    store.createRecord('principle', {
      id: 'p2',
      title: 'Data down, events up',
      body: 'Views compute their model in data() and react to store changes; interactions travel back out through plain event handlers.',
    });
    store.createRecord('principle', {
      id: 'p3',
      title: 'Static when it can be',
      body: 'The same app prerenders to HTML for content pages and stays a live SPA for the interactive ones — no second codebase.',
    });
  },
});

// Start the app. In the browser this mounts the SPA; under SSG the router takes
// over the prerendered DOM at navigation #0 (replaceChildren + marker removal +
// skipEnter, inside the commit window) with no flash and no duplication.
app.mount();

// Required by the SSG prerenderer (D67): the Go build bundles a node entry that
// imports this default export to read `app.config`.
export default app;

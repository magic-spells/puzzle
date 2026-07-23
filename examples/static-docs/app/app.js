import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';
import formatters from './formatters.js';

// Create and configure the Puzzle app.
// The v1 config surface is intentionally small: target, routes, models,
// formatters, apiURL — see constellation/doc/DOC-SPEC.md §2.
const app = new PuzzleApp({
  // Where the app mounts. In static mode (D81) `target` must be an `'#id'`
  // selector pointing at an empty element in the shell — the prerenderer injects
  // each route's markup there and stamps it `data-puzzle-static` (NOT
  // `data-puzzle-ssg`: no router ever takes these pages over).
  target: '#app',

  // Routes configuration
  routes,

  // Models registration
  models,

  // Global formatters (display transformation only — logic belongs in data()).
  // In static mode the build reads these from app/formatters.js so they exist in
  // each page's client bundle; formatters passed ONLY here would render at build
  // time but be missing client-side (the build warns). See app/formatters.js.
  formatters,

  // App lifecycle hook (v1.28, D60). In static mode (D81) this runs ONLY at build
  // time with a `{ store, config }` facade before the routes are prerendered. Any
  // records seeded here flow into the first data() of every page, land in the
  // static HTML, and are serialized into an inline data island that the client
  // kernel rehydrates before re-rendering — so data() sees the same records in
  // the browser with no network and no re-run of beforeMount.
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
      body: 'The same app prerenders to HTML for content pages and, in static mode, ships only the JavaScript each page needs — no router, no SPA bundle.',
    });
  },
});

// Start the app. This app.js entry is what `puzzle dev` and a plain/hybrid build
// run in the browser. In static mode (D81) the build runs app.js under Node once
// to prerender the pages, then ships a small per-page module (mountStatic) instead
// of this bundle — dist/ contains no app.js. app.mount() is a no-op at build time.
app.mount();

// Required by the static/hybrid build (D67/D81): the Go build imports this default
// export to read `app.config` for prerendering.
export default app;

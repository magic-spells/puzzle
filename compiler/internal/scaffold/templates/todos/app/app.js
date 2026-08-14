import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

// Create and configure the Puzzle app.
// The v1 config surface is intentionally small: target, routes, models,
// adapter, formatters, apiURL — see constellation/doc/DOC-SPEC.md §2.
const app = new PuzzleApp({
  // Where the app mounts
  target: '#app',

  // Routes configuration
  routes,

  // Models registration
  models,

  // Install server sync for models with a static adapter config. No backend?
  // Delete this import + key and the model adapter block to shrink the bundle.
  adapter,

  // Global formatters available in all templates
  // (display transformation only — logic belongs in data())
  formatters: {
    pluralize: (count, singular, plural) => {
      return count === 1 ? singular : plural || singular + 's';
    },

    todoDate: (date) => {
      if (!date) return '';

      const now = new Date();
      const todoDate = new Date(date);
      const diffTime = Math.abs(now - todoDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) return 'Today';
      if (diffDays === 2) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;

      return todoDate.toLocaleDateString();
    },
  },
});

// Start the app
app.mount();

export default app;

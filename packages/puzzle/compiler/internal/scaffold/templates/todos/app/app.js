import { PuzzleApp } from '@magic-spells/puzzle';
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

  // App lifecycle hook (D60), run once before the first navigation. This starter
  // has no backend, so the store is seeded here and every read — findMany(),
  // findOne(), createRecord(), update(), destroy() — is purely local.
  //
  // Have an API? Add `static adapter = { endpoint: '/todos' }` to
  // app/models/todo.js, pass the adapter capability
  // (`import { adapter } from '@magic-spells/puzzle/adapter'`) as an `adapter`
  // key here, set `apiURL` to your API's base URL, and delete this seed: a
  // tracked findOne/findMany inside a view's data() then fetches whatever the
  // store is missing and settles before the view commits (D161), so there is
  // still no loading code to write.
  beforeMount({ store }) {
    store.createRecord('todo', {
      id: 't1',
      text: 'Read app/views/Home.pzl — the template, the class, and data()',
      completed: true,
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
      updatedAt: new Date('2026-08-01T09:00:00.000Z'),
    });
    store.createRecord('todo', {
      id: 't2',
      text: 'These rows are seeded in app/app.js — beforeMount({ store })',
      completed: false,
      createdAt: new Date('2026-08-01T10:30:00.000Z'),
      updatedAt: new Date('2026-08-01T10:30:00.000Z'),
    });
    store.createRecord('todo', {
      id: 't3',
      text: 'Add one above — createRecord() writes to the local store',
      completed: false,
      createdAt: new Date('2026-08-01T11:15:00.000Z'),
      updatedAt: new Date('2026-08-01T11:15:00.000Z'),
    });
    store.createRecord('todo', {
      id: 't4',
      text: 'Point the model at a real API when you have one',
      completed: false,
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
      updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    });
  },

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

import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';
import { seed } from './lib/seed.js';

// The v1 config surface is intentionally small: target, routes, models,
// formatters — see constellation/doc/DOC-SPEC.md §2. There is no server, so no
// apiURL: the store is seeded in-memory after mount (below).
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,

  // Display-only formatters (logic belongs in data(), per SPEC §8). `timeago`
  // is built in and dresses the sidebar rows; `clock` is this app's one custom
  // formatter, turning a message's Date into a "3:47 PM" wall-clock stamp.
  formatters: {
    clock: (d) => {
      const date = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(date.getTime())) return '';
      let h = date.getHours();
      const m = date.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
    },
  },

  // Seed the store once, before navigation #0 (mirrors the blog example).
  // createRecord upserts by primary key and notifies subscribers, so seeding
  // belongs in beforeMount, never inside data(); here it's visible to the first data().
  beforeMount(app) {
    seed(app.store);
  },
});

app.mount();

export default app;

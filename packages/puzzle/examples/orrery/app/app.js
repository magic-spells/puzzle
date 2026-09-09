import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';
import { seedBodies } from './seed.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,

  // Seed the default solar system once, before navigation #0, only if the store
  // is empty. No localStorage — every reload starts from the same five bodies.
  // Seeding here is visible to the first data().
  beforeMount(app) {
    if (app.store.findMany('body').length > 0) return;

    seedBodies.forEach((body) => {
      app.store.createRecord('body', body);
    });
  },
});

app.mount();

export default app;

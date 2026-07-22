import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
});

app.mount();

export default app;

import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import formatters from './formatters.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  // the app's functions
  formatters,
});

app.mount();

export default app;

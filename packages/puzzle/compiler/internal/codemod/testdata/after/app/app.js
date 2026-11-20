import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import formatters from './functions.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  // the app's functions
  functions: formatters,
});

app.mount();

export default app;

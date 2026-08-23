import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';

// Mission Control is an animation showcase. It uses plain in-memory data
// (app/data/catalog.js) rather than the store/models layer, so the config here
// is just target + routes — PuzzleApp defaults `models` to {} when omitted.
const app = new PuzzleApp({
  target: '#app',
  routes,
});

app.mount();

export default app;

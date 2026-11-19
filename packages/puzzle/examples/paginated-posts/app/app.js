import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

// the adapter capability is what turns findMany(type, { query }) into a
// server query (D193). there is no real server here: `puzzle dev --fixtures`
// installs the mock adapter from app/fixtures.js, which answers the same
// /api/posts?page=2 requests a real api would.
const app = new PuzzleApp({
  // where the app mounts
  target: '#app',

  // routes and models
  routes,
  models,

  // install server sync for every model with a static adapter
  adapter,

  // adapter endpoints are joined onto this, so posts live at /api/posts
  apiURL: '/api',
});

app.mount();

export default app;

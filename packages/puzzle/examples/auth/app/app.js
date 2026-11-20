import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';
import ErrorView from './views/ErrorView.pzl';
import { authorize, restore } from './auth.js';

// there is no real server: `puzzle dev --fixtures` installs the mock backend
// in app/fixtures.js, which answers the same /api/auth/* and /api/notes
// requests a real api would, and checks the bearer token like one.
const app = new PuzzleApp({
  // where the app mounts
  target: '#app',

  // routes and models
  routes,
  models,

  // server sync for models with an adapter, and the base for their urls
  adapter,
  apiURL: '/api',

  // every adapter request passes through here first (D91): this is where the
  // access token gets attached, once, for the whole app
  beforeRequest: authorize,

  // runs before the first navigation, so the first guard already knows
  // whether a saved session could be renewed (D87, D66)
  async beforeMount(app) {
    await restore(app.store);
  },

  // a page whose data() failed renders this in its place (D145). it handles
  // the one auth failure a guard can't see coming: a 401 from a token the
  // server revoked while it still looked fresh here.
  errorView: ErrorView,

  // every contained failure reports here first (D145). a 401 is the error
  // view's to handle, so it is not logged as a bug; everything else is.
  onError(error, info) {
    if (error?.status === 401) return;
    console.error(`[auth example] ${info.phase} failed:`, error);
  },
});

app.mount();

export default app;

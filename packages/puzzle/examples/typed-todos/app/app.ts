// App entry. A TypeScript app starts from app/app.ts (the build takes it over
// app/app.js, and refuses an app that has both — D54). The rest of the app is
// TypeScript too: routes.ts, models/*.ts, and `.pzl` files with
// <script lang="ts"> (v1.22). esbuild resolves the extensionless `.ts` imports
// below natively, and strips their types transpile-only during the build.
import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes';
import models from './models';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
});

app.mount();

export default app;

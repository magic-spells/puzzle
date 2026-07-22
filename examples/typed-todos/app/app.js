// App entry (must be app/app.js — the build resolves this path). The rest of the
// app is TypeScript: routes.ts, models/*.ts, and `.pzl` files with
// <scripts lang="ts"> (v1.22, D54). esbuild resolves the extensionless `.ts`
// imports below natively, and strips their types transpile-only during the build.
import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes';
import models from './models';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  formatters: {
    pluralize: (count, singular, plural) =>
      count === 1 ? singular : plural || singular + 's',
  },
});

app.mount();

export default app;

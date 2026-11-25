# __APP_NAME__

A single-page application built with the [Puzzle](https://github.com/magic-spells/puzzle) framework, in TypeScript.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Run the tests with `npm test`.

To build the app and check it the way a host will serve it:

```bash
npm run build
npm run preview
```

## Project layout

```
__APP_NAME__/
├── app/
│   ├── app.ts            # Build entry: app initialization (mount target, routes, functions)
│   ├── routes.ts         # Route definitions
│   ├── components/       # Reusable .pzl components (Counter.pzl)
│   ├── layouts/          # Layout components (Default.pzl)
│   ├── views/            # Page components (Home.pzl)
│   ├── public/           # Static assets + index.html
│   └── styles/           # Tailwind entry stylesheet
├── tests/                # Vitest tests (Counter.test.ts)
├── puzzle.config.js      # Compiler config (Tailwind pipeline)
├── vitest.config.js      # Test config: compiles .pzl imports, jsdom for the DOM
├── tsconfig.json         # Strict TypeScript settings for editors and `npm run check`
└── package.json
```

Every `.pzl` script is `<script lang="ts">`. The build strips types without
checking them, so it stays fast; type-checking is its own step.

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server.
- `npm run build` — production build into `dist/`.
- `npm run preview` — serve `dist/` the way a host does: every path gets the
  app, so a reload or a shared link works.
- `npm test` — run the tests in `tests/` once with Vitest. They mount
  components and views with `@magic-spells/puzzle/testing` and click and type
  the way a user would; `tests/` starts with a component test for Counter.pzl.
- `npm run check` — type-check the app: `.ts` modules, `.pzl` scripts, and
  template expressions (`puzzle check`, using the app's own TypeScript).

## Next steps

- Add a view under `app/views/` (`npx puzzle generate view About`) and
  register it in `app/routes.ts`.
- Build reusable UI in `app/components/`.
- Puzzle builds a single-page app by default; `output: 'hybrid'` in
  `puzzle.config.js` also prerenders each route to HTML, and
  `output: 'static'` writes plain HTML pages with no router, as the
  [static starter](https://github.com/magic-spells/puzzle-starter-static-ts) does.
- For JavaScript, see the [JavaScript starter](https://github.com/magic-spells/puzzle-starter).
- Deploy: `npx puzzle add deploy` lists the hosts it writes a config for.
- Read the docs at https://github.com/magic-spells/puzzle.

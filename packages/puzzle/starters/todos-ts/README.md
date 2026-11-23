# __APP_NAME__

A complete todo application built with the [Puzzle](https://github.com/magic-spells/puzzle) framework in TypeScript, demonstrating the core patterns: reactive `data()`, models with schema, arrow-function event handlers, display functions, and view/component animations.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Run the tests with `npm test`.

## Project layout

```
__APP_NAME__/
├── app/
│   ├── app.ts            # Build entry: target, routes, models, seed data
│   ├── routes.ts         # Route definitions
│   ├── models/           # Todo model (schema + methods + record type) and registry
│   ├── components/       # TodoItem.pzl
│   ├── layouts/          # Default.pzl
│   ├── views/            # Home.pzl (todo management interface)
│   ├── public/           # Static assets + index.html
│   └── styles/           # Tailwind entry stylesheet
├── tests/                # Vitest tests (Home.test.ts, todo.test.ts)
├── puzzle.config.js      # Compiler config (Tailwind pipeline)
├── vitest.config.js      # Test config: compiles .pzl imports, jsdom for the DOM
├── tsconfig.json         # Strict TypeScript settings for editors and `npm run check`
└── package.json
```

## Patterns demonstrated

- **Reactive data loading** — `data()` auto-subscribes to store queries.
- **Event handling** — `events` is a class field of arrow functions.
- **Models** — schema via `Puzzle` field builders, computed getters, methods.
- **Display functions** — display-only transformations called by name in
  templates: `{ datetime(todo.createdAt, 'short') }`.
- **Animations** — declarative enter/leave via the Web Animations API.
- **Types** — every `.pzl` script is `<script lang="ts">`; `data()` returns a
  declared model interface, and props, events and lifecycle hooks are typed.

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server.
- `npm run build` — production build into `dist/`.
- `npm test` — run the tests in `tests/` once with Vitest. They mount
  components and views with `@magic-spells/puzzle/testing` and click and type
  the way a user would; `tests/` starts with a view test and a store test.
- `npm run check` — type-check the app: `.ts` modules, `.pzl` scripts, and
  template expressions (`puzzle check`, using the app's own TypeScript).

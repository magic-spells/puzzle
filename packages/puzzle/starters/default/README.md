# __APP_NAME__

A single-page application built with the [Puzzle](https://github.com/magic-spells/puzzle) framework.

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
│   ├── app.js            # App initialization (mount target, routes, functions)
│   ├── routes.js         # Route definitions
│   ├── components/       # Reusable .pzl components (Counter.pzl)
│   ├── layouts/          # Layout components (Default.pzl)
│   ├── views/            # Page components (Home.pzl)
│   ├── public/           # Static assets + index.html
│   └── styles/           # Tailwind entry stylesheet
├── tests/                # Vitest tests (Counter.test.js)
├── puzzle.config.js      # Compiler config (Tailwind pipeline)
├── vitest.config.js      # Test config: compiles .pzl imports, jsdom for the DOM
└── package.json
```

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server.
- `npm run build` — production build into `dist/`.
- `npm test` — run the tests in `tests/` once with Vitest. They mount
  components and views with `@magic-spells/puzzle/testing` and click and type
  the way a user would; `tests/` starts with a component test for Counter.pzl.

## Next steps

- Add a view under `app/views/` and register it in `app/routes.js`.
- Build reusable UI in `app/components/`.
- Read the docs at https://github.com/magic-spells/puzzle.

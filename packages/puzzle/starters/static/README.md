# __APP_NAME__

A static site built with the [Puzzle](https://github.com/magic-spells/puzzle) framework: every page is plain HTML, ready for any static host.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Run the tests with `npm test`.

To build the site and check it the way a host will serve it:

```bash
npm run build
npm run preview
```

## Project layout

```
__APP_NAME__/
├── app/
│   ├── app.js            # App initialization (mount target, routes)
│   ├── routes.js         # Route definitions: one page per route
│   ├── components/       # Reusable .pzl components (Counter.pzl)
│   ├── layouts/          # Layout components: the header and footer (Default.pzl)
│   ├── views/            # Page components (Home.pzl, About.pzl, NotFound.pzl)
│   ├── public/           # Static assets + index.html
│   └── styles/           # Tailwind entry stylesheet
├── tests/                # Vitest tests (Home.test.js)
├── puzzle.config.js      # Compiler config (Tailwind pipeline, output: 'static')
├── vitest.config.js      # Test config: compiles .pzl imports, jsdom for the DOM
└── package.json
```

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server.
- `npm run build` — production build into `dist/`: `index.html`,
  `about/index.html` and `404.html`, plus a small module for each page that
  runs its components.
- `npm run preview` — serve `dist/` the way a static host does, with real 404s.
- `npm test` — run the tests in `tests/` once with Vitest. They mount
  components and views with `@magic-spells/puzzle/testing` and click and type
  the way a user would; `tests/` starts with a test for the home page.

## Next steps

- Add a page: a view under `app/views/` (`npx puzzle generate view Contact`),
  a route in `app/routes.js`, and a link in the header in
  `app/layouts/Default.pzl`.
- Without `output: 'static'` in `puzzle.config.js`, Puzzle builds a
  single-page app, as the
  [default starter](https://github.com/magic-spells/puzzle-starter) does.
- For TypeScript, see the [TypeScript static starter](https://github.com/magic-spells/puzzle-starter-static-ts).
- Deploy: `npx puzzle add deploy` lists the hosts it writes a config for.
- Read the docs at https://github.com/magic-spells/puzzle.

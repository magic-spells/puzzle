# __APP_NAME__

A complete todo application built with the [Puzzle](https://github.com/magic-spells/puzzle) framework, demonstrating the core patterns: reactive `data()`, models with schema, arrow-function event handlers, formatters, and view/component animations.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Project layout

```
__APP_NAME__/
├── app/
│   ├── app.js            # App init: target, routes, models, formatters
│   ├── routes.js         # Route definitions
│   ├── models/           # Todo model (schema + methods) and registry
│   ├── components/       # TodoItem.pzl
│   ├── layouts/          # Default.pzl
│   ├── views/            # Home.pzl (todo management interface)
│   ├── public/           # Static assets + index.html
│   └── styles/           # Tailwind entry stylesheet
├── puzzle.config.js      # Compiler config (Tailwind pipeline)
└── package.json
```

## Patterns demonstrated

- **Reactive data loading** — `data()` auto-subscribes to store queries.
- **Event handling** — `events` is a class field of arrow functions.
- **Models** — schema via `Puzzle` field builders, computed getters, methods.
- **Formatters** — display-only transformations in templates.
- **Animations** — declarative enter/leave via the Web Animations API.

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server.
- `npm run build` — production build into `dist/`.

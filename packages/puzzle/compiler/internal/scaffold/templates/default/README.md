# __APP_NAME__

A single-page application built with the [Puzzle](https://github.com/magic-spells/puzzle) framework.

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
│   ├── app.js            # App initialization (mount target, routes, formatters)
│   ├── routes.js         # Route definitions
│   ├── components/       # Reusable .pzl components (Counter.pzl)
│   ├── layouts/          # Layout components (Default.pzl)
│   ├── views/            # Page components (Home.pzl)
│   ├── public/           # Static assets + index.html
│   └── styles/           # Tailwind entry stylesheet
├── puzzle.config.js      # Compiler config (Tailwind pipeline)
└── package.json
```

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server.
- `npm run build` — production build into `dist/`.

## Next steps

- Add a view under `app/views/` and register it in `app/routes.js`.
- Build reusable UI in `app/components/`.
- Read the docs at https://github.com/magic-spells/puzzle.

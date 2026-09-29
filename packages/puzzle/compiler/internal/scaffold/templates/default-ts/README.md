# __APP_NAME__

A single-page application built with the [Puzzle](https://github.com/magic-spells/puzzle) framework, in TypeScript.

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
│   ├── app.ts            # Build entry: app initialization (mount target, routes, formatters)
│   ├── routes.ts         # Route definitions
│   ├── components/       # Reusable .pzl components (Counter.pzl)
│   ├── layouts/          # Layout components (Default.pzl)
│   ├── views/            # Page components (Home.pzl)
│   ├── public/           # Static assets + index.html
│   └── styles/           # Tailwind entry stylesheet
├── puzzle.config.js      # Compiler config (Tailwind pipeline)
├── tsconfig.json         # Strict TypeScript settings for editors and `npm run check`
└── package.json
```

Every `.pzl` script is `<script lang="ts">`. The build strips types without
checking them, so it stays fast; type-checking is its own step.

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server.
- `npm run build` — production build into `dist/`.
- `npm run check` — type-check the app: `.ts` modules, `.pzl` scripts, and
  template expressions (`puzzle check`, using the app's own TypeScript).

## Next steps

- Add a view under `app/views/` and register it in `app/routes.ts`.
- Build reusable UI in `app/components/`.
- Read the docs at https://github.com/magic-spells/puzzle.

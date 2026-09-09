# demo — the puzzle-pieces docs site

A [Puzzle](https://github.com/magic-spells/puzzle) app that documents and exercises
every piece in the registry: one docs page per component, live examples, and code you
can copy. It consumes **copies** of the registry pieces — the source of truth is
always `../registry/`.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3070.

## Project layout

```
demo/
├── app/
│   ├── app.js                    # App initialization
│   ├── routes.js                 # Route table (one route per piece, alphabetical)
│   ├── components/
│   │   ├── ui/                   # COPIES of registry pieces (downstream — edit registry/ first)
│   │   └── docs/                 # Docs-site primitives (ExampleBox, CodeBlock, SideNav, Toc)
│   ├── lib/                      # COPIES of registry/lib helpers
│   ├── views/components/         # One *Doc.pzl page per piece
│   ├── docs/nav.js               # Sidebar / index / prev-next config
│   ├── public/                   # Static assets + index.html
│   └── styles/                   # Tailwind entry stylesheet
├── puzzle.config.js              # Compiler config (Tailwind pipeline)
└── package.json
```

## Scripts

- `npm run dev` — watch + rebuild + live-reload dev server on port 3070.
- `npm run build` — production build into `dist/`.

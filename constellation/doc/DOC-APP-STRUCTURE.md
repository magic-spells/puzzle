---
name: Puzzle app structure
kind: guide
status: verified
verified_at: '2026-07-22T00:04:04.509Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
connections:
  - PLAN-PROJECT
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - COMPONENT-COMPILER-CLI
  - FLOW-BUILD
  - TEST-TODOS-INTEGRATION
  - DOC-DEVELOPMENT
  - DOC-USER-GUIDE
  - DOC-APP-ANATOMY
  - FILE-EXAMPLES-TODOS-APP-APP
  - FILE-EXAMPLES-TODOS-APP-ROUTES
  - FILE-EXAMPLES-TODOS-APP-MODELS-INDEX
  - FILE-EXAMPLES-TODOS-APP-MODELS-TODO
  - FILE-EXAMPLES-TODOS-APP-VIEWS-HOME
  - FILE-EXAMPLES-TODOS-APP-LAYOUTS-DEFAULT
  - FILE-EXAMPLES-TODOS-PUZZLE-CONFIG
  - FILE-EXAMPLES-TODOS-APP-PUBLIC-INDEX
  - FILE-EXAMPLES-TODOS-PACKAGE
---

# Puzzle app structure

A v1 Puzzle app is a small SPA project rooted at an app directory. The canonical
shape is:

- `app/app.js` creates one [[COMPONENT-PUZZLE-APP]] with `target`, `routes`,
  `models`, optional `formatters`, optional `apiURL`, and optional `storage`,
  then calls `mount()`.
- `app/routes.js` exports route records: `path`, `view`, optional `layout`,
  optional `name`, and optional `meta`. [[COMPONENT-ROUTER]] owns history
  navigation, layout reuse, params, and initial render.
- `app/views/**/*.pzl` and `app/layouts/**/*.pzl` are route-facing files. In
  [[COMPONENT-CODEGEN]] they compile in view mode: the root `<puzzle-view>`
  becomes the render root and its attrs are preserved.
- `app/components/**/*.pzl`, when used, are inline component files. They compile
  in component mode: one root element, no `<puzzle-view>` wrapper attrs, and
  slot content flows through the runtime component path.
- `app/models/index.js` is the registry passed to the app; model files export
  [[COMPONENT-PUZZLE-MODEL]] subclasses. [[COMPONENT-STORE]] instantiates
  records and wires reactivity.
- `app/public/` is copied to `dist/`; `index.html` loads `/app.js` as an ES
  module and links `/styles.css`.
- `puzzle.config.js` is optional. In v1 its only built style pipeline is
  `styles.use: ['tailwindcss']`; [[FLOW-BUILD]] reads it through Node, then
  writes one `dist/styles.css` containing Tailwind first and collected
  `<styles>` blocks after.

Build/dev expectations: `puzzle build [dir]` and `puzzle dev [dir]` both treat
`[dir]/app/app.js` as the entry and write `[dir]/dist`. `puzzle dev` serves
`dist/` with history fallback and injects the reload client only at serve time.
The checked-in `examples/todos/` is the reference app for this structure, but the
shape above is the reusable contract.

---
name: Puzzle app structure
kind: guide
status: built
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
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-MODEL
---

# Puzzle app structure

The reusable shape of a Puzzle app; `examples/todos/` is the reference.

- `app/app.ts` (TypeScript app) or `app/app.js` is the build entry. It
  creates one [[COMPONENT-PUZZLE-APP]] with `target`, `routes`, `models`, and
  optional `formatters`, `apiURL`, `storage`, `i18n`, router mode and
  lifecycle hooks, then calls `mount()`.
- `app/routes.js` exports route records: `path`, `view`, optional `layout`,
  `name`, `guard` and `meta` (`title`, `description`, `canonical`, …); `view`
  and `layout` may be `lazy()` markers. [[COMPONENT-ROUTER]] owns navigation,
  layout reuse and params.
- Every `.pzl` template sits in a `<puzzle-view>` section. In routed files
  (`app/views/**`, `app/layouts/**`) it becomes the render root, attributes
  kept. In inline components (`app/components/**`) it renders nothing and
  holds one root element; call-site content flows through `<Children/>` and
  `<Slot name>`. A family is a directory of members plus a JS barrel
  ([[COMPONENT-CODEGEN]]).
- `app/models/` exports [[COMPONENT-PUZZLE-MODEL]] subclasses, registered in
  the app config; [[COMPONENT-STORE]] instantiates records and wires
  reactivity.
- `app/locales/<tag>.json` holds translations when `i18n` is configured.
- `app/fixtures.js` is wired in only by `--fixtures`.
- `app/public/` is copied to `dist/`; its `index.html` loads `/app.js` as a
  module and links `/styles.css`.
- `puzzle.config.js` is optional and loaded by Node. The only style pipeline
  is `styles.use: ['tailwindcss']`; [[FLOW-BUILD]] writes one
  `dist/styles.css` with Tailwind first and collected `<style>` blocks after.

`puzzle build [dir]` and `puzzle dev [dir]` compile `[dir]/app/app.ts` or
`app/app.js` into `[dir]/dist`. `puzzle dev` serves `dist/` per output mode
and injects the reload client only at serve time.

---
name: Puzzle app structure
kind: guide
status: built
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-COMPILER-CLI
  - COMPONENT-CODEGEN
  - FLOW-BUILD
  - TEST-TODOS-INTEGRATION
  - DOC-ARCHITECTURE
  - DOC-USER-GUIDE
  - DOC-SPEC-ANATOMY
---

# Puzzle app structure

The shape of a Puzzle app; `examples/todos/` is the reference. The contract is [[DOC-SPEC-ANATOMY]] §2 and §11.

- `app/app.ts` (TypeScript app) or `app/app.js` is the build entry; having both is an error. It creates one [[COMPONENT-PUZZLE-APP]] with `target`, `routes`, `models` and optional `formatters`, `apiURL`, `storage`, `adapter`, router mode and hooks, then calls `mount()`. Translations are configured in `puzzle.config.js`, not here; the build wires them in.
- `app/routes.js` exports route records (`path`, `view`, optional `layout`, `children`, `name`, `guard`, `meta`, …); `view` and `layout` may be `lazy()` markers. [[COMPONENT-ROUTER]] owns navigation, layout reuse and params.
- Every `.pzl` template sits in a `<puzzle-view>` section. In routed files (`app/views/**`, `app/layouts/**`) it is the render root and keeps its attributes. In components (`app/components/**`) it renders nothing and holds one root element; call-site content flows through `<Children/>` and `<Slot name>`. A family is a directory of members plus a JS barrel ([[COMPONENT-CODEGEN]]).
- `app/models/` exports [[COMPONENT-PUZZLE-MODEL]] subclasses, registered in the app config; [[COMPONENT-STORE]] instantiates records and wires reactivity.
- `app/locales/<tag>.json` holds translations when `i18n` is configured.
- `app/fixtures.js` (or `.ts`) is wired in only by `--fixtures`.
- `app/public/` is copied to `dist/`; its `index.html` loads `/app.js` as a module and links `/styles.css` (the production build rewrites both to hashed names).
- `puzzle.config.js` is optional and loaded by Node. The only style pipeline is `styles.use: ['tailwindcss']`; [[FLOW-BUILD]] writes one stylesheet with Tailwind first and collected `<style>` blocks after.

`puzzle build [dir]` and `puzzle dev [dir]` compile into `[dir]/dist`. `puzzle dev` serves `dist/` per output mode and injects the reload client only at serve time.

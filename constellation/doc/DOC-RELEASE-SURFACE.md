---
name: Puzzle 0.1 release surface
kind: reference
status: verified
connections:
  - DOC-SPEC
  - DOC-DECISIONS
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - COMPONENT-FORMATTERS
  - COMPONENT-ROUTER
  - COMPONENT-ANIMATIONS
  - COMPONENT-MORPH
  - COMPONENT-DEVSTATE
  - COMPONENT-SSG
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - FLOW-BUILD
  - FLOW-REACTIVITY
verified_at: '2026-07-22T00:04:05.875Z'
---

# Puzzle 0.1 release surface

Compact inventory of what ships in `@magic-spells/puzzle` at the first npm
release. [[DOC-SPEC]] remains the binding contract; this card is the map, not a
second specification. Decision cards hold rationale and git holds chronology.

## Package and application

- Root exports: `PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`,
  `PuzzleValidationError`, `PuzzleAdapterError`, and compiler support exports.
- Subpaths: `@magic-spells/puzzle/morph`, `/ssg`, `/static`, and `/puzzle-env`.
  (`/static` exports `mountStatic`, the per-page kernel for `output: 'static'`.)
- `puzzle` binary shim selects an optional platform binary for macOS/Linux on
  arm64/x64. Unsupported systems get a Go-install fallback message.
- App config: `target`, `routes`, `models`, `formatters`, `apiURL`, `storage`,
  `scrollBehavior`, `routerMode`, `routerInitialPath`, `routerBase`,
  `transitionMode`, `beforeMount`, `mounted`, and `beforeUnmount`.
- The app is SPA-first. Prerendered output comes in two modes (D67/D81), never a
  request-time SSR server or hydration protocol: `output: 'hybrid'` ships
  prerendered pages the SPA takes over at navigation zero; `output: 'static'`
  ships true static pages with no router or `app.js` and a per-page mount module.

## `.pzl` files and templates

- One `<puzzle-view>` template; optional `<scripts>` and `<styles>`; optional
  `<puzzle-skeleton min-duration="…">`.
- `<scripts>` is real JS. `lang="ts"` enables esbuild transpilation only; the
  build does not type-check `.pzl` bodies.
- `<styles scoped>` uses native `@scope`; unscoped styles are global.
- Interpolation and formatter chains; dynamic/mixed/boolean attributes;
  controlled `value`, `checked`, `disabled`, and `selected` properties.
- `{#if}` with `{:else if}`/`{:else}`, `{#unless}`, `{#case}` with `{:when}`,
  item/range `{#for}` with optional counters, template comments, and inline SVG.
- DOM events support bare/call handlers, `prevent`, `stop`, `once`, and keyboard
  filters. Component event attributes compile to callback props.
- Composition: `<children/>` default content with fallback, named
  `<slot name="…">`, `<Slot/>` router outlets, and default-slot forwarding
  through component invocations.
- `key` overrides list auto-keying; `ref="name"` binds `this.refs`; `island`
  makes element children browser-owned after mount.
- `@/…` imports resolve from the app directory in browser and prerender bundles.

## Component runtime

- Two state layers: each successful `data()` result replaces the model layer;
  `setData()` mutates a persistent local layer that wins until the next model
  commit. Store/prop/route refreshes rerun `data()`; `setData()` alone does not.
- Async `data()` is last-wins. Skeletons show only for the first load and may
  hold for a minimum duration.
- Lifecycle: `created`, `mounted`, `beforeUpdate`, `afterUpdate`, `destroyed`,
  plus `viewWillShow`/`viewDidShow` and `viewWillHide`/`viewDidHide`.
- `this.route` is the pre-commit-safe route snapshot. `this.element`,
  `this.refs`, `this.memo()`, `getData()`, `setData()`, and `refresh()` are live.
- The vnode manager handles inline components, slots, SVG namespaces, controlled
  form properties, events/modifiers, keyed moves, islands, refs, and teardown.
- Conditional branches are arity-stabilized with invisible placeholder vnodes,
  preventing unrelated trailing siblings from remounting on a toggle.

## Data layer

- Schema builders: string, number, boolean, date, object, array, belongsTo, and
  hasMany; defaults, primary keys, required/min/max/oneOf/custom validation.
- Records are model-class instances with getters/methods, immutable primary
  keys, local update/destroy, non-throwing validation reports, and throwing
  write-boundary validation.
- Store queries auto-subscribe inside `data()`. Collection and record keys are
  batched, hidden-tab safe, isolated per subscriber, and torn down with views.
- Reads: `loadAll`/`loadOne` through model adapters with identity-preserving
  upsert. Writes: `save`, `delete`, and custom `request`, with POST/PUT sync
  provenance, collision/destroy guards, and typed adapter errors.
- Relationships are lazy store-backed getters and participate in tracking.
- Optional Storage hydration/persistence is fail-soft. Persistence serializes
  once per flush and is forced during app teardown.
- JSON/server assignment rejects prototype-pollution keys and protected record
  internals.

## Routing and motion

- History, hash, and memory modes; nested relative children; index routes;
  catch-all routes; merged params; top-level layouts; route titles.
- `push`, `go`, `back`, and `forward`; guarded same-origin link interception;
  router base paths and anchors; `router.url()` + the built-in `link`
  formatter for mode-agnostic path-shaped hrefs.
- Load-then-commit navigation with chain-prefix reuse and atomic URL/title/view/
  scroll commit. Failed or superseded pushes leave committed state alone.
- Scroll-to-top, pop restoration, session persistence, custom behavior, and
  opt-out.
- Sequential route transitions by default. Optional overlapping transitions
  resolve destination-first at route, view/layout, then app level.
- WAAPI enter/leave animations are failure-safe and reduced-motion aware.
  `trigger: 'visible'`, offset, and ancestor anchors use shared observers.
- Optional morph integration supports coexisting pairs, cross-view captures,
  skeleton-delayed targets, and symmetric/trigger/target roles.

## Build, dev, and static output

- Go parser/codegen feeds an esbuild `.pzl` plugin; scripts stay untouched and
  render functions attach to the user class prototype.
- Production: ES2022, minified, console calls stripped by default, linked
  source maps, tree-shaken formatter manifest, collected component CSS.
- Tailwind-first style pipeline; scoped blocks wrapped in native `@scope`.
- Public assets copied with generated-name collision checks. One-shot builds
  stage and atomically swap `dist`, preserving the last good build on failure.
- `puzzle dev` uses incremental esbuild, recursive watch, warm Tailwind watch,
  a localhost static server, SPA fallback, SSE reload, and graceful shutdown.
- Dev reload snapshots store records and JSON-safe local view state to a
  short-lived one-shot session blob, then restores store before navigation and
  local state after mount. Production bundles eliminate this machinery.
- Prerendered builds (both modes) write directory-style pages plus `404.html`
  for a catch-all, skip dynamic routes with a warning, and support
  `prerender: false` islands. `--hybrid` (`output: 'hybrid'`, D67) shares one
  `app.js` the router takes over; `--static` (`output: 'static'`, D81) ships no
  `app.js`, stamping the target `data-puzzle-static` and emitting one per-page
  `dist/_puzzle/<slug>.js` (mountStatic + that page's classes) with shared
  runtime split into `dist/_puzzle/chunks/` and build-time data inlined as a
  `data-puzzle-static-data` island.

## CLI

- `puzzle init` (`default`/`todos`, optional TypeScript project config).
- `puzzle dev`, `puzzle build`, and `puzzle build --static` / `--hybrid`.
- `puzzle generate` / `g` for components, views, layouts, and models.
- `puzzle add tailwind` and `puzzle add piece` with local/HTTPS registries,
  dependency resolution, path-containment checks, and `pieces.lock` hashes.
- `puzzle doctor`, `puzzle info`, and `puzzle --version`.
- `puzzle upgrade` / `upgrade --check`, plus a passive TTY-only update notice
  on `dev`/`build` (opt out with `PUZZLE_NO_UPDATE_CHECK=1`; skipped in CI).
- `pzlc` is the internal/test-facing single-file compiler.

## Deliberately not shipped

No SSR server, hydration, lazy route/code splitting, navigation guards,
named-route navigation, scoped slots, array refs, built-in virtual list,
per-module hot swap, Sass pipeline, event bus, global keyboard API, app-level
computed/settings/methods, devtools hook, or automatic query fault-in.

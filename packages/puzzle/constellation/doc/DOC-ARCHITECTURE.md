---
name: Puzzle architecture
status: built
connections:
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - DOC-STRESS-EXAMPLE
  - FLOW-BUILD
  - FLOW-REACTIVITY
  - FLOW-NAVIGATION
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-ADAPTER
  - COMPONENT-ROUTER
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - COMPONENT-COMPILER-CLI
---

# Puzzle architecture

Two halves joined by ordinary ES modules generated from `.pzl` files: a Go compiler/CLI that parses templates and emits render functions for esbuild to bundle, and a JavaScript runtime that mounts them, manages data and routing, and patches the DOM. [[DOC-SPEC]] owns public behavior; [[DOC-RELEASE-SURFACE]] is the public inventory. This card is the internal boundaries and the life of a running app.

## Build-time half

[[COMPONENT-COMPILER-CLI]] resolves the app root, command, mode and config. [[COMPONENT-TEMPLATE-PARSER]] (in `packages/puzzle-lang`) splits sections and parses the template grammar and its closed expression language; it never parses user JavaScript. [[COMPONENT-CODEGEN]] appends `Name.prototype.render = function () { … }` after the unchanged class body. [[COMPONENT-ESBUILD-PLUGIN]] resolves imports, bundles the runtime, collects styles and library-function use, and writes through the staged build path ([[FLOW-BUILD]]).

Builds are SPA bundles by default: `dist/app.js`, `dist/styles.css` and the copied public files (content-hashed names in production). [[COMPONENT-SSG]] can also run the bundle at build time and serialize routes to HTML: `output: 'hybrid'` (pages the SPA takes over at navigation zero) or `output: 'static'` (pages with no router or `app.js`, each woken by a per-page module). Neither is an SSR server or hydration. [[COMPONENT-DEV-SERVER]] uses the same compilation with incremental esbuild, watching and SSE reload.

## Runtime half

- [[COMPONENT-PUZZLE-APP]] — config validation, shared context, startup, navigation zero, teardown.
- [[COMPONENT-ROUTER]] — route chains, load-then-commit navigation, URL/title/scroll/focus, layouts, transitions.
- [[COMPONENT-PUZZLE-VIEW]] — props, route snapshot, async `data()`, local state, lifecycle, refs, rendering.
- [[COMPONENT-VIEW-MANAGER]] — vnode diff/patch, composition markers, events, controlled properties, islands, keyed rows, teardown.
- [[COMPONENT-STORE]] / [[COMPONENT-PUZZLE-MODEL]] — records, schemas, queries, subscriptions, persistence, relationships, validation; [[COMPONENT-ADAPTER]] adds opt-in server sync.
- Functions, animations, morph, i18n, development state and prerender are optional or specialized layers around that core.

## Life of an app

1. **Boot** — `mount()` wires the store, function registry, i18n and router into `ctx`, runs `beforeMount`, waits for the active locale, restores a development snapshot of store records, starts the router (navigation zero preloads the chain, then mounts and commits route, title and scroll), restores development view state, then runs `mounted`. A failure before commit leaves no half-mounted app.
2. **View load** — each incoming view or component gets props and route context and runs `data(params, props)`, tracking its store queries. The newest successful result replaces the model layer, `setData()` values overlay it, and `render()` returns a ViewNode tree. A skeleton may show during the first async load. Reused routed ancestors refresh before the navigation commits.
3. **Reactive update** — DOM listener → compiled handler → the view's `events` arrow → store mutation → batched notification → subscribed `data()` reruns → render → patch ([[FLOW-REACTIVITY]]). `setData()` renders without rerunning `data()`; pair it with `refresh()` when `data()` derives from that state. Component `@event` bindings are callback props, not DOM events.
4. **Navigation** — a link or `router.push()` resolves a route chain and a token; incoming work loads before anything visible changes, then transitions run and URL, title, view tree and scroll commit together. Superseded or failed work commits nothing and destroys only its own fresh instances ([[FLOW-NAVIGATION]]).
5. **Teardown** — `unmount()` runs `beforeUnmount` first, then stops the router, destroys the routed tree (running `destroyed` hooks), removes listeners, observers and subscriptions, and flushes pending persistence. A cleanup error is reported without stopping the rest.

## Ownership rules

- Go parses Puzzle template syntax; esbuild parses and transforms JavaScript and TypeScript.
- The compiler creates render code; the runtime owns all reactivity and DOM behavior.
- The router owns route snapshots and commit order; views never read half-committed location state.
- The store owns record identity; model instances stay stable across upserts.
- Public assets never overwrite generated output; `dist/` is replaced only after a successful staged build.
- Morph is an adapter around router/view hooks, not a second navigation engine.

## Repository map (packages/puzzle)

- `client-runtime/` — browser runtime and optional subpath entries.
- `compiler/` — codegen, esbuild plugin, build/dev/SSG orchestration, CLI. The parser lives in `packages/puzzle-lang`.
- `types/`, `tests-types/` — public declarations and their type tests.
- `bin/`, `npm/` — CLI shim and platform packages.
- `examples/` — `examples/todos` is the canonical app; the rest are focused acceptance cases ([[DOC-STRESS-EXAMPLE]] is the benchmark app).
- `tests/`, `tests-browser/`, `benchmarks/` — Vitest, Playwright, and the production benchmark harness.

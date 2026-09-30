---
name: Puzzle architecture
status: built
connections:
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - FLOW-BUILD
  - FLOW-REACTIVITY
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-ROUTER
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - COMPONENT-COMPILER-CLI
---

# Puzzle architecture

Two halves joined by ordinary ES modules generated from `.pzl` files: a Go
compiler/CLI that parses templates and emits render functions for esbuild to
bundle, and a JavaScript runtime that mounts them, manages data and routing,
and patches the DOM. [[DOC-SPEC]] owns public behavior;
[[DOC-RELEASE-SURFACE]] is the public inventory. This card is the internal
boundaries.

## Build-time half

[[COMPONENT-COMPILER-CLI]] resolves the app root, command, mode and config.
[[COMPONENT-TEMPLATE-PARSER]] (the `packages/puzzle-lang` module) splits
sections and parses the template grammar and its closed expression language;
it never parses user JavaScript. [[COMPONENT-CODEGEN]] appends a
`Name.prototype.render = function () { … }` assignment after the unchanged
class body. [[COMPONENT-ESBUILD-PLUGIN]] resolves imports, bundles the
runtime, collects styles and library-function use, and writes through the
staged build path.

Builds are SPA bundles by default. [[COMPONENT-SSG]] can also execute the
server-safe bundle at build time and serialize routes to HTML:
`output: 'hybrid'` (prerendered pages the SPA takes over at navigation zero)
or `output: 'static'` (pages with no router or `app.js`, each waking its own
components through a per-page module). Neither is an SSR server or
hydration. [[COMPONENT-DEV-SERVER]] uses the same compilation contract with
incremental esbuild, watching, and SSE reload.

## Runtime half

- [[COMPONENT-PUZZLE-APP]] — config validation, shared context, startup,
  initial navigation, teardown.
- [[COMPONENT-ROUTER]] — route chains, load-then-commit navigation,
  URL/title/scroll, layouts, transitions.
- [[COMPONENT-PUZZLE-VIEW]] — props, route snapshot, async `data()`, local
  state, lifecycle, refs, rendering.
- [[COMPONENT-VIEW-MANAGER]] — vnode diff/patch, composition, events,
  controlled properties, islands, teardown.
- [[COMPONENT-STORE]] / [[COMPONENT-PUZZLE-MODEL]] — records, schemas,
  queries, subscriptions, persistence, relationships, validation.
- Functions, animations, morph, i18n, development state, and static
  serialization are optional or specialized layers around that core.

Queries inside `data()` subscribe the evaluating view; a matching store change
batches, reruns `data()`, renders, and patches. `setData()` renders without
rerunning `data()` ([[FLOW-REACTIVITY]]). Navigation preloads incoming views
first, then commits URL, title, view tree and scroll together; a superseded or
failed push commits nothing.

## Ownership rules

- Go parses Puzzle template syntax; esbuild parses and transforms JavaScript
  and TypeScript.
- The compiler creates render code; the runtime owns all reactivity and DOM
  behavior.
- The router owns route snapshots and commit order; views never read
  half-committed location state.
- The store owns record identity; model instances stay stable across upserts.
- Public assets never overwrite generated output; `dist/` is replaced only
  after a successful staged build.
- Morph integration is an adapter around router/view hooks, not a second
  navigation engine.

## Repository map (packages/puzzle)

- `client-runtime/` — browser runtime and optional subpath entries.
- `compiler/` — codegen, esbuild plugin, build/dev/SSG orchestration, CLI.
  The parser lives in `packages/puzzle-lang`.
- `types/`, `tests-types/` — public declarations and their type tests.
- `bin/`, `npm/` — CLI shim and platform packages.
- `examples/` — `examples/todos` is the canonical app; the rest are focused
  acceptance cases.
- `tests/`, `tests-browser/`, `benchmarks/` — Vitest, Playwright, and the
  production benchmark harness.

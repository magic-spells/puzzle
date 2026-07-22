---
name: Puzzle architecture
status: verified
verified_at: '2026-07-22T00:04:04.673Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
connections:
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - DOC-DECISIONS
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
---

# Puzzle architecture

Puzzle has two halves joined by ordinary ES modules generated from `.pzl`
files:

- the Go compiler/CLI parses component structure, emits render functions, and
  lets esbuild bundle the application;
- the JavaScript runtime mounts those render functions, manages data and
  routing, and patches browser DOM.

[[DOC-SPEC]] owns public behavior. This card describes internal boundaries;
[[DOC-RELEASE-SURFACE]] is the concise public inventory.

## Build-time half

[[COMPONENT-COMPILER-CLI]] resolves the app root, command, mode, and config.
[[COMPONENT-TEMPLATE-PARSER]] extracts sections and parses template grammar
without parsing user JavaScript. [[COMPONENT-CODEGEN]] emits a
`Component.prototype.render = function () { ... }` assignment after the
unchanged class body. [[COMPONENT-ESBUILD-PLUGIN]] resolves imports, bundles
the runtime, collects styles and formatter use, and writes the output through
the staged build path.

Production builds are SPA bundles by default. [[COMPONENT-SSG]] can additionally
execute the server-safe bundle and serialize eligible routes to static HTML.
This is build-time rendering, not an SSR server and not hydration.

Development uses the same compilation contract through
[[COMPONENT-DEV-SERVER]], with incremental esbuild, recursive watching, warm
styles, static serving, and SSE reload.

## Runtime half

- [[COMPONENT-PUZZLE-APP]] owns config validation, shared context, startup,
  initial navigation, and teardown.
- [[COMPONENT-ROUTER]] resolves route chains and owns load-then-commit
  navigation, URL/title/scroll state, layouts, and transitions.
- [[COMPONENT-PUZZLE-VIEW]] owns component props, route snapshots, async
  `data()`, local state, lifecycle, memoization, refs, and rendering.
- [[COMPONENT-VIEW-MANAGER]] owns vnode creation, diffing, DOM mutation,
  component composition, events, controlled properties, islands, and teardown.
- [[COMPONENT-STORE]] and [[COMPONENT-PUZZLE-MODEL]] own records, schemas,
  queries, subscriptions, persistence, relationships, validation, and adapters.
- Formatter, animation, morph, development-state, and static-serialization
  components are optional or specialized layers around that core.

## Data and update path

Queries inside `data()` register the evaluating view. A matching store change
batches notifications, reruns `data()`, renders a new vnode tree, and patches
the DOM. `setData()` is intentionally local: it renders but does not rerun
`data()`. See [[FLOW-REACTIVITY]].

Navigation uses a transaction-like split: resolve and preload incoming views
first, then commit the URL, title, view tree, and scroll behavior together.
Superseded or failed pushes do not partially commit.

## Ownership rules

- Go parses Puzzle template syntax; esbuild parses/transforms JavaScript and
  TypeScript.
- The compiler creates render code; the runtime owns all reactivity and DOM
  behavior.
- The router owns route snapshots and navigation commit order; views do not
  read half-committed global location state.
- The store owns record identity. Model instances remain stable across upserts.
- Public assets never overwrite generated output; production builds replace
  `dist/` only after a successful staged build.
- Optional morph integration is an adapter around router/view hooks, not a
  second navigation engine.

## Repository map

- `client-runtime/`: browser runtime and optional subpath entries.
- `compiler/`: parser, codegen, plugin, build/dev/SSG orchestration, and CLI.
- `types/`: public TypeScript declarations.
- `bin/` and `npm/`: CLI shim and platform packages.
- `examples/`: `examples/todos` is the canonical yardstick app; the rest are
  focused acceptance cases for specific surfaces.
- `tests/`, `tests-types/`: runtime/integration and public type checks.
- `constellation/`: durable architecture and planning memory.

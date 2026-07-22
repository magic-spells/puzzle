# Puzzle agent knowledge base

Read this file before working in the repository. It is the compact operating
guide; the Constellation cards hold the detailed contracts and implementation
map.

## Source of truth

1. `constellation/doc/DOC-SPEC.md` is the frozen contract. It wins every
   conflict. A SPEC change requires a new numbered decision card and a new
   entry in `constellation/doc/DOC-DECISIONS.md`.
2. Read the relevant component, feature, decision, flow, and test cards before
   changing covered code. Update those cards as part of the same change.
3. `constellation/doc/DOC-RELEASE-SURFACE.md` is the concise inventory of what
   ships today. `constellation/plan.md` is the current roadmap and card index.
4. Decision cards preserve rationale. Git history preserves chronology. Do not
   turn component cards or this file back into release-by-release changelogs.

## Required verification

Before claiming success, run both suites:

```bash
npx vitest run
cd compiler && go test ./...
```

Run focused checks as well when appropriate: `npm run test:types`,
`npm run verify:pack`, example builds, or browser tests. Report anything not
run.

## Current release state

- Package version: `0.1.0`, preparing for the first public npm release.
- Product line: v1 through v1.43, decisions D1-D76, plus the July 21
  pre-release correctness/performance hardening pass.
- Public package: `@magic-spells/puzzle`, with root, `./morph`, `./ssg`, and
  `./puzzle-env` exports plus a `puzzle` binary shim and four optional platform
  binary packages (macOS/Linux, arm64/x64).
- Architecture: SPA-first browser runtime with optional static prerendering.
  Static builds emit content-complete HTML, then the same SPA runtime takes
  over at navigation zero. There is no SSR server or hydration protocol.
- Canonical app: `examples/todos`. Other examples are acceptance cases for
  routing, data, TypeScript, morphs, static output, DOM islands, canvas, and
  virtual scrolling.
- Release blockers are documentation/package verification and the human npm
  publish step, not unfinished framework features.

## Architecture at a glance

### Browser runtime (`client-runtime/`)

- `app.js`: `PuzzleApp` construction, service wiring, lifecycle hooks, mount /
  unmount, HMR restore, morph-handler forwarding.
- `router/router.js`: history/hash/memory routing, nested route chains,
  load-then-atomic-commit navigation, layouts/outlets, scroll restoration,
  transitions, SSG takeover.
- `views/PuzzleView.js`: model/local state layers, tracked `data()`, refresh,
  lifecycle, refs, memoization, skeletons, animation hooks.
- `views/ViewNode.js` + `views/viewManager.js`: vnode representation, DOM
  mount/patch, keyed reconciliation, components, slots, islands, refs, events.
- `views/animate.js` + `views/visibility.js`: WAAPI animation normalization and
  shared IntersectionObserver scheduling for visible-trigger enters.
- `datastore/store.js` + `model.js`: records, schema builders, validation,
  relationships, subscriptions, persistence, adapters, read/write sync.
- `formatters*`: display formatter registry, missing-name guard, built-in
  tree-shaking.
- `devstate.js`: development-only state snapshot/restore across full reloads.
- `morph.js`: optional morph-engine integration.
- `ssg/`: route prerender orchestration and ViewNode-to-HTML serialization.

### Go compiler and CLI (`compiler/`)

- `internal/parser`: `.pzl` section splitting, lexer, AST, template grammar,
  positioned errors.
- `internal/codegen`: render-function emission, expression scoping, handlers,
  keys, inline SVG, conditional arity stabilization, golden files.
- `internal/plugin` + `internal/build`: esbuild integration, aliases, CSS
  collection, atomic output swaps, public assets, watch builds, SSG node pass.
- `internal/config` + `internal/styles`: JavaScript config loading and the
  Tailwind-first style pipeline.
- `internal/dev`: recursive watch, incremental rebuild, local server, SSE
  reload, terminal controls.
- `cmd/puzzle` plus scaffold/generate/pieces packages: `init`, `dev`, `build`,
  `generate`, `add`, `doctor`, `info`, and `--version`.
- `cmd/pzlc`: single-file compiler used by tests and tooling.

## Public invariants that are easy to break

- `.pzl` scripts are real JavaScript/TypeScript bytes. Go never parses or
  rewrites the script body. TypeScript is transpile-only.
- A compiled class stays untouched; codegen attaches `prototype.render` after
  it. `PuzzleView` is a plain class, not an HTMLElement.
- `data()` owns the replace-on-commit model layer. `setData()` owns persistent
  local UI state and rerenders without rerunning `data()`. Use `refresh()` when
  local state feeds `data()`-derived values.
- Store queries inside `data()` auto-subscribe. Record props carry identity;
  children that need live record data should re-query by id.
- Navigation loads before commit. URL/title/history, mounted tree, route
  snapshot, and outgoing scroll save commit together. Failed or superseded
  pushes do not partially commit.
- `<children/>` is the component default marker, `<slot name="x">` is named
  composition, and `<Slot/>` is the router outlet. Bare lowercase `<slot/>` is
  a compile error.
- DOM listeners are per-node and patch-managed. Component `@event` bindings
  are callback props, not custom DOM events; there is no `$emit`.
- Template text is not HTML-entity decoded and interpolations become text
  nodes. `{#svg}` is the explicit compile-time raw-markup exception.
- `island` freezes an element's children after mount; its own attrs/listeners
  still patch. Components, slots, and view roots cannot be islands.
- Production defaults to ES2022, minification, and console stripping. Set
  `build.dropConsole: false` to preserve console calls.
- One-shot builds stage and atomically swap `dist/`. Failed builds preserve the
  last good output. Public files may not collide with generated output names,
  case-insensitively.

## Working conventions

- Use `rg` / `rg --files` for discovery. Preserve unrelated user changes in a
  dirty worktree.
- Keep changes narrow. Do not add abstraction layers for hypothetical needs.
- `examples/todos` and scaffolded todos templates should stay aligned with the
  grammar and public docs.
- Generated `.pzl` templates must remain compiler-tested.
- Formatter is the project term; never call it a filter.
- Future or rejected features must be clearly labeled. Do not describe them as
  shipped.
- Update current-state prose in card bodies. Keep only durable, surprising
  constraints in card notes. Do not append verification diaries; git already
  records them.

## Model policy

When the session model is Fable-class, do planning, design, review, and
Constellation truthing yourself. Delegate substantial code-writing to Opus
agents with a tight brief and verify their work. Small mechanical edits do not
need delegation.

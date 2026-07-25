# Puzzle agent knowledge base

Read this file before working in the repository. It is the compact operating
guide; the Constellation cards hold the detailed contracts and implementation
map.

## Source of truth

1. `constellation/doc/DOC-SPEC.md` is the source of truth; keep it current.
   When code and SPEC disagree, decide on the merits — usually the SPEC is
   right, but sometimes the SPEC should change to match a code decision.
   Either way, a SPEC change requires a new numbered decision card and a new
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

- Published: `0.1.0` (2026-07-21), `0.1.1` (2026-07-22, D77 init prompts),
  `0.1.2` (the embedded agent skill + `puzzle add skills`, D78/v1.45), and
  **`0.2.0` (2026-07-24, the current `latest`)** are live on npm (all five
  packages, MIT, manual publish via `npm run release:prep` — there is no CI
  publish). Everything from D88 onward landed AFTER the 0.2.0 publish and is
  unreleased **`0.3.0`** — minor, not patch: two new export subpaths
  (`./testing`, `./fixtures`) plus breaking changes in D110/D111/D112. Do not
  describe 0.2.0 as unpublished; that error sat in these files for a day.
  `0.2.0` adds path-shaped links via
  `router.url()` + the `link` formatter (D79/v1.46) and the true static-pages
  output mode (`output: 'static'` / `--static`, D81/v1.47); the D67
  prerendered-SPA mode is renamed `output: 'hybrid'` / `--hybrid` — the config
  rename is why this is 0.2.0, not 0.1.3. Also in 0.2.0: compiler a11y
  warnings (D82/v1.48), router query snapshot + `replace()` (D83/v1.49),
  route head management (D84/v1.50), the `flip` attribute (D85/v1.51), the
  `@event:outside` modifier (D86/v1.52), route guards — the inherited `guard`
  route field (D87/v1.53) — and the dev-server port scan (D90/v1.54). Then the
  framework-gap round (D91-D98: adapter `beforeRequest`, dev build errors in
  the browser, router focus + route announcement, `/testing`, `/fixtures` +
  mock adapter), agent-skill upgrade ergonomics (D97/D99), the DevTools
  runtime bridge (D100 — framework half only; the extension is a separate,
  unstarted repo), and a deep-review hardening round (D110 `dev.proxy` prefix
  validation, D111 managed head tags build-time only).
- Product line: v1 through v1.63, plus the July 21 pre-release
  correctness/performance hardening pass and the July 24 deep-review round.
  `constellation/doc/DOC-DECISIONS.md` is the authoritative decision range —
  do not restate it here; it moves faster than this file.
- Public package: `@magic-spells/puzzle`, with root, `./morph`, `./ssg`,
  `./static`, and `./puzzle-env` exports plus a `puzzle` binary shim and four
  optional platform binary packages (macOS/Linux, arm64/x64).
- Architecture: SPA-first browser runtime with two optional prerender output
  modes. `output: 'hybrid'` emits content-complete HTML the same SPA runtime
  takes over at navigation zero; `output: 'static'` emits true static pages —
  no router, no `app.js` — with a per-page `mountStatic` module. There is no SSR
  server or hydration protocol in either.
- Canonical app: `examples/todos`. Other examples are acceptance cases for
  routing, data, TypeScript, morphs, static output, DOM islands, canvas, and
  virtual scrolling.
- Releases are published by hand: bump versions in package.json, the four
  platform manifests, and version.go. The repo manifest must **not** declare
  `optionalDependencies` — the platform pins are injected at pack time by
  `scripts/inject-platform-pins.mjs` (`prepack` injects, `postpack` restores),
  and `npm run verify:pack` fails if the repo manifest carries them. Then run
  `npm run release:prep`, publish the four platform packages, then the root.

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
- `devstate.js`: development-only state snapshot/restore across full reloads;
  also owns the live-view registry and its single observer slot.
- `devtools.js`: development-only bridge to the DevTools extension hook (D100,
  SPEC §55). No hook installed ⇒ every touchpoint is a no-op; production DCE
  removes the module entirely.
- `head.js` / `headTags.js`: route head resolution. `head.js` resolves the four
  reserved `meta` fields and syncs `document.title`; `headTags.js` is
  build-time only — the SSG injector is its sole consumer (D111).
- `morph.js`: optional morph-engine integration.
- `ssg/`: route prerender orchestration, ViewNode-to-HTML serialization, and the
  shared DOM-free chain assembly used by both prerender modes.
- `static/`: `mountStatic`, the per-page browser kernel for `output: 'static'`
  (rehydrate data island, assemble + preload chain, mount over prerendered
  markup; no router). Hybrid output reuses the router takeover instead.

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

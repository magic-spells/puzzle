# Puzzle agent knowledge base

Read this file before working in the repository. It is the compact operating
guide; the Constellation cards hold the detailed contracts and implementation
map.

## Source of truth

1. `constellation/doc/DOC-SPEC.md` is the source of truth; keep it current.
   When code and SPEC disagree, decide on the merits — usually the SPEC is
   right, but sometimes the SPEC should change to match a code decision.
   Either way, a SPEC change must be reflected in a decision card — but pick
   the right card:
   - **New decision** (a question nothing has answered yet) → new numbered
     card.
   - **Changed decision** (a question some card already owns, now answered
     differently) → **rewrite that card in place**.
     Do not add a second card superseding the first.
     One decision, one card, forever; a chain of cards for a single question is
     a defect, not a record. State the current design as if it were always the
     design — the discarded approach belongs in that card's "Alternatives
     rejected" as rationale, never as narration of what the card used to say.
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

CI exists (`.github/workflows/ci.yml`: Go vet/build/test, `npm test`,
`verify:pack`, `test:types`, `test:e2e-pack`, and a Playwright browser smoke),
so do not describe this repo as having none — what it has no job for is
*publishing*. Run the suites locally anyway: CI is a backstop, not a substitute
for verifying your own change.

Two footguns in the scripts: `npm run build` at the repo root is aliased to
`node scripts/release-prep.mjs`, so it runs the whole release preparation —
cross-compiling four Go binaries and packing a tarball — not a framework build.
And `release:prep` hard-fails on the `@magic-spells/puzzle` ranges in the
scaffold templates and every `examples/*/package.json`, so that sweep is
enforced, not merely advised.

## Current release state

- Published: `0.1.0` (2026-07-21), `0.1.1` (2026-07-22, D77 init prompts),
  `0.1.2` (the embedded agent skill + `puzzle add skills`, D78/v1.45), `0.2.0`
  (2026-07-24), `0.3.0` (2026-07-25), `0.3.1` (2026-07-25), `0.4.0`
  (2026-07-28), and **`0.5.0` (2026-08-07, the current `latest`)** are live on
  npm (all five packages, MIT, manual publish via
  `npm run release:prep` — there is no CI publish). Everything from D88 onward
  shipped in `0.3.0` — minor, not patch: two new export subpaths (`./testing`,
  `./fixtures`) plus breaking changes in D110/D111/D112. **`0.3.0` is published
  but BROKEN and deprecated** — its registry metadata carries no
  `optionalDependencies`, so it installs the CLI shim with no platform binary
  and `puzzle` exits 1 on every machine (D120). `0.3.1` is the same feature set,
  correctly published; never recommend `0.3.0`. Do not describe `0.2.0` or
  `0.3.0` as unpublished; each error sat in these files for a day after the fact
  — check `npm view @magic-spells/puzzle versions` before trusting this
  paragraph.
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
  runtime bridge (D100 — the extension's v1 is built and smoke-verified in its
  separate public repo `magic-spells/puzzle-devtools`), and a deep-review
  hardening round (D110 `dev.proxy` prefix
  validation, D111 managed head tags build-time only).
- `0.4.0` (2026-07-28): the perf round (D121/D122 profiler + DevTools
  protocol), the Grok review rounds (D132/D133), D134 capitalized composition
  markers + ecosystem migration, and D135–D143 (marker fallback bodies, hybrid
  route snapshot, mount-throw ownership, and friends). Merged to `main` and
  `verify:published`-clean. Editor grammars (vscode/sublime/zed), puzzle-pieces,
  puzzle-music-demo, and the site adopted D134/D141; pieces' adoption branch
  (`chore/d134-capitalized-markers`, pushed) is not yet merged into its
  `main`/`release/0.2.0`, and the site's merge is pending an unrelated
  in-progress worktree.
- `0.5.0` (2026-08-07, published and `verify:published`-clean): D144
  Portal scoped v1
  (`<Portal>` marker + framework outlet + portal-aware `@event:outside`), D145
  error boundaries (`onError` funnel + script-side `errorContent()`), D146
  transactional reused-ancestor refresh (prepare/commit closes the D19/D30
  soft-violation), D147 implicit two-way form binding, D148
  `puzzle preview` + real static serving in `puzzle dev` for
  `output: 'static'` projects (hybrid devs as the SPA), and D149 payload keys
  colliding with a computed getter. Also in: the Portal
  showcase `examples/overlays`, the Portal component-root steering error
  (wrap `<Portal>` in a root element; documented in D144), and the D76 change
  that points `puzzle upgrade` at the running CLI rather than the cwd. Cards
  truthed through D149.
- **`0.6.0` (2026-08-15, published and `verify:published`-clean — the current
  `latest`;** registry metadata pins all four platform packages, a temp-dir
  install runs `puzzle version 0.6.0`, and a fresh-app `puzzle add piece`
  resolves `npm:@magic-spells/puzzle-pieces@0.6.0`; the `main` merge and tag
  are pending — Cory does both): D150 `{#raw}` static raw template
  block; the pieces npm transport (a D32 amendment, not a new card — default
  registry is `npm:@magic-spells/puzzle-pieces` resolved to the CLI's
  major.minor, older-only fallback with a printed notice, `--pieces-version`
  pin, `pieces.lock` gains a `puzzle` field); and the D151–D156 build/dev
  performance round (shell-head plan, build-scoped compile cache, `.puzzle/`
  scratch dir, warm static dev rebuilds, route-level invalidation, pipeline
  hardening + `--profile-build`); and the D145 errorView amendment
  (v1.71, BREAKING): per-view `errorContent(error)`/ViewNode fallbacks are
  removed in favor of one app-level `errorView` compiled view with
  `{ error, info, retry }` props — retry re-runs the normal
  navigation/refresh pipeline; the `boundary` phase is renamed
  `error-view`. Byte-neutral by measurement (+126 gzip framework-side,
  −71 net with the todos demo cleanup); treated as an API simplification,
  not a size lever; D157 extracts server sync into the opt-in
  `@magic-spells/puzzle/adapter` subpath (a capability value passed once in
  the app config); D158 makes model adapters per-verb fetch functions with
  endpoint-generated REST defaults, plus `adapter.defaults()` — the app-wide
  dialect tier (dispatch: model function → app default → generated REST); and
  D159 turns hash/memory routing into
  imported factories from `/router-modes` (`routerMode: hashRouter()` —
  strings throw, path routing stays the inline default — "path routing" is the
  mode's official name, never "history"; `routerInitialPath` folds
  into `memoryRouter({ initialPath })`); and D160 adds opt-in SPA code
  splitting (`build: { splitting: true }` makes a dynamic `import()` a lazy
  chunk under `dist/chunks/` — default off, static mode forces it off, dev
  prunes stale chunks per rebuild, and the size banner gained a per-dependency
  composition report), which also bumps embedded esbuild 0.19.11 → 0.28.2.
  The 2026-08-15 launch-fix round (three PRs off the two release reviews)
  closed the static-adapter identity gap with three-tier page entries (bare /
  conventional `app/adapter.js` / capture-mode `app.js` import — inline
  `adapter.defaults()` is legal and must keep working in static builds),
  made errorView retry hold its face until something refills the position,
  and landed the small fixes (`mock` allowlist, `/testing` alias, falsy
  `create()` throw + branded `RouterMode`, SVG anchor clicks, D158 write-guard
  CHANGELOG). Production sizes after that round — README banner matches:
  hello-world **19.6 KB gzip**, todos **22.7 KB gzip** (the size scripts only
  check the banner; the README line is edited by hand). Cards truthed
  through D160; the next free decision number is D161. `@magic-spells/puzzle-pieces`
  `0.6.0` is live on npm (`latest`) — the version-locked pieces resolution is
  verified end-to-end. Note `PUZZLE_PIECES_REGISTRY` is set in Cory's shell
  profile pointing at the pieces registry — now
  `packages/puzzle-pieces/registry` in this monorepo; unset it when smoke-testing
  the npm transport.
- Product line: v1 through v1.75 (D134 = v1.64, D141 = v1.65, D144 = v1.66,
  D145 = v1.67, D147 = v1.68, D148 = v1.69, D150 = v1.70, the D145 errorView
  amendment = v1.71, D157 = v1.72, D158 = v1.73, D159 = v1.74, D160 = v1.75;
  D146 is a correctness amendment with no product-line entry),
  plus the July
  21 pre-release correctness/performance hardening pass and the July 24
  deep-review round. The `constellation/decision/` cards are the authoritative
  decision record — do not restate them here; they move faster than this file.
  (There is deliberately no DOC-DECISIONS index card: each decision lives in
  its numbered card only, never in two spots.)
- Public package: `@magic-spells/puzzle`, with root, `./adapter`, `./morph`,
  `./router-modes`, `./ssg`, `./static`, `./testing`, `./fixtures`, and
  `./puzzle-env` exports
  plus a `puzzle` binary shim and four
  optional platform binary packages (macOS/Linux, arm64/x64).
- Architecture: SPA-first browser runtime with two optional prerender output
  modes. `output: 'hybrid'` emits content-complete HTML the same SPA runtime
  takes over at navigation zero; `output: 'static'` emits true static pages —
  no router, no `app.js` — with a per-page `mountStatic` module. There is no SSR
  server or hydration protocol in either.
- Canonical app: `examples/todos`. Other examples are acceptance cases for
  routing, data, TypeScript, morphs, static output, DOM islands, canvas, and
  virtual scrolling.
- Releases are published by hand: bump every version stamp `release:prep`
  asserts — package.json, the four platform manifests, version.go, the
  `FRAMEWORK_VERSION` literal in `client-runtime/devtools.js` (it ships in the
  runtime), and the sibling-package train: pieces (package.json,
  demo/package.json, the demo header badge in
  `demo/app/layouts/Default.pzl`) and devtools (package.json,
  panel/package.json, extension/manifest.json). The repo manifest must **not** declare
  `optionalDependencies` — the platform pins are injected at pack time by
  `scripts/inject-platform-pins.mjs` (`prepack` injects, `postpack` restores),
  and `npm run verify:pack` fails if the repo manifest carries them. Then run
  `npm run release:prep`, publish the four platform packages, then the root.
  **The root is published as the packed tarball it prints — `npm publish
  ./magic-spells-puzzle-<version>.tgz` — never as `npm publish` in the repo
  directory** (D120): a directory publish re-reads the manifest after `postpack`
  strips the pins, so the registry gets no `optionalDependencies` and the CLI
  installs with no binary behind it. That is how 0.3.0 shipped broken.
  `prepublishOnly` now refuses a directory publish outright. After publishing,
  run `npm run verify:published` — it is the only check that inspects the
  registry metadata npm actually resolves against.
- Before every release, sweep the `@magic-spells/puzzle` dependency ranges that
  are NOT bumped by the version scripts and point them at the version being
  published:
  - `compiler/internal/scaffold/templates/{default,todos}/package.json` — these
    are `go:embed`ed into the binary, so a stale range ships a broken
    `puzzle init`: caret ranges do not cross 0.x minors, so `^0.1.0` installs
    `0.1.x` into an app scaffolded by a `0.3.0` binary. Fixing this requires
    rebuilding the platform binaries; a JS-only republish will not carry it.
  - `examples/*/package.json` — kept at the current version so the examples
    install against what is actually published.
  - `client-runtime/devtools.js` `FRAMEWORK_VERSION` — a literal that SHIPS in
    the runtime and is reported to the DevTools extension (D100); the ESM bundle
    cannot import package.json. `release:prep` now asserts it matches, because
    the "bump it at every release" comment did not stop it sitting at `0.3.0`
    through the `0.3.1` bump.
  Check with `rg -n '"@magic-spells/puzzle":' examples/*/package.json
  compiler/internal/scaffold/templates/*/package.json`. Leave each template's
  own `"version"` field alone; that is the scaffolded app's starting version.
- Since 0.6.0 the pieces registry is version-locked: `puzzle add piece`
  resolves `@magic-spells/puzzle-pieces` to the CLI's major.minor. Publish the
  matching pieces release (from `../puzzle-pieces` — the `release:prep`
  summary prints it in order) at or before the CLI release, or zero-config
  `add piece` falls back to an older minor — or hard-fails when none exists.
  The devtools zip (`npm run build:compiler`, then `build:zip` in
  `../puzzle-devtools`) is separate and unhurried.
- Sweep the release-facing prose no script checks: CHANGELOG completeness for
  the version being shipped and `DOC-RELEASE-SURFACE.md`. The README size
  banner IS scripted now — `release:prep` runs
  `scripts/measure-size.mjs --check` (builds `examples/hello-world` +
  `examples/todos` in production and fails on a stale figure; regenerate with
  `npm run measure:size`) after its banner sat stale through four releases.

## Monorepo layout (D162)

This package IS the framework, and it lives at `packages/puzzle` inside the
`magic-spells/puzzle` monorepo — the repo root is a private shell
(`@magic-spells/puzzle-monorepo`) whose scripts delegate here. Everything
that versions in lockstep with the framework is a sibling under `packages/`:

- `../puzzle-pieces` — the `@magic-spells/puzzle-pieces` npm transport
  (registry + demo + its own constellation root). Version must equal this
  package's exactly (the D32 major.minor lock); `release:prep` asserts it and
  prints the pieces publish in the release order.
- `../puzzle-devtools` — the Chrome DevTools extension (D100).
  `private: true`; its `@magic-spells/puzzle` dep is `file:../puzzle`, so its
  vitest suite always runs against the working tree, and CI runs it on every
  push — a framework breaking change fails the build the day it lands.
- `../puzzle-eslint` / `../puzzle-prettier` — the .pzl lint/format plugins.
  Both vendor JS ports of this compiler's section splitter/lexer
  (`compiler/internal/parser`), so grammar changes must land there too — CI
  runs their suites on every push. Train-versioned, not yet published.

Each package keeps its own npm install and lockfile — there are deliberately
no npm workspaces (editing any package's dependencies means regenerating its
lockfile, or `npm ci` hard-fails). The editor grammars
(puzzle-vscode/sublime/zed) stay in separate repos — their distribution
channels are repo-shaped — so when the template grammar changes, sweep them
as part of the release checklist. The absorbed puzzle-pieces and
puzzle-devtools repos are archived on GitHub, never deleted.

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
- `datastore/store.js` + `model.js`: core records, schema builders, validation,
  relationships, subscriptions, and persistence; `datastore/adapter.js` is the
  opt-in server read/write sync runtime.
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
  snapshot, outgoing scroll save, and reused-ancestor state (params, snapshot,
  data, subscriptions — D146) commit together. Failed or superseded pushes do
  not partially commit.
- `<Children>` is the component default marker, `<Slot name="x">` is named
  composition, and `<Slot>` is the router outlet. A marker is self-closing or
  paired — a paired body is fallback content, rendered only when nothing fills
  the position (D141) — and any lowercase `<slot>`/`<children>` is a
  positioned compile error steering to the capitalized form (D134).
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

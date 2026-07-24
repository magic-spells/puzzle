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
verified_at: '2026-07-24T05:49:35.856Z'
verified_sha: d9591d6e01cb9c358acfa4d641174d08e1f05b23
---

# Puzzle 0.1 release surface

Compact inventory of what ships in `@magic-spells/puzzle` at the first npm
release. [[DOC-SPEC]] remains the binding contract; this card is the map, not a
second specification. Decision cards hold rationale and git holds chronology.

## Package and application

- Root exports: `PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`,
  `PuzzleValidationError`, `PuzzleAdapterError`, and compiler support exports.
- Subpaths: `@magic-spells/puzzle/morph`, `/ssg`, `/static`, `/testing`,
  `/fixtures`, and `/puzzle-env`. (`/static` exports `mountStatic`, the
  per-page kernel for `output: 'static'`; `/testing` exports the app-author
  test utilities — `mountView`, `createTestApp`, `settled`,
  `installFakeAnimate`, `installFakeObserver`, D94 — and re-exports
  `installFixtures`; `/fixtures` is the self-contained fixtures + mock-adapter
  module, D98, bundled into an app only by the `--fixtures` flag.)
- `puzzle` binary shim selects an optional platform binary for macOS/Linux on
  arm64/x64. Unsupported systems get a Go-install fallback message.
- App config: `target`, `routes`, `models`, `formatters`, `apiURL`, `storage`,
  `beforeRequest`, `scrollBehavior`, `focusBehavior`, `routerMode`,
  `routerInitialPath`, `routerBase`, `transitionMode`, `beforeMount`, `mounted`,
  and `beforeUnmount`.
- The app is SPA-first. Prerendered output comes in two modes (D67/D81), never a
  request-time SSR server or hydration protocol: `output: 'hybrid'` ships
  prerendered pages the SPA takes over at navigation zero; `output: 'static'`
  ships true static pages with no router or `app.js` and a per-page mount module.

## `.pzl` files and templates

- One `<puzzle-view>` template; optional `<script>` and `<style>`; optional
  `<puzzle-skeleton min-duration="…">`.
- `<script>` is real JS. `lang="ts"` enables esbuild transpilation only; the
  build does not type-check `.pzl` bodies.
- `<style scoped>` uses native `@scope`; unscoped styles are global.
- Interpolation and formatter chains; dynamic/mixed/boolean attributes;
  controlled `value`, `checked`, `disabled`, and `selected` properties.
- `{#if}` with `{:else if}`/`{:else}`, `{#unless}`, `{#case}` with `{:when}`,
  item/range `{#for}` with optional counters, template comments, and inline SVG.
- DOM events support bare/call handlers, `prevent`, `stop`, `once`, `outside`
  (document-capture outside-dismiss, D86), and keyboard filters. Component
  event attributes compile to callback props.
- Composition: `<children/>` default content with fallback, named
  `<slot name="…">`, `<Slot/>` router outlets, and default-slot forwarding
  through component invocations.
- `key` overrides list auto-keying; `ref="name"` binds `this.refs`; `island`
  makes element children browser-owned after mount; `flip` FLIP-animates keyed
  reorders (translation-only, reduced-motion aware, D85).
- The compiler warns (never errors) on five template a11y mistakes with exact
  source positions (D82); generated JS is unaffected.
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
  Keyed identity is the `(tag, key)` pair by SameValueZero, so type-distinct
  keys never collide; a first-mount failure is torn down and re-mounted fresh.
- Conditional branches are arity-stabilized with invisible placeholder vnodes,
  preventing unrelated trailing siblings from remounting on a toggle.

## Data layer

- Schema builders: string, number, boolean, date, object, array, belongsTo, and
  hasMany; defaults, primary keys, required/min/max/oneOf/custom validation.
- Records are model-class instances with getters/methods, immutable primary
  keys, local update/destroy, non-throwing validation reports, and throwing
  write-boundary validation. `createRecord` rejects a blank explicit-required
  primary key exactly as `validate()` does (auto-generation is skipped for a
  `.primary().required()` field; hydration/upsert stay fail-soft).
- Store queries auto-subscribe inside `data()`. Collection and record keys are
  batched, hidden-tab safe, isolated per subscriber, and torn down with views.
- Reads: `loadAll`/`loadOne` through model adapters with identity-preserving
  upsert. Writes: `save`, `delete`, and custom `request`, with POST/PUT sync
  provenance, collision/destroy guards, and typed adapter errors.
- Every adapter call routes through one internal fetch seam, so the optional
  `beforeRequest(init, { type, method, url })` config hook attaches auth headers,
  `credentials`, or an `AbortSignal` to all of them (D91). Synchronous;
  `method`/`body`/URL are not the hook's to change. Carried by the prerender
  path; structurally unavailable under `output: 'static'`.
- Relationships are lazy store-backed getters and participate in tracking.
- Development/test affordances (D95, reshaped by D98): `installFixtures(config)`
  from `/fixtures` attaches `store.seed(type, n, overrides)` — records generated
  from the schema alone, deterministic via the install `seed` and two derived
  PRNG streams; the auto-generated pk is the one non-deterministic field — and
  the mock adapter: `static adapter = { mock: { data, latency, failRate, fail,
  handler } }` and/or the install config's per-type `mock` entries (fixtures
  file wins per key) serve the verbs from an in-memory collection by replacing
  the core's one `_network` seam, so every adapter verb runs unmodified and
  `beforeRequest` still fires. `latency` makes skeletons developable;
  `failRate`/`fail` are the supported way to exercise a `data()` rejection.
  Nothing in core references the module — it ships only under `--fixtures`
  (wired from `app/fixtures.js`) or a direct test import, and `uninstall()`
  detaches it.
- Optional Storage hydration/persistence is fail-soft. Persistence serializes
  once per flush and is forced during app teardown.
- JSON/server assignment rejects prototype-pollution keys and protected record
  internals.

## Routing and motion

- History, hash, and memory modes; nested relative children; index routes;
  catch-all routes; merged params; top-level layouts; route titles + managed
  head metadata (`meta` title/description/canonical/socialImage → marked
  `<head>` tags in SSG output and SPA navigation, per-field leaf→root
  inheritance with explicit-null suppression, D84).
- `push`, `replace` (no history entry, scroll untouched by default, D83),
  `go`, `back`, and `forward`; guarded same-origin link interception;
  router base paths and anchors; `router.url()` + the built-in `link`
  formatter for mode-agnostic path-shaped hrefs.
- Route guards (D87): an inherited `guard` route field runs root→leaf before
  views construct or load — allow / block / redirect (replace semantics,
  loop-capped). SPA-runtime only; hybrid/static prerender passes warn on
  guarded routes.
- The route snapshot carries `path`, `pathname`, parsed frozen `query`
  (repeated keys → arrays), and `hash` (D83); query never merges into params.
- Load-then-commit navigation with chain-prefix reuse and atomic
  URL/title/head/view/scroll commit. Failed or superseded pushes leave
  committed state alone.
- Scroll-to-top, pop restoration, session persistence, custom behavior, and
  opt-out.
- Focus management + route announcement (D93): every committed navigation moves
  focus to the incoming view root with `preventScroll` (strictly after the scroll
  commit) under a transient `tabindex="-1"`, and sets a framework-owned
  visually-hidden `aria-live` region to the committed title. `focusBehavior`
  mirrors `scrollBehavior` — omit / `false` / function. Memory mode and
  navigation #0 are no-ops; static output has no router and so gets neither.
- Sequential route transitions by default. Optional overlapping transitions
  resolve destination-first at route, view/layout, then app level.
- WAAPI enter/leave animations are failure-safe and reduced-motion aware.
  `trigger: 'visible'`, offset, and ancestor anchors use shared observers.
- Optional morph integration supports coexisting pairs, cross-view captures,
  skeleton-delayed targets, and symmetric/trigger/target roles; a re-mounted
  app re-arms its morph click listener.

## Build, dev, and static output

- Go parser/codegen feeds an esbuild `.pzl` plugin; scripts stay untouched and
  render functions attach to the user class prototype.
- Production: ES2022, minified, console calls stripped by default, tree-shaken
  formatter manifest, collected component CSS. The D89 usage scan also gates
  whole modules — `flip` and managed head tags, each behind its own
  `__PUZZLE_HAS_*__` define — so an app pays only for what it uses; the fixture
  generator and mock adapter are excluded structurally instead (D98): nothing
  imports `/fixtures` unless `puzzle dev|build --fixtures` generates the wiring
  entry from `app/fixtures.js`. Source maps are **opt-in** —
  `build.sourceMap` (default off) emits linked maps for SPA + true-static prod
  bundles; dev keeps linked maps regardless (D88).
- Tailwind-first style pipeline; scoped blocks wrapped in native `@scope`.
- Public assets copied with generated-name collision checks. One-shot builds
  stage and atomically swap `dist`, preserving the last good build on failure.
- `puzzle dev` uses incremental esbuild, recursive watch, warm Tailwind watch,
  a localhost static server, SPA fallback, SSE reload, and graceful shutdown.
- Build failures reach the browser, not just the terminal (D92): the SSE channel
  carries typed `reload`/`builderror`/`clear` frames with JSON payloads and
  last-write-wins client buffers, the server retains the current error and
  replays it to late-connecting clients, and a 404 with a retained error serves a
  503 self-healing shell so a first-ever failed build shows the diagnostic
  instead of "404 page not found". Dev-server only.
- Dev reload snapshots store records and JSON-safe local view state to a
  short-lived one-shot session blob, then restores store before navigation and
  local state after mount. Production bundles eliminate this machinery.
- The DevTools bridge (D100, SPEC §55) registers into an extension-injected
  `window.__PUZZLE_DEVTOOLS_HOOK__` and speaks the versioned wire protocol the
  `magic-spells/puzzle-devtools` extension consumes. Dev-only, no-op without
  the hook; production bundles eliminate it entirely (same DCE pin as
  `__PUZZLE_APP__`).
- Prerendered builds (both modes) write directory-style pages plus `404.html`
  for a catch-all, skip dynamic routes with a warning, and support
  `prerender: false` islands. `--hybrid` (`output: 'hybrid'`, D67) shares one
  `app.js` the router takes over; `--static` (`output: 'static'`, D81) ships no
  `app.js`, stamping the target `data-puzzle-static` and emitting one per-page
  `dist/_puzzle/<slug>.js` (mountStatic + that page's classes) with shared
  runtime split into `dist/_puzzle/chunks/` and build-time data inlined as a
  `data-puzzle-static-data` island. Hybrid requires history routing (a
  hash/memory router would render home over every prerendered page — the build
  rejects it); static ignores `storage` with a warning (no persistence layer),
  and base-prefixes each page's module href under `routerBase` (D81).

## CLI

- `puzzle init` (`default`/`todos`, optional TypeScript project config).
- `puzzle dev`, `puzzle build`, and `puzzle build --static` / `--hybrid`.
- `puzzle dev --fixtures` / `puzzle build --fixtures` (D98): wire
  `app/fixtures.js` through a generated wrapper entry so the `/fixtures`
  module installs before the app entry runs; rejected alongside
  `--static`/`--hybrid`. Without the flag no fixture bytes can ship.
- `puzzle generate` / `g` for components, views, layouts, and models.
- `puzzle add tailwind` and `puzzle add piece` with local/HTTPS registries,
  dependency resolution, path-containment checks, and `pieces.lock` hashes.
- `puzzle add skills` (alias `skill`, D78): installs the `go:embed`-ed agent
  skill into detected `~/.claude` / `~/.codex` / `~/.cursor` config dirs;
  `--skill-root <dir>` (repeatable, D97) pins them instead. Installs carry a
  `.puzzle-skill-version` stamp (D99): a matching one is skipped as up to date,
  a stale one prompts on a TTY and still refuses without `--overwrite` on a
  non-TTY, and a symlinked destination is reported and skipped unless
  `--overwrite` is given. Reinstalling replaces the tree rather than merging.
- `puzzle doctor`, `puzzle info`, and `puzzle --version`.
- `puzzle upgrade` / `upgrade --check`, plus a passive TTY-only update notice
  on `dev`/`build` (opt out with `PUZZLE_NO_UPDATE_CHECK=1`; skipped in CI).
  A successful upgrade offers to refresh installed skills by re-execing the
  newly installed binary (D97). `puzzle upgrade skills` does the same refresh
  from the running binary with no registry check (D99).
- `pzlc` is the internal/test-facing single-file compiler.

## Deliberately not shipped

No SSR server, hydration, lazy route/code splitting,
named-route navigation, scoped slots, array refs, built-in virtual list,
per-module hot swap, Sass pipeline, event bus, global keyboard API, app-level
computed/settings/methods, devtools hook, or automatic query fault-in.

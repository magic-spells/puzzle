---
name: Puzzle release surface
kind: reference
status: verified
connections:
  - DOC-SPEC
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
verified_at: '2026-08-14T05:01:26.065Z'
verified_sha: d74916a0e021b6bb86394551171838fbab161347
notes:
  - kind: verified
    text: >-
      0.6.0 sweep: header version, {#raw}, adapter.defaults() dispatch tier, --profile-build, pieces
      npm transport, splitting vs not-shipped list, SPA-default phrasing, formatters/manifest
      subpath — all reconciled against the release/0.6.0 code.
    sha: d74916a0e021b6bb86394551171838fbab161347
---

# Puzzle release surface

Compact inventory of what ships in `@magic-spells/puzzle` — kept current with
the released surface (0.6.0 as of this writing), not pinned to one version. [[DOC-SPEC]] remains the binding contract; this card is the map, not a
second specification. Decision cards hold rationale and git holds chronology.

## Package and application

- Root exports: `PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`,
  `PuzzleValidationError`, and compiler support exports.
- Subpaths: `@magic-spells/puzzle/adapter`, `/morph`, `/router-modes`, `/ssg`,
  `/static`, `/testing`, `/fixtures`, and `/puzzle-env`. (`/router-modes` exports
  `hashRouter()` and `memoryRouter({ initialPath })`, the opt-in router modes —
  path routing is the inline default and needs no import, D159; `/static` exports `mountStatic`, the
  per-page kernel for `output: 'static'`; `/testing` exports the app-author
  test utilities — `mountView`, `createTestApp`, `settled`, `type` (drives a
  two-way-bound control, D147), `installFakeAnimate`, `installFakeObserver`,
  D94 — and re-exports `installFixtures`; `/fixtures` is the self-contained fixtures + mock-adapter
  module, D98, bundled into an app only by the `--fixtures` flag; `/adapter`
  exports the frozen `adapter` capability — plus `adapter.defaults()`, the
  app-wide dialect tier — and `PuzzleAdapterError`, D157/D158. A
  compiler-internal `/formatters/manifest` subpath also exists for the
  tree-shaken formatter manifest.)
- `puzzle` binary shim selects an optional platform binary for macOS/Linux on
  arm64/x64. Unsupported systems get a Go-install fallback message.
- App config: `target`, `routes`, `models`, `formatters`, `apiURL`, `storage`,
  `adapter`, `beforeRequest`, `scrollBehavior`, `focusBehavior`, `routerMode`
  (a mode object from `/router-modes`; a string throws), `routerBase`,
  `transitionMode`, `beforeMount`, `mounted`, `beforeUnmount`, `onError`, and
  `errorView`.
- The app is SPA-first. Prerendered output comes in two modes (D67/D81), never a
  request-time SSR server or hydration protocol: `output: 'hybrid'` ships
  prerendered pages the SPA takes over at navigation zero; `output: 'static'`
  ships true static pages with no router or `app.js` and a per-page mount module.

## `.pzl` files and templates

- One `<puzzle-view>` template; optional `<script>` and `<style>`; optional
  `<puzzle-skeleton min-duration="…">`.
- `<script>` is real JS. `lang="ts"` enables esbuild transpilation only; neither
  the Puzzle build, scaffolded `tsc --noEmit`, nor editors type-check `.pzl`
  `<script>` bodies. The scaffolded TypeScript config checks standalone
  `.ts`/`.js` files and declarations.
- `<style scoped>` uses native `@scope`; unscoped styles are global.
- Interpolation and formatter chains; dynamic/mixed/boolean attributes;
  controlled `value`, `checked`, `disabled`, and `selected` properties.
- Implicit two-way binding (D147): a path-shaped `value=`/`checked=`
  (`ident` or `ident.ident`) on a plain form control synthesizes its own
  write-back handler (`@input:bind`/`@change:bind`) — suppressed by an author
  `@input`/`@change`, static `readonly`/`disabled`, a non-path expression, a
  dynamic or excluded `type`, or a component tag. Number, checkbox, date
  kinds, and select commit on `change`; numeric `''` writes `null`, NaN is
  skipped; IME composition never mid-writes. Records write through validated
  `update()` (rejections report to `onError` as `phase: 'bind'`); bare locals
  write `setData` + refresh. Attr namespaces (`bind:value`) are a positioned
  compile error reserving the space (`xml`/`xlink`/`xmlns` allowlisted).
- `{#if}` with `{:else if}`/`{:else}`, `{#unless}`, `{#case}` with `{:when}`,
  item/range `{#for}` with optional counters, template comments, inline SVG,
  and static raw markup blocks (`{#raw}…{/raw}`, D150).
- DOM events support bare/call handlers, `prevent`, `stop`, `once`, `outside`
  (document-capture outside-dismiss, D86), and keyboard filters. Component
  event attributes compile to callback props.
- Composition: `<Children/>` default content, named `<Slot name="…"/>`,
  `<Slot/>` router outlets, unfilled-marker omission, and default-slot forwarding
  through component invocations. `<Portal>…</Portal>` (D144) teleports children
  into a framework-created outlet at the app root — paired-only, attribute-free,
  empty in prerendered HTML, with portal-aware `@event:outside` containment.
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
- Contained mount/refresh failures report through app `onError`, destroy the
  failed instance, and preserve its exact position. An app `errorView` mounts
  there as a fresh ordinary view with `{ error, info, retry }`; retry is stable,
  single-flight, and re-enters the owner's ordinary rebuild path: a forced
  same-location Router replace or the component parent's refresh. With no error
  view, the invisible marker remains for ordinary owner recovery.
  Error-view failures report once as `phase: 'error-view'` and never recurse.
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
- Server sync is opt-in: models keep a bare `static adapter` object of per-verb
  fetch functions; `endpoint` generates missing REST defaults, and endpoint is
  optional for a fully custom adapter (D158). Verb dispatch is model function →
  app-wide default (`adapter.defaults({ verb })`, passed as the capability) →
  endpoint-generated REST, with `{ type, endpoint }` context as the trailing
  argument. The app imports the D157 capability from
  `@magic-spells/puzzle/adapter` and passes it once to `PuzzleApp`; apps that never pass it ship none of the Store/record
  verbs. Reads preserve identity and accept pagination options. Writes retain
  sync provenance, revision/collision/destroy guards, and typed adapter errors.
- Generated transports, enhanced fetch, and `store.request()` route through one internal fetch seam, so the optional
  `beforeRequest(init, { type, method, url })` config hook attaches auth headers,
  `credentials`, or an `AbortSignal` to all of them (D91). Synchronous;
  `method`/`body`/URL are not the hook's to change. Carried by the prerender
  path; structurally unavailable under `output: 'static'`. Explicit global
  fetch in an author function bypasses this seam and fixture interception.
- Relationships are lazy store-backed getters and participate in tracking.
- Development/test affordances (D95, reshaped by D98): `installFixtures(config)`
  from `/fixtures` attaches `store.seed(type, n, overrides)` — records generated
  from the schema alone, deterministic via the install `seed` and two derived
  PRNG streams; the auto-generated pk is the one non-deterministic field — and
  the mock adapter: `static adapter = { endpoint, mock: { data,
  latency, failRate, fail, handler } }` and/or the install config's per-type `mock` entries (fixtures
  file wins per key) serve the verbs from an in-memory collection by replacing
  the `/adapter` module's `_network` seam, so every adapter verb runs unmodified and
  `beforeRequest` still fires. `latency` makes skeletons developable;
  `failRate`/`fail` are the supported way to exercise a `data()` rejection.
  Nothing in core references either adapter or fixtures — fixtures ships only under `--fixtures`
  (wired from `app/fixtures.js`) or a direct test import, and `uninstall()`
  detaches it.
- Optional Storage hydration/persistence is fail-soft. Persistence serializes
  once per flush and is forced during app teardown.
- JSON/server assignment rejects prototype-pollution keys and protected record
  internals.

## Routing and motion

- History, hash, and memory modes; nested relative children; index routes;
  catch-all routes; merged params; top-level layouts; route titles + managed
  head metadata (`meta` title/description/canonical/socialImage, per-field
  leaf→root inheritance with explicit-null suppression, D84). Delivery is
  split: the browser syncs `document.title` on every navigation, while the
  marked `<head>` tags are baked per page by the prerender and never touched
  at runtime (D111) — so they are inert in the default SPA build (no `output`
  key configured).
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
  a whole module — `views/flip.js`, behind `__PUZZLE_HAS_FLIP__`, now the only
  usage define (D111 retired the managed-head one, so the scan reads only
  `.pzl`) — so an app pays only for what it uses; the fixture
  generator and mock adapter are excluded structurally instead (D98), as is
  the server adapter itself (D157): nothing imports `/fixtures` unless
  `puzzle dev|build --fixtures` generates the wiring, and nothing imports
  `/adapter` unless an app passes its capability (or fixtures needs its seam).
  entry from `app/fixtures.js`. Source maps are **opt-in** —
  `build.sourceMap` (default off) emits linked maps for SPA + true-static prod
  bundles; dev keeps linked maps regardless (D88).
- Code splitting is **opt-in** — `build.splitting` (default off, D160) makes
  every dynamic `import()` in the SPA/hybrid bundle a lazy chunk under
  `dist/chunks/`; unset builds emit the single `app.js` they always have.
  `output: 'static'` ignores it (its per-page bundles already split), `chunks/`
  is a reserved output name while it is on, and `puzzle dev` splits and prunes
  stale chunks per rebuild. The build size banner additionally reports
  per-dependency emitted bytes from esbuild's metafile, warning in production
  past 200 KB for a single dependency (app code and the framework runtime are
  listed but never flagged).
- Tailwind-first style pipeline; scoped blocks wrapped in native `@scope`.
- Public assets copied with generated-name collision checks. One-shot builds
  stage and atomically swap `dist`, preserving the last good build on failure.
- `puzzle dev` uses incremental esbuild, recursive watch, warm Tailwind watch,
  a localhost static server, SPA fallback, SSE reload, and graceful shutdown.
  An `output: 'static'` project instead gets the real pipeline per rebuild —
  full build + prerender, clean URLs, real 404s, serve-time reload injection
  into every HTML page (D148); hybrid devs as the SPA.
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
  `data-puzzle-static-data` island. Hybrid requires path routing (a
  hash/memory router would render home over every prerendered page — the build
  rejects it); static ignores `storage` with a warning (no persistence layer),
  and base-prefixes each page's module href under `routerBase` (D81).

## CLI

- `puzzle init` (`default`/`todos`, optional TypeScript project config).
- `puzzle dev`, `puzzle build`, and `puzzle build --static` / `--hybrid`.
- `--profile-build` on `build` and `dev` (or `PUZZLE_PROFILE_BUILD=1`, D156):
  opt-in per-phase timing tables on stderr; never changes artifacts or stdout.
- `puzzle preview [--port] [--strict-port]` (D148): serves an existing `dist/`
  with production-host semantics per output mode — SPA history fallback,
  hybrid prerendered-page-first, static clean URLs + real 404s. Port 4000
  default; flag-only builds self-identify via the artifact's prerender marker.
- `puzzle dev --fixtures` / `puzzle build --fixtures` (D98): wire
  `app/fixtures.js` through a generated wrapper entry so the `/fixtures`
  module installs before the app entry runs; rejected alongside
  `--static`/`--hybrid`. Without the flag no fixture bytes can ship.
- `puzzle generate` / `g` for components, views, layouts, and models.
- `puzzle add tailwind` and `puzzle add piece`. The default piece source is
  the npm registry — `npm:@magic-spells/puzzle-pieces` resolved to the CLI's
  major.minor, older-only fallback with a printed notice, `--pieces-version`
  to pin (a D32 amendment); `--registry` accepts `npm:pkg[@version]`, a local
  dir, or HTTPS. Dependency resolution, path-containment checks, and
  `pieces.lock` hashes apply to all transports; the lock records the resolving
  `puzzle` version.
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

## Error handling (D145)

`new PuzzleApp({ onError(error, { phase, view, route }) })` receives every
framework-contained error (mount, refresh, navigation, transition/leave, bind,
error-view); unregistered → the original `console.error` per catch site.
`errorView: AppErrorView` registers one ordinary compiled `.pzl` view as the
app-wide fallback: a failed view or component is replaced in place by a fresh
error-view instance (parent, siblings, and layout survive) receiving
`{ error, info, retry }` props — `retry()` reconstructs the original through
the Router's full same-location rebuild or the component parent's ordinary
refresh, holding the error view in place until the rebuild commits or fails
again, so a rebuild that never commits (a guard verdict, a supersession) leaves
the face up and the button pressable; never automatic, never recursive. Without
`errorView`, failures report and the position keeps its recovery placeholder.
Event handlers and formatters surface uncaught.

## Deliberately not shipped

No SSR server, hydration, lazy route loading (code splitting itself is the
opt-in `build.splitting`, D160),
named-route navigation, scoped slots, array refs, built-in virtual list,
per-module hot swap, Sass pipeline, event bus, global keyboard API, app-level
computed/settings/methods, or app-config devtools hook (the D100 bridge is
extension-injected, not config). Query fault-in left this list with D161:
tracked `findOne`/`findMany` now fault in automatically through the adapter
capability (in the codebase for 0.7.0).

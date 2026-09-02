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
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      0.6.0 sweep: header version, {#raw}, adapter.defaults() dispatch tier, --profile-build, pieces
      npm transport, splitting vs not-shipped list, SPA-default phrasing, formatters/manifest
      subpath — all reconciled against the release/0.6.0 code.
    sha: d74916a0e021b6bb86394551171838fbab161347
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Puzzle release surface

Compact inventory of what ships in `@magic-spells/puzzle` — kept current with
the released surface (0.7.0 as of this writing), not pinned to one version. [[DOC-SPEC]] remains the binding contract; this card is the map, not a
second specification. Decision cards hold rationale and git holds chronology.

## Package and application



- Root exports: `PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`,
  `PuzzleValidationError`, `lazy` (the D163 route-view loader marker), and
  compiler support exports (`ViewNode`, `SLOT_TAG`, `PORTAL_TAG`, and
  `SNIPPET_TAG` — the D166 snippet marker tag, with `isSnippet` on the ViewNode
  type surface).
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
- `puzzle` binary shim selects one of five optional platform binary packages:
  macOS and Linux on arm64/x64, and Windows on x64 (`puzzle-win32-x64`, whose
  packed file is `bin/puzzle.exe`). The packages are keyed the way Node spells
  the platform — `win32`, not Go's `windows` — because the shim looks them up
  by `process.platform`/`process.arch`. There is no `win32-arm64` package:
  Windows runs the x64 binary under emulation, so a `win32-arm64` HOST is folded
  onto the x64 package — by the shim's lookup table, by `puzzle upgrade`'s Go
  equivalent, and by that package's `cpu: ["x64", "arm64"]` so npm installs it
  there. Native ARM64 Node on Windows reports `arch === 'arm64'`, so all three
  are needed for the emulation story to actually hold. Anything else gets a
  Go-install fallback message.
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
- `<script>` is real JS. `lang="ts"` enables esbuild transpilation only — the
  build itself never type-checks. Type checking is the separate opt-in
  `puzzle check` command (D165), which runs the app's own `tsc` over emitted
  virtual files and reports diagnostics at real `.pzl` positions; editors still
  do not check `.pzl` script bodies, and the scaffolded TypeScript config
  covers standalone `.ts`/`.js` files and declarations.
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
  `<Slot/>` router outlets, unfilled-marker fallback bodies, and default-slot
  forwarding through component invocations. **Snippets (D166):** a caller-side
  `<Snippet fits="row" user group>…</Snippet>` declares a parameterized body
  (bare attributes are parameter declarations; `fits` routes it to a named
  slot, omitted fills the default position), and the component stamps it by
  handing values out through data attributes on its own markers
  (`<Slot name="row" user={ user }>`, `<Children user={ user }>`). Binding is by
  name, each stamp gets fresh vnodes, paired marker bodies remain fallbacks, and
  composition markers or `ref=` inside a snippet body are compile errors.
  `<Portal>…</Portal>` (D144) teleports children
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
- The vnode manager handles inline components, slots, snippets, SVG namespaces,
  controlled
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
  A tracked `findOne`/`findMany` that misses faults the read in through the
  adapter and re-runs `data()` until every read settles (D161); a committed
  `null` means the record does not exist.
- Server sync is opt-in: models keep a bare `static adapter` object of per-verb
  fetch functions; `endpoint` generates missing REST defaults, and endpoint is
  optional for a fully custom adapter (D158). Verb dispatch is model function →
  app-wide default (`adapter.defaults({ verb })`, passed as the capability) →
  endpoint-generated REST, with `{ type, endpoint }` context as the trailing
  argument. The collection verb is `loadMany`. The app imports the D157
  capability from
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


- Path routing (the inline default, D159), hash, and memory modes; nested
  relative children; index routes; catch-all routes; merged params; top-level
  layouts; route titles + managed head metadata (`meta`
  title/description/canonical/socialImage, per-field leaf→root inheritance
  with explicit-null suppression, D84). Delivery is split: the browser syncs
  `document.title` on every navigation, while the marked `<head>` tags are
  baked per page by the prerender and never touched at runtime (D111) — so
  they are inert in the default SPA build (no `output` key configured).
- `push`, `replace` (no history entry, scroll untouched by default, D83),
  `go`, `back`, and `forward`; guarded same-origin link interception;
  router base paths and anchors; `router.url()` + the built-in `link`
  formatter for mode-agnostic path-shaped hrefs.
- Route guards (D87): an inherited `guard` route field runs root→leaf before
  views construct or load — allow / block / redirect (replace semantics,
  loop-capped). SPA-runtime only; hybrid/static prerender passes warn on
  guarded routes.
- Lazy route views (D163): `lazy(loader)` from the package root marks a route
  `view` or `layout` as on-demand —
  `view: lazy(() => import('./views/Admin.pzl'))`. The marker is branded, so a
  bare loader function in a view position is a construction-time error naming
  `lazy()`; so is any other non-`PuzzleView` value. Markers resolve only after
  every guard allows the navigation (a blocked route never downloads), all in
  parallel across the matched chain, before construction and `data()`.
  Fulfillment is memoized for the app's lifetime and rejection never is, so
  retry re-invokes the loader; a failed load is an ordinary failed push
  reported as `phase: 'navigation'`, with URL and DOM untouched and no new
  loading UI — the previous view holds. Both prerender modes await the same
  markers and static per-page bundles carry the resolved classes.
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
  whole modules and code paths behind literal defines — `views/flip.js`
  (`__PUZZLE_HAS_FLIP__`), `views/portal.js` (`__PUZZLE_HAS_PORTAL__`), the
  D150 literal-`@` shim (`__PUZZLE_HAS_RAW_AT__`), `router/lazy.js`
  (`__PUZZLE_HAS_LAZY__`), and the D166 snippet expansion
  (`__PUZZLE_HAS_SNIPPETS__`) — so an app pays only for what it uses. Most are
  template facts; lazy is a script fact, so the scan reads the app's
  `.js`/`.ts` modules as well as its `.pzl` files (D111 retired the
  managed-head define, which was the scan's earlier and much looser reason to
  open a script). The fixture
  generator and mock adapter are excluded structurally instead (D98), as is
  the server adapter itself (D157): nothing imports `/fixtures` unless
  `puzzle dev|build --fixtures` generates the wiring, and nothing imports
  `/adapter` unless an app passes its capability (or fixtures needs its seam).
  Source maps are **opt-in** —
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
  `data-puzzle-static-data` island — plus, since D161, a second island carrying
  the build's settled read state so the page does not refetch what the build
  already resolved. Hybrid requires path routing (a
  hash/memory router would render home over every prerendered page — the build
  rejects it); static ignores `storage` with a warning (no persistence layer),
  and base-prefixes each page's module href under `routerBase` (D81).
- **Tooling, not app surface:** a `js/wasm` build of the parser and codegen
  (D164) exposes template diagnostics, generated JavaScript, scoped CSS, and
  warnings to the documentation-site playground behind a bounded worker
  protocol. It deliberately omits bundling, asset resolution, and TypeScript
  transformation, ships in no npm package, and adds nothing to an app's runtime
  or build.

## CLI

- `puzzle init` (`default`/`todos`, optional TypeScript project config).
- `puzzle dev`, `puzzle build`, and `puzzle build --static` / `--hybrid`.
- `puzzle check [dir]` (D165): type-checks the app's `.pzl` script bodies and
  template expressions by emitting virtual files under `.puzzle/check/` and
  running the app's own TypeScript over them — `node
  node_modules/typescript/bin/tsc --noEmit`, the same invocation on every OS —
  remapping every diagnostic to its authored `.pzl` line and column. TypeScript
  scripts are checked as written; JavaScript components get an unchecked script
  mirror plus a checked template wrapper. The generated tsconfig extends the
  app's, neutralizes the settings that would break the workspace, and switches
  shape for TypeScript 7 after probing `tsc --version`. A missing TypeScript
  install is an error naming `npm install -D typescript` — Puzzle never installs
  one — and a missing `node` on `PATH` its counterpart. `--js` is reserved and
  not yet implemented.
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


No SSR server, hydration, named-route navigation, array refs, built-in virtual
list, per-module hot swap, Sass pipeline, event bus, global keyboard API,
app-level computed/settings/methods, or app-config devtools hook
(the D100 bridge is extension-injected, not config). Three entries left this
list in 0.7.0: query fault-in with D161 (tracked `findOne`/`findMany` now fault
in automatically through the adapter capability), lazy route loading with D163
(`lazy()` marks a route `view`/`layout` as on-demand; `build.splitting`, D160,
remains the separate opt-in that makes each one a chunk), and scoped slots with
D166 (shipped as snippets — a caller-declared parameterized body the component
stamps per item). Route-level *link
preloading* — prefetching a route's chunk on hover or viewport entry — is still
not shipped, and neither is editor-level `.pzl` type checking: `puzzle check`
(D165) is a command, not a language service.

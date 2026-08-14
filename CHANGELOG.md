# Changelog

All notable changes to `@magic-spells/puzzle`. Dates are npm publish dates (UTC).

This project is pre-1.0. Per semver, **0.x minor bumps may contain breaking
changes** — and several have. Caret ranges do not cross 0.x minors, so
`^0.4.0` will not install `0.5.0`; upgrade the range explicitly.

Rationale for individual decisions lives in `constellation/decision/` as
numbered `Dnn` cards, referenced below.

## Upgrading across versions

Two breaking changes affect every app and are easy to miss on a multi-version
jump. Both are compile errors, so nothing fails silently.

**Composition markers are capitalized (0.4.0, D134).** Lowercase `<children/>`
and `<slot>` are no longer valid in any position:

| Before | After |
|---|---|
| `<children/>` | `<Children/>` |
| `<slot/>` in a component | `<Children/>` |
| `<slot/>` in a routed view or layout | `<Slot/>` |
| `<slot name="x"/>` | `<Slot name="x"/>` |

The call-site `slot="x"` **attribute** is unchanged — only the tags moved. Two
of the three errors name their replacement outright:

```
the default marker is spelled <Children/> since v1.64 (D134)
named slots are spelled <Slot name="…"/> since v1.64 (D134)
```

A bare `<slot>` is the one case the compiler cannot decide for you, because the
old spelling meant two different things depending on where it sat, so the error
offers both:

```
bare <slot> is not a marker — use <Children/> for call-site content
or <Slot/> for the router outlet (D134)
```

Pick `<Children/>` if that position received content from the call site, or
`<Slot/>` if it received a child route.

**`output: 'static'` changed meaning (0.2.0, D81).** If you set it before
0.2.0, rename it to `output: 'hybrid'` to keep the behavior you had. The name
`'static'` now produces a genuinely static site — no router, no `app.js`. This
one is *not* a compile error; it silently builds a different product.

## 0.6.0 — Unreleased

### Changed

- **BREAKING: hash and memory routing are imported factories (D159).**
  `routerMode` no longer takes a string. History routing stays the zero-config
  default (omit `routerMode`); hash and memory routing are opt-in imports from
  the new `@magic-spells/puzzle/router-modes` subpath, so a history-mode app
  no longer ships either mode's code — the fragment parsing, the entry stack,
  and their commit/click/scroll branches all tree-shake away.

  | Before | After |
  |---|---|
  | `routerMode: 'history'` | omit it |
  | `routerMode: 'hash'` | `routerMode: hashRouter()` |
  | `routerMode: 'memory'`, `routerInitialPath: '/x'` | `routerMode: memoryRouter({ initialPath: '/x' })` |

  ```js
  import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';
  ```

  A mode string is a constructor throw naming the import, so nothing fails
  silently. The `routerInitialPath` app-config field is removed —
  `memoryRouter({ initialPath })` replaces it (`createTestApp` still accepts
  `routerInitialPath` as its own option). `output: 'static'` no longer carries
  `routerMode` into a generated page at all; it was already ignored there.
- **BREAKING: error fallback UI is one app-level view (D145 amended).**
  `PuzzleView.errorContent(error)` — the per-view member returning hand-built
  `ViewNode` trees — is removed. Register one ordinary compiled view instead:
  `new PuzzleApp({ errorView: AppErrorView })`. On a framework-contained
  mount/refresh failure the failed view or component is replaced in place by a
  fresh error-view instance (parent, siblings, and layout survive) receiving
  `{ error, info, retry }` props; `retry()` re-runs the failed work through
  the normal pipeline (a same-location navigation for routed views, the
  owner's refresh for components), is single-flight, and never fires
  automatically. The error view's own failure reports once as
  `phase: 'error-view'` (replacing the old `boundary` phase) and never
  recurses. `onError` and the no-fallback default behavior are unchanged.
  Migration: move `errorContent()` markup into an `AppError.pzl` template and
  pass its class as `errorView`.

- **BREAKING: server sync is the opt-in `/adapter` subpath (D157).** The
  adapter — `loadAll`/`loadOne`, `record.save()`/`delete()`,
  `store.request()`/`upsert()`, and `PuzzleAdapterError` — moved out of the
  core store into `@magic-spells/puzzle/adapter`. Model declarations are
  unchanged from 0.5.0; keep the bare config object and enable the runtime once
  in the app config:

  ```js
  import { adapter } from '@magic-spells/puzzle/adapter';

  const app = new PuzzleApp({ target: '#app', routes, models, adapter });

  // models/todo.js — unchanged
  static adapter = { endpoint: '/api/todos' };
  ```

  The breaking migration is only for server-backed apps: add the imported
  `adapter` value to `new PuzzleApp(...)`, and import `PuzzleAdapterError` from
  `@magic-spells/puzzle/adapter` instead of the package root. Apps that never
  pass the capability ship none of the adapter (about −1.6 KB gzip on the
  reference apps); `record.save()` without it remains a plain `TypeError`.
  The `beforeRequest` hook and `/fixtures` mocking otherwise behave as before.

- **Adapters are fetch functions; REST is the shorthand (D158).** A model's
  `static adapter` may define any of the five transport functions directly.
  An `endpoint` now only generates defaults for missing verbs, so author
  functions win per verb and a fully custom adapter needs no endpoint. The
  framing is simple: define your fetch function; Puzzle keeps ownership of
  identity-preserving merge, revision guards, write ordering, persistence,
  and notifications.

  ```js
  // Standard REST: generates loadAll/loadOne/create/update/delete.
  static adapter = { endpoint: '/api/posts' };

  // Nonstandard URL, standard payload: return the Response.
  static adapter = {
    loadAll: (fetch) => fetch('/v2/posts?include=all'),
  };

  // Envelope API plus a custom method.
  static adapter = {
    endpoint: '/api/posts',
    async loadAll(fetch, options) {
      const query = new URLSearchParams(options);
      return (await (await fetch(`/api/posts?${query}`)).json()).data;
    },
    publish: (fetch, id) => fetch(`/api/posts/${id}/publish`, { method: 'PATCH' }),
  };
  ```

  The supplied `fetch` has the standard fetch signature and returns a normal
  `Response`; it additionally runs `beforeRequest` and uses the fixtures mock
  seam. Returning that `Response` from a framework verb asks Puzzle to check
  status, parse JSON, and apply the normal response guards. Returning parsed
  data is equally valid. `store.loadAll(type, options)` forwards pagination
  options to an author transport; the endpoint-generated default serializes
  them as a query string, and separate pages accumulate in the normalized
  store. `store.adapter(type)` exposes the same functions with enhanced fetch
  already bound, including custom methods. Using global `fetch` explicitly
  bypasses `beforeRequest` and fixture interception.

### Added

- **Opt-in SPA code splitting.** `build: { splitting: true }` makes every
  dynamic `import()` in the SPA bundle a lazy chunk under `dist/chunks/`
  instead of inlining it into `app.js`, so a heavy on-demand dependency is
  fetched only when its code path runs. Measured on a starter app with
  `chart.js` behind an `await import()`: `app.js` 263.4 KB → 63.6 KB
  (89.8 KB → 20.9 KB gzip), with the 199.3 KB remainder in one chunk; total
  shipped bytes are unchanged, because esbuild's ESM splitting has no
  chunk-loader runtime. The entry keeps its stable `app.js` name, so the shell
  HTML is untouched, and static imports behave exactly as before.

  Default OFF this release — with the key absent (or `null`, which means unset)
  every build emits the same single file it does today. While the flag is on,
  `chunks/` is a reserved output name and a root-level `public/chunks` asset
  fails the build, the same guard `app.js` has. `output: 'static'` ignores the
  flag: its per-page bundles already split, and its `app.js` never ships.
  `puzzle dev` splits too, pruning a re-hashed chunk's predecessor on every
  rebuild so a warm `dist/` never accumulates orphans.
- **Bundle composition in the build banner.** `puzzle build` now prints a
  largest-dependencies breakdown from esbuild's metafile and, in production,
  warns when a single dependency contributes more than 200 KB, pointing at
  `import()` + `build.splitting`. Your own code and the framework runtime are
  listed but never flagged — neither can move behind a dynamic import.
- **Embedded esbuild 0.19.11 → 0.28.2.** Nine minor versions of bundler fixes,
  including the ESM cross-chunk ordering work that makes splitting dependable.
  Output bytes shift slightly (the todos example's gzip figure moved 22.5 KB →
  22.4 KB); no API change.

- **Static raw template blocks (D150).** `{#raw}…{/raw}` disables Puzzle's
  brace lexer for author-written source, so JSON, JavaScript, CSS, and examples
  can contain literal `{ ... }`, `{#if}`, and formatter pipes. HTML inside the
  block still parses normally, blocks do not nest, and the first
  whitespace-tolerant `{/raw}` closes it. The body is static and cannot receive
  runtime values; dynamic raw-HTML injection remains deferred. Client and
  prerendered text round-trip identically, including `<` inside normal text and
  JSON-typed `<script>` elements.

## 0.5.0 — 2026-08-07

### Added

- **`<Portal>` (D144).** `<Portal>…</Portal>` teleports its children's DOM to a
  framework-created outlet at the app root while the subtree stays in the
  owner's component tree — same props, data flow, lifecycle, and teardown. For
  overlays that must escape ancestor CSS: containing blocks from
  `transform`/`filter`/`contain`, `overflow` clipping, and stacking contexts.
  It is empty in prerendered HTML, and `@event:outside` is portal-aware — a
  click inside a portaled panel does not read as "outside" its logical owner.

  **`<Portal>` is a capitalized marker in the D134 family**, recognized before
  component resolution, and it composes with the other markers:

  - `<Children/>` and `<Slot name="x"/>` work inside a `<Portal>` — a portaled
    subtree fills from the call site normally.
  - Lowercase `<portal>` gets the same positioned steering error the other
    lowercase spellings get.
  - Unlike `<Children/>` and `<Slot/>`, **`<Portal>` is paired-only** — a
    self-closing `<Portal/>` is a compile error, since a portal exists to carry
    children.
  - It is rejected inside a marker fallback body (the D141 rule) and inside an
    `island`.
  - Attribute-free: `to`/`name` are positioned compile errors, reserved for
    future named outlets.
  - Portal-in-portal is allowed.

  A `<Portal>` at a **component** template's root is a positioned compile error
  — the inline root is where call-site attributes merge and where the scoped
  style stamp lands, and a portal leaves only a comment placeholder locally, so
  there is no element to do either job. The error names the fix: wrap it in
  `<div style="display: contents">`. Portal-only components (toast stacks,
  slide-overs) hit this on the first try. A portal-only **view** is legal —
  views keep their `<puzzle-view>` root.

- **Error boundaries and app-level `onError` (D145).** Every
  framework-contained app error now reports through one funnel.
  `new PuzzleApp({ onError })` registers the hook; without one, the funnel
  replays the exact `console.error` the catch site used to make, so existing
  output is unchanged. Views may define `errorContent()` to render a fallback
  face instead of leaving a blank hole. The underlying D115/D136/D143 recovery
  and ownership semantics are unchanged — this gives them a reporting seam and
  a rendered fallback.

- **Implicit two-way form binding (D147).** A path-shaped `value=`/`checked=`
  (`ident` or `ident.ident`) on a plain form control synthesizes its own
  write-back handler — the one-line mirror `@input` handler is no longer
  needed:

  ```html
  <input value="{ draft.title }">          <!-- writes back on input -->
  <input type="checkbox" checked="{ todo.done }">
  ```

  Suppressed by an author `@input`/`@change`, static `readonly`/`disabled`, a
  non-path expression, a dynamic or excluded `type`, or a component tag.
  Number, checkbox, date kinds, and `<select>` commit on `change`; numeric `''`
  writes `null` and `NaN` is skipped; IME composition never mid-writes. Records
  write through validated `update()` (rejections report to `onError` with
  `phase: 'bind'`); bare locals write `setData` + refresh. `type()` is added to
  `@magic-spells/puzzle/testing` for driving bound controls in tests.

- **`puzzle preview` (D148).** `puzzle preview [dir] [--port N] [--strict-port]`
  serves an existing `dist/` the way a production host will, per resolved
  output mode: SPA gets history-API fallback; hybrid serves the prerendered page
  first and the shell otherwise; static gets clean URLs and a **real** 404
  (the built `404.html`), never the shell. No watcher, no SSE, no injection, no
  `dev.proxy` — the artifact is checked as it sits on disk. Default port 4000
  so it runs beside `puzzle dev`.

- **`puzzle dev` runs the real static pipeline (D148)** on an
  `output: 'static'` project, instead of serving it as an SPA. Hybrid projects
  continue to develop as the SPA.

- **`examples/overlays`**, a Portal showcase.

### Changed

- **Attribute namespaces are reserved (D147).** `bind:value`, or any other
  `prefix:name` attribute, is now a positioned compile error reserving that
  space for the grammar. `xml`, `xlink`, and `xmlns` are allowlisted.

- **`PORTAL_TAG` is a reserved script binding (D144),** alongside the existing
  `SLOT_TAG`. A module-scope binding or loop variable by that name in a `.pzl`
  `<script>` is a positioned compile error (D133).

- **`puzzle upgrade` targets the running CLI, not the current directory (D76).**
  It resolves its install context from the executable path rather than walking
  up from the cwd. Bumping a project's dependency is npm's job. Previously a
  globally installed CLI could run the package manager against an unrelated
  project and report success for a package it never wrote, while the stale CLI
  went untouched.

### Fixed

- **Reused ancestors join the atomic navigation commit (D146).** A gated
  navigation now either lands completely — URL, history, title, mounted tree,
  scroll save, **and** every reused ancestor's params, route snapshot, data,
  and store subscriptions — or changes nothing at all. This closes the last
  piece of state that sat outside the D61 commit window, and with it the
  D19/D30 soft violation where a failed navigation could leave a surviving
  layout showing destination params.

- **A payload key colliding with a computed getter no longer throws (D149).**
  Record assignment resolves each key along the prototype chain and drops any
  key whose resolved descriptor is a setter-less accessor, warning once per
  (model class, key) in development.

- **A `data()` commit that reverts a bound local key** now warns in development.

## 0.4.0 — 2026-07-28

### Breaking

- **Composition markers are capitalized (D134).** `<Children/>` for component
  default content, `<Slot name="x"/>` for a named slot, `<Slot/>` for the
  router outlet. **Lowercase `<children/>` and `<slot>` are no longer valid**
  in any position — each is a positioned compile error naming its replacement,
  except bare `<slot>`, where the error offers both candidates because the old
  spelling was ambiguous. See [Upgrading across versions](#upgrading-across-versions).

  | Before | After |
  |---|---|
  | `<children/>` | `<Children/>` |
  | `<slot/>` in a component | `<Children/>` |
  | `<slot/>` in a routed view or layout | `<Slot/>` |
  | `<slot name="x"/>` | `<Slot name="x"/>` |

  The call-site `slot="x"` attribute is unchanged. Capitalization now uniformly
  means "the framework resolves this tag": components from your imports,
  markers from the grammar.

- **Nullish interpolations render empty (D127).** `{ maybeNull }` rendered the
  literal text `null` and `{ maybeUndefined }` rendered `undefined`. Both now
  render nothing. If you were relying on the old output, interpolate an
  explicit fallback.

### Added

- **Marker fallback bodies (D141).** Markers accept a paired form whose body is
  fallback content, rendered only when nothing fills that position — supplied
  content replaces it entirely:

  ```html
  <Children>Save</Children>                        <!-- default call-site content -->
  <Slot name="footer"><button>OK</button></Slot>   <!-- named-slot fallback -->
  <Slot>No page selected</Slot>                    <!-- outlet: no child route -->
  ```

  Fallback bodies are ordinary template content — formatters, `{#if}`/`{#for}`,
  components, `{#svg}`. A self-closing marker has no fallback; an empty paired
  body means the same.

- **Dev-only performance profiling (D121/D122)** with zero production bytes.
  Separates render-function cost from diff/patch cost, counts actual DOM
  writes (a zero-mutation render is a wasted render), times `data()` and store
  flushes, and surfaces props bailouts, slot-only renders, and memo hit rates —
  reported over the DevTools protocol. All state lives in module WeakMaps; no
  fields are added to any runtime class, and the module folds away in
  production.

- **`benchmarks/`**, a production benchmark harness, and `examples/stress`
  (D128).

### Fixed

- **Hybrid prerender renders real route state (D142).** `router.current` is the
  page's route snapshot during prerender, so active-nav classes and `current.*`
  reads are correct in shipped HTML — crawlers and no-JS visitors see the same
  state the live app renders.
- **Prerendered pages survive a failed takeover (D140).** If the client mount
  throws, the prerendered content and its marker are restored — never a blank
  page.
- **Router focus no longer draws a focus ring (D139).** The transient focus
  stamp suppresses both channels (`outline` and `box-shadow`) for its lifetime,
  so keyboard navigation stops ringing the whole view.
- **`@event:once` detaches on spend**, including `:outside:once`'s
  document-level listener — zero listener cost after the single fire.
- **Params-only `replace()` no longer yanks focus per keystroke (D135).**
- **Enter animations and `mounted()` ordering converge on the anchor-race
  path (D136).**
- **`loadAll`/`loadOne` guard server records with no primary key (D137)** and
  merge through the per-field revision gate, so a background poll cannot wipe
  an in-flight edit (D138, D125 parity).
- **`mounted()` throw contract (D143).** Component-owned views destroy and
  remount on the next patch; router-owned views stay mounted on their committed
  route. Each console message names its outcome.
- **Reserved module-scope script bindings** are rejected with a positioned
  error instead of colliding silently (D133).
- **`save()` and `delete()` serialize behind one per-record write chain (D132),**
  so interleaved verbs cannot reorder.
- **Date formatters cache their `Intl` objects** (roughly 30x on repeated
  formatting).
- **Route-path shape has one owner (D126).** The router and the SSG classified
  and validated path shape independently with different rules; both now share
  `router/routePath.js`. Prerender output may no longer silently overwrite a
  public asset.
- **Async `data()` is serialized**, persistence batches its writes, and the
  SSG takeover path is kept out of plain SPA bundles (D130).

## 0.3.1 — 2026-07-25

Republish of the 0.3.0 feature set with correct registry metadata. No code
changes.

- **Fixes the broken 0.3.0 publish (D120).** The root package is now published
  as the packed tarball (`npm publish ./magic-spells-puzzle-<version>.tgz`),
  never as a directory publish, and `prepublishOnly` refuses the directory path
  outright. `npm run verify:published` inspects what the registry actually
  resolves against.

## 0.3.0 — 2026-07-25 — **deprecated, do not use**

This version installs the CLI shim with no platform binary: its registry
metadata carries no `optionalDependencies`, so `puzzle` exits 1 on every
machine. **Use 0.3.1**, which is the identical feature set correctly published.
The features below all ship in 0.3.1.

### Breaking

- **Production source maps are opt-in (D88).** Production builds emitted a
  linked `.js.map` unconditionally — roughly 468 KB beside the bundle on the
  todos example, exposing original source structure on any deploy. Set
  `build.sourceMap: true` to restore it.
- **Managed head tags are build-time only (D111).** `syncTags` is gone from the
  browser; `og:*`, `twitter:*`, and `canonical` are produced by the SSG at build
  time and baked per page into prerendered HTML. An SPA-only app that relied on
  these being applied at runtime will no longer see them. The tab title is
  unaffected — `syncTitle` still runs on every navigation in every mode.
- **`dev.proxy` rejects two prefix shapes at config load (D110):** `/` (the root
  proxy) and two keys that name the same route after trailing-slash
  normalization. The first was a documented feature; the second used to crash
  the dev server.
- **A bare `YYYY-MM-DD` is a calendar date (D114).** `date`, `time`, `datetime`,
  and `timeago` parse it as local midnight instead of the ES spec's
  UTC-midnight rule, and `in_timezone` passes it through untouched — a day names
  no instant. `{ post.publishedAt | date }` of `"2026-07-24"` now renders
  `07/24/2026` for every reader; previously anyone west of UTC saw `07/23/2026`.
  Values carrying their own time or zone are untouched.

### Added

- **`@magic-spells/puzzle/testing` (D94)** — `mountView`, `createTestApp`,
  `settled`, `measureRenders`, `installFakeAnimate`, `installFakeObserver`. A
  correct `settled()` is framework-owned knowledge: `data()` is async and
  last-wins, the store flush is rAF-scheduled with a `document.hidden` branch
  and a 220 ms fallback, navigation is load-then-atomic-commit, and jsdom ships
  neither WAAPI nor IntersectionObserver.
- **`@magic-spells/puzzle/fixtures` (D95/D98)** — `store.seed(type, n)`
  generates believable records from the schema alone, and
  `static adapter = { mock: … }` serves the adapter verbs from an in-memory
  collection with configurable latency and failure rate. Self-contained and
  self-attaching; bundled into an app only by the `--fixtures` flag on
  `puzzle dev` / `puzzle build`.
- **`beforeRequest` adapter hook (D91).** Every adapter fetch routes through one
  private `Store._fetch(url, init, context)`, and `beforeRequest` shapes the
  `init` before it goes out — auth headers, `credentials`, an `AbortSignal` —
  across the whole adapter surface at once. Previously the read path was a bare
  `fetch` with no init object, so an app with token auth could not use the D21
  read path at all.
- **Build errors appear in the browser (D92).** The reload channel carries typed
  events, the dev server retains the current error so late-connecting clients
  see it, and a first-ever failed build serves a self-healing error shell
  instead of a bare 404.
- **Router focus management and route announcement (D93).** After every
  committed navigation the router moves focus to the incoming view's root and
  announces the new title in a framework-owned live region. `focusBehavior`
  mirrors `scrollBehavior`: omit for the default, `false` to opt out, a function
  to choose the target.
- **DevTools runtime bridge (D100).** A dev-only bridge speaking a versioned
  wire protocol. The extension lives in its own repo,
  `magic-spells/puzzle-devtools`, and never imports framework internals. With no
  hook installed every touchpoint is a no-op and production DCE removes the
  module.
- **Feature-usage tree-shaking (D89)** driving runtime DCE defines.
- **`puzzle upgrade skills`**, and `puzzle add skills` asks before replacing an
  installed skill (D97/D99).

### Fixed

- **`store.findOne('post', this.params.id)` finds numeric-id records (D112).**
  The record map keys number primary keys by their string form via one helper
  applied at every id-keyed access. Record fields are never touched — a numeric
  server id stays a number on the record.
- **Static output always emits history-style hrefs (D117).** A configured
  `hash`/`memory` `routerMode` is warned as ignored rather than producing
  unusable links.
- **The SSG stops entity-escaping `<script>` and `<style>` contents (D113).**
- **Mount-failure recovery keys off the instance (D115);** preloaded views are
  exempt.
- **Lifecycle hook containment (D118).** Mount cycles carry a generation token
  so stale continuations bail, reveal hooks are guarded so content is never
  stranded, and `render() -> null` clears.
- **Router settlement (D119).** A double-click push returns the in-flight
  promise, and announcement falls back past an unchanged title.
- **CLI:** `generate --path` resolves symlinks, `pieces install` fails before
  writing, dead SPA route metadata warns, and `listenDev` validates the port
  range.

## 0.2.0 — 2026-07-24

### Breaking

- **`.pzl` section tags are singular.** `<scripts>` → `<script>`, `<styles>` →
  `<style>`. This includes `<script lang="ts">` and `<style scoped>`.
- **`output: 'static'` now means true static; the old behavior is
  `output: 'hybrid'` (D81).** The D67 mode — prerendered pages plus the full SPA
  bundle plus router takeover — is renamed `output: 'hybrid'` /
  `puzzle build --hybrid`, byte-identical. **If you were using
  `output: 'static'`, rename it to `'hybrid'` to keep the behavior you had.**

### Added

- **True static-pages output (D81).** `output: 'static'` emits per-route
  content-complete HTML with no router, no SPA takeover, and no history API —
  navigation is plain `<a>` page loads. Each page ships a small ES module that
  mounts only its own components over the prerendered markup.
- **Path-shaped links (D79).** `router.url(path)` encodes a path-shaped route
  into the mode-appropriate href — `/x` in history mode with the base prefix,
  `#/x` in hash mode with an in-fragment base, unchanged in memory mode — and
  the built-in `link` formatter exposes it to templates:
  `href="{ '/collections/' + c.id | link }"`. Closes the last seam where a `#`
  had to appear in app code.
- **Route guards (D87).** Any route node may declare `guard: fn`
  (`({ to, from, ctx }) => verdict`). A navigation runs every guard along the
  matched chain root → leaf, sequentially, first failure wins, before any
  view/layout construction and before the load gate. Guarding a top-level route
  locks its whole layout subtree with one declaration.
- **Route head management (D84)** — the four reserved `meta` fields, with
  `document.title` sync.
- **Router query snapshot and `replace()` (D83).**
- **`flip` attribute (D85)** — FLIP-animates keyed reorders,
  translation-only and reduced-motion aware.
- **`@event:outside` modifier (D86)** — document-capture outside-dismiss.
- **Compiler a11y warnings (D82).** Five template mistakes warn (never error)
  with exact source positions; generated JS is unaffected.
- **Dev port scan (D90).** A busy port is no longer fatal — `puzzle dev` binds
  the first free loopback port at or above `--port` (default 3000, at most 10
  candidates) and reports what it bound. `--strict-port` restores
  bind-or-fail.

## 0.1.2 — 2026-07-22

- **Embedded agent skill and `puzzle add skills` (D78).** The skill is
  self-contained — no external references.

## 0.1.1 — 2026-07-22

- **`puzzle init` prompts (D77)** — TTY-gated template and TypeScript
  selection.
- Datastore fixes.

## 0.1.0 — 2026-07-22

First public release. SPA-first browser runtime with a Go/esbuild compiler for
single-file `.pzl` components: reactive `data()`, a model/store layer with
adapters, relationships, schema validation, persistence, and write sync;
chainable display formatters; nested routing with layouts and outlets; morph
transitions; DOM islands; skeletons; and the `puzzle` CLI (`init`, `dev`,
`build`, `generate`, `add`, `doctor`, `info`).

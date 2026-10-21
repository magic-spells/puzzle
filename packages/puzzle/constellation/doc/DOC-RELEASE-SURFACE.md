---
name: Puzzle release surface
kind: reference
status: built
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
  - DECISION-D179-STATIC-PATHS
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
  - DECISION-D184-STORE-OBSERVE
notes:
  - kind: state
    text: >-
      Build and output: the usage-scan defines also include `__PUZZLE_HAS_LISTENER_OPTIONS__`
      (D187), set when any element listener writes `passive` or `capture`; off, the native-options
      branch compiles out.
---

# Puzzle release surface

Compact inventory of what ships in `@magic-spells/puzzle` on the current
release branch. [[DOC-SPEC]] is the binding contract; this card is the map.
Decision cards hold rationale; git and CHANGELOG.md hold history.

## Package

- **Root exports:** `PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`,
  `PuzzleValidationError`, `FormatterRegistry`, `lazy`, plus compiler-support
  exports a compiled module imports only when it emits them (`ViewNode`,
  `*_TAG` markers, `displayValue`, `listRows`, `loopItems`, `loopRange`,
  `urlValue`).
- **Subpaths** (each with `types/*.d.ts`):
  - `/adapter` — the frozen `adapter` capability (with `adapter.defaults()`,
    the app-wide dialect tier) and `PuzzleAdapterError`.
  - `/router-modes` — `hashRouter()`, `memoryRouter({ initialPath })`. Path
    routing is the inline default and needs no import.
  - `/morph` — `enableMorph(app, options)`.
  - `/ssg` — `prerender`, `prerenderToDir` and shell helpers the build drives.
  - `/static` — `mountStatic`, the per-page kernel for `output: 'static'`.
  - `/testing` — `mountView`, `createTestApp` (both take `i18n: { locale,
    strings }`), `settled`, `type` (drives a two-way-bound control),
    `measureRenders`, `installFakeAnimate`, `installFakeObserver`, and a
    re-export of `installFixtures`.
  - `/fixtures` — `installFixtures`, `uninstall`, `DEFAULT_FIXTURE_SEED`.
  - `/puzzle-env` — types only: the ambient `*.pzl` module shim.
  - Compiler-internal: `/formatters/manifest`, `/i18n/manifest`.
- **Binary:** the `puzzle` shim picks one of five optional platform packages
  (darwin/linux × arm64/x64, `win32-x64`) by Node's platform/arch;
  Windows-on-ARM folds onto x64. `pzlc` is the internal single-file compiler.
- **`packages/puzzle-lang`** (Go module, no npm package): `parser`, `expr`,
  `conformance` fixtures shared with Sites, `jsident`, `textutil`; tagged
  `packages/puzzle-lang/vX.Y.Z` beside each framework tag. A `js/wasm` build
  of parser + codegen feeds the docs playground only.

## Configuration

- **`new PuzzleApp({...})`:** `target`, `routes`, `models`, `formatters`
  (app functions), `apiURL`, `storage`, `adapter` (the `/adapter`
  capability), `beforeRequest`, `scrollBehavior`, `focusBehavior`,
  `routerMode` (a mode object; a string throws), `routerBase`,
  `transitionMode`, `beforeMount`, `mounted`, `beforeUnmount`, `onError`,
  `errorView`.
- **Route fields:** `path`, `view`, `layout` (class or `lazy()` marker),
  `children`, `guard`, `meta` (`title`/`description`/`canonical`/`socialImage`
  plus free custom keys; `title`/`description` may be `{ t: 'key' }`),
  `transitionMode`, `prerender: false`, `staticPaths` (build-only, leaf
  `:param` routes — see Build and output), `agent` (`false` or
  `{ name, about? }`, read only by `router.views` consumers — see Routing),
  `name` (informational — no named-route navigation).
- **`puzzle.config.js`:** `styles.use: ['tailwindcss']`, `build.dropConsole`
  (default true), `build.sourceMap` (default off; dev always has maps),
  `build.splitting` (default off), `dev.proxy` (path prefix → backend
  origin), `output` (`'hybrid'` | `'static'`; absent = SPA),
  `i18n: { locales, defaultLocale, routing?: 'prefix', detect?: boolean }`,
  `site` (the public origin, `'https://example.com'` — origin only; makes
  `hreflang` absolute and turns on the sitemap).

## Templates (`.pzl`)

- One `<puzzle-view>` template; optional `<script>`, `<style>`, and
  `<puzzle-skeleton min-duration="…">`. `<script>` is real JS; `lang="ts"` is
  transpile-only (type checking is `puzzle check`). `<style scoped>` uses
  native `@scope`; unscoped styles are global. `@/…` imports resolve from the
  app directory.
- **Expressions (D176):** one closed JavaScript-shaped grammar everywhere,
  parsed by `puzzle-lang/expr`: literals, names, `a.b` / `a?.b` / `a[i]`,
  arithmetic/comparison/logical operators, `??`, `?:`, arrow arguments, and
  calls to a library function, a method from the fixed string/list/number
  table, or an allowed global (`Math.*`, `Number`, `Object.keys`, …). The count
  is `.length`. `|`, `this`, `new`, `typeof`, bitwise, `**`, assignment,
  regex, `Date` and `JSON` are compile errors naming the alternative. Free
  names read `data()` fields or props (module bindings in `<Component>` `is` below); `event` is the DOM event only inside an
  `@event` handler.
- **Value semantics:** member steps and method calls compile to `?.`; a loop
  over a non-list runs zero times; `NaN`, ±Infinity and objects print nothing
  (dev warning); a list in a brace-only attribute is a space-joined token list.
- **Whitespace (D168):** runs collapse to one space; newline-bearing
  whitespace drops at a parent's edges and between non-text siblings, else is
  one space. `<pre>`/`<textarea>` keep their bytes. `\{` / `\}` escape a brace.
- Dynamic, mixed and boolean attributes; controlled `value`, `checked`,
  `disabled`, `selected`. Void elements take no closer (`</input>` is a compile
  error). Attr namespaces are a compile error except `xml`/`xlink`/`xmlns`.
- **Dynamic URL safety (D186):** a dynamic URL attribute (`href`, `src`,
  `action`, `srcset`, …) drops `javascript:`/`vbscript:` values, and `data:`
  outside image positions, after entity/control/case normalization — in the
  browser and prerendered HTML alike, with a development warning. Static
  author-written values stay as written; a mixed value whose literal head fixes
  the scheme (`href="/users/{ id }"`) compiles without the check.
- **Two-way binding:** a path-shaped `value=`/`checked=` on a plain form
  control writes back automatically (records via validated `update()`, locals
  via `setData`) unless an author `@input`/`@change`, static
  `readonly`/`disabled`, a dynamic `type`, or a component tag suppresses it.
- **Blocks:** `{#if}`/`{:else if}`/`{:else}`, `{#unless}`, `{#case}`/`{:when}`,
  `{#for item in items, i}` and range `{#for 1...5, i}` (`{#for i in 1...5}`
  is a steering error), `{#raw}…{/raw}` static raw markup, void
  `{#svg 'path'}` compile-time inline SVG, and comments `{## … }` /
  `{#comment}…{/comment}`.
- **Events:** `@event` handlers (bare or call) with `prevent`, `stop`,
  `once`, `outside`, `passive` and `capture` (native listener options, D187;
  `passive:prevent` is a compile error), and key filters on key events. A
  handler is the only door into the view's JavaScript; on a component it
  compiles to a callback prop.
- **Components (D167):** a tag whose first character is not ASCII `a`–`z` is
  a component (`<Card>`, `<Übersicht>`); `<straße-karte>` is a custom element.
  Names validate as `Ident('.'Ident)*`. A dotted tag (`<Frame.Wrapper>`)
  resolves lexically as a member expression — the component-family idiom,
  grouped by an `index.js` barrel (`export default Object.assign(Frame,
  { Wrapper })`).
- **Runtime component selection (D180):** `<Component is={ current }>` chooses an imported constructor; nullish is empty and children are its default slot. An explicit script map uses `is={ cards[key] }`. A swap destroys the outgoing instance and descendants before mounting with current props. Only `is` may read script bindings directly; other attrs, including ordinary `name`/`from` props, use data scope. `{...props}` spreads merge in written order, events are normal callback props, and `bind:` remains unsupported. `Component` is a reserved tag/family root with rename diagnostics. No registry or runtime module resolution; prerender emits selected HTML or nothing.
- **Composition:** `<Children/>` default content, `<Slot name="…"/>` named
  slots, bare `<Slot/>` router outlet; paired marker bodies are fallbacks.
  **Snippets:** caller-side `<Snippet fits="row" user>…</Snippet>` is a
  parameterized body the component stamps via `<Slot name="row" user={ u }>`
  or `<Children user={ u }>`; a snippet body is a leaf (no markers or `ref=`).
  `<Portal>…</Portal>` teleports children to an app-root outlet (empty in
  prerendered HTML, portal-aware `:outside`).
- `key` overrides list auto-keying; `ref="name"` binds `this.refs`; `island`
  makes element children browser-owned after mount; `flip` FLIP-animates keyed
  reorders (translation-only, reduced-motion aware).
- The compiler warns (never errors) on five a11y mistakes with positions.

## Function library

- 19 standard functions shared with Sites, plus PuzzleKit-only `link` and
  `timeago`. Numbers: `round`, `currency`, `percentage`,
  `number_with_delimiter`, `compact_number`. Text: `capitalize`, `truncate`,
  `strip_html`, `strip_newlines`, `pluralize` (prints count and word). Markup:
  `escape`, `raw`, `newline_to_br`. Values: `json`. Dates: `date`, `time`,
  `datetime` (presets `short`/`medium`/`long`/`iso`; defaults medium date,
  short time, medium date + short time) and `in_timezone`. Translation: `t`.
  `link(path, { locale })` takes `{ locale: 'es' }` or `{ locale: false }`
  under locale prefix routing.
- Calls nest (`{ truncate(capitalize(title), 40) }`). Apps register their own
  under the `formatters` config key (a standard name is overridable with a
  dev warning). A dropped library name passes through with a dev error naming
  the JS replacement.
- A bad literal date preset or `in_timezone` zone is a compile warning;
  dynamic ones are dev errors. Prerender prints locale-sensitive functions and
  `timeago` in the build machine's locale and `TZ` (or the page's i18n
  locale); the browser re-renders them in the viewer's.
- **`raw` and `newline_to_br`** must be the outermost call of a text
  interpolation (else a compile error) and lower to an HTML vnode. `raw`
  always runs one allowlist sanitizer in browser and prerender (no scripts,
  styles, embeds, SVG/MathML, `on*`, `style`; only relative, `http(s)`,
  `mailto:`/`tel:` URLs; `target="_blank"` gets `rel="noopener noreferrer"`).
- **Translations (D175):** `i18n` config plus `app/locales/<tag>.json`
  (nested keys flatten to dotted; CLDR-category objects are plurals). The
  build fills missing keys from the default (warning) and emits hashed
  `dist/locales/<tag>.*.json`; the browser fetches only the active locale
  (stored choice → `navigator.languages` → default; under prefix routing the
  URL decides). `ctx.i18n` / `app.i18n` expose `t`, `locale`, `locales`,
  `defaultLocale`, `dir` (`'rtl'`/`'ltr'`, also set as `<html dir>`), and
  `setLocale(tag)` (persists to `localStorage.__puzzleLocale`, sets
  `<html lang>`, rebuilds in place — or, under prefix routing, loads the same
  page under the other prefix). **`locales` is the switcher list `[{ locale,
  label, href, active }]`** — breaking: 0.8.0 returned `string[]`. Without
  prefix routing prerender uses the default locale. Date/number functions
  follow the active locale.

## Component runtime

- Two state layers: each successful `data()` result replaces the model layer;
  `setData()` writes a local layer that wins until the next model commit.
  Store/prop/route changes rerun `data()`; `setData()` alone does not. Async
  `data()` is last-wins. Skeletons show only on first load and may hold a
  minimum duration.
- Lifecycle: `created`, `mounted`, `beforeUpdate`, `afterUpdate(prev)`,
  `destroyed`, `viewWillShow`/`viewDidShow`, `viewWillHide`/`viewDidHide`.
  `prev` (D178, type `PrevViewState`) is a frozen shallow snapshot
  `{ props, params, route, data }` of the previous render; a record in it is
  the same live object. Live members: `this.route` (pre-commit-safe snapshot),
  `this.element`, `this.refs`, `this.memo()`, `getData()`, `setData()`,
  `refresh()`, `renderTick()`.
- **`this.renderTick()` (D188):** resolves once no store flush or view render is
  scheduled anywhere in the runtime, including the renders those schedule
  (timers in a hidden tab). Forces nothing, no timeout; does not wait for
  async `data()`, fetches or navigation — that is `app.idle()`.
- **Incremental rendering (D170):** item `{#for}` rows cache their vnode
  subtree per key and static subtrees build once. A record prop carries a
  render revision, so a child refreshes on that record's store mutations; a
  direct field assignment is not observed. Template functions must be pure.
- **Errors (D145):** `onError(error, { phase, view, route })` receives every
  contained error; `errorView` mounts in place of a failed view or component
  with `{ error, info, retry }` (retry re-runs the owner's rebuild; never
  automatic). Event-handler errors surface uncaught.
- **`app.idle({ timeout })` (D185):** resolves `true` once two consecutive
  frames find no mount or navigation in flight, no pending store flush or
  view render, no async `data()` running, no `setLocale()` switch loading and
  (with the adapter) no tracked find's fetch; `false` on timeout (default
  10000 ms, also used for a timeout that is not a finite number ≥ 0); never
  rejects. Timers in a hidden tab, where `setData()` renders also run
  on timers; `true` at once when not mounted. Observes existing state only,
  unlike `/testing`'s `settled()`, which drives work to a fixed point. It
  cannot see user timers, animations, IntersectionObserver triggers, writes
  or fetches nothing awaits (an event handler's unawaited `save()` or
  `loadMany()`), or a path- or hash-mode `back()`, `forward()` or `go()`
  before its `popstate` fires.
- **`ctx.idle(options?)` (D189):** the same method bound to the app, on every
  view's and component's `this.ctx`, so library components can wait for idle
  without holding the app.

## Data layer


- Schema builders: string, number, boolean, date, object, array, belongsTo,
  hasMany, with defaults, primary keys and required/min/max/oneOf/custom
  validation. Records are model instances (getters, methods, immutable
  primary keys); relationships are lazy tracked getters.
- Store queries inside `data()` auto-subscribe (batched, hidden-tab safe,
  torn down with the view). On an adapter-backed model, a tracked
  `findOne`/`findMany` miss fetches through the adapter and reruns `data()`
  until reads settle; a committed `null` means not found. Reads outside
  `data()` never fetch.
- `store.observe(type, [id,] fn)` watches a collection or one record from
  outside a view and returns an idempotent `stop()`; `fn()` runs once per
  batched flush, never fetches (D184). `store.flush()` delivers pending
  notifications now.
- **Model lookup (D189):** `store.modelFor(type)` returns the registered
  model class (`PuzzleModel` for an unknown type); static
  `Model.primaryKey()` names its primary field (default `'id'`). Never
  subscribes or fetches; works through a view's adapter store handle too.
- **Server sync is opt-in** via the `/adapter` capability passed once to
  `PuzzleApp`. A model's `static adapter` holds per-verb fetch functions
  (`endpoint` generates REST defaults); dispatch is model function →
  `adapter.defaults()` → generated REST. The collection verb is `loadMany`.
  Writes carry revision/collision/destroy guards and `PuzzleAdapterError`s.
- `beforeRequest(init, { type, method, url })` is a synchronous hook on the
  one internal fetch seam (adapter transports, `store.request()`) for headers,
  `credentials`, or a signal. Raw `fetch` bypasses it.
- **Fixtures:** `installFixtures(config)` adds deterministic
  `store.seed(type, n, overrides)` and a mock adapter (`mock: { data,
  latency, failRate, fail, handler }`) behind the `/adapter` network seam.
  Ships only under `--fixtures` or a test import.
- Optional `storage` persistence is fail-soft. Assignment rejects
  prototype-pollution keys.

## Routing and motion

- Path (default), hash and memory modes; nested relative children, index and
  catch-all routes, merged params, layouts, `routerBase`, anchors. Snapshot
  carries `path`, `pathname`, frozen `query` (repeated keys → arrays) and
  `hash`; query never merges into params.
- `push`, `replace` (no history entry), `go`, `back`, `forward`; same-origin
  link interception; `router.url(path, options?)` / `link('/x')` for
  mode-agnostic hrefs.
- **Navigation result (D182):** `push()`/`replace()` resolve
  `{ ok: true, route, catchAll?, redirectedFrom? }` or
  `{ ok: false, reason: 'blocked' | 'superseded' | 'not-found' | 'error', error? }`
  and never reject; a push deferred from `mounted()` resolves when it runs.
  `catchAll: true` marks a landing on the `*` route (D189), which stays
  `ok`; `'not-found'` means no match and no catch-all.
- **Route views (D183):** `router.views` lists every leaf route (catch-all
  excluded) as frozen `{ path, params, name, meta, title, agent, chain }`,
  built once on first read. The top-level `agent` route field — `false` or
  `{ name, about? }` — resolves nearest-defined leaf→root (a parent's `false`
  hides its subtree; a child's own object re-exposes it). The router and
  prerender never act on it; development checks validate it, warn on
  duplicate names, and list undescribed leaves once any route uses it.
- **Locale URL prefixes (D177):** `i18n.routing: 'prefix'` (path routing
  only) puts every non-default locale under `/<tag>` (default unprefixed).
  App paths stay locale-free; `link()`/`router.url()` add the active prefix,
  `{ locale: 'es' }` forces one, `{ locale: false }` skips it. A link into
  another locale is a full page load. Default-locale pages redirect a
  first-time visitor to their language once (`i18n.detect: false` opts out).
- Load-then-commit navigation: URL, title, view, scroll and reused-ancestor
  state commit atomically; failed or superseded pushes change nothing.
- **Guards:** inherited `guard` runs root→leaf before views load; allow /
  block / redirect (replace, loop-capped). SPA only; prerender warns on
  guarded routes.
- **Lazy views:** `view: lazy(() => import('./views/Admin.pzl'))` (also
  `layout`); a bare loader is a construction error. Loads start after guards
  allow, in parallel; success is memoized, a failure is not (retry
  re-invokes); a failed load is a failed push (`phase: 'navigation'`).
  Prerender awaits them.
- **Head:** `document.title` syncs on every navigation; `meta` fields resolve
  leaf→root per field (`null` suppresses an inherited value); a `{ t: 'key' }`
  title/description translates. The managed description/canonical/social tags
  and `hreflang` alternates are baked by the prerender only, so they are inert
  in a plain SPA build.
- `scrollBehavior`: scroll-to-top, pop restoration, session persistence,
  custom function or `false`. `focusBehavior` (same shape): each committed
  navigation focuses the incoming view root and announces the title in an
  `aria-live` region.
- Transitions are sequential by default; `transitionMode: 'overlap'` resolves
  route → view/layout → app. WAAPI enter/leave animations (including
  `trigger: 'visible'`) are failure-safe and reduced-motion aware. Morph
  (`/morph`) handles paired, cross-view and skeleton-delayed targets.

## Build and output


- Production: ES2022, minified, console stripped by default, tree-shaken
  function manifest, collected CSS. A usage scan over the project's `.pzl` and
  `.js`/`.ts`, plus the `.pzl` files of installed packages that list
  `@magic-spells/puzzle` in `peerDependencies` or `dependencies` (D89), and
  config facts gate optional runtime behind literal defines —
  `__PUZZLE_HAS_FLIP__`, `_PORTAL__`, `_RAW_AT__`, `_RAW_HTML__`,
  `_RAW_SANITIZE__`, `_LAZY__`, `_SNIPPETS__`, `_I18N__`, `_LOCALE_ROUTING__`.
  A compiled `.pzl` the scan never read that needs a compiled-out feature or
  function fails the build, naming the file. Pre-compiled component packages
  are unsupported. Fixtures and the adapter are excluded structurally: nothing
  imports them unless wired.
- `build.splitting` makes each dynamic `import()` a chunk under
  `dist/chunks/` (a reserved name while on); `output: 'static'` ignores it;
  dev prunes stale chunks.
- In production `build.hashNames` defaults to the configured splitting value: app
  entry/JS-imported CSS, the composed stylesheet and static page modules get
  content-derived names; false opts out and true enables hashing without splitting.
  Shell references follow emitted names. Split SPA/hybrid shells and all production
  static pages preload their transitive static-import chunks, excluding lazy/external
  edges (D181). Public files and all development output retain their names. The size
  banner lists per-dependency bytes and
  warns past 200 KB for one dependency in production.
- Tailwind-first styles. Public assets copy with case-insensitive collision
  checks against generated names. One-shot builds stage and atomically swap
  `dist/`, keeping the last good build on failure.
- **Output modes** (no SSR server or hydration): SPA by default.
  `output: 'hybrid'` prerenders pages one shared app entry (fixed or hashed) takes over (path
  routing required). `output: 'static'` ships no router or `app.js`: one
  `dist/_puzzle/<slug>.js` (or `<slug>-[hash].js`) per page with build data and settled read state
  inlined; `storage` is ignored. Both write directory-style pages plus
  `404.html`, skip a `:param` route without `staticPaths` with a warning, and
  honor `prerender: false`. Under prefix routing every page is written once per
  locale (`dist/<tag>/…`, each with its own `lang`/`dir` and table) with
  `hreflang` alternates; a literal root-relative `<a href>` warns. With
  `site`, a prerendering build writes `dist/sitemap.xml`.
- **`staticPaths` (D179):** a leaf `:param` route lists its pages for both
  prerender modes — an array of params objects, a build-time function
  (`{ store, config, locale? }`, once per locale), or a model name. One page
  per entry; static pages of a route share one module. Types:
  `StaticPathsEntry`, `StaticPathsContext`, `StaticPathsFn` (root export).
- **Dev server:** incremental rebuilds, warm Tailwind, port 3000 (scans
  upward), SPA fallback, SSE reload; static projects rebuild + prerender per
  change. Build errors show in the browser. Installing or changing a package
  needs a restart (the watcher covers the project only). Reload preserves store records and
  JSON-safe local view state. The DevTools bridge attaches to an
  extension-injected `window.__PUZZLE_DEVTOOLS_HOOK__`. None ships in
  production.

## CLI

- `puzzle init <name>` — `--template default|todos`, `--dir`,
  `--typescript` (or the TTY prompt): `<script lang="ts">` components,
  `app/app.ts` entry, strict `tsconfig.json`, `typescript` devDependency and
  a `check` script.
- `puzzle dev [dir]` — `--port` (3000), `--strict-port`, `--fixtures`,
  `--profile-build`. `puzzle build [dir]` — `--mode production|development`,
  `--static`, `--hybrid`, `--fixtures` (not with prerender), `--profile-build`
  (or `PUZZLE_PROFILE_BUILD=1`). Entry is `app/app.ts` else `app/app.js`
  (both is an error); `--fixtures` wires `app/fixtures.js|ts` first. Both
  stop early when `@magic-spells/puzzle` is not installed.
- `puzzle preview [dir]` — `--port` (4000), `--strict-port`; serves `dist/`
  with production-host semantics per output mode (a static miss serves
  `dist/<first-segment>/404.html` before the root one).
- `puzzle check [dir]` — type-checks `.pzl` scripts and template
  expressions via virtual files in `.puzzle/check/` and the app's own
  `node node_modules/typescript/bin/tsc --noEmit`, remapping diagnostics to
  `.pzl` positions; the generated tsconfig extends the app's. Missing
  TypeScript or `node` is a named error (Puzzle never installs TypeScript).
  `--js` is reserved.
- `puzzle generate|g <component|view|layout|model> <Name>` — `--path`,
  `--force`, `--family A,B` (component only: a directory with one stub per
  member and an `index.js` barrel; members PascalCase, unique, not the root or
  a marker name; all-or-nothing). A `tsconfig.json` at the project root makes
  every stub TypeScript (`index.ts` barrel, `app/models/<name>.ts`).
- `puzzle add tailwind | piece <name…> | theme [name…] | skills` — `--registry`
  (`npm:pkg[@version]`, local dir, or HTTPS; else `$PUZZLE_PIECES_REGISTRY`,
  else `npm:@magic-spells/puzzle-pieces` at the CLI's major.minor with an
  older-only fallback), `--pieces-version`, `--overwrite`, `--dir`,
  `--skill-root <dir>` (repeatable).
  - `piece` copies pieces with their dependencies and records hashes in
    `pieces.lock`; nested `files` paths install path-preserving (families);
    manifest `dependencies` carry npm version floors, printed as one merged
    `npm install` line. Never runs npm or edits `styles.css`.
  - `theme` lists palettes or copies one (default → `app/styles/pieces.css`,
    others → `app/styles/themes/<name>.css`); a locally modified copy needs
    `--overwrite`.
  - `skills` (alias `skill`) installs the embedded agent skill into detected
    `~/.claude` / `~/.codex` / `~/.cursor` dirs, version-stamped.
- `puzzle upgrade [--check]`; `puzzle upgrade skills` refreshes existing
  skill installs. A successful upgrade offers the same refresh. `dev`/`build`
  show a passive TTY-only update notice from a cached answer refreshed by a
  detached helper (opt out `PUZZLE_NO_UPDATE_CHECK=1`; skipped in CI).
- `puzzle doctor [dir]`, `puzzle info [dir]`, `puzzle --version`.

## Not shipped

SSR server, hydration, named-route navigation, route link preloading, array
refs, a built-in virtual list, per-module hot swap, Sass, an event bus, a
global keyboard API, app-level computed/settings/methods, a config-level
devtools hook, and editor-level `.pzl` type checking (`puzzle check` is a
command, not a language service).

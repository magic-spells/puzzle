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
  - DECISION-D179-STATIC-PATHS
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
  - DECISION-D184-STORE-OBSERVE
verified_at: '2026-11-01T19:28:56.040Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Puzzle release surface

What `@magic-spells/puzzle` ships on the current release branch, as a map. [[DOC-SPEC]] is the binding contract (cited as `§N`); decision cards hold the rationale.

## Package

- **Root exports:** `PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`, `PuzzleValidationError`, `FormatterRegistry`, `lazy`. Compiler-support exports a compiled module imports only when it emits them: `ViewNode`, `SLOT_TAG`/`SNIPPET_TAG`/`PORTAL_TAG`, `displayValue`, `urlValue`, `listRows`/`loopItems`/`loopRange`, `dynamicComponent`. Root types include `NavigationResult`, `PrevViewState`, `RouteView`, `StaticPathsEntry`/`StaticPathsContext`/`StaticPathsFn`.
- **Subpaths** (each typed in `types/*.d.ts`):
  - `/adapter` — the frozen `adapter` capability (`adapter.defaults()` is the app-wide dialect tier) and `PuzzleAdapterError`. Also exports untyped read-state helpers the static build uses.
  - `/router-modes` — `hashRouter()`, `memoryRouter({ initialPath })`. Path routing is the default and needs no import.
  - `/morph` — `enableMorph(app, options)`.
  - `/ssg` — `prerender`, `prerenderToDir`, `enumerateRoutes` and the shell injectors the build drives.
  - `/static` — `mountStatic`, the per-page kernel for `output: 'static'`.
  - `/testing` — `mountView`, `createTestApp` (both accept `i18n: { locale, strings }`), `settled`, `type`, `measureRenders`, `installFakeAnimate`, `installFakeObserver`, and a re-export of `installFixtures`.
  - `/fixtures` — `installFixtures`, `uninstall`, `DEFAULT_FIXTURE_SEED`.
  - `/puzzle-env` — types only: the ambient `*.pzl` module shim.
  - Build-replaced: `/formatters/manifest`, `/i18n/manifest`.
- **Binary:** the `puzzle` shim (`bin/puzzle.js`) picks one of five optional platform packages (darwin/linux × arm64/x64, `win32-x64`; Windows on ARM uses x64). `pzlc` is an internal single-file compiler for tests and tooling.
- **`packages/puzzle-lang`** (Go module, no npm package): `parser`, `expr`, `conformance`, `jsident`, `textutil`; tagged `packages/puzzle-lang/vX.Y.Z` beside each framework tag. `expr` also serves the Sites dialect's `|` pipes behind `Options.Pipes`. A `js/wasm` build of parser + codegen feeds the docs playground only ([[COMPONENT-PLAYGROUND-COMPILER]]).

## Configuration

- **`new PuzzleApp({...})`** (§2): `target`, `routes`, `models`, `formatters` (app functions), `apiURL`, `storage`, `adapter` (the `/adapter` capability), `beforeRequest`, `scrollBehavior`, `focusBehavior`, `routerMode` (a mode object; a string throws), `routerBase`, `transitionMode`, `beforeMount`, `mounted`, `beforeUnmount`, `onError`, `errorView`.
- **Route fields** (§9): `path`, `view`, `layout` (class or `lazy()` marker), `children`, `guard`, `meta` (`title`/`description`/`canonical`/`socialImage` plus free keys; `title`/`description` may be `{ t: 'key' }`), `transitionMode`, `prerender: false`, `staticPaths` (build-only, leaf `:param` routes), `agent` (`false` or `{ name, about? }`), `name` (informational; there is no named-route navigation).
- **`puzzle.config.js`** (§2, read by `compiler/internal/config`): `styles.use: ['tailwindcss']`; `build.dropConsole` (default true), `build.sourceMap` (default off; dev always has maps), `build.splitting` (default off), `build.hashNames` (default on in production); `dev.proxy` (path prefix → backend origin); `output` (`'hybrid'` | `'static'`; absent = SPA); `i18n: { locales, defaultLocale, routing?: 'prefix', detect?: boolean }`; `site` (public origin only; makes `hreflang` absolute and turns on the sitemap).

## Templates (`.pzl`)

Contract: §3–§6, §17, §18, §24, §28, §31, §43, §47, §57, §64–§67; the shared language is [[DOC-LANGUAGE-CORE]].

- One `<puzzle-view>` template; optional `<script>`, `<style>`, `<puzzle-skeleton min-duration="…">`. `<script>` is real JS; `lang="ts"` is transpile-only (`puzzle check` type-checks). `<style scoped>` uses native `@scope`. `@/…` imports resolve from `app/`.
- **Expressions** ([[DECISION-D176-EXPRESSION-LANGUAGE]]): one closed JavaScript-shaped grammar parsed by `puzzle-lang/expr` — literals, names, `a.b`/`a?.b`/`a[i]`, arithmetic, comparison, logical, `??`, `?:`, arrow arguments, and calls to a library function, a method from the fixed string/list/number table, or an allowed global (`Math.*`, `Number`, `Object.keys`, …). The count is `.length`. `|`, `this`, `new`, `typeof`, bitwise, `**`, assignment, regex, `Date` and `JSON` are compile errors naming the alternative. Free names read `data()` fields or props; `event` exists only inside an `@event` handler.
- **Value semantics** ([[DECISION-D173-CORE-SEMANTICS]]): every member step and method call is `?.`-guarded; a loop over a non-list runs zero times; `NaN`, ±Infinity and objects print nothing (dev warning); a list in a brace-only attribute is a space-joined token list.
- **Whitespace** ([[DECISION-D168-TEXT-RUN-WHITESPACE]]): runs collapse to one space; newline-bearing whitespace drops at a parent's edges and between non-text siblings. `<pre>`/`<textarea>` keep their bytes. `\{` / `\}` escape a brace.
- Dynamic, mixed and boolean attributes; controlled `value`, `checked`, `disabled`, `selected`. Void elements take no closer. Attribute namespaces are compile errors except `xml`/`xlink`/`xmlns`.
- **Dynamic URL safety** (D186): a dynamic URL attribute drops `javascript:`/`vbscript:` values, and `data:` outside image positions, in the browser and prerendered HTML alike. Static values and mixed values whose literal head fixes the scheme compile without the check.
- **Two-way binding** (D147): a path-shaped `value=`/`checked=` on a plain form control writes back (records via validated `update()`, locals via `setData`) unless an author `@input`/`@change`, static `readonly`/`disabled`, a dynamic `type`, or a component tag suppresses it.
- **Blocks:** `{#if}`/`{:else if}`/`{:else}`, `{#unless}`, `{#case}`/`{:when}`, `{#for item in items, i}`, range `{#for 1...5, i}`, `{#raw}…{/raw}`, void `{#svg 'path'}`, comments `{## … }` and `{#comment}…{/comment}`.
- **Events:** `@event` handlers with `prevent`, `stop`, `once`, `outside`, `passive`, `capture` and key filters. On a component, `@event` is a callback prop.
- **Components:** a tag whose first character is not ASCII `a`–`z` is a component; names validate as `Ident('.'Ident)*`. A dotted tag (`<Frame.Wrapper>`) is a family member, grouped by an `index.js` barrel ([[DECISION-D167-COMPONENT-FAMILIES]]).
- **`<Component is={ … }>`** ([[DECISION-D180-COMPONENT-SLOT]]): picks one constructor the file imports; nullish renders nothing; children are its default slot. `Component` is a reserved tag/family root.
- **Composition:** `<Children/>`, `<Slot name="…"/>`, bare `<Slot/>` router outlet; paired marker bodies are fallbacks. `<Snippet fits="row" user>…</Snippet>` passes a parameterized body the component stamps through `<Slot name="row" user={ u }>` or `<Children user={ u }>`. `<Portal>…</Portal>` renders into an app-root outlet.
- `key`, `ref="name"` (`this.refs`), `island`, `flip`. The compiler warns (never errors) on five a11y mistakes.

## Function library

[[DECISION-D174-FUNCTION-LIBRARY]], [[COMPONENT-FORMATTERS]].

- 19 standard functions shared with Sites — `round`, `currency`, `percentage`, `number_with_delimiter`, `compact_number`, `capitalize`, `truncate`, `strip_html`, `strip_newlines`, `pluralize`, `escape`, `raw`, `newline_to_br`, `json`, `date`, `time`, `datetime`, `in_timezone`, `t` — plus PuzzleKit-only `link` and `timeago`.
- Calls nest. Apps register their own under the `formatters` config key; overriding a standard name warns in dev. A removed library name is a dev error naming the JS replacement.
- `raw` and `newline_to_br` must be the outermost call of a text interpolation. `raw` always runs the allowlist sanitizer (`client-runtime/sanitize.js`).
- **Translations** ([[DECISION-D175-TRANSLATIONS]], D177): `i18n` config plus `app/locales/<tag>.json`; the build emits hashed `dist/locales/<tag>.*.json` and the browser fetches only the active locale. `ctx.i18n` / `app.i18n` expose `t`, `locale`, `locales` (the switcher list `[{ locale, label, href, active }]`), `defaultLocale`, `dir`, and `setLocale(tag)` (persists to `localStorage.__puzzleLocale`).

## Component runtime

- Two state layers: each `data()` result replaces the model layer; `setData()` writes a local layer that wins until the next model commit. Async `data()` is last-wins. Skeletons show only on first load.
- Lifecycle: `created`, `mounted`, `beforeUpdate`, `afterUpdate(prev)` (D178), `destroyed`, `viewWillShow`/`viewDidShow`, `viewWillHide`/`viewDidHide`. Members: `this.route`, `this.element`, `this.refs`, `this.ctx`, `memo()`, `getData()`, `setData()`, `refresh()`, `renderTick()` (D188).
- Incremental rendering ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]): keyed rows and static subtrees are cached; a record prop carries a render revision.
- Errors (§60): `onError(error, { phase, view, route })` and an app-level `errorView` with `{ error, info, retry }`.
- `app.idle({ timeout })` (D185) resolves `true` when the app is quiet, `false` on timeout (default 10000 ms), never rejects; `ctx.idle()` (D189) is the same method on every view's context.

## Data layer

§7, §8, §20–§22, §49, §52, §58, §61.

- Schema builders: `string`, `number`, `boolean`, `date`, `object`, `array`, `belongsTo`, `hasMany`, with defaults, primary keys and `required`/`min`/`max`/`oneOf`/custom validation.
- Store queries inside `data()` auto-subscribe. On an adapter-backed model a tracked `findOne`/`findMany` miss fetches and reruns `data()` until reads settle ([[DECISION-D161-AUTO-FETCHING-FINDS]]). Reads outside `data()` never fetch.
- `store.observe(type, [id,] fn)` (D184), `store.flush()`, `store.modelFor(type)` (D189), static `Model.primaryKey()`.
- Server sync is opt-in through `/adapter`: per-verb model fetch functions, `endpoint` REST defaults, `adapter.defaults()`; dispatch is model function → app default → generated REST. The collection verb is `loadMany`. `beforeRequest(init, { type, method, url })` is synchronous.
- Fixtures: `installFixtures(config)` adds `store.seed(type, n, overrides)` and a mock adapter (`mock: { data, latency, failRate, fail, handler }`). Ships only under `--fixtures` or a test import.
- `storage` persistence is fail-soft.

## Routing and motion

§9, §14, §15, §19, §23, §26, §30, §33, §44, §45, §48, §51, §62.

- Path (default), hash and memory modes; nested routes, index and catch-all routes, layouts, `routerBase`. The snapshot carries `path`, `pathname`, frozen `query`, `hash`, `params`, `route`, `chain`.
- `push`, `replace`, `go`, `back`, `forward`; same-origin link interception; `router.url(path, options?)` and the `link` function. `push`/`replace` resolve a never-rejecting `NavigationResult` (D182; `catchAll: true` per D189).
- `router.views` and the `agent` route field (D183).
- Locale URL prefixes: `i18n.routing: 'prefix'` (path routing only) (D177).
- Load-then-commit navigation; inherited `guard` (SPA only); `lazy()` views and layouts.
- Head: `document.title` syncs on every navigation; description/canonical/social tags and `hreflang` are prerender-only.
- `scrollBehavior`, `focusBehavior`; sequential or `overlap` transitions; WAAPI enter/leave animations including `trigger: 'visible'`; `/morph`.

## Build and output

§13, §27, §36, §50, §53–§56, §59, §63.

- Production: ES2022, minified, console stripped by default, tree-shaken function manifest, collected CSS. A usage scan ([[DECISION-D89-FEATURE-USAGE-TREESHAKE]]) over the app's `.pzl`/`.js`/`.ts` and installed packages' `.pzl` gates optional runtime behind defines: `__PUZZLE_HAS_FLIP__`, `_PORTAL__`, `_RAW_AT__`, `_RAW_HTML__`, `_RAW_SANITIZE__`, `_LAZY__`, `_SNIPPETS__`, `_COMPONENT_SLOT__`, `_CONDITIONAL_SLOT__`, `_LISTENER_OPTIONS__`, plus the config facts `_I18N__` and `_LOCALE_ROUTING__`. A compiled `.pzl` the scan never read that needs a compiled-out feature fails the build.
- `build.splitting` puts each dynamic `import()` in `dist/chunks/`; `output: 'static'` ignores it.
- `build.hashNames` ([[DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD]]): on by default in production, `false` opts out. Unset, a file the shell does not reference keeps its fixed name with a warning; an explicit `true` fails instead. Static-import chunks get modulepreloads.
- The size banner reports per-dependency bytes and warns past 200 KB for one dependency.
- Tailwind-first styles; public assets copy with case-insensitive collision checks; one-shot builds stage and atomically swap `dist/`.
- Output modes (no SSR server, no hydration): SPA by default; `output: 'hybrid'` prerenders pages the SPA takes over (path routing required); `output: 'static'` ships no router or `app.js`, one module per page under `dist/_puzzle/`. Both write directory-style pages and `404.html`, honor `prerender: false` and `staticPaths` ([[DECISION-D179-STATIC-PATHS]]), write per-locale pages under prefix routing, and write `dist/sitemap.xml` when `site` is set.
- Dev server: incremental rebuilds, port 3000 scanning upward, SPA fallback, SSE reload, browser build-error overlay, state-preserving reload, and the DevTools bridge (`window.__PUZZLE_DEVTOOLS_HOOK__`). None of it ships in production.

## CLI

Commands live in `compiler/cmd/puzzle`. Global: `--no-color`; `puzzle version` = `--version` = `-v`.

- `puzzle init [app-name|path]` — `-t/--template default|todos`, `-y/--yes`, `--typescript`.
- `puzzle dev [dir]` — `-p/--port` (3000), `--strict-port`, `--host`, `-o/--open`, `--fixtures`, `--profile-build`.
- `puzzle build [dir]` — `-m/--mode production|development`, `--static`, `--hybrid`, `--fixtures` (not with prerender), `-q/--quiet` (skips the summary, page report and update notice), `--profile-build` (or `PUZZLE_PROFILE_BUILD=1`). Entry is `app/app.ts` else `app/app.js`; both is an error.
- `puzzle preview [dir]` — `-p/--port` (4000), `--strict-port`, `--host`.
- `puzzle check [dir]` — type-checks `.pzl` with the app's own `node node_modules/typescript/bin/tsc`; `--js` is reserved and hidden.
- `puzzle generate|g <component|view|layout|model> <Name>` — `--path`, `-f/--force`, `--dir`, `--family A,B` (component only).
- `puzzle add tailwind | piece <name…> | theme [name…] | skills` — `--registry`, `--pieces-version`, `-f/--force`, `-y/--yes`, `--dir`, `--skill-root <dir>` (repeatable).
- `puzzle upgrade [--check] [-y]`, `puzzle upgrade skills`; `dev`/`build` show a TTY-only update notice (`PUZZLE_NO_UPDATE_CHECK=1` opts out; skipped in CI).
- `puzzle doctor [dir]`, `puzzle info [dir]` (both `--json`).
- Hidden compatibility aliases: `init --dir`, `add --overwrite`.

## Not shipped

SSR server, hydration, named-route navigation, route link preloading, array refs, a built-in virtual list, per-module hot swap, Sass, an event bus, a global keyboard API, app-level computed/settings/methods, a config-level devtools hook, editor-level `.pzl` type checking. Rationale for each is in DOC-SPEC's deferred list.

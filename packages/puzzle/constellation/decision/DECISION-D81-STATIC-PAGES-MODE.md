---
name: >-
  D81 — output: 'static' is a true static site: no router, per-page mount modules, history-style
  hrefs
status: verified
verified_at: '2026-08-24T21:11:50.859Z'
connections:
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D01-SPA-ONLY
  - DECISION-D79-LINK-FUNCTION
  - COMPONENT-SSG
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - FILE-STATIC-MOUNT
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-RUNTIME
  - FILE-BUILD-PRERENDER-PAGES
  - TEST-PRERENDER-OUTPUT
  - FLOW-PRERENDER
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D81 — `output: 'static'`: a true static site

`output: 'static'` (`puzzle build --static`) emits per-route content-complete
HTML with **no router, no SPA takeover and no history API**: navigation is plain
`<a>` page loads. Each page ships a small ES module that mounts only its own
components over the prerendered markup. The prerendered-SPA mode is
`output: 'hybrid'` ([[DECISION-D67-HYBRID-PRERENDER]]); the two share the
prerenderer, serializer and `assembleChain`, so a page and its client render
cannot diverge. `--static`/`--hybrid` are mutually exclusive, and a flag that
disagrees with the config value is an error.

## Decision

1. **`__pzlModule` stamps.** Codegen stamps every compiled class with its
   app-root-relative source path so the build can generate a per-page import
   graph.
2. **Per-page entry** at `dist/_puzzle/<slug>.js` (`/`→`index`, `*`→`404`,
   else `/`→`--`, collisions suffixed `-2`, `-3`…), importing `mountStatic` from
   `@magic-spells/puzzle/static` plus exactly that page's view/layout/component
   classes. An esbuild splitting pass factors shared code into
   `dist/_puzzle/chunks/`. The shell's `/app.js` tag is stripped; `dist/` has no
   `app.js`. The injected script path carries the normalized `routerBase`.
3. **Browser kernel** (`client-runtime/static/index.js`, `mountStatic`): builds
   the same ctx the prerenderer built (Store + FormatterRegistry + router stub),
   rehydrates the inline data island, assembles and preloads the chain via the
   shared `assembleChain`, skips enter animations and replaces the prerendered
   children flash-free. The target is stamped `data-puzzle-static`, not
   `data-puzzle-ssg`.
4. **Build-time data.** `beforeMount` runs only at build time. Each page's store
   is serialized into `<script type="application/json" data-puzzle-static-data>`
   (escaped per D113) and rehydrated in replace mode before preload, so `data()`
   re-renders identically with no network.
5. **Router stub parity.** Both phases use `makeRouterStub` (`ssg/assemble.js`)
   over the per-page route snapshot: `url()` and `current` work, navigation
   methods throw. Its encoding is **always history-style** — the file layout is
   the URL space and there is no click interception — so prerendered and
   rehydrated hrefs are byte-identical. `routerBase` still prefixes. A configured
   `routerMode` produces a build warning and never reaches the page (the Go entry
   and summary do not carry it; a Go test pins that).
6. **Go pipeline:** `compiler/internal/build/prerender_pages.go`. `models` load
   from `app/models/index.{js,ts}` and `formatters` from
   `app/formatters.{js,ts}`; ones registered only in the app entry trigger a
   warning (present at build time, missing client-side).

Other static-mode rules:
- `prerender: false` writes an empty-target shell that still gets a data island
  and entry script — rendered fully client-side.
- `config.storage` is ignored with a warning (a live object serializes to a dead
  `{}`); a direct `mountStatic({ storage })` caller still gets persistence.
- Shadowed routes are still written (no router, no matching — D126); two routes
  declaring the same path skip the second with reason `duplicate`.
- `staging/.puzzle-prerender` and `_puzzle` are reserved in public output (both
  modes).
- **Locale prefix routing** ([[DECISION-D177-LOCALE-URL-PREFIXES]]): every route
  is written once per locale (`dist/<locale>/…`, default locale at the root),
  each `WrittenPage` carrying its `locale`. A route's locale pages share one
  slug and one entry module (`uniqueEntryPages` takes the first per slug; a
  slug whose pages name different modules is an error). The kernel takes the
  page's locale from the URL prefix, then its table island, and wraps the stub
  with `localizeRouterStub` so hrefs carry the prefix. Default-locale pages
  (404 included) carry the inline first-visit redirect script
  (`ssg/redirect.js`) unless `i18n.detect: false`.

## Alternatives

- **One shared static bundle importing `routes.js`** — rejected: every view in
  every page's graph.
- **Zero-JS output** — rejected: kills component interactivity; possible future
  per-route opt-out.
- **Per-component partial hydration (Astro-style)** — rejected: a `.pzl` is one
  class + render fn, no independent unit to hydrate.
- **Re-running `beforeMount` in the browser** — rejected: refetches build-time
  data and can leak build-time credentials.
- **Honouring hash `routerMode` in static output** — rejected: `#/about` on a
  page with no router is a dead link. **Throwing** like hybrid — rejected: the
  output is correct, the config is just inert. **Passing the mode to the kernel
  as an ignored option** — rejected: an inert option invites making it live.

## Consequences

Flat files, plain-link navigation, a few KB of JS per page, deployable to any
static host. D1 holds for both modes.

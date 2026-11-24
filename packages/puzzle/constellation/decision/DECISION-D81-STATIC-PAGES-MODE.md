---
name: 'D81 — output: ''static'' is a true static site: no router, per-page mount modules, path-shaped hrefs'
status: verified
verified_at: '2026-11-24T18:13:21.008Z'
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
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: verified
    text: >-
      router.js must stay free of class static blocks and other module-level side effects: the
      static kernel, the SSG assembler and i18n import its path helpers, so a side effect there pins
      the whole Router into every static page's shared chunk. The popstate-absent assertion in
      tests/static-docs-example.test.js guards it.
---

# D81 — `output: 'static'`: a true static site

`output: 'static'` (`puzzle build --static`) emits per-route content-complete HTML with **no router, no SPA takeover and no history API**: navigation is plain `<a>` page loads. Each page ships a small ES module that mounts only its own components over the prerendered markup. The prerendered-SPA mode is `output: 'hybrid'` ([[DECISION-D67-HYBRID-PRERENDER]]); the two share the prerenderer, serializer and `assembleChain`, so a page and its client render cannot diverge. `--static`/`--hybrid` are mutually exclusive, and a flag that disagrees with the config value is an error.

## Decision

1. **`__pzlModule` stamps.** Codegen stamps every compiled class with its app-root-relative source path so the build can generate a per-page import graph — in every build except a production SPA one (`output` unset, not `--mode development`), where nothing reads the stamp and the plugin compiles without it (`Plugin.SetStripStamps`, one value per build because the passes share a compile cache). Dev diagnostics and DevTools read it too, so development builds keep it.
2. **Per-page entry** at `dist/_puzzle/<slug>.js` — content-hashed `<slug>-<hash>.js` in production when `build.hashNames` is on (D181). Slugs: `/`→`index`, `*`→`404`, else `/`→`--`, collisions suffixed `-2`, `-3`…. Each imports `mountStatic` from `@magic-spells/puzzle/static` plus exactly that page's view/layout/component classes. An esbuild splitting pass factors shared code into `dist/_puzzle/chunks/`. A page whose module graph imports CSS links its own stylesheet (`_puzzle/<slug>.css`, hashed like the module) at the end of its `<head>`. The shell's `/app.js` tag is stripped; `dist/` has no `app.js`. `app.css` ships only when a `public/` page links it; CSS the app entry imports that no page loads draws a warning. The injected script path carries the normalized `routerBase`.
3. **Browser kernel** (`client-runtime/static/index.js`, `mountStatic`): builds the same ctx the prerenderer built (Store + FormatterRegistry + router stub), rehydrates the inline data island, assembles and preloads the chain via `assembleChain`, skips enter animations and replaces the prerendered children flash-free. The target is stamped `data-puzzle-static`, not `data-puzzle-ssg`.
4. **Build-time data.** `beforeMount` runs only at build time. Each page's store is serialized into `<script type="application/json" data-puzzle-static-data>` (escaped per D113) and rehydrated in replace mode before preload, so `data()` re-renders identically with no network.
5. **Router stub parity.** Both phases use `makeRouterStub` (`ssg/assemble.js`) over the per-page route snapshot: `url()` and `current` work, navigation methods throw. Its encoding is **always path-shaped** — the file layout is the URL space and there is no click interception — so prerendered and rehydrated hrefs are byte-identical. `routerBase` still prefixes. A configured `routerMode` produces a build warning and never reaches the page.
6. **Go pipeline:** `compiler/internal/build/prerender_pages.go`. `models` load from `app/models/index.{js,ts}` and `functions` from `app/functions.{js,ts}`; ones registered only in the app entry trigger a warning (present at build time, missing client-side).

Other static-mode rules:
- `prerender: false` writes an empty-target shell that still gets a data island and entry script — rendered fully client-side. The kernel sets its route title, and its topmost view plays its enter, as on an SPA's first navigation.
- `config.storage` is ignored (a live object serializes to a dead `{}`), with a warning whenever the config names the key, so a `window`-guarded value that reads `undefined` at build time still warns; a direct `mountStatic({ storage })` caller still gets persistence.
- Shadowed routes are still written (no router, no matching — D126); two routes declaring the same path skip the second with reason `duplicate`.
- `_puzzle` is reserved in public output (`checkStaticReserved`, shared by the one-shot and dev static builds); `.puzzle-prerender` is reserved in both prerender modes.
- **Locale prefix routing** ([[DECISION-D177-LOCALE-URL-PREFIXES]]): every route is written once per locale (`dist/<locale>/…`, default locale at the root), each `WrittenPage` carrying its `locale`. A route's locale pages share one slug and one entry module (`uniqueEntryPages` takes the first per slug; a slug whose pages name different modules is an error). The kernel takes the page's locale from the URL prefix, then its table island, and wraps the stub with `localizeRouterStub` so hrefs carry the prefix. Default-locale pages (404 included) carry the inline first-visit redirect script (`ssg/redirect.js`) unless `i18n.detect: false`.

## Alternatives rejected

- **One shared static bundle importing `routes.js`** — every view in every page's graph.
- **Zero-JS output** — kills component interactivity.
- **Per-component partial hydration (Astro-style)** — a `.pzl` is one class + render fn, no independent unit to hydrate.
- **Re-running `beforeMount` in the browser** — refetches build-time data and can leak build-time credentials.
- **Honouring hash `routerMode` in static output** — `#/about` on a page with no router is a dead link. **Throwing** like hybrid — the output is correct, the config is just inert. **Passing the mode to the kernel as an ignored option** — an inert option invites making it live.

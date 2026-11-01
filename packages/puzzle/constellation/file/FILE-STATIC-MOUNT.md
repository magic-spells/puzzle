---
name: Static output kernel
status: verified
path: client-runtime/static/index.js
language: javascript
summary: mountStatic — the browser kernel that wakes a prerendered static page (no router).
connections:
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D175-TRANSLATIONS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D179-STATIC-PATHS
  - FILE-SSG-ASSEMBLE
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# static/index.js

`mountStatic`, the per-page browser kernel that wakes a prerendered `output: 'static'` page with no router ([[DECISION-D81-STATIC-PAGES-MODE]], [[COMPONENT-SSG]]). It wires the same build-time ctx the prerenderer wired, rehydrates the store from the data island and then the D161 read state, assembles the chain through [[FILE-SSG-ASSEMBLE]], and swaps the prerendered markup without a flash.

- **Records before read state.** `hydrateReadState` drops an absence whose record turned out present, which only works in that order.
- **Route params** ([[DECISION-D179-STATIC-PATHS]]): `{}` on a fixed route. On a `staticPaths` page the shared page entry merges the page's `data-puzzle-static-route` island (path and params) into the route JSON before calling `mountStatic`; the kernel threads `route.params` into the snapshot and every `preload`. It never reads params off `location`.
- **Translations** ([[DECISION-D175-TRANSLATIONS]], behind `__PUZZLE_HAS_I18N__`): builds the i18n service from the virtual manifest (paths resolve against the stub's normalized `routerBase`), sets `ctx.i18n`, installs `t`, and awaits `__ready()` before `assembleChain`. The page's `data-puzzle-locale` island answers its own locale with no request. `setLocale` re-assembles against the same stub, skips enters, destroys the root and mounts fresh (last-wins by token); store records survive. A switch requested before the remount is armed (a `mounted()` calling `setLocale`) is replayed, not dropped. `__i18n` is an internal test seam, as on `PuzzleApp`.
- **Translated title.** A `meta.title: { t: 'key' }` follows the active locale (`syncLocaleTitle`) after every remount, and on load when the page is not a prerendered takeover (no `data-puzzle-static` marker) or the active locale differs from the island's. A plain string title stays as the build wrote it.
- **Locale prefix routing** ([[DECISION-D177-LOCALE-URL-PREFIXES]], behind `__PUZZLE_HAS_LOCALE_ROUTING__` and `routing === 'prefix'`): the URL decides the locale — `urlLocale` (the prefix after `routerBase`), then the island's locale, then the default — ahead of the stored choice and `navigator.languages`, so an unprefixed page is always a default-locale page. The stub is wrapped by `localizeRouterStub` so `link()` hrefs carry the prefix, and `setLocale` stores the choice and loads the same page under the other prefix (`assignSameOrigin`, or a test seam) instead of remounting.

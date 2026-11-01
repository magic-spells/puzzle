---
name: Prerender flow
status: verified
triggers:
  - kind: manual
connections:
  - COMPONENT-SSG
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - FILE-SSG-RUNTIME
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-SERIALIZER
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-BUILD-SHELL
  - FILE-HEAD-TAGS
  - FLOW-BUILD
  - DOC-SPEC-BUILD
  - DECISION-D01-SPA-ONLY
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP
  - DECISION-D130-TAKEOVER-BUILD-DEFINE
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
  - DECISION-D142-HYBRID-ROUTE-SNAPSHOT
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D179-STATIC-PATHS
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
verified_at: '2026-11-01T19:25:13.521Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Prerender flow

The two prerender modes on top of the SPA build ([[FLOW-BUILD]]): `hybrid` (prerendered HTML + the SPA bundle, which takes over at navigation zero, [[DECISION-D67-HYBRID-PRERENDER]]) and `static` (true static pages with a per-page mount module, [[DECISION-D81-STATIC-PAGES-MODE]]). Neither is SSR or hydration ([[DECISION-D01-SPA-ONLY]]): the runtime clears the prerendered children and mounts a freshly rendered tree in one synchronous swap — it adopts the *screen*, not the nodes. Runtime detail is [[COMPONENT-SSG]]; the output contract is [[DOC-SPEC-BUILD]] §36.

## Build time

1. **Resolve the output mode** before bundling: a `--static`/`--hybrid` flag that disagrees with `output` is a hard error. A plain SPA build warns per routes file that sets `meta.description`/`canonical`/`socialImage` (those tags exist only in prerendered HTML).
2. **Prerender after the shell and public assets are staged, before the swap** — the production entry/CSS references and shell preloads are already rewritten by [[FILE-BUILD-SHELL]]. The shell is the injection template; a failure leaves the last good `dist/`.
3. **Go generates a Node entry, bundles it, runs it — Go never renders.** The summary follows the last stdout sentinel (user logging is harmless). Missing `node`, a non-zero exit, the 120 s timeout or a missing sentinel fail the build with stderr shown.
4. **Enumerate pages** with one unstarted memory Router per build: one entry per fixed leaf, one per `staticPaths` value ([[DECISION-D179-STATIC-PATHS]]), repeated per locale under prefix routing, default locale first ([[DECISION-D177-LOCALE-URL-PREFIXES]]). The prerenderer compiles no matchers of its own, so it can't disagree with the live router on path shape ([[DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP]]).
5. **Assemble each chain without a DOM** via `assembleChain` (`created()` + awaited `data()`, no `mounted()`, no animations; layout last), shared with the static kernel.
6. **Serialize** mirroring ViewManager (inline components, shared slot expansion, controlled state as attributes, directives dropped, placeholders and Portals → nothing, RAWTEXT script/style per [[DECISION-D113-SSG-RAWTEXT-RULE]]).
7. **Splice into the shell** against byte offsets compiled once per build ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]): managed head tags, the page markup, and the per-page islands (locale table, `hreflang` alternates, first-visit redirect).
8. **Emit per mode.** Hybrid writes `<path>/index.html` (catch-all → `404.html`, other locales under `<locale>/`) with a marked container; `prerender: false` gets the untouched shell. Static strips the `app.js` tag, marks the target, and appends in one splice the data island, the read-state island (only if something settled, [[DECISION-D161-AUTO-FETCHING-FINDS]]) and the page's module script. Slugs are assigned by walking the page list in order. With `site` set, `sitemap.xml` is written.
9. **Go post-checks:** a route page may not overwrite a `public/` asset (case-folded; only `/` writing the shell over itself is allowed); the scratch dir is reserved, then removed.
10. **Static only:** a browser-platform esbuild pass bundles the per-page entries with splitting into `_puzzle/` (shared code in `_puzzle/chunks/`). In production its metafile maps each entry to its output, and every written page (locale and generated pages sharing an entry included) gets its emitted module `src` and static-import modulepreloads ([[DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD]]). Hashing follows `Config.HashNames()`; development skips this rewrite. `app.js` and its map are deleted.
11. **Swap** staging over `dist/` atomically.

## Load time

**Hybrid** — the SPA bundle built with the takeover define ([[DECISION-D130-TAKEOVER-BUILD-DEFINE]]). The router navigates the real URL; for a marked container it awaits the initial preload (no skeleton over real content), preloads nested components with enters suppressed, then snapshots the prerendered nodes and marker, clears and mounts. On rejection the error view gets the position first ([[DECISION-D145-ERROR-BOUNDARIES]]); otherwise nodes **and** marker are restored ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]) so a later mount can take over again. The define is probed inline at each branch — hoisting it into a module constant silently breaks the fold.

**Static** — `mountStatic`: resolve the target (missing throws); rebuild the chain from the view classes and the serialized snapshot; build ctx with the throwing router stub (path hrefs regardless of `routerMode`); skip `beforeMount` (it ran at build time); rehydrate the data island (replace mode), then the read-state island (records first); assemble through the same module, so `data()` against the rehydrated store matches the markup; suppress enters, snapshot, clear, mount into the connected container (`mounted()` may focus or measure); on rejection destroy and restore — the only recovery a static page has. An unmarked (`prerender: false`) target mounts normally. Navigation is plain `<a>`.

**What each embeds:** hybrid embeds nothing — the route snapshot is shadowed onto the build Router's `current` only while rendering ([[DECISION-D142-HYBRID-ROUTE-SNAPSHOT]]), and no read state transfers. Static embeds the store snapshot and read-state envelope as HTML islands and the route snapshot as JSON in the page module (plus a route island for a generated page).

## Skipped vs. failing

- **Skipped with a warning:** a `:param` route without `staticPaths` (or with an empty list); leaves under a catch-all; in hybrid, pages shadowed by an earlier first-match route. No catch-all warns that there is no `404.html`. A `:` or `*` inside a larger segment is literal and prerenders.
- **Build failures:** target not a `#id`, missing or non-empty; hybrid with any `routerMode`; any route's `data()` rejecting (including an unsatisfiable tracked fault), named by route; a missing locale table under prefix routing; a path escaping the output dir; a RAWTEXT breakout; a `public/` collision; static only — a rendered route whose class lacks a compiled module stamp.
- **Warn-only:** a guarded hybrid route still ships its markup (a guard is not a secrecy boundary; use `prerender: false`); static drops guards, `routerMode`, `storage` and function-shaped config.

## Invariants that break silently

- The hybrid and static markers are **not** interchangeable (double mount or no takeover, no error).
- Hybrid HTML under a plain-SPA bundle appends instead of replacing (the folded clear is empty) — each mode ships its own bundle with its own HTML.
- Slug assignment precedes any reuse decision; a subset render still enumerates and claims every page.
- A catch-all's children must not consume a compiled-entry index (one phantom index inverts the shadow skip).
- Two routes writing one file: hybrid lets the last claimant win; static keeps the first in reachable order and warns.
- Non-routed nested components see a null route at build time, as in the browser.
- The snapshot path is normalized in exactly one place, or non-ASCII paths differ between prerender and takeover.
- `prerender: false`: hybrid writes the untouched shell; static writes an unmarked target but still builds the page context, so `beforeMount` runs and its store becomes the island.
- Portal and placeholder content is invisible to crawlers in both modes.

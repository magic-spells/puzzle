---
name: "SPA code splitting (lazy chunks for dynamic import())"
status: planned
connections:
  - FILE-BUILD-OPTIONS
  - FILE-BUILD
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-DEV-SERVER
  - FILE-CONFIG
  - COMPONENT-SSG
  - DECISION-D09-GO-ESBUILD-COMPILER
notes:
  - kind: state
    text: >-
      Motivating case (2026-08-13): the Constellation viewer's
      `import('mermaid')` was inlined into app.js, growing it from ~340KB to
      3.4MB. Workaround shipped there: vendor mermaid's chunked ESM build as
      static assets and load it with a native browser import() whose URL lives
      in a variable so esbuild leaves it alone. This feature makes that
      workaround unnecessary.
---

# SPA code splitting

## Intent

In SPA output, a dynamic `import()` in app code is inlined into the single
`app.js` — there is nowhere to split to. Any app with a heavy on-demand
dependency (mermaid, a chart library, an editor, a PDF renderer) pays for it on
every page load, or has to vendor the dependency outside the build entirely.
Splitting already exists in the codebase for the static-pages pass
([[FILE-BUILD-PRERENDER-PAGES]] runs esbuild with `Splitting: true` across page
entries); this feature wires the same capability into the SPA bundle path so a
dynamic `import()` becomes a lazy chunk loaded natively by the browser.

Verified behavior on 0.6.0 (hello-world + dynamic import of a local module,
production build): one `app.js` emitted, module inlined — no chunk.

## Design

**Phase 1 — dynamic imports become lazy chunks.**

- [[FILE-BUILD-OPTIONS]] `newBundleOptions` already writes through `Outdir`
  with `FormatESModule` (checked on release/0.6.0 post-D157/D159), so the
  options change is literally adding `Splitting: true`; the work is in the
  consumers of the outdir, which currently assume a single JS output. The
  entry keeps its stable `app.js` name, so the shell HTML is unchanged.
  Chunks land beside it as hashed `chunk-*.js` files importing each other
  with native ESM — esbuild's ESM splitting has **no chunk-loader runtime**,
  so client JS weight does not grow (hello-world stays ~22KB gzip), and it
  composes with the D157/D159 direction (opt-in subpaths + usage gates
  shrink the eager bundle; splitting makes the rest lazy).
- Static imports are untouched: an app with no dynamic `import()` builds to a
  single `app.js` byte-for-byte as today. Authors choose split points by
  writing `import()`. No per-view or per-component fragmentation.
- Plumb multi-file output through [[FILE-BUILD]] (copy/report) and
  [[FILE-DEV-SERVER]] (serve chunk files; full-page reload already tolerates
  chunk-hash churn between rebuilds).
- Bump embedded esbuild (0.19.11 → current) in the same change — splitting
  correctness (import ordering, circular deps) improved materially after 0.19.
- Gate behind `build: { splitting: true }` in [[FILE-CONFIG]] for a release or
  two, then default on. JSON null = unset per the existing config convention.
- Extend the existing build size banner (D159) with a bundle-composition
  breakdown from esbuild's metafile, warning when a single dependency exceeds
  ~200KB — this would have flagged the mermaid inline on day one.

**Phase 2 (separate design) — lazy route views.**
`view: () => import('./views/Heavy.pzl')` in routes.js: router awaits the
import, loading/error states, prerender interplay. Out of scope here; Phase 1
alone solves the heavy-dependency class of problem.

## Interactions

- SSG/hybrid: the prerender pass already splits across page entries; Phase 1
  must not double-handle those — SPA splitting applies to the browser bundle
  pass only.
- `--fixtures`, dev proxy, live reload: unaffected; chunks are ordinary static
  outputs.
- Skill/docs: update "puzzle build emits a single app.js" statements and the
  heavy-dependency guidance once this lands.

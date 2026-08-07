---
name: D148 — `puzzle preview` + real static serving in dev
status: verified
connections:
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D90-DEV-PORT-SCAN
  - DECISION-D92-DEV-ERROR-OVERLAY
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC-BUILD
verified_at: '2026-08-07T22:43:50.731Z'
verified_sha: f2aef082b4b17fb4ded5da94da53a547e2fe66b1
notes:
  - kind: verified
    text: >-
      Verified at the 0.5.0 release prep: compiler/internal/serve owns both Resolve (serve.go:61)
      and the port scan (port_test.go covers scan/strict/exhausted/zero/range), so dev and preview
      share one resolver. preview defaults to port 4000 (cmd/puzzle/main.go:172), sets
      Cache-Control: no-cache on HTML (preview.go:162), and --fixtures + output:'static' is refused
      at dev startup (dev/dev.go:204). compiler/internal/{preview,serve} tests pass.
    sha: f2aef082b4b17fb4ded5da94da53a547e2fe66b1
---

# D148 — `puzzle preview` + real static serving in dev

Two halves of one principle — **you should see what ships before you deploy it**
(v1.69):

1. **`puzzle preview [dir] [--port N] [--strict-port]`** serves an existing
   `dist/` the way the production host will, per resolved output mode: SPA →
   history-API fallback; hybrid → prerendered page first, shell otherwise;
   static → clean URLs and a REAL 404 (serving the built `404.html`), never the
   shell. No watcher, no SSE, no injection, no `dev.proxy` — the artifact is
   checked as it sits on disk. Default port 4000 so it runs beside dev.
2. **`puzzle dev` on an `output: 'static'` project runs the real pipeline**:
   every rebuild is the full one-shot build (bundle + Tailwind + prerender +
   per-page modules, staging + atomic swap), served with static-host semantics
   — clean URLs, genuine full-page navigations, real 404s, no router.

## Context

Dev always served the SPA runtime regardless of output mode, so a static-mode
project was developed against a router that does not exist in what ships;
prerender-output bugs (the D113 RAWTEXT class), takeover, and per-page
`mountStatic` behavior were structurally invisible until after deploy. And
`npx serve dist` — the only preview story — breaks SPA deep links (no history
fallback) while quietly serving the shell for missing static routes, hiding
exactly the bug class a preview should expose.

## Decision

- **Shared resolver, one source of truth.** `compiler/internal/serve` owns both
  the mode-aware URL→file mapping (`Resolve`) and the D90 port scan (moved
  verbatim out of dev), so dev and preview answer static URLs identically and
  cannot drift. Resolve answers "which file, what status"; each caller decides
  how to write the response (dev injects live-reload, preview never rewrites).
- **Hybrid dev stays the SPA loop.** A hybrid site IS the SPA bundle after
  takeover, so the SPA loop already shows what ships; dev prerenders nothing
  for it. Only `static` changes dev behavior.
- **Static dev injects the reload client at serve time** into every HTML page
  it serves — disk stays production-clean — so reload and the D92 build-error
  overlay reach static pages through the existing SSE channel with no new
  mechanism, and a dev 404 page carries the client too (self-heals when the
  route appears). A failed compile OR prerender keeps the last good pages
  serving (staging swap), with the retained build error replayed over SSE.
- **Static dev pays full rebuilds.** No incremental esbuild context, no warm
  Tailwind watcher — the prerender pass needs a complete, atomically swapped
  tree the in-place incremental builder deliberately does not produce
  (~400 ms on `examples/static-docs`; scales with site size; the startup
  banner names the trade). `--fixtures` + static is rejected at dev startup
  (D98's rule, failed fast instead of once per rebuild).
- **Preview mode resolution: config wins, artifact breaks ties.** A build via
  `--static`/`--hybrid` flag leaves no config key, so preview reads the mode
  back from the artifact's own marker (`data-puzzle-static` /
  `data-puzzle-ssg`) when the config is silent, and says so; an explicit
  config always wins, and a config/artifact disagreement (or an `app.js`
  shape mismatch) warns instead of guessing.
- Preview defaults to port 4000 — not dev's 3000 — so `dev` + `preview`
  side by side never silently port-scan past each other. HTML is served
  `Cache-Control: no-cache` (a host usually wouldn't) so a stale page can
  never straddle two builds. Missing/empty `dist/` is a hard error naming
  `puzzle build`.

## Alternatives rejected

- **Prerender-in-dev for hybrid too** — slows every rebuild to verify only
  first-paint HTML and the takeover moment; `build` + `preview` covers those.
- **A `puzzle dev` opt-out flag back to the SPA loop for static projects** —
  speculative surface; dev showing a router that will not ship is the bug this
  closes, not a mode to preserve.
- **Guessing preview's mode from file shapes alone** — the marker is the
  artifact describing itself; shape-sniffing (`app.js` present/absent) is kept
  only as a warning, never as the decision.
- **`http.ServeFile` for HTML** — it 301-redirects `…/index.html` to `…/` and
  cannot carry the 404 status a built `404.html` must be served with; HTML is
  written out directly instead.

## Consequences

SPEC §13 gains the `preview` command; §36's "dev is unchanged (SPA)" contract
is amended to static-mode real serving. The SPA dev path is byte-identical
(resolution merely moved into the shared resolver — nested-`index.html`
shadowing rule, symlink traversal backstop and all). Static dev's full-rebuild
cost is the accepted price of "dev shows what ships"; if large static sites
make it hurt, an incremental prerender is the upgrade path, not a return to
SPA serving.

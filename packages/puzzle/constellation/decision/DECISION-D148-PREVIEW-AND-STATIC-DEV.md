---
name: D148 — `puzzle preview` + real static serving in dev
status: verified
connections:
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D90-DEV-PORT-SCAN
  - DECISION-D92-DEV-ERROR-OVERLAY
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC-BUILD
verified_at: '2026-08-24T19:03:32.784Z'
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
code_refs:
  - compiler/cmd/puzzle/main.go
  - compiler/internal/build/prerender.go
  - compiler/internal/build/prerender_pages.go
  - compiler/internal/build/watch_static.go
  - compiler/internal/dev/dev.go
  - compiler/internal/keys/keys.go
  - compiler/internal/preview/preview.go
  - compiler/internal/serve/serve.go
---

# D148 — `puzzle preview` + real static serving in dev

## Context

You should see what ships before you deploy it. An SPA dev loop for a
static-mode project hides prerender-output bugs (the D113 RAWTEXT class),
takeover and per-page `mountStatic` behavior; and `npx serve dist` breaks SPA
deep links while serving the shell for missing static routes.

## Decision

1. **`puzzle preview [dir] [--port N] [--strict-port]`** serves an existing
   `dist/` the way the host will, per output mode: SPA → history fallback;
   hybrid → prerendered page first, shell otherwise; static → clean URLs and a
   real 404 (the built `404.html`), never the shell. No watcher, SSE,
   injection or `dev.proxy`. Default port 4000 so it runs beside dev (3000).
2. **`puzzle dev` on `output: 'static'` runs the real pipeline**: every rebuild
   is a complete static build (bundle + Tailwind + prerender + per-page
   modules) staged and atomically swapped, served with static-host semantics.
   Never an in-place patch of the served `dist/`. Making it warm is
   [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]. Hybrid dev stays the SPA loop (a
   hybrid site is the SPA after takeover).

Rules:

- **One resolver.** `compiler/internal/serve` owns `Resolve` (mode-aware
  URL→file+status) and the D90 port scan; dev and preview both use it. Callers
  decide how to write the response.
- **Static dev injects the reload client at serve time** into every HTML page
  (disk stays production-clean), so reload and the D92 overlay work through the
  existing SSE channel, including on the dev 404 page. A failed compile or
  prerender keeps the last good pages and replays the error.
- `--fixtures` + static is rejected at dev startup (D98).
- **Preview mode: config wins, artifact breaks ties.** An explicit `output`
  always wins; an unloadable config is fatal. With no `output` key, preview
  reads the `data-puzzle-static` / `data-puzzle-ssg` marker from
  `dist/index.html` only; a config/artifact disagreement warns that `dist/`
  predates the config. A flag-built site whose root route is
  `prerender: false` previews as SPA; the `app.js` shape check only warns.
  Naming `output` in config removes the ambiguity.
- Preview serves HTML with `Cache-Control: no-cache`, writes HTML directly (not
  `http.ServeFile`, which 301s `index.html` and can't send a 404 status), and
  errors on a missing/empty `dist/` naming `puzzle build`. Both commands share
  `compiler/internal/keys` for TTY `q`-to-quit.

## Alternatives

- Prerender in dev for hybrid too — slows every rebuild; `build` + `preview`
  covers first paint.
- A dev opt-out back to the SPA loop for static — dev showing a router that
  won't ship is the bug.
- Deciding preview mode from file shapes — the marker is authoritative; shape
  sniffing only warns.

## Consequences

The SPA dev path is unchanged. When static dev got slow on large sites, the fix
is a warmer or incremental rebuild (D154, D155), never serving the SPA.

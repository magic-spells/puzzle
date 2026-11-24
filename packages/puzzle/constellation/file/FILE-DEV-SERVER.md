---
name: development server
status: verified
path: compiler/internal/dev/dev.go
language: go
summary: Recursive watch, rebuild loop, localhost server, SSE reload, and shutdown.
connections:
  - COMPONENT-DEV-SERVER
  - COMPONENT-DEVSTATE
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
notes:
  - kind: state
    text: >-
      dev.go keeps no path-containment helpers of its own: it calls `serve.WithinDir`, and
      `withinDirResolved` lives only in serve.
---

# dev.go

`puzzle dev` ([[COMPONENT-DEV-SERVER]]): initial dev build, recursive fsnotify
watch (new directories are re-added), debounced rebuild loop over the warm
[[FILE-BUILD-WATCH]] builder plus one long-lived `tailwindcss --watch` child, the
local server with history fallback and `dev.proxy`, and SSE live reload.
Change classification lives in `changes.go`.

- The reload client is injected into `index.html` **at serve time**; `dist/` on
  disk stays production-clean.
- `styles.css` is recomposed when either Tailwind or an esbuild rebuild changes
  CSS; the two reloads one edit produces are coalesced into one.
- Server errors come back through a channel and shutdown is graceful
  (SIGINT/SIGTERM → `Shutdown`, SSE handlers released via context) — no
  `log.Fatal` in goroutines.

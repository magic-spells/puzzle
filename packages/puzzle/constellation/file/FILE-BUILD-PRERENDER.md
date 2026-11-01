---
name: Go static prerender step
status: verified
path: compiler/internal/build/prerender.go
language: go
summary: Node-platform prerender bundle, timeout, summary parsing, and cleanup.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-SSG
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# prerender.go

The `output: 'hybrid'` prerender step ([[COMPONENT-SSG]]): a second,
Node-platform esbuild pass whose entry imports the app's default export plus the
SSG runtime, run under `node` (bounded by `prerenderTimeout`) to write one
`index.html` per route into staging, returning a parsed summary. It runs after
public files are copied and before the staging→dist swap, so a prerender failure
keeps the last good `dist/`. The static-pages mode ([[FILE-BUILD-PRERENDER-PAGES]])
reuses its bundle/exec helpers.

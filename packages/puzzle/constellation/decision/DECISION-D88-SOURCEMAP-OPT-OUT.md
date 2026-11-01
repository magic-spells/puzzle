---
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D60-DROP-CONSOLE-OPT-OUT
  - DECISION-D81-STATIC-PAGES-MODE
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
name: 'D88 — build.sourceMap: production source maps are opt-in'
---

# D88 — `build.sourceMap`: production source maps are opt-in

`build.sourceMap` (boolean, default **false**) controls linked source maps for
production bundles — the SPA/hybrid build and the static per-page bundles. A
default production `dist/` ships no `.js.map` and no `sourceMappingURL`
comment: maps reveal source structure and are dead weight on a static host.
Same shape as `build.dropConsole` (D60).

## Decision

- `options.go` bases every bundle on `api.SourceMapNone`; dev builds set
  `api.SourceMapLinked`; the production branch in `build.go` turns linked maps
  on only when `cfg.Build.SourceMap` is true.
- The static per-page pass decides up front (`staticPagesSourcemap(cfg, dev)`):
  linked for dev or opt-in, none otherwise — so each chunk's content hash covers
  the bytes that actually ship.
- The temporary Node prerender bundle keeps its inline map (never shipped).
- `config.go` rejects a non-boolean value by name.

## Alternatives rejected

- **Maps on by default** — leaks source and adds dead weight per bundle.
- **One switch including dev** — dev always wants maps.
- **Generate maps, then strip sidecars and comments** — wasted work, and chunk
  hashes would describe bytes that don't ship.

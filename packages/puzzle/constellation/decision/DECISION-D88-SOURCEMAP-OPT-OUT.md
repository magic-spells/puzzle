---
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D60-DROP-CONSOLE-OPT-OUT
  - DECISION-D81-STATIC-PAGES-MODE
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
name: 'D88 — build.sourceMap: production source maps are opt-in'
---

# D88 — `build.sourceMap`: production source maps are opt-in

`build.sourceMap` (boolean, default **false**) controls linked source maps for
production bundles — the SPA/hybrid build and the static per-page bundles. A
default production `dist/` ships no `.js.map` and no `sourceMappingURL` comment:
maps reveal source structure and are dead weight on a static host. Same shape as
`build.dropConsole` (D60).

## Decision

- `options.go` bases every bundle on `api.SourceMapNone`; dev builds set
  `api.SourceMapLinked`; the production branch in `build.go` re-enables linked
  maps only when `cfg.Build.SourceMap` is true.
- The static per-page pass decides up front (`staticPagesSourcemap(cfg, dev)`):
  linked for dev or explicit opt-in, none otherwise — so each chunk's content
  hash covers the bytes that actually ship.
- The temporary Node prerender bundle keeps its inline map (never shipped).
- `config.go` rejects a non-boolean value by name.

## Alternatives

- **Maps on by default** — rejected: leaks source and ~0.5 MB per bundle.
- **One global switch including dev** — rejected: dev always wants maps.
- **Generate maps, then strip sidecars and comments** — rejected: wasted work,
  and chunk hashes would describe bytes that don't ship.

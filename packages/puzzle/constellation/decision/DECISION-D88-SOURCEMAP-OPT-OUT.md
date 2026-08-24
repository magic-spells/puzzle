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
name: 'D88 — `build.sourceMap`: production linked source maps become opt-in (off by default)'
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D88 — build.sourceMap: production linked source maps become opt-in (off by default)

Production builds emitted a linked `.js.map` unconditionally (`options.go` hardcoded `api.SourceMapLinked`), shipping a large map (~468 KB on todos) beside every prod bundle whether or not anyone wanted it. A new `build.sourceMap` config field makes production source maps **opt-in**, defaulting to **off**. This mirrors the [[DECISION-D60-DROP-CONSOLE-OPT-OUT]] opt-out precedent (a `build.*` boolean toggling a production-only esbuild behavior).

## Context

The framework's stance is that a production `dist/` should be shippable as-is with no surprises. A linked source map is a debugging aid most static/marketing deployments neither want nor should expose (it reveals original source structure), and it is dead weight on the wire. Emitting it by default made the honest "just deploy dist/" path leak maps.

## Decision



Add `build.sourceMap` (boolean, default **false**) to the config, applied to **production** bundles only — both the SPA production build and the true-static (`output: 'static'`, D81) per-page bundles:

- `options.go` bases the shared bundle on `api.SourceMapNone`; **dev** builds set `api.SourceMapLinked`, and the production branch in `build.go` re-enables `api.SourceMapLinked` only when `cfg.Build.SourceMap` is true.
- The **temporary Node prerender bundle** (the intermediate esbuild output the SSG/static prerender pass runs under Node) keeps its inline map — it is never shipped, so the opt-out does not gate it.
- The **static** per-page pass decides the same way, before esbuild runs: `staticPagesSourcemap(cfg, dev)` returns linked for a development build or an explicit `build.sourceMap`, and `api.SourceMapNone` otherwise. Nothing is generated in order to be deleted afterwards, so a chunk's content hash is computed over bytes that carry no `sourceMappingURL` comment and therefore describes what actually ships.
- `config.go` parses/validates `build.sourceMap` (non-boolean rejected, named precisely, same as `dropConsole`).

## Alternatives rejected



- **Keep maps on by default** — the status quo; leaks source structure and ~0.5 MB per bundle onto every static host by default.
- **A single global `sourceMap` (dev included)** — dev debugging genuinely wants maps; the split (dev always linked, prod opt-in) matches how the other prod-only knobs (minify, dropConsole) behave.
- **Emit maps from the static per-page pass unconditionally and strip the `.js.map` sidecars + `sourceMappingURL` comments afterwards** — localized, but it makes esbuild generate output solely to throw it away, and the content hash it stamps into each chunk name is computed over bytes that include a comment the shipped file does not carry. Deciding the mode up front costs one helper and makes the hash describe the real artifact.

## Consequences

Default production builds now ship **no** `.js.map` and no `sourceMappingURL` comment (SPA and static); `build.sourceMap: true` restores linked maps for both. Dev and the temporary prerender bundle are unchanged. This is a behavior change from the prior always-on default — captured here and in [[DOC-RELEASE-SURFACE]]. Verified on prod `examples/todos` (no map, no comment) and by `compiler/internal/build/build_test.go` (default omits maps; `sourceMap: true` emits linked maps for SPA and static).

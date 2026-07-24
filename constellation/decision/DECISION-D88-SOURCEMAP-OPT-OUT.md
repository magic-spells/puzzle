---
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D60-DROP-CONSOLE-OPT-OUT
  - DECISION-D81-STATIC-PAGES-MODE
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-07-24T05:49:09.860Z'
verified_sha: d9591d6e01cb9c358acfa4d641174d08e1f05b23
---

# D88 — build.sourceMap: production linked source maps become opt-in (off by default)

Production builds emitted a linked `.js.map` unconditionally (`options.go` hardcoded `api.SourceMapLinked`), shipping a large map (~468 KB on todos) beside every prod bundle whether or not anyone wanted it. A new `build.sourceMap` config field makes production source maps **opt-in**, defaulting to **off**. This mirrors the [[DECISION-D60-DROP-CONSOLE-OPT-OUT]] opt-out precedent (a `build.*` boolean toggling a production-only esbuild behavior).

## Context

The framework's stance is that a production `dist/` should be shippable as-is with no surprises. A linked source map is a debugging aid most static/marketing deployments neither want nor should expose (it reveals original source structure), and it is dead weight on the wire. Emitting it by default made the honest "just deploy dist/" path leak maps.

## Decision

Add `build.sourceMap` (boolean, default **false**) to the config, applied to **production** bundles only — both the SPA production build and the true-static (`output: 'static'`, D81) per-page bundles:

- `options.go` now bases the shared bundle on `api.SourceMapNone`; **dev** builds set `api.SourceMapLinked` (dev behavior unchanged), and the production branch in `build.go` re-enables `api.SourceMapLinked` only when `cfg.Build.SourceMap` is true.
- The **temporary Node prerender bundle** (the intermediate esbuild output the SSG/static prerender pass runs under Node) keeps its existing inline map — it is never shipped, so the opt-out does not gate it.
- The **static** per-page pass still emits maps from esbuild, then a post-pass (`removeStaticSourceMaps`) strips `.js.map` sidecars and trailing `//# sourceMappingURL=` comments from `dist/_puzzle` when production and `sourceMap` is false — the pragmatic way to apply the opt-out to that separate browser bundle without threading the flag through its options.
- `config.go` parses/validates `build.sourceMap` (non-boolean rejected, named precisely, same as `dropConsole`).

## Alternatives rejected

- **Keep maps on by default** — the status quo; leaks source structure and ~0.5 MB per bundle onto every static host by default.
- **A single global `sourceMap` (dev included)** — dev debugging genuinely wants maps; the split (dev always linked, prod opt-in) matches how the other prod-only knobs (minify, dropConsole) behave.
- **Gate the static bundle's esbuild options instead of post-stripping** — the static pass builds its options separately; the post-pass keeps the change localized and leaves the shared options path simple.

## Consequences

Default production builds now ship **no** `.js.map` and no `sourceMappingURL` comment (SPA and static); `build.sourceMap: true` restores linked maps for both. Dev and the temporary prerender bundle are unchanged. This is a behavior change from the prior always-on default — captured here and in [[DOC-RELEASE-SURFACE]]. Verified on prod `examples/todos` (no map, no comment) and by `compiler/internal/build/build_test.go` (default omits maps; `sourceMap: true` emits linked maps for SPA and static).

---
name: compiler build orchestrator
status: verified
path: compiler/internal/build/build.go
language: go
summary: Staged browser builds, assets, styles, validation, and atomic dist swap.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# build.go

One-shot builds: stages browser output, assets, styles and public files into a
`staging-*` directory under `<root>/.puzzle/tmp` ([[DECISION-D153-PUZZLE-SCRATCH-DIR]])
and swaps it into `dist/` only when every step succeeds, so a failed build keeps
the last good output ([[FLOW-BUILD]]).

Trap: `cfg.Splitting() && mode != "static"` is resolved **before**
`ValidatePublic` ([[DECISION-D160-SPA-CODE-SPLITTING]]) — static mode deletes this
pass's `app.js` before the swap, so splitting it would strand chunks nothing
imports. `ValidatePublic` takes that boolean and reserves the root-level
`chunks/` entry only while splitting is on; an app that never opts in keeps its
`public/chunks/` assets, which is why the name is not in `reservedOutputNames`.

Production resolves `hash := !dev && cfg.HashNames()`, keeps static mode's discarded
SPA entry fixed, and captures the browser metafile for the shell rewrite. The composed
stylesheet is content-hashed even when unlinked. After copying public assets,
[[FILE-BUILD-SHELL]] rewrites compiler references and inserts the splitting pass's
static-import preloads before either prerender mode reads the shell. Errors preserve
the last good output. Public files retain their names; development skips the rewrite.

---
name: compiler build orchestrator
status: verified
path: compiler/internal/build/build.go
language: go
summary: Staged browser builds, assets, styles, validation, and atomic dist swap.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
verified_at: '2026-08-16T04:34:19.601Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/build/build.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] resolves `cfg.Splitting() && mode !=
"static"` before `ValidatePublic` — static mode deletes this pass's `app.js`
before the swap, so splitting it would strand chunks nothing imports — and
`ValidatePublic` takes that boolean, reserving the root-level `chunks/` entry
only while splitting is on. An app that never opts in keeps its `public/chunks/`
assets, which is why the name is not in `reservedOutputNames`.

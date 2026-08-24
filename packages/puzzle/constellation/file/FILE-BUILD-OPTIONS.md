---
name: shared esbuild options
status: verified
path: compiler/internal/build/options.go
language: go
summary: Browser/prerender resolution aliases, targets, defines, and shared options.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/build/options.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] adds a `Splitting` bit to `bundleFlags`:
set, the pass gains `Splitting` + `ChunkNames: "chunks/[name]-[hash]"`. It rides
the flags rather than the shared options because esbuild rejects `Splitting`
alongside the prerender pass's `Outfile`. `AbsWorkingDir` is deliberately left
unanchored here, unlike the per-page pass — this pass's metafile input keys are
resolved against the process cwd by `metafileAllInputs`, which drives dev CSS
pruning, so anchoring would silently break it whenever the app root is not the
cwd.

---
name: shared esbuild options
status: verified
path: compiler/internal/build/options.go
language: go
summary: Browser/prerender resolution aliases, targets, defines, and shared options.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-07-24T23:40:00.000Z'
verified_sha: 35e8fd092a8e4559269fd8578a419e69e8371f6c
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

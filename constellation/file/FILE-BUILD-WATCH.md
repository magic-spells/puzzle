---
name: incremental build context
status: verified
path: compiler/internal/build/watch.go
language: go
summary: Reusable esbuild context, CSS graph pruning, and public-asset mirroring.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
verified_at: '2026-07-25T00:10:00.000Z'
verified_sha: 87078756d4e8a665c4a582864fbe7273cbf6f286
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/build/watch.go`.

[[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]] makes rebuild input explicit:
the builder receives the changed batch, owns usage/public classification, and
reports whether its committed component-CSS revision moved (test and profiling
evidence; the dev server recomposes each rebuild and dedupes by bytes). A
public source that appears or moves syncs on the next rebuild. Public-only
batches also skip esbuild unless the changed asset belongs to the last
successful module graph, compared symlink-resolved. Working plugin
CSS is promoted only after a full successful rebuild; Tailwind never reads
partially updated state.

---
name: incremental build context
status: verified
path: compiler/internal/build/watch.go
language: go
summary: Reusable esbuild context, CSS graph pruning, and public-asset mirroring.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - FLOW-DEV-REBUILD
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# watch.go

The warm dev builder: a reusable esbuild context, CSS graph pruning, and
public-asset mirroring. Intent: [[COMPONENT-DEV-SERVER]], [[FLOW-DEV-REBUILD]].

- **Rebuild input is explicit** ([[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]]):
  the builder receives the changed batch, owns usage/public classification, and
  reports whether its committed component-CSS revision moved (the dev server
  recomposes each rebuild and dedupes by bytes). A public source that appears or
  moves syncs on the next rebuild. Public-only batches skip esbuild unless the
  changed asset belongs to the last successful module graph (compared
  symlink-resolved).
- **Working plugin CSS is promoted only after a full successful rebuild**;
  Tailwind never reads partially updated state.
- **Splitting** ([[DECISION-D160-SPA-CODE-SPLITTING]]): a splitting dev build runs
  with `Write: false`, materializes the outputs itself, then deletes the previous
  rebuild's outputs this one did not produce — otherwise an edited lazy module's
  re-hashed chunk accumulates beside its predecessor forever. Only paths this
  builder wrote are prune candidates, so the public mirror stays `prevPublic`'s
  job and `app.js` (rewritten every pass) is safe. With the flag off, `Write:
  true` and none of this runs.

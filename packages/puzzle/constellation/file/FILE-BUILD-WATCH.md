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
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
notes:
  - kind: gotcha
    text: >-
      `WatchBuilder.rebuild` sets `b.refused = changed` right after merging the carried batch and
      clears it only just before `b.landed = true`, so EVERY error return (entry check, usage scan,
      locales, bundle, split write, public copy) carries the batch into the next rebuild. Clearing
      it after the entry check alone dropped a public asset saved in the same batch as a failing
      .pzl: the fix rebuild computed syncPublic false and dist kept the old file (review F7-B2,
      `TestWatchBuilderReplaysFailedBundleBatch`). Esbuild errors from every build path render
      through `formatBuildErrors` (watch_static.go).
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

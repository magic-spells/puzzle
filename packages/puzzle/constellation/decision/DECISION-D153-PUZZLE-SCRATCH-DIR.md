---
name: 'D153 — All transient build directories live in a self-ignoring .puzzle/'
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - FILE-BUILD
  - FLOW-BUILD
  - DECISION-D98-FIXTURES-MODULE-FLAG
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D153 — All transient build directories live in a self-ignoring .puzzle/

## Context

A build needs a staging tree (assembled before it replaces `dist/`) and a
holding directory `swapOutput` moves the old output into. A killed build leaves
them behind. Left in the app root they are scanned by Tailwind (its default
`**/*` source honors `.gitignore`, and a `dist` rule doesn't match other names)
and by the usage scan — ten leftovers took Tailwind's scan from ~0.1 s to 14 s.
Tailwind has no CLI-level exclusion.

## Decision

Transient directories live under `<root>/.puzzle/tmp/` as `staging-*` and
`dist-old-*` (`compiler/internal/build/workdir.go`). `<root>/.puzzle` carries a
`.gitignore` of `*`, created when absent, never overwritten. `.puzzle` is also
the D98 fixtures scratch root and is outside every directory `puzzle dev`
watches. It stays under the app root so installing staging as `dist/` is a
same-filesystem atomic rename.

`SweepWorkDirs` runs at the top of `build.Build` and at `puzzle dev` startup. It
deletes trees, so it is narrow: two known locations, exact prefixes, real
directories only, entries untouched for `staleWorkAge` (10 min). A running
build re-stamps its staging root every minute (`keepWorkDirFresh`), since
writes into subdirectories don't move the root's mtime. Symlinked entries are
skipped; a symlinked `.puzzle` disables the sweep, and `ensureWorkTmp` /
`check.Generate` reject it with a diagnostic. The sweep also removes the legacy
app-root names (`.dist-staging-*`, `dist.old-*`).

`dist/` itself is left alone: templates gitignore it, and excluding it
otherwise would change Tailwind's sources unasked.

`cleanupFixturesWorkDir` always removes `.puzzle/fixtures/` and removes
`.puzzle` only when this build created it and it is empty.

## Alternatives

- Pid/lock file instead of age + heartbeat — pids are reused; a killed build
  can't clean its marker.
- Delete leftovers unconditionally — destroys a concurrent build's staging
  (dev + manual build is normal).
- Editing the user's `.gitignore`, or a `.gitignore` inside `dist/` — compiler
  doesn't edit user files or ship artifacts.
- OS temp dir — loses the atomic same-filesystem install.
- Injecting `@source not` into the user's CSS — changes their `@import`
  resolution.

## Consequences

Projects gain one self-ignoring `.puzzle/`; interrupted builds self-clean on the
next run.

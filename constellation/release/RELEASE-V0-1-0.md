---
name: 0.1.0 — first public release
status: built
version: 0.1.0
connections:
  - DOC-BUILD-PLAN
  - FILE-PACKAGE
  - DECISION-D01-SPA-ONLY
---

# 0.1.0 — first public release

Published 2026-07-22. The point at which Puzzle stopped being an in-repo
prototype and became an installable package: `@magic-spells/puzzle` on npm,
MIT, with the `puzzle` binary shim and its optional platform binary packages.

Theme: prove the whole shape works end to end before growing it. A SPA-first
browser runtime, a Go/esbuild compiler for single-file `.pzl` components, and
one CLI covering the full loop from `init` to `build`. The release exists to
establish the public surface, not to extend it — every capability in it was
already designed and exercised by the todos app; publishing was the milestone.

Releases are cut by hand: bump the versions, run `npm run release:prep`, then
publish. There is no CI publish and there never has been.

## Upgrade notes

Nothing to upgrade from.

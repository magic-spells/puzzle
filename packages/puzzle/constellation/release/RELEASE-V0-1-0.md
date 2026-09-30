---
name: 0.1.0 — first public release
status: built
version: 0.1.0
connections:
  - FILE-PACKAGE
  - DECISION-D01-SPA-ONLY
  - FLOW-RELEASE
---

# 0.1.0 — first public release

Published 2026-07-22: `@magic-spells/puzzle` on npm (MIT) with the `puzzle`
shim and optional platform binary packages. It established the whole shape —
the SPA-first runtime, the Go/esbuild `.pzl` compiler, and one CLI from `init`
to `build` — rather than extending it. 0.1.1 (same day) made `puzzle init`
prompt on a TTY.

Releases are cut by hand; there is no CI publish ([[FLOW-RELEASE]]).

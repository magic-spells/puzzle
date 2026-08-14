---
name: Puzzle config loader
status: verified
path: compiler/internal/config/config.go
language: go
summary: Bounded Node evaluation and validation of puzzle.config.js.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-07-24T23:40:00.000Z'
verified_sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/config/config.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] adds `build.splitting` on the same
tri-state pattern as `build.dropConsole`: `json.RawMessage` + the shared
`unset()` helper, so JSON `null` means unset rather than an explicit `false`.
Pointer storage keeps "absent" distinguishable from "false", so the default can
flip in `Config.Splitting()` without changing what a stored config means.

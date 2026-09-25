---
name: Puzzle config loader
status: verified
path: compiler/internal/config/config.go
language: go
summary: Bounded Node evaluation and validation of puzzle.config.js.
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
  - kind: state
    text: >-
      `i18n` config key (D175, v1.81): `Config.I18n *I18n{ Locales, DefaultLocale }`, nil when
      absent; `I18nEnabled()`. Validation errors: not an object; `locales` missing, not an array, or
      empty; a tag failing `ValidLocaleTag` (`^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$`, with a `_`→`-`
      suggestion); a case-insensitive duplicate; `defaultLocale` missing (the message says the key
      is `defaultLocale`, not `default`), not a string, or not in `locales`. `ValidLocaleTag` is
      exported for the locales package's file-name check.
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/config/config.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] adds `build.splitting` on the same
tri-state pattern as `build.dropConsole`: `json.RawMessage` + the shared
`unset()` helper, so JSON `null` means unset rather than an explicit `false`.
Pointer storage keeps "absent" distinguishable from "false", so the default can
flip in `Config.Splitting()` without changing what a stored config means.

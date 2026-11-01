---
name: Puzzle config loader
status: verified
path: compiler/internal/config/config.go
language: go
summary: Bounded Node evaluation and validation of puzzle.config.js.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-SPEC-ANATOMY
  - DECISION-D175-TRANSLATIONS
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# config.go

Loads `puzzle.config.js` by shelling out to Node and JSON-round-tripping the
default export (bounded evaluation), then validates it into `Config`. Behavioral
intent stays on [[COMPONENT-ESBUILD-PLUGIN]]; the user-facing keys are in
[[DOC-SPEC-ANATOMY]] §2.

Traps:

- **Tri-state scalars.** `build.splitting`, `build.hashNames` and
  `build.dropConsole` are held as `json.RawMessage` and read through `unset()`, so
  JSON `null` means unset, not `false`; pointer storage keeps "absent" apart from
  "false". `Config.HashNames()` owns its default — absent/null is **true**,
  independent of `Config.Splitting()`
  ([[DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD]]). Build callers apply the
  production-only gate and read the raw `Build.HashNames` pointer to tell default-on
  (falls back with a warning) from an explicit `true` (errors).
- **`dev.proxy`** keys must be absolute `/`-prefixed paths and targets absolute
  http(s) URLs; `/` and colliding normalized prefixes are errors
  ([[FEATURE-DEV-PROXY]]).
- **`i18n`** ([[DECISION-D175-TRANSLATIONS]]): `Config.I18n` is nil when absent
  (`I18nEnabled()`). `locales` must be a non-empty array of tags passing
  `ValidLocaleTag` with no case-insensitive duplicate, and `defaultLocale` (the
  key is `defaultLocale`, not `default`) must be one of them. `ValidLocaleTag` is
  exported for the locales package's file-name check. Unknown keys inside `i18n`
  are silently ignored.
- **`i18n.routing` / `i18n.detect`** ([[DECISION-D177-LOCALE-URL-PREFIXES]]):
  `routing` is absent or `'prefix'` (`RoutingPrefix`), read through the nil-safe
  `PrefixRouting()`. `detect` is a `*bool` (nil = default on) and only means
  something with prefix routing.
- **`site`** (D177): validated by `validateSite` as an origin only — absolute
  http(s) with a host; a path other than `/`, a query, fragment or user info is an
  error that points at `routerBase`. Stored as `scheme://host` with no trailing
  slash, `""` when absent; the prerender uses it for absolute `hreflang` links and
  the sitemap.

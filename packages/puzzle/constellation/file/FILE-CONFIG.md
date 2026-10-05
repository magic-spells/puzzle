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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# config.go

Loads `puzzle.config.js` by shelling out to Node and JSON-round-tripping the
default export (bounded evaluation), then validates it into `Config`. Behavioral
intent stays on [[COMPONENT-ESBUILD-PLUGIN]]; the user-facing keys are in
[[DOC-SPEC-ANATOMY]] §2.

Traps:

- **Tri-state scalars.** `build.*` keys such as `build.splitting` and
  `build.dropConsole` are held as `json.RawMessage` and read through the shared
  `unset()` helper, so JSON `null` means unset, not `false`. Pointer storage
  keeps "absent" distinguishable from "false", so a default can flip in the
  accessor (`Config.Splitting()`) without changing what a stored config means.
- **`dev.proxy`** keys must be absolute `/`-prefixed paths and targets absolute
  http(s) URLs; `/` and colliding normalized prefixes are errors
  ([[FEATURE-DEV-PROXY]]).
- **`i18n`** ([[DECISION-D175-TRANSLATIONS]]): `Config.I18n` is nil when absent
  (`I18nEnabled()`). Errors: not an object; `locales` missing, not an array or
  empty; a tag failing `ValidLocaleTag` (2–3 letter language, optional 4-letter
  script, optional 2-letter or 3-digit region, non-repeated variants; the error
  names the subtag, with a `_`→`-` suggestion); a case-insensitive duplicate;
  `defaultLocale` missing (the message names the key `defaultLocale`, not
  `default`), not a string, or not in `locales`. `ValidLocaleTag` is exported for
  the locales package's file-name check.
- **`I18n.Routing` / `I18n.Detect`** ([[DECISION-D177-LOCALE-URL-PREFIXES]]):
  `Routing` is `""` (absent) or `RoutingPrefix` (`'prefix'`) — any other value is
  an error; read through the nil-safe `PrefixRouting()`. `Detect` is a tri-state
  `*bool` (nil = absent, default on) and must be a boolean; it means something only
  with prefix routing. Unknown keys inside `i18n` stay silently ignored.
- **`site`** (D177): a top-level string, validated by `validateSite` — an absolute
  http/https URL with a host name (`Hostname()`, so `https://:80` fails; a bare
  trailing `:` fails too), origin only: a path other than `/`, a query, fragment or
  user info is an error that points at `routerBase`. Stored as `scheme://host`
  without a trailing slash; `""` when absent. The prerender receives it as an
  option to make `hreflang` alternates absolute and to write the sitemap.

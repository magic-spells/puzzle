---
name: 'Translations: i18n service, app wiring, prerender, locale files'
kind: unit
status: built
framework: vitest
connections:
  - DECISION-D175-TRANSLATIONS
  - COMPONENT-FORMATTERS
  - COMPONENT-PUZZLE-APP
  - COMPONENT-SSG
  - COMPONENT-TESTING
  - FILE-STATIC-MOUNT
  - DOC-SPEC-TEMPLATE
  - DOC-TESTING
---

# Translations: i18n service, app wiring, prerender, locale files

Proves [[DECISION-D175-TRANSLATIONS]] end to end. Vitest suites in `tests/`:
`i18n`, `i18n-app`, `i18n-hardening`, `i18n-ssg`, `static-locale-remount`
(run with `npx vitest run tests/i18n tests/static-locale-remount`); the build
side is Go, `go test ./compiler/internal/locales/`. The `/testing` `i18n`
option's isolation lives in [[TEST-PUBLIC-TESTING-SURFACE]]
(`testing-i18n-isolation`).

- **Service (`i18n`):** locale selection (stored choice, viewer languages
  exact/base/same-base, default fallback); `t` lookup — a missing key prints
  itself with a did-you-mean, inherited properties are never translations;
  single-pass substitution that never re-substitutes inserted text or injects
  markup; plurals through `Intl.PluralRules` with an exact-0 `zero` form; the
  loader (page island, fetch, one fallback to the default locale); and
  `setLocale` — fetch first, then switch table, locale and `<html lang>`
  together, last-wins on overlap, a failed switch changes nothing. The `t`
  formatter registers over the service unless the app registered its own.
- **App wiring (`i18n-app`):** strings load before navigation #0; `ctx.i18n`
  and `app.i18n`; `setLocale`'s same-location rebuild through the router
  (keep 0, replace, no animation, scroll or focus change). Hangs are turned
  into rejections so a deadlock fails by name.
- **Hardening:** a tag Intl rejects picks a plural form instead of throwing
  mid-render; an overtaken `setLocale` never reports a switch that did not
  happen; the dev did-you-mean is computed only when its warning prints.
- **Prerender (`i18n-ssg`, `static-locale-remount`):** pages render in the
  default locale (numbers and dates too, not the build machine's); the default
  table rides as a `data-puzzle-locale` island at the shell `</body>` anchor
  (hybrid) or before the page module (static), escaped per D113, and a
  `</body>` in a comment or script string does not move it; a non-default
  viewer swaps once. The static kernel's locale remount prepares nested
  components before the swap, and a throwing mount keeps the old page and
  rejects `setLocale`.
- **Locale files (`compiler/internal/locales`):** nesting flattens to dotted
  keys with plural objects kept; missing keys fill from the default locale
  with a warning; output is minified, content-hashed files plus the manifest;
  every problem is reported at once; unlisted files, empty objects and
  dotfiles warn or skip; a UTF-8 BOM is accepted.

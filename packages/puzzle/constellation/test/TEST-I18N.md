---
name: 'Translations: i18n service, app wiring, prerender, locale files'
kind: unit
status: built
framework: vitest
connections:
  - DECISION-D175-TRANSLATIONS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - COMPONENT-FORMATTERS
  - COMPONENT-PUZZLE-APP
  - COMPONENT-SSG
  - COMPONENT-TESTING
  - COMPONENT-ROUTER
  - FILE-STATIC-MOUNT
  - DOC-SPEC-TEMPLATE
  - DOC-TESTING
---

# Translations: i18n service, app wiring, prerender, locale files

Proves [[DECISION-D175-TRANSLATIONS]] and [[DECISION-D177-LOCALE-URL-PREFIXES]]
end to end. Vitest suites in `tests/`: `i18n`, `i18n-app`, `i18n-hardening`,
`i18n-ssg`, `static-locale-remount`, `router-locale-prefix`, `locale-prefix-app`,
`locale-redirect-build`, plus D177 blocks in `static-kernel`, `ssg-head`,
`router-head` and `static-prerender` (run with `npx vitest run tests/i18n
tests/static-locale-remount tests/router-locale-prefix tests/locale-`). The build
side is Go: `go test ./compiler/internal/locales/ ./compiler/internal/config/
./compiler/internal/build/ ./compiler/internal/serve/`. The `/testing` `i18n`
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
  D177: `urlLocale`, `islandLocale`, `localeLabel`, the `i18n.locales` switcher
  list (config order, own-language label, lazy read), `setLocale` under prefix
  routing (store + navigate, no fetch), `i18n.dir`/`<html dir>`, and the
  open-redirect guard (`samePath`, `assignSameOrigin`, `/es//evil.example/`).
- **App wiring (`i18n-app`):** strings load before navigation #0; `ctx.i18n`
  and `app.i18n`; `setLocale`'s same-location rebuild through the router
  (keep 0, replace, no animation, scroll or focus change). Hangs are turned
  into rejections so a deadlock fails by name. D177: the URL locale beats the
  stored choice; push/`link()`/`router.url()` carry the prefix and take
  options; `setLocale` from a guard, `data()`, a superseded, blocked or first
  navigation loads the right page; the mount-time first-visit redirect (mount
  stays pending; skipped on a prerendered page); hash/memory routing and a
  route on a locale prefix are refused at mount.
- **Router (`router-locale-prefix`):** reading and writing under the composed
  base, `url()` options, click interception (a link is taken only when its
  locale base equals the router's), the route-collision throw, and the parity
  of the four encoders that call `localeBase`.
- **Hardening:** a tag Intl rejects picks a plural form instead of throwing
  mid-render; an overtaken `setLocale` never reports a switch that did not
  happen; the dev did-you-mean is computed only when its warning prints.
- **Prerender (`i18n-ssg`, `static-locale-remount`, `static-kernel`,
  `ssg-head`, `router-head`):** without routing pages render in the default
  locale (numbers and dates too, not the build machine's); the table rides as a
  `data-puzzle-locale` island at the shell `</body>` anchor (hybrid) or before
  the page module (static), escaped per D113, and a `</body>` in a comment or
  script string does not move it; a non-default viewer swaps once. The static
  kernel's locale remount prepares nested components before the swap, and a
  throwing mount keeps the old page and rejects `setLocale`. D177: per-locale
  pages (folders, lang, dir, island, format locale, link prefix, 404s,
  `prerender: false`), hybrid's per-locale `url` re-shadow, hreflang
  alternates (absolute with `site`, warning without, stale shell ones
  stripped), canonical localization, `beforeMount`'s `locale`, the route
  collision error, the inline redirect script (default-locale pages only,
  `detect: false`, self-contained, small, escaped), the sitemap, `{ t }` head
  text at build time and in the router, and the static kernel's URL-decides
  rule.
- **Shared cases and real builds:** `tests/fixtures/locale-redirect-cases.js`
  is the one first-visit decision table that `selectLocale`, the inline script
  and the SPA redirect all run. `npm run build:locale-prefix` (pretest) builds
  `tests/fixtures/locale-prefix-site` (static), `locale-prefix-hybrid` and
  `locale-prefix-spa` with the compiler; `locale-redirect-build` runs the
  redirect script a real build emitted, and `locale-prefix-app` loads the
  hybrid and SPA pages a host would serve into jsdom (and the built
  `examples/i18n` switcher). `tests/fixtures/prerender-golden/golden.json`
  pins every prerendered file and summary for static and hybrid, with and
  without i18n, so apps without `routing` keep their HTML
  (`static-prerender`).
- **Locale files (`compiler/internal/locales`):** nesting flattens to dotted
  keys with plural objects kept; missing keys fill from the default locale
  with a warning; output is minified, content-hashed files plus the manifest;
  every problem is reported at once; unlisted files, empty objects and
  dotfiles warn or skip; a UTF-8 BOM is accepted.
- **Go, D177:** `TestI18nRouting` and `TestSiteValidation` (config),
  `TestLocaleRoutingDefine`, `TestI18nRoutingWarnings`,
  `TestValidatePublicReservesLocalePrefixes`, `TestBuildStaticLocaleRouting`
  (build), `TestResolveStaticLocale404` (serve).

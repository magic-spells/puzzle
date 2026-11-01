---
name: 'Translations: i18n service, app wiring, prerender, locale files'
kind: unit
status: verified
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
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Translations: i18n service, app wiring, prerender, locale files

Proves [[DECISION-D175-TRANSLATIONS]] and [[DECISION-D177-LOCALE-URL-PREFIXES]] end to
end. Run with
`npx vitest run tests/i18n tests/static-locale-remount tests/router-locale-prefix tests/locale-`;
the build side is
`go test ./compiler/internal/locales/ ./compiler/internal/config/ ./compiler/internal/build/ ./compiler/internal/serve/`.
D177 also has blocks in `static-kernel`, `ssg-head`, `router-head` and
`static-prerender`. The `/testing` `i18n` option's isolation is in
[[TEST-PUBLIC-TESTING-SURFACE]] (`testing-i18n-isolation`).

- **Service** (`i18n`): locale selection (stored choice, viewer languages: exact, Chinese
  script, base, same-base; default fallback); `t` lookup (a missing key prints itself
  with a did-you-mean; inherited properties are never translations); single-pass
  substitution that never re-substitutes inserted text or injects markup; plurals
  through `Intl.PluralRules` with an exact-0 `zero` form; the loader (page island, fetch,
  one fallback to the default locale); `setLocale` fetches first, then switches table,
  locale and `<html lang>` together, last-wins on overlap, and a failed switch changes
  nothing. Prefix routing: `urlLocale`, `islandLocale`, `localeLabel`, the
  `i18n.locales` switcher list, `setLocale` storing and navigating instead of fetching,
  `<html dir>`, and the open-redirect guard (`samePath`, `assignSameOrigin`,
  `/es//evil.example/`).
- **App wiring** (`i18n-app`): strings load before navigation zero; `ctx.i18n` and
  `app.i18n`; `setLocale`'s same-location rebuild through the router (keep 0, replace,
  no animation, scroll or focus change). Hangs are turned into rejections so a deadlock
  fails by name. Prefix routing: the URL locale beats the stored choice; push, `link()`
  and `router.url()` carry the prefix; `setLocale` from a guard, `data()`, or a
  superseded, blocked or first navigation loads the right page; the first-visit
  redirect (skipped on a prerendered page); hash/memory routing and a route on a locale
  prefix are refused at mount.
- **Router** (`router-locale-prefix`): reading and writing under the composed base,
  `url()` options, click interception (a link is taken only when its locale base equals
  the router's), the route-collision throw, the four encoders that call `localeBase`
  agreeing.
- **Hardening** (`i18n-hardening`): a tag Intl rejects picks a plural form instead of
  throwing mid-render; an overtaken `setLocale` never reports a switch that did not
  happen; the dev did-you-mean is computed only when its warning prints.
- **Prerender** (`i18n-ssg`, `static-locale-remount`): without prefix routing, pages
  render in the default locale (numbers and dates too, not the build machine's); the
  table rides as a `data-puzzle-locale` island at the shell `</body>` anchor (hybrid) or
  before the page module (static), escaped per D113; a non-default viewer swaps once; the
  static kernel's locale remount prepares nested components before the swap and a
  throwing mount keeps the old page. With prefix routing: per-locale pages (folders,
  lang, dir, island, format locale, link prefix, 404s, `prerender: false`), hreflang
  alternates (absolute with `site`, a warning without), canonical localization, the
  inline redirect script (default-locale pages only, `detect: false`), the sitemap, and
  `{ t }` head text.
- **Real builds**: `tests/fixtures/locale-redirect-cases.js` is the one first-visit
  decision table that `selectLocale`, the inline script and the SPA redirect all run.
  `npm run build:locale-prefix` (pretest) builds `tests/fixtures/locale-prefix-site`
  (static), `locale-prefix-hybrid` and `locale-prefix-spa`; `locale-redirect-build` runs
  the redirect script a real build emitted, and `locale-prefix-app` loads the built pages
  into jsdom (plus the built `examples/i18n` switcher).
  `tests/fixtures/prerender-golden/golden.json` pins every prerendered file for static
  and hybrid, with and without i18n, so apps without routing keep their HTML.
- **Locale files** (`compiler/internal/locales`): nesting flattens to dotted keys with
  plural objects kept; missing keys fill from the default locale with a warning; output
  is minified, content-hashed files plus the manifest; every problem is reported at once;
  unlisted files, empty objects and dotfiles warn or skip; a UTF-8 BOM is accepted.
- **Go config/build/serve**: `TestI18nRouting`, `TestSiteValidation`,
  `TestLocaleRoutingDefine`, `TestI18nRoutingWarnings`,
  `TestValidatePublicReservesLocalePrefixes`, `TestBuildStaticLocaleRouting`,
  `TestResolveStaticLocale404`.

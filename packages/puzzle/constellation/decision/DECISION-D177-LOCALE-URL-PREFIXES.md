---
name: >-
  D177 — Locale URL prefixes: i18n.routing 'prefix', one prerendered page per locale, link() adds
  the prefix
status: built
connections:
  - DECISION-D175-TRANSLATIONS
  - DECISION-D79-LINK-FUNCTION
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D51-ROUTER-BASE-PATH
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - COMPONENT-SSG
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - COMPONENT-FORMATTERS
  - COMPONENT-DEV-SERVER
  - FILE-STATIC-MOUNT
  - FILE-CONFIG
  - DOC-SPEC-BUILD
  - DOC-SPEC-ROUTER
  - TEST-I18N
---

# D177 — Locale URL prefixes

`i18n: { locales, defaultLocale, routing: 'prefix' }` gives every language its
own URLs and its own prerendered HTML. Without `routing`, behaviour is exactly
[[DECISION-D175-TRANSLATIONS]] (one URL, client-side swap) and no code is
added. Shipped in 0.9.0 (PRs #206, #207, #209, #212–#215).

## Context

D175 prerenders every page once, in `defaultLocale`; a viewer in another
language gets default-language HTML, then a fetch and a swap. Crawlers only
ever see the default language, there are no per-language URLs to share, and
non-default viewers see a flash. A public static site needs one real document
per language.

## Decision

### URLs and output

- The default locale is unprefixed (`/blog/cookies`); every other locale lives
  under its configured tag, verbatim and matched exactly on a segment boundary
  (`/es/blog/cookies`, `/pt-BR/…`; `/esp` is not `es`). `/en/…` for the default
  locale does not exist and is not redirected. `pathLocale` in
  `router/router.js` is the single prefix matcher.
- Under `routerBase` ([[DECISION-D51-ROUTER-BASE-PATH]]) the URL is
  `base + /<locale> + path`. Locale files, page modules and assets stay on the
  bare base — emitted once and shared.
- The build prerenders every page once per locale into `dist/<locale>/…`,
  default locale at the dist root. Each page has its own `<html lang>`, carries
  only its own locale's table island, and renders with its own format locale.
  `*` writes `dist/<locale>/404.html`; in static mode `puzzle dev`/`preview`
  try `dist/<first-segment>/404.html` (exact case, any first-level folder)
  before the root one.
- The prerender runs locale by locale, default first, creating each locale's
  i18n service right before its pages (the format-locale slot is module state)
  and restoring the format locale after. Page-module slugs are per route path,
  shared by every locale. `BuildI18n.tables` is required per locale.
- `beforeMount`'s build facade gains `locale`, since it runs once per locale.

### Links

- `link(path)` and `router.url(path)` add the active locale's prefix, at build
  time and on the client. Templates and script never write a prefix:
  `router.push('/about')` is locale-less too. `push('/es/about')` routes as
  written, lands on the catch-all and warns in dev.
- `link(path, { locale: 'es' })` forces one locale. `link(path, { locale: false })`
  skips the prefix and still applies `routerBase` — for files that exist once
  (`/files/resume.pdf`). Same options on `router.url` (read from `arguments[1]`,
  typed with a JSDoc `@overload`).
- **One helper computes the base**: `localeBase(routerBase, locale,
  defaultLocale)`. All four encoders call it — `Router.url`, the router's write
  side, the static router stub (`localizeRouterStub` in `ssg/assemble.js`, kept
  apart from `makeRouterStub` because esbuild keeps unused destructured params)
  and the hybrid prerender's `routeRouter.url` shadow, re-shadowed per locale.
  A parity test pins all four ([[DECISION-D79-LINK-FUNCTION]] records the
  earlier drift).
- **Build warning** for a literal root-relative `href` on `<a>`/`<area>` when
  routing is on. Skipped: `//host`, dynamic values, `{#raw}`, and a last static
  segment with a file extension. Collected in the usage scan (`Usage.RootHrefs`,
  always collected, printed only under routing).

### The i18n service

- **`i18n.locales` is the list a language switcher renders**: one entry per
  configured locale, in config order — `{ locale, label, href, active }`.
  `label` is the language's own name from `Intl.DisplayNames`; `href` is the
  current page in that locale; `active` marks the current one. Without prefix
  routing `href` is the current page for every entry and a switcher calls
  `setLocale(entry.locale)`. **Breaking**: 0.8.0 exposed a `string[]`.
- **Read `locales` where it re-runs.** A prop-less component inside a
  persistent layout runs `data()` once, so its hrefs go stale after a client
  navigation. Read `i18n.locales` in the layout's or view's `data()` and pass
  it down as a prop (the `examples/i18n` switcher and the `language-switcher`
  piece do this). The switcher pattern: real links, and a plain click calls
  `setLocale` so the choice is stored; modified clicks stay native.
- **The URL decides the locale**: URL prefix, then (static) the page's island
  tag, beat the stored choice and `navigator.languages`. An unprefixed static
  page takes its island locale, so a stored choice does not apply there — that
  is the redirect's job.
- **`setLocale(tag)` navigates** in prefix mode: store the choice, then load
  the same page under the other prefix, query and fragment kept. The page is
  the in-flight navigation's target when one is running (`localePage(router)`
  reads it from a module-level WeakMap), else the committed URL. A full page
  load in every mode, so the router's base never changes while the app runs.
  It compares against the page's forced locale, not the stored one.
- `i18n.dir` is `'rtl'` for right-to-left languages, else `'ltr'`.

### Security

Every prefix-swap result is a same-origin path: `samePath` collapses a leading
run of `/`, `\`, tab or newline, and the only `location.assign`/`replace`
goes through `assignSameOrigin`. (`/es//evil.example/` once produced
`//evil.example/`.)

### Head

- Every prerendered page except the catch-all 404 pages gains `<link rel="alternate" hreflang>` for each
  locale plus `x-default`, tagged `data-puzzle-head="alternate"`, a managed set:
  stale shell ones are stripped. `prerender: false` pages get no hreflang and
  no redirect.
- `hreflang` wants absolute URLs: an optional top-level `site` config
  (`'https://example.com'`, origin only) supplies the origin. Without it the
  links are root-relative and the build warns once. `site` reaches the
  prerender as an option, not through the manifest.
- A root-relative or same-origin canonical is localized per page (it must
  include `routerBase`); one that cannot be localized warns.
- **Translated head text**: `meta: { title: { t: 'key' } }` (and
  `description`) resolves through `headText(value, i18n)` in `head.js`, at
  build time and in the client. `syncTitle` stays string-only; the static
  kernel syncs a `{ t }` title on load and after remount. A `{ t }` value
  without `i18n` warns. Works with or without prefix routing.

### First-visit redirect

Default-locale pages redirect once to the matching prefixed URL when all hold:

- the URL itself has no locale prefix;
- the visitor did not arrive from the same origin (`document.referrer`), so a
  deliberate click to another language is never bounced back;
- the wanted locale is non-default — the stored choice if there is one,
  otherwise the first `navigator.languages` match. A stored default-locale
  choice suppresses it.

Prerendered default-locale pages (404 included) carry an inline script,
`ssg/redirect.js`, generated from one function source (879 B for three
locales; the build fails if it contains `</script` or `<!--`). Pages without
it — the SPA, a hybrid `prerender: false` shell, `puzzle dev` — redirect at
the top of `mount()`, which skips a container marked `data-puzzle-ssg`, so no
page gets both. After a redirect `mount()` never settles: the page is
unloading. One shared case table (`tests/fixtures/locale-redirect-cases.js`)
drives `selectLocale`, the emitted script and the runtime redirect.
`i18n: { detect: false }` removes both. Under a CSP without `unsafe-inline`
the script is blocked and prerendered default-locale pages get no redirect.

### Modes and validation

- `routing` accepts only `'prefix'`; any other value is a build error. Unknown
  keys inside `i18n` stay silently ignored (existing convention).
- Static, hybrid and SPA path routing are covered. Hash and memory routing have
  no path to prefix: hybrid already rejects them, static ignores `routerMode`,
  and the SPA throws in `mount()`.
- A config-fact define, `__PUZZLE_HAS_LOCALE_ROUTING__` (set on all three
  build passes), gates every runtime branch, so apps without `routing` ship no
  added code (minifier names may differ by a byte; prerendered HTML is pinned
  by `tests/fixtures/prerender-golden/golden.json`). The manifest carries
  `routing` and `detect: false` only when set.
- **Collisions are build errors**: a route whose first segment equals a
  non-default locale tag (case-insensitive), and a top-level `public/<locale>/`
  folder. The Router constructor throws on the route collision too.
- Router (hybrid/SPA): the path-mode base is composed once as `#base =
  routerBase + prefix` for path reading, URL writing and click interception;
  route matching and `this.route` stay locale-free. Interception takes a link
  only when its locale base equals the router's; another locale's link is a
  real page load. A hybrid fallback page (`/es/product/1` served the root
  shell) sets `<html lang>` from the URL.
- Dev: a route re-renders in every locale; a locale-file edit stays
  render-wide ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]).

### Sitemap and text direction

- **`dist/sitemap.xml`** is written by every prerendering build that sets
  `site`. It lists every prerendered page except 404 and `prerender: false`;
  under prefix routing each entry carries `xhtml:link rel="alternate"
  hreflang`. A `public/sitemap.xml` wins, with a warning. Works without
  `i18n`. No index file past 50,000 URLs.
- **`<html dir>`** is set beside `<html lang>` on every prerendered page and
  on a client switch: `rtl` for right-to-left languages, decided from the
  tag's language and script. An ltr page drops only a shell `dir="rtl"`.

## Alternatives rejected

- **Prefix the default locale too (`/en/…`)** — the root then needs a redirect
  to exist at all; unprefixed default keeps existing URLs stable.
- **Geolocation** — needs an IP service, an edge header or a permission prompt,
  and location is not language.
- **A cookie for the stored choice** — only useful when a server or edge reads
  it; static hosts have neither. `localStorage['__puzzleLocale']` stays.
- **Guessing which `link()` paths are files** (extension heuristic, route
  lookup) — routes may contain dots, the static kernel has no route table, and
  a wrong guess is a silent dead link. The heuristic only quiets the warning.
- **`{ file: true }` / `{ static: true }` for the opt-out** — `static` already
  names the output mode; `locale: false` matches Next.js.
- **A separate `alternates` list or a top-level `app.locales`** — two lists
  named for the same thing; one rich `i18n.locales` serves switcher and code.
- **Compile-time href rewriting** — D79 already rejected it.
- **In-place locale switch under prefix routing** — the router's base would
  change mid-session.

## Consequences

- HTML output and `beforeMount` build-time reads multiply by the locale count;
  JS, CSS and assets do not.
- The inline redirect is the first executable inline script Puzzle emits.
- Known limits: a hybrid fallback page with no `meta.title` keeps the shell's
  default-language title; a `setLocale` during a pending guard targets the
  unguarded page; app code that rewrites the query with
  `history.replaceState` loses it on a switch.
- Tests: `tests/fixtures/locale-prefix-site` (static),
  `locale-prefix-hybrid` and `locale-prefix-spa` are real built fixtures;
  `tests/locale-redirect-build.test.js` runs the script a real build emits;
  `tests/locale-prefix-app.test.js` drives the built `examples/i18n`.

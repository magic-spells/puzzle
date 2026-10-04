---
name: >-
  D177 — Locale URL prefixes: i18n.routing 'prefix', one prerendered page per locale, link() adds
  the prefix
status: planned
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
own URLs and its own prerendered HTML. Without `routing`, behaviour and output
bytes are exactly [[DECISION-D175-TRANSLATIONS]] (one URL, client-side swap).
Target release 0.9.0. Status per part is in *Build state* at the end.

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
  locale does not exist and is not redirected.
- Under `routerBase` ([[DECISION-D51-ROUTER-BASE-PATH]]) the URL is
  `base + /<locale> + path`. Locale files, page modules and assets stay on the
  bare base — they are emitted once and shared.
- The build prerenders every page once per locale into `dist/<locale>/…`,
  default locale at the dist root. Each page has its own `<html lang>`, carries
  only its own locale's table island, and renders with its own format locale.
  `*` writes `dist/<locale>/404.html`; the dev/preview server tries
  `dist/<first-segment>/404.html` before the root one.
- The prerender loops locale by locale, sequentially, creating each locale's
  i18n service right before its pages (the format-locale slot is module state;
  creating all services up front leaves the last one active). Page-module slugs
  are per route path, shared by every locale.
- `beforeMount`'s build facade gains `locale`, since it now runs once per
  locale.

### Links

- `link(path)` and `router.url(path)` add the active locale's prefix, at build
  time and on the client. Templates and script never write a prefix:
  `router.push('/about')` is locale-less too.
- `link(path, { locale: 'es' })` forces one locale. `link(path, { locale: false })`
  skips the prefix and still applies `routerBase` — for files that exist once
  (`/files/resume.pdf`). Same options on `router.url`. (Next.js `<Link locale>`
  has the same two forms.)
- **One helper computes the base** — `localeBase(routerBase, locale,
  defaultLocale)` beside `encodeURL` — and all four encoders call it:
  `Router.url`, the router's write side, the static router stub
  (`ssg/assemble.js`) and the hybrid prerender's `routeRouter.url` shadow, which
  must be re-shadowed per locale. A parity test pins all four per locale
  ([[DECISION-D79-LINK-FUNCTION]] records the earlier drift).
- **Build warning** for a literal root-relative `href` on `<a>`/`<area>` when
  routing is on (it bypasses `link()` and silently sends a Spanish viewer to
  the default language). Skipped: `//host`, dynamic values, and a last segment
  with a file extension. Collected in the usage scan (config-dependent, so not
  a cached codegen warning). Not extended to `routerBase`-only apps.

### The i18n service

- **`i18n.locales` is the list a language switcher renders**: one entry per
  configured locale, in config order —
  `{ locale, label, href, active }`. `label` is the language's own name from
  `Intl.DisplayNames` (first letter upper-cased in that locale); `href` is the
  current page in that locale; `active` marks the current one. Without prefix
  routing `href` is the current page for every entry and a switcher calls
  `setLocale(entry.locale)`. **Breaking**: 0.8.0 exposed a `string[]`.
- **The URL decides the locale**: URL prefix, then (static) the page's island
  tag, beat the stored choice and `navigator.languages`.
- **`setLocale(tag)` navigates** in prefix mode: store the choice, then
  `location.assign` the same page under the other prefix (query and fragment
  kept). No fetch, no in-place rebuild — a full page load in every mode, so the
  router's base never changes while the app runs. The promise resolves once the
  navigation is issued.

### Head

- Every prerendered page gains `<link rel="alternate" hreflang>` for each
  locale plus `x-default` (the default locale's URL), tagged
  `data-puzzle-head="alternate"`, at build time.
- `hreflang` wants absolute URLs: a new optional top-level `site` config
  (`'https://example.com'`) supplies the origin. Without it the links are
  root-relative and the build warns once.
- A root-relative or same-origin canonical is localized per page; one that
  cannot be localized warns (an inherited absolute canonical would point every
  language at the default URL).
- **Translated head text**: `meta: { title: { t: 'products.title' } }` (and
  `description`) resolves through one `headText(value, i18n)` helper in
  `head.js`, at build time and in the client's title sync; the object branch
  sits behind `__PUZZLE_HAS_I18N__`. Works with or without prefix routing.

### First-visit redirect

A small inline script on unprefixed prerendered pages (the SPA does the same
at runtime). It redirects once to the matching prefixed URL when all hold:

- the URL itself has no locale prefix (checked on the URL, so it never misfires
  on a hybrid SPA fallback);
- the visitor did not arrive from the same origin (`document.referrer`), so a
  deliberate click to another language is never bounced back;
- the wanted locale is non-default — the stored choice if there is one,
  otherwise the first `navigator.languages` match (same matching as
  `selectLocale`). A stored default-locale choice suppresses it.

It is a second copy of `selectLocale`'s matching; both run against one shared
case table in tests. `i18n: { detect: false }` removes the script (strict CSP,
or sites that want no automatic redirect).

### Modes and validation

- `routing` accepts only `'prefix'`; any other value is a build error.
- Static and hybrid output and plain SPA path routing are covered. Hash and
  memory routing have no path to prefix: hybrid already rejects them, static
  ignores `routerMode`, and the SPA throws in `mount()` (the compiler cannot
  read `app.js`).
- A config-fact define, `__PUZZLE_HAS_LOCALE_ROUTING__`, gates every runtime
  branch, so apps without `routing` ship byte-identical bundles. The manifest
  carries `routing` only when set.
- **Collisions are build errors**: a route whose first segment equals a
  non-default locale tag, and a top-level `public/<locale>/` folder. The Router
  constructor throws on the route collision too.
- Router (hybrid/SPA): the path-mode base becomes `routerBase + prefix` in path
  reading, URL writing and click interception; route matching and `this.route`
  stay locale-free. A click on another locale's prefix is left to the browser
  as a real page load.
- Dev: a route re-renders in every locale; a locale-file edit stays
  render-wide ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]).

## Alternatives rejected

- **Prefix the default locale too (`/en/…`)** — the root then needs a redirect
  to exist at all; unprefixed default keeps existing URLs stable.
- **Geolocation** — needs an IP service, an edge header or a permission prompt,
  and location is not language.
- **A cookie for the stored choice** — only useful when a server or edge reads
  it; static hosts have neither. `localStorage['__puzzleLocale']` stays.
- **Guessing which `link()` paths are files** (extension heuristic, route
  lookup) — routes may contain dots, the static kernel has no route table, and
  a wrong guess is a silent dead link. The extension heuristic is used only to
  quiet the warning, where a wrong guess costs a missed warning.
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
- A sitemap is not emitted (none exists in any mode).

## Build state

Planned. Parts: Go config/manifest/define/warning; translated head; runtime
prefix core (`localeBase`, `link` options, `i18n.locales`, static kernel);
per-locale prerender with `hreflang` and the redirect; Go dev/preview
integration; router for hybrid and SPA; a `language-switcher` piece.

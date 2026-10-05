---
name: Static output kernel
status: verified
path: client-runtime/static/index.js
language: javascript
summary: mountStatic — the browser kernel that wakes a prerendered static page (no router).
connections:
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D175-TRANSLATIONS
  - FILE-SSG-ASSEMBLE
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# static/index.js

`mountStatic` — the browser kernel that wakes a prerendered `output: 'static'`
page with no router ([[DECISION-D81-STATIC-PAGES-MODE]], [[COMPONENT-SSG]]). It
wires the same build-time ctx the prerenderer wired, rehydrates the store from
the data island, then the D161 read state (records first — `hydrateReadState`
drops an absence whose record turned out present, which only works in that
order), assembles the page chain through the shared [[FILE-SSG-ASSEMBLE]], and
swaps the prerendered markup flash-free.

Translations ([[DECISION-D175-TRANSLATIONS]]), behind `__PUZZLE_HAS_I18N__`: the
kernel builds the i18n service from the virtual manifest (paths resolve against
the stub's normalized `routerBase`), sets `ctx.i18n`, installs `t`, and awaits
`__ready()` **before** `assembleChain`. The page's `data-puzzle-locale` island
answers its own locale with no request; without prefix routing a viewer in another
locale fetches once and the single mount swaps the default-language markup.
`setLocale` re-assembles the chain against the same stub, skips enters, destroys
the current root and mounts fresh (last-wins by token); store records survive. A
switch that lands before the remount is armed (a `mounted()` calling `setLocale`)
is replayed, not dropped. `__i18n` is an internal test seam, as on `PuzzleApp`.

**Translated title.** A `meta.title: { t: 'key' }` follows the active locale
(`syncLocaleTitle` → `syncTitle(headText(…))`): on load when the active locale
differs from the island's (the build already wrote the island locale's title), and
after every locale remount. A plain string title is left as the build wrote it.

**Locale prefix routing** ([[DECISION-D177-LOCALE-URL-PREFIXES]]), behind
`__PUZZLE_HAS_LOCALE_ROUTING__` and `manifest.routing === 'prefix'`: the URL
decides the locale — `urlLocale` (the path prefix after `routerBase`), then the
page's island tag (`islandLocale`), then the default — ahead of the stored choice
and `navigator.languages`, so an unprefixed page is always a default-locale page.
The stub is wrapped by `localizeRouterStub` for that locale, so `link()` hrefs carry
the prefix, and `setLocale` gets a `navigate` (`assignSameOrigin` unless a test seam
supplied one): it stores the choice and loads the same page under the other
prefix instead of remounting.

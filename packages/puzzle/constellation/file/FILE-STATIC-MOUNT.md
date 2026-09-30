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
answers the default locale with no request; a viewer in another locale fetches
once and the single mount swaps the default-language markup. `setLocale`
re-assembles the chain against the same stub, skips enters, destroys the current
root and mounts fresh (last-wins by token); store records survive. A switch that
lands before the remount is armed (a `mounted()` calling `setLocale`) is replayed,
not dropped. `__i18n` is an internal test seam, as on `PuzzleApp`.

---
name: Static output kernel
status: verified
path: client-runtime/static/index.js
language: javascript
summary: mountStatic — the browser kernel that wakes a prerendered static page (no router).
connections:
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
  - FILE-SSG-ASSEMBLE
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
      Translations in the static kernel (D175, v1.81), behind `__PUZZLE_HAS_I18N__`: `mountStatic`
      builds the i18n service from the virtual manifest (manifest paths resolve against the stub's
      normalized `routerBase`), sets `ctx.i18n`, installs `t`, and awaits `__ready()` before
      `assembleChain` — the page's `data-puzzle-locale` island supplies the default table with no
      request, and a viewer in another locale fetches once and the kernel's single mount swaps the
      prerendered default-language markup. `setLocale` re-assembles the page chain against the same
      stub, skips enters, destroys the current root, and mounts fresh into the target (last-wins by
      token); store records survive. `__i18n` is an internal test seam, as on PuzzleApp.
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]], static mode of [[DECISION-D81-STATIC-PAGES-MODE]]); this card anchors that plan to `client-runtime/static/index.js`.

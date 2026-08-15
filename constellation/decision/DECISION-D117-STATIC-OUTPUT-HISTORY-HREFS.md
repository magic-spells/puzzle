---
name: >-
  D117 — static output always emits history-style hrefs: routerMode is ignored under
  output:'static', with a build warning
status: verified
connections:
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D79-LINK-FORMATTER
  - COMPONENT-SSG
  - FILE-SSG-RUNTIME
verified_at: '2026-08-14T05:01:18.315Z'
verified_sha: d74916a0e021b6bb86394551171838fbab161347
notes:
  - kind: verified
    text: >-
      history forced in both stubs, warning emitted, unit + real static-docs build verified
      path-shaped hrefs
    sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

Under `output: 'static'`, the router stub that backs `router.url()` and the
`link` formatter is forced to `'history'` mode in BOTH the prerender pass
(`ssg/index.js`) and the browser kernel (`static/index.js`), regardless of the
app's configured `routerMode`. A configured `hash`/`memory` mode produces a
build warning saying it is ignored.

## Context

A 0.2.0 → 0.3.0 regression. The D81 hybrid guard throws for hash/memory —
its message actively tells hash-mode users to switch to static ("Use
`output: 'static'` for a non-path app"). Static then handed
`config.routerMode` straight to `makeRouterStub`, so the `link` formatter
prerendered `href="#/about"` while the page physically lives at
`/about/index.html`. Static pages install no router and no click
interception: those links did nothing. In 0.2.0 static had no `link`
formatter, so the raw path fell through and worked — D79's arrival turned the
passthrough into dead links.

## Decision

- `routerMode` is meaningless under static output: there is no router, and
  the emitted file layout is path-shaped by construction. Force the stub to
  `'history'` in both places — the prerendered HTML and the client re-render
  must produce **byte-identical** hrefs (the existing stub-equivalence rule).
- `routerBase` keeps flowing through: a based static site still wants
  prefixed hrefs.
- A configured `hash`/`memory` mode under static output pushes a
  `prerender()` warning (surfaced by the build like every other prerender
  warning) rather than throwing — the output is correct either way; the
  config is simply inert.
- [[DECISION-D81-STATIC-PAGES-MODE]]'s hybrid throw is untouched and remains
  hybrid-scoped — it was never wrong, just silent about static.

## Alternatives rejected

- **Throwing** like hybrid does — hybrid genuinely cannot work off path
  mode (the SPA takeover boots at '/'); static works fine, the user's
  `routerMode` is just irrelevant. A throw would break the very apps D81's
  error message sent here.
- **Emitting hash-shaped pages** to honor the config — there is no router to
  interpret `#/about` on a static page; the file layout is the URL space.

## Consequences

- `output: 'static'` + `routerMode: hashRouter()` apps get working path-shaped
  links again, plus a warning explaining why the mode is ignored.
- The D79 stub-equivalence property (prerender href === rehydration href)
  now holds under every routerMode, not just history.
- **Inert residual:** the Go-generated per-page entry (`prerender_pages.go`)
  still passes the app's configured `routerMode` into `mountStatic`, and the
  static summary still reports it — both now ignored by the kernel (the
  option is documented "accepted for entry-module compatibility only"). A
  Go-side cleanup could drop the passthrough, but a Go test pins it and the
  value is harmless; not worth the churn this round.

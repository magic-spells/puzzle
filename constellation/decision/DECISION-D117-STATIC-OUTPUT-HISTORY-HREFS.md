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
verified_at: '2026-08-23T19:55:13.483Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
notes:
  - kind: verified
    text: >-
      history forced in both stubs, warning emitted, unit + real static-docs build verified
      path-shaped hrefs
    sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

Under `output: 'static'`, the router stub that backs `router.url()` and the
`link` formatter emits path-shaped (history-style) hrefs in BOTH the prerender
pass (`ssg/index.js`) and the browser kernel (`static/index.js`), regardless of
the app's configured `routerMode`. The encoding is hard-coded in
`makeRouterStub` — the stub takes no mode at all — and a configured
`hash`/`memory` mode produces a build warning saying it is ignored.

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
  the emitted file layout is path-shaped by construction. The stub encodes
  path-shaped hrefs in both places — the prerendered HTML and the client
  re-render must produce **byte-identical** hrefs (the existing
  stub-equivalence rule), so the encoding is a constant of the mode rather than
  a parameter either caller can get wrong.
- `routerBase` keeps flowing through: a based static site still wants
  prefixed hrefs.
- A configured `hash`/`memory` mode under static output pushes a
  `prerender()` warning (surfaced by the build like every other prerender
  warning) rather than throwing — the output is correct either way; the
  config is simply inert.
- **`routerMode` never reaches the page.** The Go-generated per-page entry
  (`prerender_pages.go`) does not emit it and the static summary does not carry
  it, so `mountStatic` has no such option to ignore — the value cannot travel
  from app config to a static page at all. A Go test pins the absence.
- [[DECISION-D81-STATIC-PAGES-MODE]]'s hybrid throw is untouched and remains
  hybrid-scoped — it was never wrong, just silent about static.

## Alternatives rejected

- **Throwing** like hybrid does — hybrid genuinely cannot work off path
  routing (the SPA takeover boots at '/'); static works fine, the user's
  `routerMode` is just irrelevant. A throw would break the very apps D81's
  error message sent here.
- **Emitting hash-shaped pages** to honor the config — there is no router to
  interpret `#/about` on a static page; the file layout is the URL space.
- **Threading the mode through to the kernel as an accepted-but-ignored
  option** — an inert option is a standing invitation to make it live again;
  dropping it from the entry and the summary makes the guarantee structural.

## Consequences

- `output: 'static'` + `routerMode: hashRouter()` apps get working path-shaped
  links, plus a warning explaining why the mode is ignored.
- The D79 stub-equivalence property (prerender href === rehydration href)
  holds under every `routerMode`, not just the path-routing default.

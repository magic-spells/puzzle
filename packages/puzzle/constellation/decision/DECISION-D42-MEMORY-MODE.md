---
name: D42 — Memory routing (`memoryRouter()`, URL-less) + `go`/`back`/`forward` in every mode
status: verified
verified_at: '2026-11-01T19:23:24.972Z'
connections:
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - DOC-ROUTER
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DECISION-D34-HASH-ROUTING
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D159-ROUTER-MODE-FACTORIES
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/router/modes.js
  - client-runtime/router/router.js
  - client-runtime/app.js
---

# D42 — Memory routing (`memoryRouter()`, URL-less) + `go`/`back`/`forward`

`routerMode: memoryRouter({ initialPath })` from `@magic-spells/puzzle/router-modes` ([[DECISION-D159-ROUTER-MODE-FACTORIES]]) keeps the route entirely in router state: `location` and `history` are never read or written. For tests (no jsdom history fakery) and embedded widgets that must not touch the host page's URL. See [[DOC-SPEC-ROUTER]] §15.

## Decision

- **An in-memory entry stack replaces `history`.** Entries `{ path }` plus an index; `push()` truncates forward entries and appends. The whole pipeline — commit, tokens, transitions, nested chains — runs unchanged; only URL side effects vanish. The stack lives on the mode instance, which `create()` makes once per Router, so two routers never share it.
- **`go(n)` / `back()` / `forward()` exist in every mode.** Memory mode moves the index and runs the pipeline as a pop (out-of-range `n` is a silent no-op); path and hash routing delegate to `history.go(n)`. App code stays mode-agnostic.
- **No document-level side effects** (the mode is `urlless`): no popstate listener, no scroll management (`scrollBehavior` is accepted and ignored, [[DECISION-D33-ROUTER-SCROLL]]), no focus move or route announcement, and no `document.title`/head sync (a widget must not rename the host tab).
- **The click interceptor stays active**, so in-app `<a href="/about">` links route. Caveat (documented): it is document-global, so same-origin path links in a host page are intercepted too — the same trade hash mode makes.
- **`initialPath`** (default `'/'`) rides the mode object, so it cannot be set in URL modes, which read the URL.

## Alternatives rejected
- A `history` shim object — mimicking the History API costs more than the three seams it saves.
- Memory-only navigation methods — breaks the mode-agnostic app promise.
- Keeping title-setting, or stack-keyed scroll — document-level side effects an embed has no claim to (scroll could return if an embed asks).
- Disabling interception — an in-app link would do a full page load.
- Always starting at `'/'` — deep-linked embeds and tests would need an extra `push()` and `data()` round.

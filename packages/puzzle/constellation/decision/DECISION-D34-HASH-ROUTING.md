---
name: 'D34 — Hash routing: opt-in `hashRouter()`, path-shaped app API, popstate-only'
status: verified
verified_at: '2026-08-24T21:39:15.808Z'
connections:
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D30-NESTED-ROUTES
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/router/modes.js
  - client-runtime/router/router.js
  - client-runtime/app.js
---

# D34 — Hash routing: opt-in `hashRouter()`, path-shaped app API, popstate-only

`routerMode: hashRouter()` (from `@magic-spells/puzzle/router-modes`; [[DECISION-D159-ROUTER-MODE-FACTORIES]] owns the selection surface) carries the route in `location.hash` (`/#/user/123`), so static hosts with no rewrite rules (GitHub Pages, S3, `file://`) serve deep links and reloads. See [[DOC-SPEC-ROUTER]] §15.

## Decision
- **One Router, three URL seams.** The mode changes only how the router reads the URL, writes it (`pushState('#' + path)`, keeping the scroll key in `history.state`), and intercepts links. Commit ([[DECISION-D19-NAVIGATION-COMMIT]]), transitions, nested chains and scroll ([[DECISION-D33-ROUTER-SCROLL]]) are unchanged.
- **App code stays path-shaped.** Route definitions, `push('/user/123')`, `current.path` and params are identical in every mode; no `#` appears in app code, so the mode is a one-line config change.
- **popstate only.** Modern browsers fire `popstate` for fragment navigations; no `hashchange` listener.
- **Non-route fragments are ignored.** A fragment without a leading `/` is not the router's: it routes `/` on initial load and is ignored on a pop.
- **Path mode stays the default.** Hash mode is a hosting workaround. An unknown `routerMode` value (including a mode string) throws at construction naming the `/router-modes` import.
- `puzzle dev`'s history-API fallback stays; it is harmless in hash mode.

## Alternatives rejected
- A pluggable history-abstraction layer (Vue Router style) — over-engineering for modes that touch three seams in one file.
- A hash-shaped app API (`push('#/x')`) — forks every example and component by mode.
- A `hashchange` listener beside popstate — double-fires the pipeline.
- Normalizing bare fragments (`#faq` → `/faq`) — turns in-page anchors into spurious navigations.
- Hash as default or host auto-detection — clean paths are better wherever the host allows.
- `hashRouting: true` (no room for a third mode) or a nested `router: { mode }` (the config is flat, [[DECISION-D08-MINIMAL-CONFIG]]).

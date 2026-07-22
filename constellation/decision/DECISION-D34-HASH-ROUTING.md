---
name: "D34 — Hash routing: routerMode config, path-shaped API, popstate-only (v1.6)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
  - DECISION-D33-ROUTER-SCROLL
---

# D34 — Hash routing: routerMode config, path-shaped API, popstate-only (v1.6)

Opt-in hash mode (`routerMode: 'hash'`) carries the route in `location.hash` (`/#/user/123`) so static hosts with no rewrite rules can serve deep links and reloads. Settled (v1.6); router-only, additive. See [[DOC-SPEC]] §15 and [[DOC-ROUTER]].

## Context
Through v1.5 the router only ever routed off `location.pathname`, which forces every host to serve `index.html` for every app route (the history-API fallback `puzzle dev` provides). On a static host that can't be configured — GitHub Pages, an S3 bucket, `file://` — that fallback doesn't exist, so a deep link or a reload 404s. D34 adds an opt-in **hash mode** that carries the route in `location.hash` (`/#/user/123`), where the pathname never changes and no server rewrite is needed.

Hash mode touches exactly three seams in the one router file — reading the current URL (fragment vs pathname+search), writing it on push (`pushState('#' + path)`, which keeps the [[DECISION-D33-ROUTER-SCROLL]] scroll key in `history.state`), and the link interceptor — and nothing else: the [[DECISION-D19-NAVIGATION-COMMIT]] atomic commit, [[DECISION-D28-ANIMATIONS]] transitions, [[DECISION-D30-NESTED-ROUTES]] nested chains, and D33 scroll all apply unchanged. Additive like D28–D33: router-only, no compiler or runtime-kernel change; flat and nested routing are otherwise identical.

## Decision
Add an opt-in hash mode selected by a `routerMode` config enum. Sub-decisions, each with its rejected alternative:

- **One Router with a mode switch, not a history-abstraction layer.** A Vue-Router-style pluggable history object (`createWebHistory`/`createWebHashHistory`) was **rejected** as over-engineering for two modes: the mode only touches three seams in one file, and no third history implementation is planned. (A `'memory'` mode for tests would slot into the same `routerMode` enum if ever needed.)
- **The API stays path-shaped; the hash is a URL-encoding detail.** Making hash-mode apps write `push('#/x')` or hash-shaped route defs was **rejected**: it would fork every example, doc, and component between modes. The mode should be changeable in one config line, so route definitions, `push('/user/123')`, `current.path`, and params are identical in both modes — no `#` ever appears in app code.
- **popstate-only, no `hashchange` listener.** Also listening to `hashchange` was **rejected**: modern browsers fire `popstate` for fragment navigations, so a second listener means every manual hash edit double-fires the pipeline and needs dedupe bookkeeping. Vue Router 4 makes the same bet (its hash history is the HTML5 history with a `#` base).
- **Non-route fragments are ignored, not normalized.** Prepending `/` to a bare fragment (`#faq` → route `/faq`) was **rejected**: it would turn every in-page anchor traversal into a spurious navigation (usually to the catch-all). Instead a fragment without a leading `/` is "not ours" — it routes `/` on the initial load and is ignored entirely on a pop, leaving the rendered view alone.
- **Opt-in, history default.** Flipping the default (or auto-detecting the host) was **rejected**: clean pathname URLs are strictly better when the host supports them, so hash mode is a hosting workaround, not an upgrade. The default stays `'history'`; an omitted field is the exact v1.5 behavior.
- **Field name `routerMode`, an enum.** A boolean `hashRouting: true` was **rejected** as a dead end (no room for a future third mode); a nested `router: { mode }` object was **rejected** because the §2 surface is flat — `scrollBehavior` (D33) set that precedent.

## Alternatives rejected
- Vue-Router-style pluggable history-abstraction layer — over-engineering for two modes touching three seams in one file.
- Hash-shaped app API (`push('#/x')`, hash-shaped route defs) — would fork every example, doc, and component between modes.
- A `hashchange` listener alongside popstate — double-fires the pipeline, needs dedupe bookkeeping.
- Normalizing bare fragments (`#faq` → `/faq`) — turns in-page anchors into spurious navigations.
- Flipping the default to hash / auto-detecting the host — hash is a workaround, not an upgrade.
- Boolean `hashRouting: true` — dead end with no room for a third mode. Nested `router: { mode }` object — the §2 surface is flat.

## Consequences
`routerMode` is the **second amendment to the frozen §2 config surface** (after v1.5's `scrollBehavior`). The change is router-only: no compiler, runtime-kernel, or CLI change. `puzzle dev`'s history-API fallback stays in place — harmless in hash mode, since the pathname never moves.

Non-breaking: an omitted `routerMode` is the exact v1.5 behavior, and unknown values throw at construction (fail-fast); this is an additive amendment (v1.6).

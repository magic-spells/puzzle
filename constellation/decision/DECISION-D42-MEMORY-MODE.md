---
name: "D42 — routerMode: 'memory' (URL-less routing) + go/back/forward API (v1.11)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - DOC-ROUTER
  - DOC-SPEC
  - DECISION-D34-HASH-ROUTING
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D19-NAVIGATION-COMMIT
  - FEATURE-V1-11-MEMORY-MODE
---

# D42 — `routerMode: 'memory'` (URL-less routing) + go/back/forward API (v1.11)

The third `routerMode` value ([[DECISION-D34-HASH-ROUTING]] reserved the slot):
the route lives entirely in router state — `location` and `history` are never
read or written. For tests (no jsdom history gymnastics) and embedded/iframe
apps that must not touch the host page's URL. Ships with the first programmatic
history API — `router.go(n)` / `back()` / `forward()` — added in **all** modes.
See [[DOC-SPEC]] §15.

## Context
D34 built the mode seams (read-URL / write-URL / link-interceptor) and noted
memory mode "would slot into the same enum". The framework's own router tests
fake `history` through jsdom; consumers testing components that navigate have it
worse. Embeds (a Puzzle widget inside a non-Puzzle page) cannot use either
existing mode without clobbering the host URL.

## Decision
Sub-decisions, each with its rejected alternative:

- **An in-memory entry stack replaces `history`.** Entries `{ path }` plus an
  index; `push()` truncates any forward entries and appends (browser semantics).
  The full D19/D28/D30 pipeline — atomic commit, cancellation tokens, sequential
  transitions, nested chains — runs unchanged; only the URL side effects vanish.
  (Rejected: a `history` shim object — mimicking the History API to keep one code
  path costs more than the three seams it saves.)
- **`go(n)`/`back()`/`forward()` are added in all three modes.** In memory mode
  they move the stack index and run the pipeline as a pop; out-of-range `n` is a
  silent no-op (browser `history.go` semantics). In history/hash modes they
  delegate to `history.go(n)` — the popstate listener already handles the rest.
  This is the router's first programmatic back/forward surface; memory mode
  needs it (there is no browser chrome), the other modes get it for symmetry.
  (Rejected: memory-only methods — a mode-conditional API breaks the "app code
  is mode-agnostic" promise.)
- **No document-level side effects at all.** Memory mode registers no popstate
  listener and — deliberately — does **not** set `document.title` from
  `meta.title`: an embedded widget must not rename the host page's tab, and a
  test asserting title can use history mode. (Rejected: keeping title-setting —
  it is a document-level side effect exactly like the URL.)
- **Scroll management is a no-op in memory mode.** `scrollBehavior` is accepted
  but inert (documented). There are no history entries to key restoration off,
  and an embed shares the window with a host page the router has no claim on.
  Resolves the open question in the old FEATURE-ROUTER-MODES-FOLLOWUPS card the
  way it leaned. (Rejected: stack-entry-keyed scroll — plausible later if an
  embedded-app use case actually asks for it; opt-in complexity until then.)
- **The click interceptor stays active.** In-app `<a href="/about">` links must
  keep working — app code stays path-shaped and mode-agnostic (the D34
  principle). Same-origin pathname links route in memory; everything that falls
  through today still falls through. **Embed caveat (documented):** the
  interceptor is document-global, so same-origin path links in the *host* page
  would be intercepted too — the same accepted trade hash mode already makes;
  mount-scoped interception is a possible future refinement, not a v1.11 one.
  (Rejected: no interception in memory mode — an in-app link would then trigger
  a full page navigation, the worst outcome.)
- **`routerInitialPath` sets the first route.** With no URL to read, the initial
  navigation needs a source: a new optional PuzzleApp config field (Router
  option `initialPath`), default `'/'`, honored **only** in memory mode —
  setting it in history/hash mode is a constructor throw (fail-fast, like the
  mode enum and route-shape throws; the URL is the initial path in those modes,
  and a silently ignored field hides a config bug). Third amendment to the
  frozen §2 config surface, after `scrollBehavior` (v1.5) and `routerMode`
  (v1.6). (Rejected: always starting at `'/'` — deep-linked embeds and tests
  would need an awkward extra `push()` with an extra `data()` round.)

## Alternatives rejected
- **History-API shim, memory-only navigation methods, title-setting, scroll
  keying, interceptor removal, fixed `'/'` start** — each covered above.
- **Base-path support (the other half of the old followups card)** — still out;
  deciding it properly means deciding it for history mode too (which assumes
  root deployment today) — deliberate scope widening for a later amendment.

## Consequences
Router + one PuzzleApp config passthrough; no compiler or runtime-kernel change.
§2 gains `routerInitialPath`; §9 gains `go`/`back`/`forward` in all modes.
Non-breaking: existing apps are byte-identical; the new methods are additive.
The framework's own future tests (and consumers') can drop jsdom URL fakery.

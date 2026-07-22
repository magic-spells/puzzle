---
name: "D51 — One routerBase, applied at the path-shape boundary: pathname prefix (history), in-fragment prefix (hash), inert (memory) (v1.19)"
status: verified
connections:
  - DECISION-D34-HASH-ROUTING
  - DECISION-D41-SCROLL-ANCHORS-PERSISTENCE
  - DECISION-D42-MEMORY-MODE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - FEATURE-ROUTER-BASE-PATH
  - DOC-ROUTER
  - DOC-SPEC
verified_at: '2026-07-12T00:15:00.443Z'
verified_sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
notes:
  - kind: verified
    text: >-
      Decision implemented as written and verified at the merged main sha (480 vitest green); no
      deviations from the recorded contract.
    sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
  - kind: state
    text: >-
      Round-3 fix (fix/code-review-round3): click interception now also accepts the exact '#'+base
      fragment (→ push('/')), matching what #currentPath always accepted for initial/pop parsing.
      The "only #<base>/... fragments are routes" wording predates this — a hand-authored app-root
      link (href="#/myapp", the same shareable URL the parse path deliberately supports) no longer
      bypasses the router.
---

# D51 — One `routerBase`, applied at the path-shape boundary: pathname prefix (history), in-fragment prefix (hash), inert (memory) (v1.19)

The remaining half of the old router-modes follow-up (its memory half shipped as D42).
`routerBase: '/myapp'` in the PuzzleApp config serves the app under a sub-path in both
URL-carrying modes while route definitions, `push()`, `router.current`, `params`, and
`this.route` stay base-free. See [[DOC-SPEC]] §23.

## Context
History mode assumed root deployment; D42 deliberately deferred base support because
deciding it for hash mode meant deciding it for history mode too. The router already
funnels ALL URL contact through three seams: `#currentPath()` (read), the commit's
pushState (write), and the click interceptor.

## Decision
- **One config, applied at the path-shape boundary — mode-agnostic by construction.**
  Reads strip the base after the mode-specific raw read; writes prefix the base before
  the mode-specific encoding. History: `location.pathname` carries `/myapp/user/1`.
  Hash: the fragment carries it — `#/myapp/user/1` (the mode-translation rule stays
  exact: the entire path-shaped surface moves into the fragment, base included), and
  the D41 anchor convention composes untouched (`#/myapp/docs#faq` → strip base →
  `/docs#faq` → existing anchor split). Memory: no URL exists, so `routerBase` is
  **inert** (like `scrollBehavior` there) — one config object works across all modes
  in tests. (Rejected: mode-specific options; throwing in memory mode — D42's
  `routerInitialPath` throw guards a *meaningless* option, whereas an inert base lets
  the same app config run under the test mode.)
- **App code is base-free; hrefs are not.** `push('/user/1')`, matching, `current`,
  `params`, `this.route` never see the base. But an `<a href>` is a REAL document URL
  — middle-click, copy-link, open-in-new-tab must work — so hrefs carry the base
  (`href="/myapp/user/1"`, or relative). The history-mode interceptor intercepts only
  same-origin URLs **under the base** (stripping it on push); links outside the base
  fall through to the browser — a real navigation away from the app, which is *more*
  correct than today's intercept-everything. Hash mode mirrors it: with a base set,
  only `#<base>/...` fragments are routes; other `#/...` fragments are left to the
  browser like any non-route fragment. (Rejected: base-free hrefs rewritten at
  intercept time — breaks middle-click/new-tab, the whole point of an href.)
- **Normalization + fail-fast:** leading `/` ensured, trailing `/` trimmed, `''`/`'/'`
  → no base (default, zero behavior change); a base containing `#` or `?` is a
  constructor throw (config error posture, like unknown mode). Multi-segment bases
  work.
- **Loaded outside the configured base (history mode):** warn once and pass the
  pathname through un-stripped — typically the catch-all: visible and debuggable, not
  silent misrouting.

## Alternatives rejected
Covered above. Also rejected: reading the base from `<base href>` — implicit config
the router can't validate, and hash mode has no sane `<base>` story.

## Consequences
Router + config passthrough only (`routerBase` joins the §2 surface exactly as
`scrollBehavior`/`routerMode` did — passed through only when set). No compiler,
store, or view changes. Base-less apps byte-identical. Scroll keys (D41) are
unaffected — they ride `history.state`, not the URL.

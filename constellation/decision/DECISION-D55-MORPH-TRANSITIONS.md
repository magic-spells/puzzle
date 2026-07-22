---
name: "D55 — Shared-element morph route transitions: data-puzzle-morph pairing + a single router morph-handler slot (v1.23)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-ROUTER
  - FEATURE-MORPH-TRANSITIONS
  - DOC-ROUTER
  - DOC-SPEC
---

# D55 — Shared-element morph route transitions: `data-puzzle-morph` pairing + a single router morph-handler slot (v1.23)

Puzzle owns the shared-element transition **convention**; the spring mechanics
stay in `@magic-spells/morph-engine` (an optional peer). Two elements carrying
the same `data-puzzle-morph` value are the same logical surface; when a
navigation swaps one in or out, the router morphs between them. Apps opt in
with one line — `enableMorph(app)` from `@magic-spells/puzzle/morph`.

## Context

The morph engine (spring-driven container-transform blob) needs both elements
as live DOM at flight time, and needs the outgoing dialog to SURVIVE until the
reverse flight lands. Hand-wired integration takes four per-view touchpoints
(arm on click, show in `mounted()`, `await hide()` before `push()`, `stop()` in
`destroyed()`) and the browser back button closes instantly — the router
destroys route-mounted views with no out animation. But the router already has
both seams: the [[DECISION-D28-ANIMATIONS]] sequential OUT phase awaits before
destroy, and the IN commit block mounts synchronously pre-paint. What the
standalone wiring reconstructs badly (which navigation is happening, when
views mount and die), the router simply knows.

## Decision

- **Pairing is identity-based** (the `view-transition-name` / Hero-tag /
  layoutId model): `data-puzzle-morph="<shared-id>"` on both elements. The
  attribute names the surface; the navigation direction picks which way to fly.
  No role attribute — the dialog is target on open, source on close.
- **The router grows exactly ONE morph-agnostic slot**:
  `setMorphHandler({ enter(el, {initial}), leave(el): Promise|null })`. Two
  call sites in `#swap`: `leave(oldAnimator.element)` starts as the out phase
  starts and a returned promise is awaited (alongside `playOut()`) **before**
  `destroy()`; `enter(animatorElement, { initial: !cur })` fires synchronously
  post-commit, PRE-PAINT, so a pairing hides its elements before the plain
  mount ever paints. Handler errors are logged and swallowed — navigation
  never wedges. Null handler ⇒ byte-identical router.
- **All pairing/guard logic lives in `client-runtime/morph.js`**
  (`@magic-spells/puzzle/morph` subpath export): scan the mounted animator
  subtree for the first `[data-puzzle-morph]`, find a measurable counterpart
  OUTSIDE it, `engine.show(from, to)`. On leave, fly back only when the round
  trip is intact — target still in the leaving subtree, attribute value
  unchanged since show (a params-only task switch re-points content with NO
  swap, so the hooks never fire and the stale id must refuse the reverse
  flight), source still connected outside the leaving subtree (a whole-chain
  teardown takes the counterpart with it) — otherwise `engine.stop()`, instant
  close. Every enter starts from a clean engine (interrupted transitions can
  strand a run via the skipped-out path).
- **`initial: !cur` is the deep-link rule**: navigation #0 never morphs.
  `prefers-reduced-motion` disables morphing entirely (engine never engaged —
  distinct from [[DECISION-D28-ANIMATIONS]]'s zero-duration WAAPI, which still
  runs the hook sequence).
- **Dependency posture**: `@magic-spells/morph-engine` is an optional
  peerDependency (+ devDependency for in-repo examples); the core bundle is
  unaffected unless the app imports the subpath. In-repo builds get an explicit
  esbuild alias entry for `@magic-spells/puzzle/morph` (the bare alias points
  at index.js, a FILE — prefix substitution would break subpaths).

## Rejected alternatives

- **Per-view glue API** (arm/show/hide/stop calls in app code): four
  touchpoints per dialog, and back button can't morph — the exact wart this
  kills.
- **ViewManager-level pairing** (would cover `{#if}` toggles too): a patch
  removes elements synchronously; holding removed DOM for a leave animation is
  a full Vue-style transition system. Route-mounted dialogs are the real use
  case and the router has await points on both sides. `{#if}` morphs stay
  manual via the raw engine.
- **Promise-valued `animations.out`**: generalizes the wrong thing — the morph
  isn't a per-view animation, it's a cross-view pairing; a view field can't see
  the counterpart, and the enter side still needs the pre-paint scan.
- **`PuzzleApp` config flag** (`morph: true`): the core can't import the
  engine without bundling it for every app; the subpath import IS the
  tree-shaking boundary.
- **`router.push(path, { morphFrom })` disambiguator** for duplicate ids:
  deferred — document order + measurability picks the counterpart in v1.

## Consequences

Adding the effect to an app is: the attribute on both elements +
`enableMorph(app)`. Open, close, and browser back/forward all morph; deep
links and params-only switches never do. One morph pair per transition (one
engine); morph views should not also declare `animations.in/out`
(documented, not enforced). Verified by `tests/router-morph.test.js` (stub
handler: enter/initial semantics, leave-before-destroy ordering, params-only
silence, throw survival) and the `examples/kanban-morph` demo end-to-end.

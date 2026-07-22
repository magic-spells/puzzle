---
name: Morph integration (@magic-spells/puzzle/morph)
status: verified
framework: vanilla-js
connections:
  - DECISION-D55-MORPH-TRANSITIONS
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D69-MORPH-ROLES
  - FEATURE-MORPH-TRANSITIONS
  - FEATURE-V1-35-CROSS-VIEW-MORPH
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - DOC-ROUTER
  - FILE-MORPH
verified_at: '2026-07-17T23:33:29.572Z'
verified_sha: 10613c327cac6e46be4fc4f2ecb258cedcae5528
notes:
  - kind: gotcha
    text: >-
      A morph view that also fades needs a real box root. A puzzle-view root styled display:
      contents has no box, so opacity animation is a no-op and can leave overlay chrome fully
      visible while a fly-back is awaited. Use a box root for opacity animation, or a contents root
      with no view animation.
  - kind: gotcha
    text: >-
      An occluded Chrome window (not just a background tab — visibilityState goes hidden) freezes
      rAF, so a flight parks mid-air with show()'s promise pending and body scroll locked; on
      re-visibility the spring settles and the next enter's stop() recovers.
---

# Morph integration

The optional `@magic-spells/puzzle/morph` subpath is Puzzle's convention layer over the optional `@magic-spells/morph-engine` peer. `enableMorph(app, options?)` creates the engine, registers one router morph handler, and returns the engine for tuning. Apps that never import the subpath bundle none of it.

Three attributes share one identity namespace:

- `data-puzzle-morph="id"` launches and receives.
- `data-puzzle-morph-trigger="id"` launches only.
- `data-puzzle-morph-target="id"` receives only and wins over a plain duplicate landing.

Coexisting pairs take priority. On enter, the handler finds a measurable counterpart outside the entering animator and calls `show`. On leave, it calls `hide` only when the same id/target/source round trip is still intact; otherwise it stops immediately. The router checks its nav token after `playOut()` and again after awaiting the leave promise, so a superseded navigation abandons promptly instead of waiting on a possibly-never-settling `hide()`; the leave promise's rejection is swallowed at creation.

Sibling swaps use capture flights. Leave snapshots measurable launch elements before teardown and may pin a recently clicked source clone so it stays visually fixed during the outgoing fade. Enter flies that clone/snapshot into the first matching receiver. Skeleton views get a short-lived MutationObserver so the target may arrive at the skeleton-to-content swap. Captures are one-navigation, clone flights never establish a hide pair, and TTL/next-navigation cleanup handles failed or superseded work.

Initial navigation and reduced motion skip morphing. Engine errors never wedge routing. Clone attributes are stripped to avoid self-pairing, duplicate ids warn once, and a fresh enter stops any stale engine run before pairing.

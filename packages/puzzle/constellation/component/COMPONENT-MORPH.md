---
name: Morph integration (@magic-spells/puzzle/morph)
status: verified
framework: vanilla-js
connections:
  - DECISION-D55-MORPH-TRANSITIONS
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D69-MORPH-ROLES
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - DOC-ROUTER
  - FILE-MORPH
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Morph integration

The optional `@magic-spells/puzzle/morph` subpath (`client-runtime/morph.js`) is
Puzzle's convention layer over the optional `@magic-spells/morph-engine` peer.
`enableMorph(app, options?)` creates the engine, registers one router morph handler and
returns the engine; apps that never import it bundle none of it. Author contract:
[[DOC-SPEC-VIEW]] §37, [[DOC-ROUTER]].

## Pairing

Three attributes share one id namespace: `data-puzzle-morph` (launch + receive),
`data-puzzle-morph-trigger` (launch only), `data-puzzle-morph-target` (receive only; wins
over a plain duplicate). Coexisting pairs take priority. On enter, the handler finds a
measurable counterpart outside the entering animator and calls `show`; on leave it calls
`hide` only if the same id/target/source round trip is intact, else stops immediately.
The router rechecks its nav token after `playOut()` and after the leave promise, so a
superseded navigation never waits on a `hide()` that may not settle; that promise's
rejection is swallowed at creation.

Sibling swaps use capture flights: leave snapshots measurable launch elements before
teardown and may pin the recently clicked source clone; enter flies it into the first
matching receiver. Skeleton views get a short-lived MutationObserver so the target can
arrive at the skeleton → content swap. Captures last one navigation, never establish a
hide pair, and TTL/next-navigation cleanup handles failures. Initial navigation and
reduced motion skip morphing; engine errors never wedge routing; clone attributes are
stripped (no self-pairing); duplicate ids warn once; a fresh enter stops any stale run.

## Install lifecycle

`enableMorph` owns a capture-phase `document` click listener (to pin the clicked clone),
so the handler carries its own lifecycle: a module `installedMorphs` WeakMap (app →
teardown) makes a second `enableMorph` on the same app dispose the first. `dispose()`
(idempotent) removes the listener, drops `lastClicked`, discards captures and calls
`engine.stop()` — not `destroy()`, the engine stays reusable. `arm()` re-attaches. Both
ride on the handler passed to `setMorphHandler` (the router reads only `enter`/`leave`);
`PuzzleApp.unmount()` disposes and `mount()` re-arms the same object.

## Gotchas

- **The dismissed target is excluded from the leaving capture**:
  `captureFromLeaving(el, dismissed)` refuses to snapshot or pin the live pair's target
  after a D55 leave — otherwise a dialog's close button (inside the morph shell) leaves a
  frozen ghost behind the fly-back.
- **`PIN_CLONE_EXCLUDED_STYLES` must exclude `translate`/`scale`/`rotate`**, not only
  `transform`: the pin rect already includes them, so copying them double-applies.
  Verified NON-issues (don't re-investigate): logical inset/margin properties cause no
  drift (the pin's physical declarations win), and the `margin` entry never matches
  (longhands only) but `margin: 0` is re-applied after the copy loop. Remaining gap: an
  author inline `!important` still beats the pin.
- A morph view that also fades needs a real box root: a `display: contents` root has no
  box, so its opacity animation is a no-op.
- An occluded Chrome window freezes rAF; a flight parks mid-air (promise pending, body
  scroll locked) until visible again, and the next enter's `stop()` recovers.

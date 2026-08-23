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
verified_at: '2026-08-16T04:34:16.256Z'
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
  - kind: gotcha
    text: >-
      PIN_CLONE_EXCLUDED_STYLES must exclude the INDEPENDENT transform properties
      translate/scale/rotate, not just 'transform' (added in the pre-release review): the pin rect
      from getBoundingClientRect already includes them, so copying them onto the fixed-position
      clone double-applies (verified in real Chromium: translate:70px drifted the clone +70px;
      scale:2 doubled its size). Two adjacent claims were REFUTED during verification, don't
      re-fund: logical inset/margin properties (inset-inline-start etc.) cause NO drift without
      !important — the pin's later physical declarations win the cascade in LTR and RTL — and the
      'margin' entry in the excluded set never matches anything (CSSStyleDeclaration enumerates
      longhands only), which is harmless because margin:0 is re-applied after the copy loop. The
      residual known gap: any author inline style with !important (logical OR physical) still beats
      the pin's normal-priority declarations.
    sha: ed27cae
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
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

## Install lifecycle: `dispose` / `arm`

`enableMorph` owns a **capture-phase `document` click listener** (it records the
last clicked launch element so leave can pin exactly that clone). A document
listener outlives the app, so the handler carries its own lifecycle rather than
leaking one per install:

- A module-level `installedMorphs` WeakMap maps app → its live teardown. Calling
  `enableMorph` twice on the same app disposes the first install before building
  the second, so a duplicate listener can never stack. WeakMap so a discarded app
  and its teardown closure collect together.
- `dispose()` (idempotent) removes the listener, drops the possibly-detached
  `lastClicked` ref, discards captures, disarms the cross-flight, and stops a
  non-idle engine. It calls `engine.stop()`, **not** `destroy()` — the engine
  stays reusable.
- `arm()` re-attaches the listener and re-registers in the WeakMap, and is a
  no-op while still armed.

Both ride on the handler object passed to `setMorphHandler`. The router only ever
reads `enter`/`leave`, so the extra fields are inert to it; `PuzzleApp.unmount()`
disposes and `mount()` re-arms, which is what makes a mount → unmount → re-mount
cycle restore click-pinning on the **same** handler object.

**Gotcha — the dismissed target is excluded from the leaving capture.**
`captureFromLeaving(el, dismissed)` takes the live pair's target whenever leave
just ran the D55 path (fly-back *or* broken round trip) and refuses both to
snapshot it and to click-pin it. Without that exclusion a dialog's close button —
which sits *inside* the morph-marked shell, so the click hint resolves to the
shell itself — leaves a frozen ghost of the dialog hanging behind the fly-back.

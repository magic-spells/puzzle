---
name: 'D73 — Scroll-triggered enter animations: trigger: ''visible'' on the in spec'
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
  - DOC-SPEC-VIEW
  - DOC-VIEW-LIFECYCLE
  - DOC-USER-GUIDE
  - DECISION-D28-ANIMATIONS
verified_at: '2026-11-01T19:23:12.785Z'
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/animate.js
  - client-runtime/views/visibility.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D73 — Scroll-triggered enter animations: `trigger: 'visible'` on the `in` spec

`animations.in` (D28) takes an optional `trigger`: `'mount'` (default) or `'visible'` — the enter holds the element at its `from` keyframe and plays once when it scrolls into view. Runtime-only; the compiler never sees `animations`. Spec: [[DOC-SPEC-VIEW]] §39.

## Decision

- **`trigger` lives on the `in` spec** — triggering is a property of the enter phase. A `trigger` on `out` warns once and is ignored; a `triggerAnchor` without `trigger: 'visible'` arms nothing.
- **Hold = a paused WAAPI animation** at time 0 with `fill: 'both'` (`playAnimation({ paused })`), reusing the keyframe pipeline — no flash of natural-state content.
- **One shared IntersectionObserver per distinct rootMargin** (`views/visibility.js`, `observeVisible`), threshold 0. `triggerOffset` (px number or `'15%'`) maps to `rootMargin: '0px 0px -<offset> 0px'`, raising the trigger line above the viewport bottom. Observers disconnect when their last target disarms.
- **`viewWillShow`/`viewDidShow` bracket the actual reveal**, not the mount; `mounted()` timing is unchanged. Reveal is once per mount (a keyed remount re-reveals). `playIn()`'s promise stays pending until reveal or destroy; `destroy()` disarms, resolves it and skips the hooks.
- **`triggerAnchor: '<selector>'`** observes `this.element.closest(selector)` (ancestors only, resolved at arm time) so a whole section reveals as one unit; per-child `delay` choreographs it. Ancestor-only means the anchor always outlives the child. No match → warn once, observe own root. `{#for}` rows share one spec and reveal together.
- **Content is never stranded hidden** — every degradation lands on `'mount'`: no `IntersectionObserver` → play at mount; `prefers-reduced-motion` → no hold; bad `trigger`/`triggerOffset` → warn once and fall back; WAAPI throws → instant reveal; throwing show hooks are contained (D118).

## Alternatives rejected

- **Depend on `@magic-spells/scroll-trigger`** — scroll-spy semantics (one active section) don't fit per-element reveal, and the runtime has no dependencies; its offset model survives as `triggerOffset`.
- **CSS scroll-driven animations** — browser support, and it bypasses the WAAPI engine, hooks and reduced-motion handling.
- **A separate `animations.visible` key** — not a new phase.
- **Replay on every re-entry** — fights once-per-mount `#playedIn`.

## Gotchas

- `in.to` must still equal the natural resting style (fill release). Below-fold content sits at `from` (often invisible) until scrolled to — keep hero content on `'mount'`.
- On prerendered pages the markup renders in its natural state and below-fold components hold-and-reveal after takeover.
- Per-index stagger for `{#for}` rows is not built.

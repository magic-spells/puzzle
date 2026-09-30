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
verified_at: '2026-07-19T05:39:52.996Z'
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/animate.js
  - client-runtime/views/visibility.js
---

# D73 — Scroll-triggered enter animations: `trigger: 'visible'` on the `in` spec

`animations.in` (D28) takes an optional `trigger`: `'mount'` (default) or
`'visible'` — the enter holds the element at its `from` keyframe and plays once
when it scrolls into view. Runtime-only; the compiler never sees `animations`.
Spec: [[DOC-SPEC-VIEW]] §39.

## Decision

- **`trigger` lives on the `in` spec.** Triggering is a property of the enter
  phase; a `trigger` on `out` warns once and is ignored.
- **Hold = a paused WAAPI animation** at time 0 with `fill: 'both'`
  (`playAnimation({ paused })`), reusing the keyframe pipeline — no flash of
  natural-state content.
- **One shared IntersectionObserver per distinct rootMargin**
  (`views/visibility.js`, `Map<rootMargin, {io, targets: Map<Element, Set<cb>>}>`),
  threshold 0. `triggerOffset` (px number or `'15%'`) maps to
  `rootMargin: '0px 0px -<offset> 0px'`, raising the trigger line above the
  viewport bottom. Observers disconnect when their last target disarms.
- **`viewWillShow`/`viewDidShow` bracket the actual reveal**, not the mount;
  `mounted()` timing is unchanged. Reveal is once per mount (keyed remount
  re-reveals). `playIn()`'s promise stays pending until reveal or destroy (all
  callers are fire-and-forget); `destroy()` disarms and resolves it and skips
  the hooks.
- **`triggerAnchor: '<selector>'`** observes `this.element.closest(selector)`
  (ancestors only, resolved at arm time) so a whole section reveals as one
  unit; per-child `delay` choreographs it. Ancestor-only means the anchor always
  outlives the child. No match → warn once, observe own root. `{#for}` rows
  share one spec and reveal together; a per-index stagger is deferred.
- **Content is never stranded hidden** — every degradation lands on `'mount'`:
  no `IntersectionObserver` → play at mount; `prefers-reduced-motion` → no hold;
  bad `trigger`/`triggerOffset` → warn once and fall back; WAAPI throws →
  instant reveal; throwing show hooks are contained (D118).

## Alternatives

- **Depend on `@magic-spells/scroll-trigger`** — rejected: scroll-spy semantics
  (one active section) mismatch per-element reveal, and the runtime has no
  dependencies; its offset model survives as `triggerOffset`.
- **CSS scroll-driven animations** — rejected: browser support, and bypasses the
  WAAPI engine, hooks and reduced-motion handling.
- **A separate `animations.visible` key** — rejected: not a new phase.
- **Replay on every re-entry** — rejected: fights once-per-mount `#playedIn`.

## Consequences

- `in.to` must still equal the natural resting style (fill release). Below-fold
  content sits at `from` (often invisible) until scrolled to; keep hero content
  on `'mount'`.
- On prerendered pages the markup renders in natural state and below-fold
  components hold-and-reveal after takeover.

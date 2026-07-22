---
name: Animation and visibility runtime
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DECISION-D28-ANIMATIONS
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
  - FILE-ANIMATE
  - FILE-VISIBILITY
verified_at: '2026-07-22T00:04:07.016Z'
---

# Animation and visibility runtime

Normalizes all view/component motion over the Web Animations API. `playAnimation` validates `{ from, to, duration, easing?, delay? }`, applies `fill: 'both'`, returns a uniform `{ finished, cancel, play }` handle, and guarantees that `finished` resolves after success, cancellation, malformed input, missing WAAPI, or reduced motion. Enter effects release ownership back to CSS after finishing; leave effects hold until teardown.

Every failure degrades to visible content. Malformed specs warn once and finish immediately. A throwing `play()` cancels the held effect so the element cannot remain hidden. `cancelAnimations` restores an outgoing root after a navigation that animated out but failed before commit.

D73 extends enter specs with `trigger: 'visible'`, `triggerOffset`, and optional ancestor `triggerAnchor`. PuzzleView creates a paused enter at its from keyframe, then `visibility.js` starts it on the first intersection. Hooks bracket the actual reveal, not mount. Reduced motion, missing IntersectionObserver, invalid values, or missing anchors fall back to mount-trigger behavior.

The visibility registry shares one IntersectionObserver per rootMargin and stores a callback set per observed element, so several anchored children can reveal from one section without duplicate observers. Observations are one-shot; destroy-before-reveal disarms and resolves pending work.

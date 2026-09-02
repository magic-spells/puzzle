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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: gotcha
    text: >-
      playOut() captures `shown = #mounted` BEFORE it arms #leaving, and skips both hide hooks and
      the out spec when it is false (D28: the brackets pair with the mount). The capture order is
      what makes that readable rather than subtle — #completeMount refuses to run on a leaving view,
      so once #leaving is set the flag can no longer move, and both the main task and the
      spent-#outTask branch read the same value. A never-shown view still becomes #leaving,
      unsubscribes from the store, and cancels a running enter animation; only the bracket and the
      out are skipped. Note that a skeleton view does NOT qualify as never-shown: the skeleton
      render completes its mount.
---

# Animation and visibility runtime

Normalizes all view/component motion over the Web Animations API. `playAnimation` validates `{ from, to, duration, easing?, delay? }`, applies `fill: 'both'`, returns a uniform `{ finished, cancel, play }` handle, and guarantees that `finished` resolves after success, cancellation, malformed input, missing WAAPI, or reduced motion. Enter effects release ownership back to CSS after finishing; leave effects hold until teardown.

Every failure degrades to visible content. Malformed specs warn once and finish immediately. A throwing `play()` cancels the held effect so the element cannot remain hidden. `cancelAnimations` restores an outgoing root after a navigation that animated out but failed before commit.

D73 extends enter specs with `trigger: 'visible'`, `triggerOffset`, and optional ancestor `triggerAnchor`. PuzzleView creates a paused enter at its from keyframe, then `visibility.js` starts it on the first intersection. Hooks bracket the actual reveal, not mount. Reduced motion, missing IntersectionObserver, invalid values, or missing anchors fall back to mount-trigger behavior.

The visibility registry shares one IntersectionObserver per rootMargin and stores a callback set per observed element, so several anchored children can reveal from one section without duplicate observers. Observations are one-shot; destroy-before-reveal disarms and resolves pending work. The reveal's user hooks are guarded (D118): a throwing `viewWillShow`/`viewDidShow` is logged, the held animation still plays, and `playIn()` settles — the reveal fires from an observer delivery no caller can observe, so an unguarded throw stranded content at its `from` keyframe.

---
name: Animation and visibility runtime
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DECISION-D28-ANIMATIONS
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
  - DECISION-D118-LIFECYCLE-HOOK-CONTAINMENT
  - DOC-SPEC-VIEW
  - FILE-ANIMATE
  - FILE-VISIBILITY
verified_at: '2026-11-01T19:26:46.557Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Animation and visibility runtime

`views/animate.js` runs all view/component motion over the Web Animations API
(author contract: [[DOC-SPEC-VIEW]] §12/§39). `playAnimation` validates
`{ from, to, duration, easing?, delay? }`, applies `fill: 'both'`, and returns a
uniform `{ finished, cancel, play }` handle whose `finished` always resolves:
after success, cancellation, malformed input, missing WAAPI or reduced motion
(durations and delays become 0). Enter effects release their fill back to CSS
when done; leave effects hold until teardown.

Every failure degrades to visible content. A malformed spec warns once and
finishes immediately; a throwing `play()` cancels the held effect so nothing stays
hidden. After a navigation that animated a view out but failed before commit, the
router calls `_restoreFromLeaving()`: it cancels the Puzzle-owned out animation
(`_cancelOutAnimation()`, never `getAnimations()`, so app-owned motion is left
alone), fires the show bracket, and re-subscribes the view.

**`playOut()` captures `shown = #mounted` BEFORE arming `#leaving`**, and skips the
hide hooks and the out spec when it is false: the hide bracket pairs with the
mount ([[DECISION-D28-ANIMATIONS]]). Once `#leaving` is set, `#completeMount`
refuses to run, so `shown` can't change underneath. A never-shown view still
becomes leaving, unsubscribes and cancels a running enter. A skeleton view counts
as shown; the skeleton render completes its mount.

**Visible trigger** ([[DECISION-D73-SCROLL-TRIGGER-ANIMATIONS]]):
`trigger: 'visible'`, `triggerOffset`, optional ancestor `triggerAnchor`. The view
creates a paused enter at its `from` keyframe, and `views/visibility.js` starts it
on first intersection; the hooks bracket the reveal, not the mount. Reduced
motion, no IntersectionObserver, invalid values or a missing anchor fall back to
the mount trigger. The registry shares one IntersectionObserver per rootMargin
with a callback set per element; observations are one-shot; destroy before reveal
disarms and resolves. Reveal hooks are contained
([[DECISION-D118-LIFECYCLE-HOOK-CONTAINMENT]]): a throwing `viewWillShow`/
`viewDidShow` is logged and the animation still plays, because the reveal fires
from an observer callback no caller can observe.

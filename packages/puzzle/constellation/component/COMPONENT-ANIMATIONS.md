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
---

# Animation and visibility runtime

`views/animate.js` normalizes all view/component motion over the Web Animations API
(author contract: [[DOC-SPEC-VIEW]] §12/§39). `playAnimation` validates
`{ from, to, duration, easing?, delay? }`, applies `fill: 'both'`, returns a uniform
`{ finished, cancel, play }` handle, and `finished` always resolves — after success,
cancellation, malformed input, missing WAAPI or reduced motion. Enter effects release
ownership back to CSS when done; leave effects hold until teardown.

Every failure degrades to visible content: malformed specs warn once and finish
immediately; a throwing `play()` cancels the held effect so nothing stays hidden;
`cancelAnimations` restores an outgoing root after a navigation that animated out but
failed before commit.

**`playOut()` captures `shown = #mounted` BEFORE arming `#leaving`**, and skips both hide
hooks and the out spec when it is false (D28: the brackets pair with the mount). Once
`#leaving` is set `#completeMount` refuses to run, so the flag can't move and both the
main task and the spent-`#outTask` branch read the same value. A never-shown view still
becomes leaving, unsubscribes, and cancels a running enter. A skeleton view DOES count as
shown — the skeleton render completes its mount.

**Visible trigger** (D73): `trigger: 'visible'`, `triggerOffset`, optional ancestor
`triggerAnchor`. PuzzleView creates a paused enter at its `from` keyframe and
`views/visibility.js` starts it on first intersection; hooks bracket the reveal, not the
mount. Reduced motion, no IntersectionObserver, invalid values or a missing anchor fall
back to mount-trigger. The registry shares one IntersectionObserver per rootMargin with a
callback set per element; observations are one-shot; destroy-before-reveal disarms and
resolves. Reveal hooks are guarded (D118): a throwing `viewWillShow`/`viewDidShow` is
logged and the held animation still plays — the reveal fires from an observer callback no
caller can observe, so an unguarded throw would strand content at `from`.

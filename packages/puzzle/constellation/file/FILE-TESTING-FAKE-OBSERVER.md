---
name: controllable IntersectionObserver fake
status: verified
path: client-runtime/testing/fake-observer.js
language: javascript
summary: >-
  installFakeObserver: a driveable IntersectionObserver stand-in exposing observers, trigger, and
  restore.
connections:
  - COMPONENT-TESTING
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# testing/fake-observer.js

`installFakeObserver()`, a driveable `IntersectionObserver` stand-in for jsdom ([[DECISION-D94-TESTING-EXPORT]]): it records observers, lets a test `trigger` intersections, and `restore`s the original global. It exposes enough per-observer state to assert D73 `rootMargin` sharing and cleanup ([[DECISION-D73-SCROLL-TRIGGER-ANIMATIONS]]).

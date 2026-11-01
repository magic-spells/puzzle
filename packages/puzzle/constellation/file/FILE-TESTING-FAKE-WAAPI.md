---
name: controllable Web Animations fake
status: verified
path: client-runtime/testing/fake-waapi.js
language: javascript
summary: >-
  installFakeAnimate: a recording Element.animate/getAnimations stand-in with manual finish and
  restore.
connections:
  - COMPONENT-TESTING
  - DECISION-D94-TESTING-EXPORT
  - COMPONENT-ANIMATIONS
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# testing/fake-waapi.js

`installFakeAnimate({ spy })`, a recording `Element.animate`/`getAnimations` stand-in with manual finish and `restore` ([[DECISION-D94-TESTING-EXPORT]]), so tests can drive enter/leave animations ([[COMPONENT-ANIMATIONS]]) step by step in jsdom, which has no Web Animations API.

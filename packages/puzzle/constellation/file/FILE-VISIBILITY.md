---
name: visibility trigger registry
status: verified
path: client-runtime/views/visibility.js
language: javascript
summary: Shared IntersectionObserver registry for visible-trigger enter animations.
connections:
  - COMPONENT-ANIMATIONS
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# visibility.js

`observeVisible(el, rootMargin, callback)`: the shared IntersectionObserver registry behind `trigger: 'visible'` enter animations ([[COMPONENT-ANIMATIONS]], D73). Every observation with the same `rootMargin` shares one observer; one element may carry several callbacks (`triggerAnchor`), and an observer disconnects when its last target disarms.

**Never throws.** Without an `IntersectionObserver` global (jsdom) it returns `null` and the caller falls back to mount-trigger behavior, so content is never stranded hidden; a throwing observe or callback is logged and swallowed.

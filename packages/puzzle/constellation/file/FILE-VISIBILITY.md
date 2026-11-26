---
name: visibility trigger registry
status: verified
path: client-runtime/views/visibility.js
language: javascript
summary: Shared IntersectionObserver registry for visible-trigger enter animations.
connections:
  - COMPONENT-ANIMATIONS
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# visibility.js

`observeVisible(el, rootMargin, callback)`: the shared IntersectionObserver registry behind `trigger: 'visible'` enter animations ([[COMPONENT-ANIMATIONS]], D73). Every observation with the same `rootMargin` shares one observer; one element may carry several callbacks (`triggerAnchor`), and an observer disconnects when its last target disarms.

**Never throws.** Without an `IntersectionObserver` global (jsdom) it returns `null` and the caller falls back to mount-trigger behavior, so content is never stranded hidden; a throwing observe or callback is logged and swallowed.

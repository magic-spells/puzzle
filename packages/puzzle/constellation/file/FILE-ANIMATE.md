---
name: animation runtime
status: verified
path: client-runtime/views/animate.js
language: javascript
summary: Failure-safe Web Animations API wrapper and reduced-motion handling.
connections:
  - COMPONENT-ANIMATIONS
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# animate.js

The Web Animations API wrapper behind enter and leave animations
([[COMPONENT-ANIMATIONS]]). Imported by `PuzzleView.js`, and by `flip.js` for
`prefersReducedMotion` only (FLIP moves call `el.animate` themselves); it
imports nothing.

- **Never throws.** Missing WAAPI (jsdom), a malformed spec or rejected keyframes
  degrade to an instant finish; the element always ends visible.
- **`finished` always resolves**, including on cancel (WAAPI rejects with
  AbortError), so callers can await it once on navigation interrupts and
  destroy-during-leave.
- **Reduced motion zeroes durations but still resolves asynchronously**, so hook
  order is identical either way.
- Malformed-spec warnings are warn-once per spec object (WeakSet/WeakMap).

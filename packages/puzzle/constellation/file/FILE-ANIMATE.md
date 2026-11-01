---
name: animation runtime
status: verified
path: client-runtime/views/animate.js
language: javascript
summary: Failure-safe Web Animations API wrapper and reduced-motion handling.
connections:
  - COMPONENT-ANIMATIONS
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# animate.js

The one wrapper around the Web Animations API ([[COMPONENT-ANIMATIONS]]): nothing
else in the runtime calls `el.animate` directly. Imported by `PuzzleView.js` and
`flip.js`; it imports nothing.

- **Never throws.** Missing WAAPI (jsdom), a malformed spec or rejected keyframes
  degrade to an instant finish; the element always ends visible.
- **`finished` always resolves**, including on cancel (WAAPI rejects with
  AbortError), so callers can await it once on navigation interrupts and
  destroy-during-leave.
- **Reduced motion zeroes durations but still resolves asynchronously**, so hook
  order is identical either way.
- Malformed-spec warnings are warn-once per spec object (WeakSet/WeakMap).

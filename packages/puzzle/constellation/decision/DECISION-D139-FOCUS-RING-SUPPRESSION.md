---
name: 'D139 — Focus-ring suppression on the router''s transient focus stamp'
status: verified
connections:
  - COMPONENT-ROUTER
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - DECISION-D135-REPLACE-FOCUS-PARITY
  - DOC-SPEC-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/router/router.js
---

## Context

D93 focuses the committed leaf view root after every navigation by stamping a
transient `tabindex="-1"`. On keyboard or back/forward navigation the UA's
`:focus-visible` draws a ring around the whole view; app `*:focus` rules and
Tailwind `focus:ring-*` (a `box-shadow`) draw it too. The root is a
programmatic-only target, never a Tab stop, so the ring invites no action
(WCAG 2.4.7 applies to keyboard-operable UI); focus position and the
announcement carry the accessibility.

## Decision

- In the branch that stamps `tabindex="-1"`, the router sets inline
  `outline: none !important` and `box-shadow: none !important`, and removes
  both in the same `{ once: true }` blur listener that lifts the tabindex.
- Prior inline values are captured (`getPropertyValue` +
  `getPropertyPriority`) and restored verbatim; absent ones are removed.
- An element with an author-set `tabindex` is never stamped, so it keeps its
  ring.

## Alternatives

- App-level CSS (`puzzle-view:focus { outline: none }`) — every app has the
  noise by default; the framework creates the focus, so it owns the cosmetics.
- A runtime-injected stylesheet — more machinery, and an app `!important` rule
  would still win.
- Suppress `outline` only — leaves the `box-shadow` ring.

## Consequences

- A custom `focusBehavior` returning a natively focusable control without an
  explicit `tabindex` is stamped: it is not a Tab stop and has no ring until
  blur. Give it `tabindex="0"` to keep the ring.
- A rerender that rewrites the root's `style` attribute while focused can drop
  the suppression early; harmless (the ring can only reappear).

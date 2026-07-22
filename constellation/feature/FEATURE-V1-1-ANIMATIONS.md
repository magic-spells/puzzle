---
name: "v1.1 — View & component animations"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D28-ANIMATIONS
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - DOC-VIEW-LIFECYCLE
  - DOC-SPEC
---

# v1.1 — View & component animations

The first post-v1 amendment: the reserved `animations` class field graduates from inert to a shipped enter/leave animation system on the Web Animations API, with four lifecycle hooks and sequential route transitions. Driven by [[DECISION-D28-ANIMATIONS]].

## Intent
v1 shipped `animations` as a reserved-but-inert class field (D3, SPEC §4) and had no motion story — route swaps and component mounts were instant. v1.1 makes declarative enter/leave animation a first-class feature without a wrapper element or a new build step.

## Scope
**In:** declarative `animations = { in, out }` specs (`{ from, to, duration, easing?, delay? }`) driving `el.animate([from, to], { fill: 'both' })` on the instance's root element (no wrapper); the `viewWillShow`/`viewDidShow` and `viewWillHide`/`viewDidHide` hook pairs (fire in order even with no `animations` field — zero-duration lifecycle, not animation callbacks); sequential route transitions (old `out` → destroy → mount new → `in`), one animator per transition; fire-and-forget enters with a fill-release contract; `prefers-reduced-motion` zeroing; jsdom/no-`el.animate` instant-finish degrade; the fixed-height inner-content collapse recipe.
**Out (deferred/rejected):** a dedicated `<puzzle-component>` wrapper element (rejected — reintroduces D20's wrapper explosion), overlapping/cross-fade transitions (deferred then — shipped later as v1.24, [[DECISION-D56-OVERLAP-TRANSITIONS]]), awaited enters, and animating both a layout and its view on one transition. Full rationale and the five sub-decisions each with their rejected alternative live in [[DECISION-D28-ANIMATIONS]].

## Outcome
Shipped in v1.1; documented in [[DOC-SPEC]] §12 and [[DOC-VIEW-LIFECYCLE]]. An additive amendment over the frozen SPEC — `destroy()` stays synchronous, existing callers and error paths unaffected. The URL still commits first (D19 untouched). Touched [[COMPONENT-PUZZLE-VIEW]] (hooks + animation field), [[COMPONENT-ROUTER]] (transition sequencing), and [[COMPONENT-VIEW-MANAGER]] (animation play/release).

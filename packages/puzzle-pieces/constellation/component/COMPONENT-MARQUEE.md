---
name: Marquee wrapper over scrolling-content
status: built
framework: puzzle
props:
  - name: direction
    type: '''left'' | ''right'''
  - name: speed
    type: number
  - name: pauseOnHover
    type: boolean
  - name: drag
    type: boolean
  - name: gap
    type: number
  - name: fade
    type: boolean | string
  - name: class
    type: string
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DOC-REGISTRY
---

Single-file wrapper over `@magic-spells/scrolling-content` 2.1.0 (0.7.0,
feat/select-marquee-quantity), replacing the 364-line port (its own rAF loop, clone
rebuild in `afterUpdate`, drag, hover gate). Vertical `up`/`down` is DROPPED — upstream
has no vertical mode and no call site used it; it is an upstream feature if wanted.
`fade` is new (upstream had it). `paused` is deliberately not exposed: upstream reflects
it and a binding would fight the patcher.

## The piece pre-authors the track

The wrapper renders `<scrolling-content><scrolling-track><scrolling-item><Children/>`
itself. Upstream adopts an existing track/item and then moves nothing, so Puzzle's
patcher inserts and patches children where they already live. Without that, upstream
would relocate Puzzle-owned nodes two levels down and later inserts would land outside
the track. The host must contain the track/item at connect time (Puzzle's normal order).

## What went upstream (2.1.0)

A MutationObserver on the source `<scrolling-item>` (`childList`, `characterData`,
`subtree`, one-rAF coalesced) that drops every clone and refills — the port's
`afterUpdate` rebuild, moved to where it belongs; public `rebuild()`; `data-clone` on
clones (already `aria-hidden` + `inert`); a `/css` export detected on the host by a
`--scrolling-content-styles` sentinel so the import-time `<style>` injection is skipped;
`pointerenter`/`pointerleave` gated on `pointerType === 'mouse'` (a touch tap used to
pause forever); the pre-upgrade hide rule split so pre-authored markup shows as a static
row and old browsers without `:has()` keep the 2.0.0 behaviour.

## Gotchas

- All bound attributes are observed and never written back, so plain bindings suffice
  (`direction`/`speed` change mid-scroll with no restart). `gap` becomes
  `--scrolling-content-gap` in the inline style; a length `fade` also goes into the
  inline style so upstream's `setProperty` and the patcher's wholesale `style` rewrite
  agree (bare `fade` is excluded because upstream REMOVES the property there).
- First paint after upgrade is one static row; clones arrive on the ResizeObserver's
  first callback a frame later.
- The observer is pinned to the `<scrolling-item>` element present at connect. Patching
  inside it is fine; re-creating that element strands the clones — call
  `element.rebuild()`.
- Clone count only grows on resize (upstream, out of scope).

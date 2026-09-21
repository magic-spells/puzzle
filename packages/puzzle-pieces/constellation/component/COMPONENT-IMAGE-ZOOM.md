---
name: ImageZoom wrapper over image-zoom
status: built
framework: puzzle
props:
  - name: src
    type: string
    required: true
  - name: alt
    type: string
  - name: min
    type: number
  - name: max
    type: number
  - name: aspect
    type: string
  - name: loading
    type: '''lazy'' | ''eager'''
  - name: label
    type: string
  - name: class
    type: string
  - name: style
    type: string
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DOC-REGISTRY
---

Single-file wrapper over `@magic-spells/image-zoom` 0.1.0 (0.8.0,
feat/piece-image-zoom). Pinch-to-zoom and pan for one image: two-finger pinch,
one-finger pan once zoomed, double-tap / double-click toggle between `min` and `max`,
sqrt-damped rubber band past either end with an animated snap back. Nothing is ported —
the piece renders the real `<image-zoom>` element, binds `min`/`max`, and upgrades it
with a dynamic import in `mounted()`.

Why wrap: the package is a pointer/touch state machine (a pinch and a pan handing each
other fingers, midpoint-anchored scaling, translate clamping against the contained image
box, a 300ms/20px double-tap discriminator, a ResizeObserver that doubles as the late-init
path for an element that was `display:none` at connect). None of it is markup, and the
translation is where a fork's bugs would come from.

## The image is a prop, not a slot

`connectedCallback` runs `querySelector('img')` ONCE, caches the element, and from then
on writes the pan/zoom transform into its `style.transform` every frame. Slotting the
image would let a caller put a dynamic `style={ … }` binding on it — the patcher rewrites
that attribute wholesale and would wipe the transform (same rule as morph elements and
`<scroll-stack-item>`) — or hide it behind an `{#if}`, stranding the cached reference. So
`src`/`alt` are props, the piece writes the `<img>` itself, and nothing binds its style.
A `<picture>` or a srcset is a change to the piece, not a slot.

## A src change re-attaches the host

The component measures the natural size and the contain-fit base scale once at connect
and has no attribute for a new source, so a gallery that flips `src` would keep the old
base scale. `afterUpdate()` detects the change (edge-triggered against `#lastSrc`) and
removes/re-inserts the host at the same position: one disconnect/connect pair on the same
node, which is the lifecycle the component already handles, and which the patcher does not
notice. Zoom returns to `min` on a swap — what a gallery wants anyway.

## Not controlled

Zoom is the element's for the whole duration of a gesture, so there is no `scale` prop —
a bound one would fight every pinch frame the patcher rendered through. The piece reports
instead (`@change(scale, { translateX, translateY })`, `@zoomStart(scale)`,
`@zoomEnd(scale)`) and hands the upgraded element out through `@ready(element)` for
`reset()` / `zoomTo()`. Same shape as the wrapped overlays.

## Gotchas

- `@change` fires once per animation frame during a gesture. A parent that puts it in
  state must round or debounce first.
- Listeners are bound in `mounted()` before the module lands — `addEventListener` works on
  an un-upgraded element, so the first fit's `image-zoom:change` is never missed.
- `zoomed` / `gesturing` / `transitioning` are written BY the component; the template
  binds none of them.
- `@import "@magic-spells/image-zoom/css" layer(components)` is REQUIRED: the overflow
  clip, the aspect ratio, the absolute `transform-origin: 0 0` image box and the
  `touch-action` switch that hands a one-finger swipe back to page scroll all live there.
  Unlayered it would outrank the `aspect-*` / `rounded-*` / `bg-*` utilities on the host.
- No keyboard zoom upstream — the piece is an enhancement over a normal image, never the
  only way to see detail. `label` writes `role="group"` + `aria-label` only when given.

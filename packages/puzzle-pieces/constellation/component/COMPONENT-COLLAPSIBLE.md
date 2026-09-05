---
name: Collapsible + Accordion families
kind: piece
status: built
framework: puzzle
props:
  - name: open
    type: boolean
  - name: value
    type: string | string[]
  - name: defaultValue
    type: string | string[]
  - name: type
    type: '''single'' | ''multiple'''
  - name: defaultOpen
    type: boolean
  - name: speed
    type: number
  - name: disabled
    type: boolean
variants:
  - single
  - multiple
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
notes:
  - kind: gotcha
    text: >-
      Astra F12 (recreated Accordion panels painted fully open; fixed in 0.6.x with a `_seeded`
      WeakSet that re-seeded a panel's resting height on first sight) is SUPERSEDED and the WeakSet
      is deleted. The height seeding is upstream's `connectedCallback` now: it reads the `open`
      attribute and writes `height: auto | 0` with no animation, on every connect. There is nothing
      left in this repo to regress.
  - kind: gotcha
    text: >-
      Padding must NOT sit on `<collapsible-content>` itself. The element animates its HEIGHT, and
      height is the content box — a closed panel at `height: 0` still renders its own padding, so
      `pb-4` on the host left 16px of dead space under every closed row (caught in the browser
      smoke, not by any test). `Collapsible.Content` therefore renders a single inner `<div>` that
      carries the padding, the typography and the merged `class`; the host carries nothing but the
      optional `--collapsible-easing` style. This is upstream's own documented shape. A static test
      guards the structure.
  - kind: gotcha
    text: >-
      ONE @change PER USER ACTION needs microtask coalescing, because upstream fires TWO
      `collapsible:toggle` events for an exclusive open: `[NOTIFY]` closes the siblings BEFORE
      dispatching the opener's own event, so the sibling's `open:false` arrives first and the
      opener's `open:true` second, synchronously in the same task. Reporting per event would hand
      the parent a transient '' before the real value. The Accordion root instead sets a `#queued`
      flag and schedules one `queueMicrotask`, then derives the value by reading the DOM once
      (`#readValue()` over its direct members) after everything has settled — deriving beats
      accumulating, since upstream is the source of truth for what is open. Two other invariants
      ride on this listener: `#syncing` suppresses events caused by the root's own `show()/hide()`
      cascade, and `#last` is NEVER assigned from the reported value (it tracks `props.value` only),
      which is what makes a rejected toggle stay rejected instead of being reverted by a later
      unrelated render.
---

Two families over one web component, `@magic-spells/collapsible-content` 1.2.0:
`Collapsible` · `.Trigger` · `.Content`, and `Accordion` · `.Item` · `.Trigger` ·
`.Content`. Rewritten from single-file ports in 0.7.0.

## Why a wrapper, and why two families

The value here is the height animation, the distance-derived duration, the
mid-animation reversal, the exclusive-group arbitration and the full ARIA set —
all upstream, all easy to get subtly wrong in a fork. The pieces are markup and
tokens only.

Two content channels (the trigger row and the panel body) are what forced the
family shape: a piece gets exactly one, and a named slot cannot compile inside a
component invocation. The old `label` prop and Accordion's `items` config array
are gone; the array's plain-text-only `content` limitation went with it, which was
the real cost of the config shape.

## The non-exclusive group root

`Collapsible` renders `<collapsible-group>` around its `<collapsible-component>`.
This is load-bearing, not decoration. Upstream joins a groupless component to its
NEAREST group ancestor, and an exclusive group closes every member but the one
just opened — so a bare component root would be slammed shut whenever a standalone
Collapsible sat inside an Accordion item. Its own plain group shields it.

`Accordion.Item` is the one member that does NOT compose the Collapsible family:
it renders the raw `<collapsible-component>`, because wrapping it in Collapsible's
own group would shield it from its own accordion and leave the group with no
members to coordinate. Trigger and Content still compose.

## Never bind `open`

`<collapsible-content>` OBSERVES `open`, and its own `collapsed` setter writes the
attribute back. A live template binding would fight the patcher every render —
the same rule `dropdown-panel`'s `visible` has. `Collapsible.Content` renders it
exactly once, frozen on the first `data()` call, purely so a prerendered page
paints in the right state and `connectedCallback` seeds the height without
animating. Every later change is imperative `show()` / `hide()` from the root.

## Group and target guards

`collapsible:toggle` bubbles and is composed, so a nested Accordion's rows travel
straight through an outer root on their way up. Both roots filter: Collapsible by
`event.target === its own component child`, Accordion by
`item.closest('collapsible-group') === this.element`, which is the same predicate
that defines its member set. Without them a nested piece reports as its parent.

## Controlled `value` and the rejected toggle

There is no cross-component context in Puzzle, so the Accordion root reaches its
members through the DOM: edge-triggered in `afterUpdate()`, with an
`item.open === want` no-op guard so a parent echoing back the value it was just
handed animates nothing.

A rejected toggle is NOT reverted — the wrapped-overlay contract. The component
self-manages and reports; the parent re-syncs. Reverting would fight the animation
and double-fire the event.

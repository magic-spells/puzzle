---
name: PanelStack family
status: verified
framework: puzzle
props:
  - name: current
    type: string
  - name: defaultCurrent
    type: string
  - name: effect
    type: string
  - name: class
    type: string
variants:
  - slide
  - stack
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

`PanelStack` · `PanelStack.Panel`, a D167 family over
`@magic-spells/panel-stack` 0.2.0.

## Frozen `current` seed, imperative drive

`<panel-stack>` OBSERVES and REFLECTS `current`, so it can never be a live
binding. `#initialCurrent` is captured on the first `data()` call
(`props.current ?? props.defaultCurrent`) and rendered once; everything after is
`element.current = next`, edge-triggered in `afterUpdate` under `#syncing`.
Seeding through `current` rather than `initial` is deliberate: `#initState` keeps
the first `<stack-panel>` as the root and pushes the authored `current` on top, so
a stack that starts deep can still pop back.

## @change comes from `panel-stack:change`

Upstream dispatches `panel-stack:push` and `:pop` BEFORE mutating the stack (push
must be cancelable; pop restores focus around the frame it drops). Reporting
`@change` from those would hand the parent the old handle, and its next render
would push a second time. So `@change(handle)` comes from `panel-stack:change`,
which upstream emits from its `#reflect()` funnel after the stack has settled:
bubbles and composed, de-duped, and silent at init (an authored `current`
included). It reports once per real transition, including the DOM-driven ancestor
fallback when the current panel is removed.

`@push`, `@pop` and `@reset` stay synchronous and receive the raw CustomEvent (the
detail is a plain object), so `event.preventDefault()` cancels a push and
`event.detail.toHandle` reads the target. A cancelled push settles nowhere new and
reports no `@change`. Every listener skips events under `#syncing` and events whose
target is not this element. `test/layout-wrapper.test.js` guards the change path.

## No lib file

The component's per-state CSS custom properties own every panel state (translate,
scale, blur, the stack overlay), so the registry ships no `lib/panel-stack.js`;
`test/layout-wrapper.test.js` asserts no reference to one exists.

## Triggers are upstream's markup contract

`data-action-stack-push` + `target`, `data-action-stack-pop`, `data-stack-focus`
and the Escape rule (pop at depth > 1, bubble at root so a wrapping Dialog closes)
are all handled by the component's own delegated listeners. The piece adds
nothing.

## Morph

Panels are positioned with transforms, so neither the root nor a panel may be a
morph root.

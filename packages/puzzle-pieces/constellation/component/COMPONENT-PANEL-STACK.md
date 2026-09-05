---
name: PanelStack family
status: built
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
notes:
  - kind: state
    text: >-
      SUPERSEDES the "@change is deferred one microtask" section. panel-stack 0.2.0 now emits a
      post-mutation `panel-stack:change { handle }` from its `#reflect()` funnel — bubbles +
      composed, de-duped against `#lastChange`, and silently seeded at init so mounting (authored
      `current` included) reports nothing. The wrapper listens to that event directly (`#onChange`,
      same `#syncing` guard and `event.target !== this.element` guard as the raw handlers) and
      reports `event.detail.handle`. The `queueMicrotask` derivation from push/pop/reset is gone —
      the re-entrancy it worked around cannot happen, because the event fires after the stack has
      settled. Raw `@push`/`@pop`/`@reset` stay synchronous so `preventDefault()` still cancels a
      push; a cancelled push settles nowhere new and so reports no `@change`. Bonus coverage: the
      DOM-driven ancestor fallback (current panel removed) now reports too. Guarded by
      `test/layout-wrapper.test.js` ("PanelStack reports @change from the post-mutation
      panel-stack:change").
---

`PanelStack` · `PanelStack.Panel`, a D167 family over
`@magic-spells/panel-stack` 0.2.0. Replaced a port whose root-first `stack` array
the parent had to own, plus a shipped lib file of class helpers.

## Frozen `current` seed, imperative drive

`<panel-stack>` OBSERVES and REFLECTS `current`, so it can never be a live
binding. `#initialCurrent` is captured on the first `data()` call
(`props.current ?? props.defaultCurrent`) and rendered once; everything after is
`element.current = next`, edge-triggered in `afterUpdate` under `#syncing`.
Seeding through `current` rather than `initial` is deliberate: `#initState` keeps
the first `<stack-panel>` as the root and pushes the authored `current` on top, so
a stack that starts deep can still pop back.

## @change is deferred one microtask — and that is load-bearing

FOUND IN BROWSER SMOKE. Upstream dispatches `panel-stack:push` and `:pop` BEFORE
mutating the stack (push must be cancelable; pop restores focus around the frame
it drops). A synchronous `props.change?.()` therefore re-enters the component
mid-navigation: the parent's setData/refresh runs `afterUpdate`, which sees a
stack that has not moved, decides the handles differ, and pushes a SECOND time —
depth 4 for two clicks. Reading `detail.toHandle` instead fixes the reported value
but not the re-entrancy. One `queueMicrotask` fixes both, which is also why the
handle is read off `element.currentHandle` rather than out of the detail. The raw
`@push`/`@pop`/`@reset` callbacks stay synchronous so `preventDefault()` still
cancels a push; a cancelled push reports no `@change`.

## The deleted lib file

`registry/lib/panel-stack.js` (`panelState`, `panelClass`, `panelInert`, the
translate/scale/blur class sets, the `after:` stack overlay) is gone, along with
its `registryDependencies` entry and the `registry.json` line. The component's
per-state CSS custom properties own all of it — `test/layout-wrapper.test.js`
asserts no reference survives anywhere.

## Triggers are upstream's markup contract

`data-action-stack-push` + `target`, `data-action-stack-pop`, `data-stack-focus`
and the Escape rule (pop at depth > 1, bubble at root so a wrapping Dialog closes)
are all handled by the component's own delegated listeners. The piece adds
nothing, so consumers' existing trigger markup kept working across the rewrite.

## Morph

Panels are positioned with transforms, so neither the root nor a panel may be a
morph root.

---
name: ContextMenu — pointer-placed menu family over dropdown-panel
status: built
framework: puzzle
props:
  - name: disabled
    type: boolean
  - name: effect
    type: string
  - name: class
    type: string
connections:
  - COMPONENT-DROPDOWN-PANEL
  - COMPONENT-DROPDOWN-MENU
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - DOC-REGISTRY
---


A D167 family in `registry/ui/context-menu/ContextMenu/`: root, `.Content` and the barrel —
three files. The root composes [[COMPONENT-DROPDOWN-PANEL]] with `menu` and
`trigger="contextmenu"`, so a right-click or 500 ms touch long-press anywhere inside the
component opens the panel pinned to the pointer, clamped to an 8 px margin and flipped
rather than clipped. 0.7.0 replaced the 324-line flat port and retired Astra F4 (the port's
clamp read stale coordinates) by moving the math upstream.

## The row members are RE-EXPORTED from DropdownMenu

`registryDependencies: ["dropdown-menu"]`, and the barrel re-exports `Trigger`, `Item`,
`Link`, `Group`, `Label`, `Separator`, `Shortcut` and `Sub` from
`../DropdownMenu/index.js`. This is the sanctioned exception to
[[COMPONENT-DROPDOWN-PANEL]]'s "compose, do not re-export" rule — see the `state` note there.
Only the root and `.Content` are ContextMenu's own, because only those genuinely differ.

## Gotchas

- **`open` is not a prop, deliberately.** The coordinates exist only at the instant of the
  gesture, so a boolean has nothing sane to mean. `@show`/`@hide` are report-only; a
  consumer that wants to summon one calls `showAt(x, y)` on a DropdownPanel.
- **The SURFACE is everything inside the root except the Content.** There is no
  `<dropdown-trigger>` at all — upstream's `queryDOM` allows that only in contextmenu mode.
- **`disabled` works by rendering no `trigger` attribute**, which leaves the component
  hunting for a `<dropdown-trigger>` that never arrives, so nothing is wired and the
  browser's own menu survives. The cost is one `requires <dropdown-trigger>` console warning
  per disabled instance. The alternative — keeping `trigger="contextmenu"` and cancelling
  `before-show` — would suppress the native menu too, which is worse.
- **`.Content` defaults `flip` ON** (it is free-floating already) but OFF on an
  `opens="right"` submenu panel, where `flipped` means `bottom: 100%` and would throw the
  panel above its own row. It has no `align`: the component pins and clamps instead.

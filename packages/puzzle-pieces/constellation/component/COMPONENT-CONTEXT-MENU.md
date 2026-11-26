---
name: ContextMenu — pointer-placed menu family over dropdown-panel
status: verified
framework: puzzle
props:
  - name: disabled
    type: boolean
  - name: class
    type: string
connections:
  - COMPONENT-DROPDOWN-PANEL
  - COMPONENT-DROPDOWN-MENU
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - DOC-REGISTRY
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

A D167 family in `registry/ui/context-menu/ContextMenu/`: root, `.Content` and the barrel —
three files. The root composes [[COMPONENT-DROPDOWN-PANEL]] with `menu` and
`trigger="contextmenu"`, so a right-click or 500 ms touch long-press anywhere inside the
component opens the panel pinned to the pointer, clamped to an 8 px margin and flipped
rather than clipped. The clamp math is upstream's and measures the pointer on every open.

## The row members are RE-EXPORTED from DropdownMenu

`registryDependencies: ["dropdown-menu"]`, and the barrel re-exports `Trigger`, `Item`,
`Link`, `Group`, `Label`, `Separator`, `Shortcut` and `Sub` from
`../DropdownMenu/index.js`. This is the sanctioned exception to
[[COMPONENT-DROPDOWN-PANEL]]'s "compose, do not re-export" rule — see the re-export note there.
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
- **`.Content` defaults `flip` ON** but OFF on an `opens="right"` submenu panel, where
  `flipped` means `bottom: 100%` and would throw the panel above its own row. `flip` is inert
  on the root panel, which the component places and flips itself; it matters for a `.Sub`'s
  downward panel. It has no `align`: the component pins and clamps instead.

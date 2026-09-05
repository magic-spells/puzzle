---
name: DropdownMenu — menu-button family over dropdown-panel menu mode
status: built
framework: puzzle
props:
  - name: trigger
    type: '''click'' | ''hover'' | ''both'''
  - name: arrow
    type: '''none'' | ''flip'' | ''static'''
  - name: open
    type: boolean
  - name: effect
    type: string
  - name: sub
    type: boolean
  - name: class
    type: string
variants:
  - button
  - item
  - bare
connections:
  - COMPONENT-DROPDOWN-PANEL
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - DOC-REGISTRY
---


A D167 compound family in `registry/ui/dropdown-menu/DropdownMenu/`: root plus `.Trigger`,
`.Content`, `.Item`, `.Link`, `.Group`, `.Label`, `.Separator`, `.Shortcut`, `.Sub` and an
`index.js` barrel. The root composes [[COMPONENT-DROPDOWN-PANEL]] with `menu` set, which
puts `@magic-spells/dropdown-panel` >= 2.1.0 into **application-menu mode**. 0.7.0 replaced
the 334-line flat port; the `items[]` array, `label`/`triggerClass` and the
`slot="trigger"` escape hatch are gone.

## Why this one claims `role="menu"` and Menubar does not

Menubar deliberately stays a disclosure because upstream provides no bar-level roving.
Menu mode is the opposite case: the component genuinely implements what the roles promise —
`role="menu"`/`menuitem`, one tab stop with a roving tabindex, arrows with wrap, Home/End,
typeahead, Enter/Space activation, Tab-to-close, Escape one level at a time and
ArrowRight/Left submenus. So the family authors **no** role, tabindex or aria-\* at all
(bar `Separator`'s `role="separator"` and `Group`'s `role="group"`), and a static test
guards that.

## Gotchas

- **Nothing in the family closes the menu.** `dropdown-panel:select` closes the whole chain
  and returns focus to the ROOT trigger. The port's `closest('dropdown-component')` walk is
  gone and must not return — two closers means two closes.
- **`@select` fires at the root, `@press` at the row, and both fire.** A submenu choice is
  reported by the root because that is where the chain closes; `Sub` passes `sub` to the
  base to silence the nested roots.
- **`Sub` exists because an `Item` is a `<button>`** and cannot contain a
  `<dropdown-component>`; the nested trigger and panel must be that component's direct
  children. `block` on the Sub host is load-bearing for `opens="right"`.
- **`Sub.pzl` imports `./DropdownMenu.pzl`, not the barrel** — the barrel imports Sub, and a
  cycle through it leaves one side undefined.
- **A `{#for}` may live inside a `Content`, never directly inside the root** around a
  Trigger/Content/Sub — the direct-children contract.
- **Trigger's fallback body (D141) is the stock chrome**: the `label` text plus the
  `[data-dropdown-arrow]` hook, closed tight because `:empty` is literal. Filling the body
  replaces all of it, so a custom trigger owns its accessible name.

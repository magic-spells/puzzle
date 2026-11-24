---
name: DropdownMenu — menu-button family over dropdown-panel menu mode
status: verified
framework: puzzle
props:
  - name: trigger
    type: '''click'' | ''hover'' | ''both'''
  - name: arrow
    type: '''none'' | ''flip'' | ''static'''
  - name: open
    type: boolean
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
notes:
  - kind: state
    text: >-
      Trigger's `button` variant is Button's outline at md (`border border-border-strong text-ink
      hover:bg-ink/6`, transparent), so it matches an outline Button beside it.
  - kind: state
    text: >-
      DropdownMenu.Sub renders its nested root with `arrow="flip"`, so submenu rows are written
      `<DropdownMenu.Trigger variant="item" label="Export as"/>`: a filled Trigger body drops the
      `[data-dropdown-arrow]` hook, and the chevron with it. The top-level root defaults
      `arrow="none"`.
  - kind: state
    text: >-
      DropdownMenu.Shortcut, Menubar.Shortcut and Kbd draw the keycap seam with the `shadow-kbd`
      utility, backed by the `--shadow-kbd` token in all four theme files.
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

A D167 compound family in `registry/ui/dropdown-menu/DropdownMenu/`: root plus `.Trigger`,
`.Content`, `.Item`, `.Link`, `.Group`, `.Label`, `.Separator`, `.Shortcut`, `.Sub` and an
`index.js` barrel. The root composes [[COMPONENT-DROPDOWN-PANEL]] with `menu` set, which
puts `@magic-spells/dropdown-panel` >= 2.1.0 into **application-menu mode**.

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
  and returns focus to the ROOT trigger. No row may also walk `closest('dropdown-component')`
  to close it — two closers means two closes.
- **`@select` fires at the root, `@press` at the row, and both fire.** A submenu choice is
  reported by the root because that is where the chain closes; `Sub` passes `sub` to the
  base to silence the nested roots.
- **`Sub` exists because an `Item` is a `<button>`** and cannot contain a
  `<dropdown-component>`; the nested trigger and panel must be that component's direct
  children. `block!` on the Sub host is load-bearing for `opens="right"`; the `!` is too,
  because the root's own `inline-block` otherwise wins the cascade.
- **`Sub.pzl` imports `./DropdownMenu.pzl`, not the barrel** — the barrel imports Sub, and a
  cycle through it leaves one side undefined.
- **A `{#for}` may live inside a `Content`, never directly inside the root** around a
  Trigger/Content/Sub — the direct-children contract.
- **Trigger's fallback body (D141) is the stock chrome**: the `label` text plus the
  `[data-dropdown-arrow]` hook, closed tight because `:empty` is literal. Filling the body
  replaces all of it, so a custom trigger owns its accessible name.

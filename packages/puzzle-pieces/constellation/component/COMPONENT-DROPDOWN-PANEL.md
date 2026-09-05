---
name: DropdownPanel — shared base family for trigger↔panel overlays
status: built
framework: puzzle
props:
  - name: trigger
    type: '''hover'' | ''click'' | ''both'''
  - name: arrow
    type: '''flip'' | ''static'' | ''none'''
  - name: arrowShape
    type: '''chevron'' | ''triangle'''
  - name: effectDuration
    type: string
  - name: effectEasing
    type: string
  - name: open
    type: boolean
  - name: class
    type: string
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - DOC-REGISTRY
---

The registry's shared base for every trigger-and-panel overlay. A D167 family —
`registry/ui/dropdown-panel/DropdownPanel/{DropdownPanel,Trigger,Panel}.pzl` plus an
`index.js` barrel (`Object.assign(DropdownPanel, { Trigger, Panel })`) — wrapping
`@magic-spells/dropdown-panel` 2.0.0. NavigationMenu is the first consumer; eight more
menu-style pieces (popover, hover-card, popconfirm, menubar, dropdown-menu, context-menu,
split-button, accordion) are expected to follow.

Consumers **compose** the members, they do not re-export them: a re-exported class has
nowhere to hang piece-specific token chrome, and in a copy-in registry the consumer must be
able to edit `NavigationMenu/Trigger.pzl` without forking the shared base.

## Gotchas

- **Direct-children contract.** `dropdown-trigger` and `dropdown-panel` must be direct
  children of `dropdown-component`. A Puzzle component renders one root and adds no wrapper,
  so the members satisfy it — but never wrap one in a div, and never put an `{#if}` around
  one at that level.
- **`visible` is reflected state — never bind it in a template.** The component writes that
  attribute itself, so a patcher binding fights it every render. Controlled `open` is
  optional and edge-triggered, driven through `show()` / `hide()` once the module lands, and
  through the attribute before that.
- **All four `dropdown-panel:*` events bubble.** Without a `event.target === this.element`
  guard a nested submenu reports as its parent (same trap as Sheet's `#mine`).
- **The hover bridge is `dropdown-trigger::before`** — an invisible skewed shape that keeps
  the pointer inside while it travels to the panel. Declaring your own `::before` on the
  trigger breaks it, so an arrow must be a real child `<span data-dropdown-arrow>`, closed
  tight (`:empty` is literal).
- **A nested `dropdown-component` needs `display: block`.** It ships `inline-block` and
  shrink-wraps its trigger text; an `opens="right"` panel then resolves `left: 100%` against
  that narrow box and lands on top of the parent panel. NavigationMenu.Item puts `block` on
  the DropdownPanel root for exactly this — the `<li>` being block-level does nothing.
- **`wide` positions against the nearest POSITIONED ANCESTOR**, because the host goes
  `position: static`. NavigationMenu's `<nav>` carries `relative` for this and the panel takes
  that element's width — so give the nav the width you want the mega panel to have.
- **Never `overflow-hidden` anywhere in the chain** — it clips nested submenus and the arrow.
- **`aria-hidden` / `inert` / `aria-expanded` / `role` / `tabindex` are derived output.** The
  component writes them and overwrites anything authored.
- **No FOUC, one small pre-JS gap.** The core stylesheet alone holds a closed panel at
  `opacity: 0; pointer-events: none`, but `aria-hidden`/`inert` only land at upgrade, so for
  that instant a closed panel is still in the a11y tree and tab order.
- **Two stylesheets**, both `layer(components)`: `/css` is required, `/css/effects` is
  optional and is the only source of custom properties (`--dp-effect-duration`,
  `--dp-effect-easing`, `--dp-arrow-size`, `--dp-arrow-thickness`). The core sheet declares
  none, so the design-system bridge is Tailwind on the members' hosts, and the two timing
  knobs go through an inline `style` (runtime values — Tailwind cannot generate classes for
  strings it never sees in source).

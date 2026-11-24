---
name: DropdownPanel — shared base family for trigger↔panel overlays
status: verified
framework: puzzle
props:
  - name: trigger
    type: '''hover'' | ''click'' | ''both'' | ''contextmenu'''
  - name: menu
    type: boolean
  - name: sub
    type: boolean
  - name: arrow
    type: '''flip'' | ''static'' | ''none'''
  - name: arrowShape
    type: '''chevron'' | ''triangle'''
  - name: effectDuration
    type: string
  - name: effectEasing
    type: string
  - name: openDelay
    type: number
  - name: closeDelay
    type: number
  - name: open
    type: boolean
  - name: class
    type: string
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - DOC-REGISTRY
notes:
  - kind: state
    text: >-
      Menubar has no role="menubar"/"menuitem" on purpose: upstream is a disclosure with no
      bar-level roving (Tab moves between triggers), so the roles would promise a keyboard model
      that is not there. Menubar.Item (button) and Menubar.Link (anchor) are separate members
      because a component root gets one content channel. Both close the whole open chain themselves
      (hide() on each ancestor dropdown-component), since upstream closes only on an outside press.
      HoverCard defaults openDelay/closeDelay to 600/300.
  - kind: state
    text: >-
      `menu` opts the root into upstream's application-menu mode (role=menu/menuitem, roving
      tabindex, typeahead, Enter/Space, Tab to close, ArrowRight/Left for submenus), so
      DropdownMenu, ContextMenu and SplitButton own no keyboard code. `trigger="contextmenu"` opens
      the panel at the pointer on right-click or a 500 ms long-press, with no `<dropdown-trigger>`.
      `@select(value)` is the one event not filtered to this element: a submenu choice closes the
      whole chain and returns focus to the root trigger, so the root reports it, and a nested root
      passes `sub` to stay quiet. Returning `false` from the handler cancels the close. `showAt(x,
      y)` is a no-op until the component has upgraded.
  - kind: state
    text: >-
      ContextMenu and SplitButton re-export DropdownMenu's row members (Item, Link, Group, Label,
      Separator, Shortcut, Sub; ContextMenu also Trigger) instead of forking them. The compose rule
      is about the base: a context-menu row is a dropdown-menu row, and dropdown-menu is copied in
      anyway as their registry dependency, so editing one Item.pzl updates every menu. Each keeps
      its own root and Content (SplitButton: Action and Menu).
  - kind: state
    text: >-
      A nested NavigationMenu.Item renders an `<li>`, so the nested shape wraps just that Item in a
      `<ul>` inside the Content; Links stay outside it. Upstream finds focusable items deeply, so
      arrow keys still reach the nested trigger.
  - kind: state
    text: >-
      Only DropdownPanel.Panel takes `effect`; the root has none, so effects go on Content/Panel.
      The root's trigger, openDelay, closeDelay, arrow and arrowShape, and Panel's opens and effect,
      pass straight through with `false` as the omit sentinel and no allowlist (a copy of upstream's
      list drifts). Upstream defaults what it does not know: an unknown trigger is `both`, a bad
      delay is 0, an unknown arrow or effect matches no selector.
  - kind: state
    text: >-
      Menubar.Trigger renders `<Children/>` then a `<span data-dropdown-arrow>` hook only for
      `variant="item"`. It has no fallback body and no `label` prop, because a filled fallback body
      would drop the hook; `<Menubar.Trigger variant="item">Export as</Menubar.Trigger>` keeps its
      chevron. Menubar.Menu leaves `arrow` unset (upstream default `flip`), and bar triggers have no
      hook, so they draw no glyph.
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

The registry's shared base for every trigger-and-panel overlay. A D167 family —
`registry/ui/dropdown-panel/DropdownPanel/{DropdownPanel,Trigger,Panel}.pzl` plus an
`index.js` barrel (`Object.assign(DropdownPanel, { Trigger, Panel })`) — wrapping
`@magic-spells/dropdown-panel` (manifest floor `^2.1.1`; menu mode, `flip` and the hover
delays need ≥ 2.1.0). Consumers: navigation-menu, popover, hover-card, popconfirm, menubar
and dropdown-menu; context-menu, split-button and language-menu reach it through
dropdown-menu.

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
- **Two stylesheets**, both `layer(components)`: `/css` is required (`puzzle add piece`
  prints its `@import` line), `/css/effects` is optional and is the only source of custom
  properties (`--dp-effect-duration`, `--dp-effect-easing`, `--dp-arrow-size`,
  `--dp-arrow-thickness`). The core sheet declares none, so the design-system bridge is
  Tailwind on the members' hosts, and the two timing knobs go through an inline `style`
  (runtime values — Tailwind cannot generate classes for strings it never sees in source).
- **One content channel per component root.** A named `<Slot name>` is a compile error inside
  a component invocation and a template gets one default marker, so a piece rooted at
  `<DropdownPanel>` can route only one body. Trigger-plus-panel pieces are therefore families
  (Popover, HoverCard); a single-file wrapper works only when the panel is prop-driven
  (Popconfirm, whose `<Children/>` is the trigger).
- **The trigger element is upstream's `role="button"` `dropdown-trigger`.** Call-site trigger
  content must be non-interactive — a nested `<button>` or `<a>` inside it is invalid and
  double-focusable. Icon-only triggers need an `sr-only` name.

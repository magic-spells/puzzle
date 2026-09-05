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
      2026-09-05: four more consumers landed on the base — popover, hover-card and menubar as D167
      families (Popover · .Trigger · .Content; HoverCard · .Trigger · .Content; Menubar · .Menu ·
      .Trigger · .Content · .Item · .Link · .Separator · .Label · .Shortcut), and popconfirm as a
      single file. ~1,250 lines of ported overlay machinery deleted (timers, document listeners,
      Escape handlers, rAF flip/clamp measurement, roving tabindex, aria mirroring). Menubar drops
      role="menubar"/"menuitem" deliberately: upstream is a disclosure with no bar-level roving, so
      the roles would promise a keyboard model that is not there (Tab moves between triggers). The
      base root gained openDelay/closeDelay props → open-delay/close-delay attributes, honoured by
      @magic-spells/dropdown-panel >= 2.1.0 and inert on 2.0.0 (HoverCard defaults 600/300); the
      demo runs 2.0.0, so delays are inert there today. COMPILER CONSTRAINT that shaped all four: a
      named <Slot name> is a compile error anywhere inside a component invocation
      (parser/slot.go:200) and a template may declare only one default marker, so a piece whose root
      is <DropdownPanel> has exactly ONE content channel — that is why a trigger-plus-panel piece
      must be a family, and why Menubar.Item (button) and Menubar.Link (anchor) are separate members
      rather than one component branching on href. Items close the whole open chain themselves
      (hide() on each ancestor dropdown-component) because upstream only closes on an OUTSIDE press.
  - kind: state
    text: >-
      2026-09-05 (feat/menu-families): the base gained four additive things for the last three
      consumers — dropdown-menu, context-menu, split-button, now COMPONENT-DROPDOWN-MENU /
      -CONTEXT-MENU / -SPLIT-BUTTON. (1) `menu` prop → `menu` attribute, opting the component into
      application-menu mode (role=menu/menuitem, roving tabindex, typeahead, Enter/Space incl. Space
      clicking a link, Tab-to-close, ArrowRight/Left submenus). (2) `'contextmenu'` added to the
      `trigger` allow-list: right-click / 500 ms long-press anywhere in the component, panel fixed
      at the pointer, clamped and flipped, and NO <dropdown-trigger> required. (3) `@select(value,
      event)` from `dropdown-panel:select` — and it is the ONE event NOT filtered by `#mine`,
      deliberately: a submenu choice closes the whole chain and returns focus to the ROOT trigger,
      so the root is what owes the parent a report. The new `sub` prop silences a nested root
      instead, so exactly one instance per chain reports, exactly once per activation. Returning
      `false` from the handler → `preventDefault()`, which cancels the close. (4) `showAt(x, y)`
      passthrough on the root class, guarded on `#ready` (a coordinate is not state, so there is no
      attribute to leave the intent on). Panel gained `flip` → `flip` attribute (opt-in upward
      opening; the component sets `flipped`, its own sheet styles it). Panel's existing `left-auto
      right-0` ALIGN_END utility recipe was left alone even though 2.1.0 now ships an equivalent
      `align` attribute — five shipped families depend on the recipe and the two are equivalent.
      RE-EXPORT EXCEPTION: context-menu and split-button re-export dropdown-menu's ROW members
      (Trigger, Item, Link, Group, Label, Separator, Shortcut, Sub) instead of forking them. The
      "compose, do not re-export" rule above is about the BASE — it exists so a family has somewhere
      of its own to hang chrome and so a consumer can edit one family's Trigger without forking the
      base every other piece shares. Neither applies to a row: a context-menu row IS a dropdown-menu
      row, and in a copy-in registry the re-export is BETTER — dropdown-menu is copied in anyway as
      the registry dependency, so the consumer edits one Item.pzl and every menu follows. Each keeps
      its own root and Content, which genuinely differ. PIN: demo/package.json points
      @magic-spells/dropdown-panel at `file:../../../../../open-sourcery/dropdown-panel` (the 2.1.0
      working tree, branch feat/menu-mode) because ^2.0.0 has no menu mode — return it to `^2.1.0`
      when 2.1.0 publishes. Piece headers and docs already tell consumers to install ^2.1.0.
---

The registry's shared base for every trigger-and-panel overlay. A D167 family —
`registry/ui/dropdown-panel/DropdownPanel/{DropdownPanel,Trigger,Panel}.pzl` plus an
`index.js` barrel (`Object.assign(DropdownPanel, { Trigger, Panel })`) — wrapping
`@magic-spells/dropdown-panel` 2.x (the demo pins `^2.0.0`; `openDelay`/`closeDelay` need
≥ 2.1.0). Consumers today: navigation-menu, popover, hover-card, popconfirm, menubar.
Still to follow once upstream gains a menu mode and pointer placement: dropdown-menu,
context-menu, split-button.

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
- **One content channel per component root.** A named `<Slot name>` is a compile error inside
  a component invocation and a template gets one default marker, so a piece rooted at
  `<DropdownPanel>` can route only one body. Trigger-plus-panel pieces are therefore families
  (Popover, HoverCard); a single-file wrapper works only when the panel is prop-driven
  (Popconfirm, whose `<Children/>` is the trigger).
- **The trigger element is upstream's `role="button"` `dropdown-trigger`.** Call-site trigger
  content must be non-interactive — a nested `<button>` or `<a>` inside it is invalid and
  double-focusable. Icon-only triggers need an `sr-only` name.

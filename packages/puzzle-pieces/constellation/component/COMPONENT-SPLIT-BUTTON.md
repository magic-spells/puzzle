---
name: SplitButton — fused action + menu family over dropdown-menu
status: verified
framework: puzzle
props:
  - name: variant
    type: '''primary'' | ''secondary'' | ''outline'' | ''ghost'' | ''destructive'''
  - name: size
    type: '''sm'' | ''md'' | ''lg'''
  - name: disabled
    type: boolean
  - name: label
    type: string
  - name: class
    type: string
variants:
  - primary
  - secondary
  - outline
  - ghost
  - destructive
connections:
  - COMPONENT-DROPDOWN-MENU
  - COMPONENT-DROPDOWN-PANEL
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - DOC-REGISTRY
notes:
  - kind: state
    text: >-
      Action's VARIANT map is a verbatim copy of Button.pzl's quiet recipes (primary solid ink,
      secondary ink tint, outline transparent with border-border-strong, ghost tint hover). Menu
      carries the same recipes with plain `hover:`, since its `<dropdown-trigger>` never matches
      `:disabled`. Both must change with Button; see the quiet-buttons note on
      DECISION-SCHEMES-AND-STYLES.
  - kind: state
    text: >-
      Action follows the button family's disabled rule (shared with button, button-group,
      copy-button, alert-dialog/popconfirm buttons, pagination prev/next, toggle, toggle-group):
      `disabled:cursor-not-allowed` rather than `disabled:pointer-events-none`, so a disabled
      button's `title` tooltip shows, and every hover is `not-disabled:hover:…` so it stays flat. A
      native disabled <button> fires no click; onPress still re-checks. Menu deliberately keeps
      `opacity-50 pointer-events-none`: its <dropdown-trigger> is not a <button> (never matches
      :disabled), and pointer-events-none is the only thing stopping a click from opening the menu.
  - kind: state
    text: >-
      Wire rows through the Menu's @select only: Item @press and the root @select fire on the same
      activation, so wiring both runs each action twice. `SplitButton.Menu disabled` blocks clicks
      only: upstream `<dropdown-trigger>` keeps tabindex=0 and still opens on Enter/Space/ArrowDown.
      The fix belongs upstream (a `disabled` on `<dropdown-trigger>`, then one prop forwarded
      through DropdownMenu.Trigger); there is no piece-side keydown guard, by decision.
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

A D167 family in `registry/ui/split-button/SplitButton/`: `SplitButton` (layout shell),
`.Action` (the primary `<button>`), `.Menu` (the caret half, composing
[[COMPONENT-DROPDOWN-MENU]]) and the barrel, which re-exports DropdownMenu's row members for
the same reason ContextMenu does.

Three members rather than a bare layout shell: a pure shell would have had to reach its
halves with descendant selectors like
`[&>dropdown-component>dropdown-trigger]:rounded-l-none`, which is fragile and leaks the
custom-element names into consumer markup. Members carrying their own fusion classes match
Menubar and Tabs.

## Gotchas

- **`variant` and `size` are repeated on `.Action` and `.Menu`.** Puzzle has no
  cross-component context, so the root cannot hand them down. Documented as the D167
  consequence, in the header and on the docs page.
- **`.Menu` supplies its own Trigger and Content**; call-site children go straight into the
  panel as rows. Those two must be the component's direct children, so they are not the
  consumer's to place.
- **`<dropdown-trigger>` is not a `<button>`**, so `disabled:` variants do not apply — the
  caret's disabled treatment is spelled out as `opacity-50 pointer-events-none`.
- **The accessible name is an `.sr-only` span, not `aria-label`** — the component owns the
  ARIA on `dropdown-trigger` and an authored label there is one more thing in its way.
- `focus-visible:z-10` on both halves is what draws the focus outline above the neighbour;
  per the focus-flash rule the outline COLOR is unconditional (`outline-ring`).

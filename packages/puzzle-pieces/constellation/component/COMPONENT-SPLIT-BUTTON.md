---
name: SplitButton — fused action + menu family over dropdown-menu
status: built
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
---


A D167 family in `registry/ui/split-button/SplitButton/`: `SplitButton` (layout shell),
`.Action` (the primary `<button>`), `.Menu` (the caret half, composing
[[COMPONENT-DROPDOWN-MENU]]) and the barrel, which re-exports DropdownMenu's row members for
the same reason ContextMenu does. 0.7.0 replaced the 351-line flat port; `label` and
`actions[]` are gone.

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

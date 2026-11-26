---
name: Select family over select-dropdown
status: verified
framework: puzzle
props:
  - name: value
    type: string
  - name: placeholder
    type: string
  - name: name
    type: string
  - name: disabled
    type: boolean
  - name: open
    type: boolean
  - name: id
    type: string
  - name: class
    type: string
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - COMPONENT-DROPDOWN-PANEL
notes:
  - kind: state
    text: >-
      The stock trigger is `min-h-9 … py-1.5` (36px), the height of every other field and of a md
      Button. It uses min-h rather than h so a custom slot trigger may grow.
  - kind: state
    text: >-
      The shown label is a `label` state key seeded in created(); #setLabel writes it with
      setState() and no refresh(), because data() reads `label` to derive labelClass and setState()
      re-runs data() when data() read the written key (framework D23). The wrapper keeps no echo or
      ownership guards: upstream's value setter dispatches nothing, and only the host dispatches
      select-dropdown:* events.
  - kind: gotcha
    text: >-
      When the `Select.Option` rows render after mount with a preselected `value`, the label text is
      right but stays placeholder grey: upstream applies the pending value in a microtask after
      `afterUpdate` and fires no event, so the per-afterUpdate label mirror never sees it. A parent
      passing `''` likewise leaves the old label showing. A possible fix derives the colour from
      upstream's DOM state (`select-option[selected]`) instead of the mirrored label.
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

`Select` · `Select.Option` · `Select.Label` · `Select.Divider`, a D167 family over
`@magic-spells/select-dropdown` 0.3.0. Callbacks `@change(value)`, `@show()`, `@hide()`.
Options are children; the trigger is a D141 `<Slot name="trigger">` with a stock
label-span + chevron fallback, and trigger content must be non-interactive because
upstream's `<select-trigger>` is the control.

## What upstream provides (0.3.0)

Observed `value`/`disabled`, per-option `disabled`, a MutationObserver that wires late
options and re-applies a pending value, a value-carrying `select-dropdown:change`
(`detail: { value, label }`, user picks only), a caret injected only when the trigger has
no other element child, and the `body:has(select-dropdown[visible])` scroll lock. 0.2.0
cannot be wrapped, so the piece's floor is `@magic-spells/select-dropdown@^0.3.0`.

## `value` is never bound, and `Select.Option` sets its attribute by hand

Puzzle's patcher treats `value` as a name-keyed PROPERTY on every element, so
`value={…}` on `<select-option>` writes an expando and no attribute; upstream reads
`getAttribute('value')` and falls back to the row text. The member therefore writes the
attribute from `mounted()`/`afterUpdate()`. The root writes `element.value` after the
dynamic import resolves and again in `afterUpdate()` only when `props.value` moved
(`#last` tracks props, never the reported value); programmatic writes are silent
upstream, so there is no echo to guard.

## Selection is sticky and the label is mirrored

Upstream re-asserts the last applied value (user pick or programmatic) on every option
mutation, so a `{#for}` re-render keeps the selection with no help from the root. If the
selected option leaves the DOM, upstream clears silently — value `''`, label back to
whatever `.select-label-text` held when the panel first existed — with no event. The root
therefore mirrors `element.selectedText` into its `label` state key on every `afterUpdate()`
with `setState()` when it changes. `data()` reads `label` through `getState()`, so the write
re-runs `data()`, where the label colour and text are derived. The stock trigger must render the placeholder
text (not an empty span) at mount, since that captured text is also the form-reset label.
A controlled parent cannot CLEAR the selection by passing `''`/`null`.

## Focus model is upstream's

Real DOM focus roves onto `<select-option>` (tabindex rewritten by the component). Do
not re-render the option list from the change handler while the panel is open, and never
bind `tabindex`, `role`, `aria-disabled`, `selected`, `aria-selected` or `visible`.
`open` is optional-controlled and drives `show()`/`hide()` synchronously (no rAF —
hidden tabs never fire it); upstream defers its own outside-click listener.

## Rejected

- Keeping an `options=` convenience prop next to the members: two ways to say one thing.
- Upstream reflecting `selected-label` attributes instead of writing the trigger text:
  the mirror is cheaper and keeps plain-HTML users of the component unchanged.
- `aria-activedescendant` (the port's model): the wrap-vs-port trade; upstream wins.
- Panel placement modes (`up`/`down`): upstream is center-overlay only; not added.

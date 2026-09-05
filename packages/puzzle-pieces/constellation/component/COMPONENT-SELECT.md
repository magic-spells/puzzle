---
name: Select family over select-dropdown
status: built
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
---


`Select` · `Select.Option` · `Select.Label` · `Select.Divider`, a D167 family over
`@magic-spells/select-dropdown` 0.3.0 (0.7.0, feat/select-marquee-quantity). Replaced the
673-line port whose `options` array, `aria-activedescendant` focus model, `morph`,
`position` and `indicator` props are all gone. Callbacks `@change(value)`, `@show()`,
`@hide()`. Options are children; the trigger is a D141 `<Slot name="trigger">` with a stock
label-span + chevron fallback, and trigger content must be non-interactive because
upstream's `<select-trigger>` is the control.

## What went upstream (0.3.0) instead of into a fork

Observed `value`/`disabled`, per-option `disabled`, a MutationObserver that wires late
options and re-applies a pending value, a value-carrying `select-dropdown:change`
(`detail: { value, label }`, user picks only), caret injected only when the trigger has no
other element child, the `body:has(select-dropdown[visible])` scroll lock and the host
layout defaults deleted, and three bugs the wrapper build found: `role` set in
constructors (throws on `createElement` after definition), `aria-hidden` written before
focus left the panel, and `show()` closed by the click that called it. The published
0.2.0 cannot be wrapped — the demo pins the `open-sourcery/select-dropdown-wt` worktree via
`file:` until 0.3.0 ships.

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
therefore mirrors `element.selectedText` into local `label` on every `afterUpdate()`, and
the stock trigger must render the placeholder text (not an empty span) at mount, since
that captured text is also the form-reset label. A controlled parent cannot CLEAR the
selection by passing `''`/`null`.

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

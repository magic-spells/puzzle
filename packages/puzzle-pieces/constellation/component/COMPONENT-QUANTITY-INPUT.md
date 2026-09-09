---
name: QuantityInput wrapper over quantity-input
status: built
framework: puzzle
props:
  - name: value
    type: number
  - name: min
    type: number
  - name: max
    type: number
  - name: step
    type: number
  - name: disabled
    type: boolean
  - name: name
    type: string
  - name: label
    type: string
  - name: class
    type: string
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DOC-REGISTRY
---

Single-file wrapper over `@magic-spells/quantity-input` 1.1.0 (0.7.0,
feat/select-marquee-quantity), replacing a 131-line port. Marginal on line count — the
wrapper is about the same size — and taken for consistency: this component ADOPTS the
authored decrement button, `<input>` and increment button (`[data-action-decrement]`,
`input`, `[data-action-increment]`) and creates nothing, so every Tailwind form-control
utility, the SVG icons, `name` and `aria-label` survive from the port unchanged.
`@change(value)` is value-first; the port's second event argument was dropped (no call
site used it).

## What went upstream (1.1.0)

Zero as a value (the `parseInt(...) || 1` fallbacks turned `min="0"`/`value="0"` into
1 — a real regression for "0 removes from cart"), observed `step`, observed + reflected
`disabled`, null-safe setters, empty/NaN commit snapping back to the current value, and
— after review — the component OWNS `disabled` on all three controls: host `disabled`
disables everything, and dec/inc are additionally disabled at `min`/`max` on every sync.
The piece renders the same at-bounds state from props for prerender and never fights it.
1.1.0 is stacked on Cory's Enter-key PR (commit on Enter instead of submitting the form).

## The field is the live clamped prop, not a frozen seed

Puzzle's `patchAttrs` force-syncs `value` on an `<input>` against the LIVE DOM property
every patch, so the NumberField-style frozen seed was re-asserted after each render and
reverted what the component had written (host 3, field 1 after two clicks). The input
renders `value={ String(current) }` — the `String()` keeps D147 from auto-binding — and
carries an authored `@change` so the component's own `change` handling is untouched.
Host `value` is never template-bound; the root writes `element.value` after the dynamic
import resolves and in `afterUpdate()` when `props.value` moved. Upstream never dispatches
`quantity-input:change` from a programmatic write, so no `#syncing` guard is needed.

## Stylesheet deliberately not imported

`@magic-spells/quantity-input/styles` carries four hex colours and fixed `7rem`/`2.5rem`
sizing that would fight every token utility; the only rule the piece needs (spinner
hiding) is already expressed as Tailwind arbitrary variants and is the prerender-correct
form of upstream's constructor-injected rule.

## Gotchas

- `#syncInput` force-writes `type="number"`, `inputMode`, `pattern`, `value` (clamped)
  and `min` onto the authored input on every sync — render the same values, never
  different ones.
- Without a `value` attribute `element.value` returns `min`, so the wrapper always writes
  `value` explicitly after upgrade. An out-of-range pushed value renders clamped.
- Integer semantics only (`parseInt` throughout); `step` decimals truncate.

---
name: 'D38 — Event modifiers: `@event:modifier={…}`, key filters, canonical order'
status: verified
verified_at: '2026-11-01T19:23:24.972Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - DOC-EVENTS
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D86-OUTSIDE-MODIFIER
  - DECISION-D187-PASSIVE-CAPTURE
code_refs:
  - client-runtime/views/viewManager.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D38 — Event modifiers: `@event:modifier[:modifier…]={ handler }`

Common listener chores (prevent, stop, once, key gating) are written on the binding instead of inside the handler. See [[DOC-SPEC-TEMPLATE]] §5 and [[DOC-EVENTS]].

## Decision
- **The set.** On any event: `prevent`, `stop`, `once` (fires once ever for that binding), `outside` ([[DECISION-D86-OUTSIDE-MODIFIER]]), and the listener options `passive` / `capture` ([[DECISION-D187-PASSIVE-CAPTURE]]). Key filters, valid **only** on `keydown`/`keyup`/`keypress`: `enter`, `escape`, `tab`, `space`, `up`, `down`, `left`, `right`, `backspace`, `delete` (gating on `event.key` `Enter`, `Escape`, `Tab`, `' '`, `ArrowUp`, …). Modifiers stack.
- **Canonical execution order, independent of written order:** outside-gate → key gate → once-spend → `preventDefault` → `stopPropagation` → handler. A non-matching key bails before `preventDefault` (native behavior for other keys survives) and without spending `once`.
- **`once` is runtime state.** The spent marker lives on the element's listener record keyed by the full binding name, so it survives the per-render handler swap; it clears when the binding is actually removed (a removed-then-re-added `@event:once` fires again).
- **Encoding:** modifiers ride in the vnode **key** (`'@keydown:enter:prevent'`); the value stays a plain function. The ViewManager wraps it with `withModifiers` on its per-node listener path ([[DECISION-D18-PER-NODE-LISTENERS]]). Modifier-free bindings take the plain path.
- **Two tables must stay mirrored:** the parser's `eventKeyFilters` (`puzzle-lang/parser/parser.go`) and the runtime's `KEY_FILTERS` (`viewManager.js`); `tests/event-key-filters-parity.test.js` holds them identical.
- **Compile errors (positioned):** an unknown modifier; a key filter on a non-keyboard event; a duplicate modifier; more than one key filter; `passive` with `prevent`; any modifier on a component callback prop ([[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]]); a Vue-style dotted modifier (`@click.prevent` steers to `@click:prevent`; a dotted custom event name whose suffix is not a modifier word is left alone).

## Gotchas
- A *conditional* intercept (Backspace merges blocks only at caret offset 0) cannot use `:prevent`; write a plain `@keydown` handler that calls `event.preventDefault()` behind its own guard.

## Alternatives rejected
- A compile-time wrapper — cannot express once-ever across handler swaps.
- A structured `{ handler, modifiers }` vnode value — breaks the function-value contract the callback-prop path and the diff rely on.
- System-modifier combinations (`:ctrl:enter`) and `home`/`end`/`pageup`/`pagedown` — they collide with the one-key-filter rule and need their own decision.

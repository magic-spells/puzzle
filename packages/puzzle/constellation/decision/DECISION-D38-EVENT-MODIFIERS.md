---
name: 'D38 — Event modifiers: `@event:modifier={…}`, key filters, canonical order'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - DOC-EVENTS
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D86-OUTSIDE-MODIFIER
code_refs:
  - client-runtime/views/viewManager.js
---

# D38 — Event modifiers: `@event:modifier[:modifier…]={ handler }`

See [[DOC-SPEC-TEMPLATE]] §5 and [[DOC-EVENTS]].

## Decision
- **The set.** On any event: `prevent` (`preventDefault`), `stop` (`stopPropagation`), `once` (fires once ever for that binding), and `outside` ([[DECISION-D86-OUTSIDE-MODIFIER]]). Key filters, valid **only** on `keydown`/`keyup`/`keypress`: `enter`, `escape`, `tab`, `space`, `up`, `down`, `left`, `right`, `backspace`, `delete` (→ `event.key` `Enter`, `Escape`, `Tab`, `' '`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Backspace`, `Delete`). Modifiers stack.
- **Canonical execution order, independent of written order:** outside-gate → key gate → once-spend → `preventDefault` → `stopPropagation` → handler. A non-matching key bails before `preventDefault` (native behavior for other keys survives) and without spending `once`.
- **`once` is runtime state.** A spent marker keyed to the binding survives per-patch handler swaps and is cleared when the binding is actually removed (so a removed-then-re-added `@event:once` fires again).
- **Encoding:** modifiers ride in the vnode **key** (`'@keydown:enter:prevent'`); the value stays a plain function. The ViewManager wraps it with `withModifiers` on its per-node listener path ([[DECISION-D18-PER-NODE-LISTENERS]]). Modifier-free bindings are byte-identical.
- **Two tables must stay mirrored:** the parser's `eventKeyFilters` (`puzzle-lang/parser`) and the runtime's `KEY_FILTERS` (`viewManager.js`).
- **Compile errors:** an unknown modifier; a key filter on a non-keyboard event; a duplicate modifier; more than one key filter; any modifier on a component callback prop ([[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]]).

A *conditional* intercept (Backspace merges blocks only at caret offset 0) cannot use `:prevent`; it is a plain `@keydown` handler that calls `event.preventDefault()` behind its own guard.

## Alternatives rejected
- A compile-time wrapper — cannot express once-ever across handler swaps.
- A structured `{ handler, modifiers }` vnode value — breaks the function-value contract the callback-prop path and the diff rely on.
- System-modifier combinations (`:ctrl:enter`) and `home`/`end`/`pageup`/`pagedown` — they interact with the one-key-filter rule and need their own decision.

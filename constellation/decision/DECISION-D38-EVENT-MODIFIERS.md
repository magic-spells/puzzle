---
name: "D38 — Event modifiers: `@event:modifier={...}` (v1.7)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - DOC-EVENTS
  - DOC-SPEC
notes:
  - kind: state
    text: >-
      Round-3 amendment to the spent-marker mechanics (fix/code-review-round3): the marker still
      survives per-patch handler swaps (the decision's core), but it is now CLEARED when the binding
      is actually removed (removeAttr, or nulled via the setAttr inline-if path). Previously a
      removed-then-re-added @event:once binding read the stale flag and never fired.
---

# D38 — Event modifiers: `@event:modifier={...}` (v1.7)

`@event:modifier[:modifier…]={ handler }` lands `prevent`/`stop`/`once` plus keyboard key filters; canonical execution order, modifiers encoded in the vnode key, wrapped at runtime via `withModifiers`. Settled (v1.7); additive. See [[DOC-SPEC]] §5 and [[DOC-EVENTS]].

## Context
[[DOC-SPEC]] §5/§6 deferred event modifiers. D38 lands them.

## Decision
`@event:modifier[:modifier…]={ handler }`. The set is **`prevent`** (`preventDefault`), **`stop`** (`stopPropagation`), **`once`** (fires once EVER for that binding) on any event, plus **key filters** `enter/escape/tab/space/up/down/left/right` (→ `event.key` `Enter`/`Escape`/`Tab`/`' '`/`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`) valid **only** on `keydown`/`keyup`/`keypress`. Modifiers stack.

- **Execution order is CANONICAL, independent of written order:** key-gate → once-spend → `preventDefault` → `stopPropagation` → handler. The key gate runs first so a non-matching key bails **before** `preventDefault` (preserving native behavior for other keys) and **without** spending `once`. `once` is spent-once-ever via a marker that **survives per-patch handler swaps** — a compile-time wrapper cannot express once-ever, which is why the wrapping lives in the runtime.
- **Encoding: modifiers ride in the vnode KEY** (`'@keydown:enter:prevent'`), and the handler value stays a plain function. Modifier-free bindings are **byte-identical** to before, and the component callback-prop path ([[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]]) is untouched. The runtime wraps via `withModifiers` in the ViewManager's per-node listener path ([[DECISION-D18-PER-NODE-LISTENERS]]).
- **Compile errors (not warnings):** unknown modifier; a key filter on a non-keyboard event; a duplicate modifier; more than one key filter; any modifier on a component callback prop.

## Alternatives rejected
- **A compile-time wrapper** — cannot express once-ever; the spent-marker must survive handler swaps, which only a runtime marker keyed to the binding can do.
- **A structured `{ handler, modifiers }` vnode value** — breaks the function-value contract that the callback-prop path and the diff both rely on; the key-encoding keeps the value a plain function.

## Consequences
The todos example and golden fixtures deliberately **stay modifier-free** (golden #1 protection).

Non-breaking: additive amendment (v1.7).

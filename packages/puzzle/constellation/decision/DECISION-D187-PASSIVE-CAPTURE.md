---
name: D187 — passive and capture event modifiers
status: built
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-TEMPLATE
  - DOC-EVENTS
  - DOC-RELEASE-SURFACE
  - TEST-DOM-PATCHING
---


## Context

Scroll and touch handlers need passive listeners, and some interactions need capture-phase dispatch. Both are native `addEventListener` options and fit the existing colon modifier syntax.

## Decision

`@event:passive` passes `passive: true` and `@event:capture` passes `capture: true`. Both compose with the other modifiers; `outside` still listens on document in capture phase and may also be passive. Listener replacement, removal, null toggling and once spending remove with the same capture flag the listener was installed with.

The parser accepts both as generic modifiers in written order. `passive` with `prevent` is a positioned parse error in either order, because a passive listener cannot cancel the default action. Duplicate and dotted spellings keep the existing diagnostics; component callback props still reject every modifier.

The options branch in the patcher sits behind `__PUZZLE_HAS_LISTENER_OPTIONS__`, a usage-scan define set when any element listener in the app's templates carries either modifier. Apps that use neither ship the same listener code as before.

## Alternatives rejected

- **A separate listener-options directive** — duplicates the modifier channel.
- **Native `once`** — loses the spent state across handler patches (D38).
- **Accept `passive:prevent` silently** — promises behavior the browser will not deliver.

## Consequences

The dispatch order of the existing modifiers and the handler arguments are unchanged.

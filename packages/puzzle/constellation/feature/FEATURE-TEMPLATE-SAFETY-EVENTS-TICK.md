---
name: Template URL safety, listener options and tick
status: built
release: RELEASE-V0-9-0
change: feature
branch: feat/template-safety-events
connections:
  - DECISION-D186-DYNAMIC-URL-SAFETY
  - DECISION-D187-PASSIVE-CAPTURE
  - DECISION-D188-TICK
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-SSG
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - DOC-SPEC-TEMPLATE
  - DOC-SPEC-ANATOMY
  - DOC-EVENTS
  - DOC-TEMPLATE-SYNTAX
  - DOC-TESTING
  - DOC-RELEASE-SURFACE
  - TEST-COMPILER-CODEGEN
  - TEST-DOM-PATCHING
  - TEST-RUNTIME-LIFECYCLE
---


# Template URL safety, listener options and tick

## Scope

- [[DECISION-D186-DYNAMIC-URL-SAFETY]]: `compiler/internal/codegen/url.go` picks the guarded values and the mode bits; `client-runtime/url.js` is the `urlValue` guard, shared by browser and prerender renders.
- [[DECISION-D187-PASSIVE-CAPTURE]]: `passive`/`capture` in the parser's generic modifier table (`packages/puzzle-lang/parser`), the patcher's options branch in `views/viewManager.js`, and the `__PUZZLE_HAS_LISTENER_OPTIONS__` usage bit (`internal/plugin` scan → `internal/build` defines).
- [[DECISION-D188-TICK]]: `client-runtime/scheduler.js` (`frame`, `schedule`, `tick`), used by the store, `PuzzleView` and `app.idle()`; `tick()` on `PuzzleView` and in `types/index.d.ts`.
- README, CHANGELOG 0.9.0.

## Tests

- Go: `codegen/url_test.go` (guard emission, static and component boundaries, fixed-scheme mixed heads, candidate lists, modifier keys); `plugin_test.go` (the listener-options usage bit); `parser/event_options_test.go` (accepted orders, `passive:prevent`, duplicates, dotted spellings).
- JS: `tests/url-safety.test.js` (the compiled `tests/fixtures/url-safety/Links.pzl` through mount/patch, serialization and route prerender, with case, entity, whitespace and control spellings); `tests/event-options.test.js`; `tests/tick.test.js`; `tests/store-flush.test.js` (D63 on the shared scheduler).

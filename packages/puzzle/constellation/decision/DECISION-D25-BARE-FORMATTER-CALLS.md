---
name: D25 — v1 formatter call form and callback-prop wrapping
status: verified
verified_at: '2026-08-24T19:04:22.414Z'
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - DECISION-D14-TODOS-MILESTONE
code_refs:
  - compiler/internal/codegen/codegen.go
  - compiler/internal/codegen/expr.go
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
notes:
  - kind: verified
    text: >-
      Retitled and re-truthed: the bare-call/deferred-guard claim now defers to D43; the
      callback-prop wrapper half is unchanged and still current.
    sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D25 — v1 formatter call form and callback-prop wrapping

Two things were settled here for v1. The live one is that callback props on
component tags compile with the same handler wrapper as DOM events. The other —
that formatter calls emit bare `__f.name(...)` with the typo-guard deferred —
was answered differently in v1.12 and now belongs to
[[DECISION-D43-FORMATTER-MISSING-GUARD]].

## Context
COMPILER_DESIGN §d specified `(__f.name || __f.__missing)(…)` so a typo'd formatter fails with a named error; golden file #1 (the Phase 1 fixture the runtime was proven against, [[DECISION-D14-TODOS-MILESTONE]]) emits bare `__f.date(…)`.

## Decision

v1 emitted bare calls: the fixture was the correctness definition and the
failure mode without the guard (`TypeError: __f.dat is not a function`) was
still debuggable, so the guard was deferred as a DX improvement needing a
`__missing` formatter in the runtime registry plus the wrapped call form.

**That deferral ended in v1.12.** Codegen emits the guarded form and
[[DECISION-D43-FORMATTER-MISSING-GUARD]] owns the question now — go there for
the current contract, not to this card.

Callback props on component tags compile with the same
`(event) => this.events.h(…)` wrapper as DOM events (APP_ANATOMY §1 form),
superseding COMPILER_DESIGN's looser "pass the handler reference" phrasing.
That half is unchanged and still current.

## Alternatives rejected
- **COMPILER_DESIGN's "pass the handler reference" phrasing for callback props** — superseded by the `(event) => this.events.h(…)` wrapper form (APP_ANATOMY §1).

---
name: "D25 — Formatter calls compile to bare __f.name(...); the __missing typo-guard is deferred"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
---

# D25 — Formatter calls compile to bare __f.name(...); the __missing typo-guard is deferred

Settled (v1). The compiler emits bare `__f.name(...)` formatter calls — matching golden file #1 — and defers the `__missing` typo-guard as a later DX improvement.

## Context
COMPILER_DESIGN §d specified `(__f.name || __f.__missing)(…)` so a typo'd formatter fails with a named error; golden file #1 (the Phase 1 fixture the runtime was proven against, [[DECISION-D14-TODOS-MILESTONE]]) emits bare `__f.date(…)`.

## Decision
The compiler emits bare calls — the fixture is the correctness definition and the failure mode without the guard (`TypeError: __f.dat is not a function`) is still debuggable. The guard is deferred as a DX improvement (needs a `__missing` formatter registered in the runtime registry plus the wrapped call form).

Also settled here: callback props on component tags compile with the same `(event) => this.events.h(…)` wrapper as DOM events (APP_ANATOMY §1 form), superseding COMPILER_DESIGN's looser "pass the handler reference" phrasing.

## Alternatives rejected
- **The `(__f.name || __f.__missing)(…)` wrapped form** (COMPILER_DESIGN §d) — deferred; the fixture emits bare calls and the unguarded failure mode is still debuggable.
- **COMPILER_DESIGN's "pass the handler reference" phrasing for callback props** — superseded by the `(event) => this.events.h(…)` wrapper form (APP_ANATOMY §1).

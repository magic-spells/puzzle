---
name: "v1.12 — The __missing formatter typo-guard"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - DECISION-D25-BARE-FORMATTER-CALLS
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
---

# v1.12 — The `__missing` formatter typo-guard

A typo'd formatter (`{ name | captialize }`) no longer crashes the render with an anonymous `TypeError` — it warns once, names the offender (with a did-you-mean), and passes the value through. Driven by [[DECISION-D43-FORMATTER-MISSING-GUARD]], superseding the [[DECISION-D25-BARE-FORMATTER-CALLS]] deferral.

## Intent

Close the long-carded D25 DX gap: a display-only mistake should never take a whole view down, and the error should name the typo instead of surfacing as `__f.captialize is not a function`.

## Scope

**In:**
- Codegen emits `(__f.name || __f.__missing('name'))(value, args…)` for every call in a chain (name JS-escaped).
- The registry's `__missing` becomes a **factory**: one `console.error` per unknown name per registry instance (`[puzzle] unknown formatter "captialize" — value passed through unchanged (did you mean "capitalize"?)`, suggestion at Levenshtein ≤ 2), returning a pass-through. `get()` stays consistent for unknown names.
- Golden #1 (`tests/fixtures/todos/TodoItem.compiled.js`) and the `formatter_chain` codegen golden updated — the fixture is the correctness definition, so it moves with the emission contract. A dedicated Go test (`TestFormatterMissingGuard`) pins the wrapped form so a blind golden `-update` can't silently revert it. `ScanFormatters` still over-includes (its rationale comment updated): used builtins must resolve to the real formatter, keeping the guard a *typo* guard, not a bundling crutch.

**Out (rejected in D43):** throwing; dev-only warnings; compile-time checking (impossible under the real-JS rule — the compiler cannot see the runtime registry).

## Outcome

Shipped in v1.12; documented in [[DOC-SPEC]] §6 and [[DOC-TEMPLATE-SYNTAX]]. Touched [[COMPONENT-CODEGEN]] and [[COMPONENT-FORMATTERS]] plus goldens/tests; template grammar and `.pzl` sources untouched — only emitted JS differs.

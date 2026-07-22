---
name: "D22 — Interpolation safety under the vdom: no escape-by-default"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - COMPONENT-VIEW-MANAGER
---

# D22 — Interpolation safety under the vdom: no escape-by-default

Settled. Compiled interpolations emit `String(expr)` into text vnodes with no `__formatters.escape` wrapper — injection safety comes from the vdom's `createTextNode`, not from escaping.

## Context
The escape-by-default wrapper was the prototype's string-concatenation-era contract. Under the vdom (D17), the ViewManager inserts text via `createTextNode`, which is literal — injection-safe by construction. The old wrapper double-encodes (`&` displays as `&amp;` — verified empirically, regression-tested in `tests/todos-app.test.js`).

## Decision
Compiled interpolations emit `String(expr)` into text vnodes with **no** `__formatters.escape` wrapper. The `escape` formatter stays registered for explicit use; `raw` (HTML injection) is deferred post-v1 since the runtime deliberately has no `innerHTML` vnode.

## Alternatives rejected
- **Keep escape-by-default** — double-encodes (`&` → `&amp;`).
- **Strip escape at runtime** — hides the contract.

## Consequences
COMPILER_DESIGN §b/§d already updated ([[DOC-COMPILER-DESIGN]]).

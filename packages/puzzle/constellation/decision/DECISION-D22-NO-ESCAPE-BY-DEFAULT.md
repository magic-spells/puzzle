---
name: D22 — Interpolation safety comes from text nodes, not escaping
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - COMPONENT-VIEW-MANAGER
  - DOC-COMPILER-DESIGN
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - DECISION-D174-STANDARD-FORMATTERS
---

# D22 — Interpolation safety comes from text nodes, not escaping

## Decision
A text interpolation compiles to a text vnode whose value is the display coercion of the expression (`__s(expr)`, [[DECISION-D127-DISPLAY-COERCION-OWNER]]) — no escape wrapper. The ViewManager inserts it with `createTextNode`, which is literal and injection-safe by construction. The `escape` function stays in the library for explicit use.

Injecting HTML is the one exception, opt-in and sanitized: a text interpolation whose outermost call is `raw(…)` (or `newline_to_br(…)`) compiles to a live-HTML vnode that parses the value only after an allowlist sanitizer runs ([[DECISION-D174-STANDARD-FORMATTERS]]).

## Alternatives rejected
- Escape-by-default (the string-concatenation era) — double-encodes under the vdom (`&` shows as `&amp;`; regression-tested in `tests/todos-app.test.js`).
- Stripping escape at runtime — hides the contract.

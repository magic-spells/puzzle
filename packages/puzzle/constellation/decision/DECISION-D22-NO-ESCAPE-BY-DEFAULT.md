---
name: D22 — Interpolation safety comes from text nodes, not escaping
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - COMPONENT-VIEW-MANAGER
  - DOC-COMPILER-DESIGN
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - DECISION-D174-FUNCTION-LIBRARY
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D22 — Interpolation safety comes from text nodes, not escaping

## Decision
- A text interpolation compiles to a text vnode whose value is the display coercion of the expression (`__s(expr)`, [[DECISION-D127-DISPLAY-COERCION-OWNER]]) — no escape wrapper. The ViewManager inserts it with `createTextNode`, which is literal and injection-safe by construction.
- The `escape` function stays in the library for explicit use.
- Injecting HTML is the one opt-in exception: a text interpolation whose outermost call is `raw(…)` or `newline_to_br(…)` compiles to a live-HTML vnode. `raw` runs an allowlist sanitizer first; `newline_to_br` escapes its value and only adds `<br>` tags ([[DECISION-D174-FUNCTION-LIBRARY]]).

## Alternatives rejected
- Escape-by-default — double-encodes under the vdom (`&` shows as `&amp;`).
- Stripping escape at runtime — hides the contract.

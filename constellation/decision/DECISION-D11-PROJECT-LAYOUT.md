---
name: "D11 — Project layout: `app/` source, `dist/` output"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DECISION-D27B-BLOG-EXAMPLE
---

# D11 — Project layout: `app/` source, `dist/` output

Settled; enforced by [[DOC-SPEC]] §11. The entry point is `app/app.js`, build output goes to `dist/`, and `examples/todos/` is the canonical reference application.

## Context
The prototype defaulted its source directory to `./src`.

## Decision
- Entry point is `app/app.js`.
- CLI defaults updated accordingly (away from the prototype's `./src`).
- `examples/todos/` is the canonical reference application.

## Consequences
`example-app/` has since been removed — replaced by `examples/blog/` (see [[DECISION-D27B-BLOG-EXAMPLE]]).

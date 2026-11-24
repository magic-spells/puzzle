---
name: "D10 — Generated `render()` attached via prototype assignment"
status: verified
verified_at: '2026-11-24T18:13:21.008Z'
connections:
  - COMPONENT-CODEGEN
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
code_refs:
  - compiler/internal/codegen/codegen.go
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# D10 — Generated `render()` attached via prototype assignment

Enforced by [[DOC-SPEC-ANATOMY]] §4.

## Decision
The compiler appends `Name.prototype.render = function () { … }` **after** the user's class (and `Name.prototype.renderSkeleton` for a `<puzzle-skeleton>`, [[DECISION-D39-SKELETON]]); it never injects a method into the class body. The name comes from [[DECISION-D24-CLASS-NAME-EXTRACTION]].

## Why
The user's code is never rewritten, so sourcemaps stay honest and debugging stays sane.

## Alternatives rejected
- Injecting `render()` into the class body — rewrites user code.

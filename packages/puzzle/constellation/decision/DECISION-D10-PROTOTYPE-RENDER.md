---
name: "D10 — Generated `render()` attached via prototype assignment"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-CODEGEN
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
code_refs:
  - compiler/internal/codegen/codegen.go
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D10 — Generated `render()` attached via prototype assignment

Enforced by [[DOC-SPEC-ANATOMY]] §4.

## Decision
The compiler appends `Name.prototype.render = function () { … }` **after** the user's class (and `Name.prototype.renderSkeleton` for a `<puzzle-skeleton>`, [[DECISION-D39-SKELETON]]); it never injects a method into the class body. The name comes from [[DECISION-D24-CLASS-NAME-EXTRACTION]].

## Why
The user's code is never rewritten, so sourcemaps stay honest and debugging stays sane.

## Alternatives rejected
- Injecting `render()` into the class body — rewrites user code.

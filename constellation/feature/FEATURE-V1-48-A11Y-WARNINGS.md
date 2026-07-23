---
name: v1.48 — Compiler accessibility warnings (D82)
status: building
connections:
  - DECISION-D82-A11Y-WARNINGS
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - FILE-CODEGEN
---

# v1.48 — Compiler accessibility warnings (D82)

Five conservative, positioned, non-fatal template a11y diagnostics on the
existing `Result.Warnings` channel. Ship [[DECISION-D82-A11Y-WARNINGS]].

## Scope

- In: NEW `compiler/internal/codegen/a11y.go` — a read-only AST walk over the
  template and skeleton trees, descending into `{#if}`/`{#for}`/`{#case}`
  bodies, component call-site children, and slot fallbacks; wired into
  `compile()` beside the existing script-import collision warning. Rules:
  `<img>`/`<input type="image">` without `alt` (explicit `alt=""` valid),
  `<iframe>` without `title`, `<a>` without `href`, statically positive
  `tabindex`. Any static/valueless/dynamic/mixed attr counts as present;
  dynamic `type`/`tabindex` never warn. NEW `a11y_test.go` (rules, positions,
  skeleton coverage, control-flow nesting, no-warning equivalents).
- Out (per D82): suppression syntax, warning IDs, ARIA role matrix,
  click/keyboard heuristics, any runtime or generated-JS change.

## Acceptance

- Each rule fires with the exact source position; valid equivalents are
  silent; goldens byte-identical; `go test ./...` green.

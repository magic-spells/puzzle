---
name: v1.48 — Compiler accessibility warnings (D82)
status: verified
connections:
  - DECISION-D82-A11Y-WARNINGS
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - FILE-CODEGEN
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Merged (PR #12) and verified: 27-case a11y_test.go green, goldens byte-identical, positioned
      warnings confirmed via pzlc smoke; all example fixtures compile warning-free.
    sha: 0858d1e52af13ecfe031278ca8e1db496ca3ff2c
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-2-0
change: feature
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

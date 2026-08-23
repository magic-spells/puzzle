---
name: v1.48 — Compiler accessibility warnings (D82)
status: verified
connections:
  - DECISION-D82-A11Y-WARNINGS
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - FILE-CODEGEN
verified_at: '2026-08-23T19:55:34.717Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
notes:
  - kind: verified
    text: >-
      Merged (PR #12) and verified: 27-case a11y_test.go green, goldens byte-identical, positioned
      warnings confirmed via pzlc smoke; all example fixtures compile warning-free.
    sha: 0858d1e52af13ecfe031278ca8e1db496ca3ff2c
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

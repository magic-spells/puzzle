---
name: 'D82 — Compiler accessibility warnings: five conservative template diagnostics'
status: verified
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - FILE-CODEGEN
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D82 — Compiler accessibility warnings: five conservative template diagnostics

The compiler emits positioned, non-fatal warnings for five common template accessibility mistakes through the existing `Result.Warnings` channel (printed by the esbuild plugin and `pzlc`). Generated JavaScript is unchanged. Spec: [[DOC-SPEC-TEMPLATE]] §43.

## Decision

A read-only AST walk in codegen (`a11y.go`, `collectA11yWarnings`) over the template and skeleton ASTs, descending into control-flow bodies, component call-site children and fallbacks. Exactly five rules, chosen for near-zero false positives:

- `<img>` without `alt` (`alt=""` is valid — decorative)
- `<input type="image">` without `alt` (only when `type` is statically `image`)
- `<iframe>` without `title`
- `<a>` without `href`
- a statically positive `tabindex`

Any attribute node satisfies presence — static, valueless, dynamic or mixed — so rules never guess at runtime values; a dynamic `type`/`tabindex` never warns. A new rule is a new walk case plus tests and a SPEC list entry.

## Alternatives rejected

- **Errors or a strict-mode flag** — must never break existing builds.
- **Suppression syntax / warning IDs** — grammar cost for noise five conservative rules shouldn't produce; revisit only if one proves noisy.
- **ARIA role matrix, click-without-keyboard heuristics** — where a11y linters generate false positives.
- **Parser-side, a separate lint command, or runtime dev checks** — codegen owns the warnings channel and already sees the AST with positions.

---
name: 'D82 — Compiler accessibility warnings: five conservative template diagnostics (v1.48)'
status: planned
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - FILE-CODEGEN
  - FEATURE-V1-48-A11Y-WARNINGS
---

# D82 — Compiler accessibility warnings: five conservative template diagnostics (v1.48)

The compiler emits **positioned, non-fatal warnings** for five common template
accessibility mistakes. Zero runtime bytes, zero change to generated
JavaScript — the diagnostics ride the existing out-of-band `Result.Warnings`
channel. See [[DOC-SPEC]] §43.

## Context

Puzzle owns a compiler, so it can catch markup mistakes at the exact source
position for free — one of the highest-value things Svelte's compiler does.
A 2026-07 framework-gap review surfaced this as the cheapest borrowable idea
on the table. The infrastructure already exists: `Result.Warnings` with
positioned `Warning{File, Line, Col, Message}` structs and one precedent
warning (the D-series script-import collision diagnostic), already printed to
stderr by the esbuild plugin and `pzlc`. The parser AST carries `Pos` on every
element and distinguishes static, dynamic, and mixed attributes — everything a
presence check needs.

## Decision

**A read-only AST walk in codegen (`a11y.go`) appending to the existing
warnings slice, run over the template AND skeleton ASTs.** Exactly five rules
in v1, chosen for near-zero false-positive rates:

- `<img>` without `alt` (explicit `alt=""` is valid — decorative images)
- `<input type="image">` without `alt` (only when `type` is statically `image`)
- `<iframe>` without `title`
- `<a>` without `href`
- a statically positive `tabindex`

Presence is satisfied by ANY attribute node — static, valueless, dynamic
(`alt={description}`), or mixed — so the rules never guess about runtime
values. Dynamic/mixed `type` and `tabindex` never warn. The walk descends into
`{#if}`/`{#for}`/`{#case}` bodies, component call-site children, and slot
fallbacks.

Deliberate boundaries, each with its rejected alternative:

- **Warnings, never errors.** Accessibility diagnostics on existing apps must
  not break builds. **Rejected:** a strict mode flag — config surface for a
  hypothetical need.
- **No suppression syntax, no warning IDs.** Five conservative rules should
  not need silencing; a suppression language is real grammar cost for noise
  that should not exist. Revisit only if a rule proves noisy in practice.
- **No ARIA role matrix, no click-without-keyboard heuristics.** Those rule
  families are where a11y linters generate false positives; a short reliable
  list beats a large engine. **Rejected** for v1.
- **Lives in codegen, not the parser.** The parser API keeps its single
  error-shaped surface; codegen already owns the warnings channel (the
  script-import precedent).

## Consequences

- Developers get file:line:col a11y feedback in every `puzzle dev`/`build`
  with no new output plumbing and no opt-in.
- Generated JS is byte-identical; golden tests are untouched by construction.
- The rule list is additive — future rules are new walk cases plus tests, no
  contract change beyond a SPEC list amendment.

## Alternatives rejected

- A separate lint tool/command — a second binary surface for what the build
  already sees; the compiler is the natural (and only positioned) home.
- Runtime dev-mode checks — costs bundle bytes, fires after the fact, and
  cannot point at source positions.

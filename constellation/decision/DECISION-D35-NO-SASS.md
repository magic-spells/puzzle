---
name: "D35 — No Sass support, ever"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DECISION-D12-TAILWIND-FIRST
  - DECISION-D26-TAILWIND-PIPELINE
  - DECISION-D03-SCRIPTS-REAL-JS
---

# D35 — No Sass support, ever

Sass moves from "deferred" to permanently rejected: `styles.use` stays a single `'tailwindcss'` string and the reserved Sass object-entry slot is removed. Settled. See [[DOC-SPEC]] §11.

## Context
[[DECISION-D12-TAILWIND-FIRST]] shipped the Tailwind-first style pipeline and parked Sass as "deferred"; [[DECISION-D26-TAILWIND-PIPELINE]]/[[DECISION-D03-SCRIPTS-REAL-JS]] even reserved the `styles.use` object-entry shape (`{ name: 'sass', ... }`) as the deferred Sass slot. D35 closes that door.

## Decision
Sass will **never** be supported — it moves from deferred to permanently rejected. Rationale: native CSS now has nesting (and custom properties, `@layer`, `color-mix()`, container queries), so the historical reason to reach for a preprocessor is gone, and Puzzle is Tailwind-first — that is what its users write. A second style pipeline is not free: it doubles the `styles.use` support surface (config parsing, CLI resolution, watch wiring, composition ordering, error paths) for a shrinking audience, and a minimal one-pipeline surface is a feature, not a gap.

The `{ name: 'sass', input: ... }` roadmap example is removed; `styles.use` stays a single `'tailwindcss'` string, though the object form remains reserved for some *other* future pipeline should a concrete need appear — just never Sass.

## Alternatives rejected
- Keeping Sass as a deferred/future pipeline — the historical preprocessor need is gone with native CSS nesting; a second pipeline doubles the support surface for a shrinking audience.

## Consequences
Supersedes the "Sass … deferred" phrasing in **D12** (and the "deferred Sass shape" asides in **D26**/**D3**): those entries stand as append-only history, but the status they recorded is now settled here. Scoped styles (`<style scoped>`) are untouched — they remain genuinely deferred.

Non-breaking: no config that ever validated stops validating; a Sass entry was already a parse-and-reject error and stays one.

---
name: D12 — Tailwind is the only style pipeline (no Sass, ever); bare `<style>` is global CSS
status: verified
verified_at: '2026-08-24T19:04:17.751Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
  - DECISION-D26-TAILWIND-PIPELINE
  - DECISION-D59-SCOPED-STYLES
code_refs:
  - compiler/cmd/puzzle/add.go
  - compiler/internal/config/config.go
  - compiler/internal/plugin/plugin.go
  - compiler/internal/styles/styles.go
  - compiler/internal/scaffold/templates/todos/puzzle.config.js
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D12 — Tailwind is the only style pipeline; bare `<style>` is global CSS

Enforced by [[DOC-SPEC-ANATOMY]] §3, §11. Implementation: [[DECISION-D26-TAILWIND-PIPELINE]].

## Decision
- `puzzle.config.js` with `styles: { use: ['tailwindcss'] }` gives zero-config Tailwind in `puzzle dev` and `puzzle build`. `styles.use` accepts only the string `'tailwindcss'`; any other entry is a load-time error naming it. The object-entry shape stays reserved for some other future pipeline — never Sass.
- A bare `<style>` block emits **global** CSS, appended after the Tailwind layer. Scoping is opt-in per block with `<style scoped>` ([[DECISION-D59-SCOPED-STYLES]]).
- The compiler never parses CSS.

## Why no Sass
Native CSS has nesting, custom properties, `@layer`, `color-mix()` and container queries, so the reason to reach for a preprocessor is gone, and Puzzle users write Tailwind. A second pipeline doubles the `styles.use` surface (config parsing, CLI resolution, watch wiring, composition order, error paths) for a shrinking audience.

## Alternatives rejected
- Sass as a supported or deferred pipeline — see above; permanently rejected.

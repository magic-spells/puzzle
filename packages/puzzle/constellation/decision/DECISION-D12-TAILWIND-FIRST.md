---
name: D12 — Tailwind is the only style pipeline (no Sass, ever); bare `<style>` is global CSS
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
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
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D12 — Tailwind is the only style pipeline; bare `<style>` is global CSS

Enforced by [[DOC-SPEC-ANATOMY]] §3, §11. Implementation: [[DECISION-D26-TAILWIND-PIPELINE]].

## Decision
- `puzzle.config.js` with `styles: { use: ['tailwindcss'] }` gives zero-config Tailwind in `puzzle dev` and `puzzle build`. `styles.use` accepts only the string `'tailwindcss'`; any other entry (string or object) is a load-time error naming it.
- A bare `<style>` block emits **global** CSS, appended after the Tailwind layer. Scoping is opt-in per block with `<style scoped>` ([[DECISION-D59-SCOPED-STYLES]]).
- The compiler never parses CSS.

## Alternatives rejected
- Sass (supported or deferred) — permanently rejected. Native CSS has nesting, custom properties, `@layer`, `color-mix()` and container queries, and Puzzle users write Tailwind. A second pipeline doubles the `styles.use` surface (config parsing, CLI resolution, watch wiring, composition order, error paths) for a shrinking audience.

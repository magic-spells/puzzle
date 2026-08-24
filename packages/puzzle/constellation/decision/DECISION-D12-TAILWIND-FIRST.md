---
name: D12 — Tailwind-first styling; unscoped `<style>` is global CSS
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
code_refs:
  - compiler/cmd/puzzle/add.go
  - compiler/internal/config/config.go
  - compiler/internal/parser/sections.go
  - compiler/internal/plugin/plugin.go
  - compiler/internal/styles/styles.go
  - compiler/internal/scaffold/templates/todos/puzzle.config.js
---

# D12 — Tailwind-first styling; unscoped `<style>` is global CSS

Settled; enforced by [[DOC-SPEC-ANATOMY]] §3, §11. `puzzle.config.js` with `styles: { use: ['tailwindcss'] }` gives zero-config Tailwind, and a bare `<style>` block emits global CSS.

## Context
Puzzle targets a Tailwind-first styling experience; the styling pipeline needed a v1 contract.

## Decision
- `puzzle.config.js` with `styles: { use: ['tailwindcss'] }` gives zero-config Tailwind during `puzzle dev`/`puzzle build`.
- A bare `<style>` block emits **global** CSS. Scoping is opt-in per block via
  `<style scoped>`, which [[DECISION-D59-SCOPED-STYLES]] owns — that card holds
  the current contract, including the native `@scope` wrapping. This card's
  v1 deferral of the attribute ended there.

## Alternatives rejected
- The Sass pipeline — deferred.

---
name: "D12 — Tailwind-first styling; `<style>` is global CSS in v1"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
---

# D12 — Tailwind-first styling; `<style>` is global CSS in v1

Settled; enforced by [[DOC-SPEC]] §3, §11. `puzzle.config.js` with `styles: { use: ['tailwindcss'] }` gives zero-config Tailwind, and `<style>` blocks emit global CSS in v1.

## Context
Puzzle targets a Tailwind-first styling experience; the styling pipeline needed a v1 contract.

## Decision
- `puzzle.config.js` with `styles: { use: ['tailwindcss'] }` gives zero-config Tailwind during `puzzle dev`/`puzzle build`.
- `<style>` blocks emit **global** CSS.

## Alternatives rejected
- The `scoped` attribute on `<style>` — deferred.
- The Sass pipeline — deferred.

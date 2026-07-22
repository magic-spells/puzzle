---
name: "D3 — `<scripts>` blocks are real JavaScript"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
---

# D3 — `<scripts>` blocks are real JavaScript

Settled per [[DOC-SPEC]] §4 — the most consequential decision in the project. `.pzl` scripts must be standard JavaScript, so the Go compiler never parses JS.

## Context
Older examples used an object-literal dialect inside class bodies (`events: {...},` with commas between members) that does not parse as JavaScript.

## Decision
`.pzl` scripts must be standard JS — `events` and `animations` are class fields (`events = {...};`), no commas between members.

## Alternatives rejected
- The object-literal dialect inside class bodies (`events: {...},` with commas between members) — rejected because it does not parse as JavaScript.
- Method-shorthand handlers — rejected because method shorthand would mis-bind `this`; the compiler rejects it at build time (handlers must be arrow functions).

## Consequences
- The Go compiler **never parses JavaScript** — `<scripts>` is handed to esbuild untouched.
- Editors, ESLint, Prettier, and (future) TypeScript work with zero special tooling.
- Handlers in `events` must be **arrow functions**: class-field initializers evaluate during construction with `this` bound to the instance, so arrows permanently capture the component. Method shorthand would mis-bind `this`; the compiler rejects it at build time.
- The base class must never read `this.events` in its constructor (fields initialize after `super()` returns); the runtime reads it lazily at mount time.

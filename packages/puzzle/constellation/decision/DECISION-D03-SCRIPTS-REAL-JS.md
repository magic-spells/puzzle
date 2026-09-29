---
name: "D3 — `<script>` blocks are real JavaScript"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
---

# D3 — `<script>` blocks are real JavaScript

Enforced by [[DOC-SPEC-ANATOMY]] §4 — the most consequential decision in the project.

## Decision
A `.pzl` `<script>` is standard JavaScript (or TypeScript, [[DECISION-D54-TYPESCRIPT-SCRIPTS]]). `events` and `animations` are class fields (`events = {…};`), with no commas between members. The Go compiler **never parses the script** — it hands it to esbuild untouched and only reads its token stream for narrow lookups (the class name, [[DECISION-D24-CLASS-NAME-EXTRACTION]]).

## Consequences
- Editors, ESLint, Prettier and TypeScript work with no special tooling.
- Handlers in `events` must be **arrow functions**: a class-field initializer runs during construction with `this` bound to the instance, so an arrow captures the component. Method shorthand parses, but the runtime calls it as `this.events.name(…)`, so `this` is the events object. Nothing checks this at compile time — the compiler cannot see the script.
- The base class must never read `this.events` in its constructor (fields initialize after `super()` returns); the runtime reads it lazily at mount.
- Tooling that would need to rewrite user JS (auto-wiring in `puzzle add`/`generate`) prints a snippet instead ([[DECISION-D32-CLI-TOOLING]]).

## Alternatives rejected
- An object-literal dialect in class bodies (`events: {…},`) — does not parse as JavaScript.

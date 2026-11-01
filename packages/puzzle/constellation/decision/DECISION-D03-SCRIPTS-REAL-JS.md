---
name: "D3 — `<script>` blocks are real JavaScript"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D3 — `<script>` blocks are real JavaScript

The most consequential decision in the project; enforced by [[DOC-SPEC-ANATOMY]] §4. Editors, ESLint, Prettier and TypeScript work on `.pzl` scripts with no special tooling.

## Decision
- A `.pzl` `<script>` is standard JavaScript (or TypeScript, [[DECISION-D54-TYPESCRIPT-SCRIPTS]]). `events` and `animations` are class fields (`events = {…};`), with no commas between members.
- The Go compiler **never parses or rewrites the script**. esbuild gets it untouched; the compiler only reads its token stream for narrow lookups such as the class name ([[DECISION-D24-CLASS-NAME-EXTRACTION]]).
- Tooling that would need to rewrite user JS (auto-wiring in `puzzle add`/`generate`) prints a snippet instead ([[DECISION-D32-CLI-TOOLING]]).

## Gotchas
- Handlers in `events` must be **arrow functions**. A class-field initializer runs with `this` bound to the instance, so an arrow captures the component; method shorthand or a `function` expression parses, but the runtime calls it as `this.events.name(…)`, so `this` is the events object. The compiler cannot see this, so development builds warn instead: on a view class's first mount, each non-arrow handler whose source uses `this` gets one warning naming the arrow fix. Production drops the check.
- The base class must never read `this.events` in its constructor (fields initialize after `super()` returns); the runtime reads it lazily at mount.

## Alternatives rejected
- An object-literal dialect in class bodies (`events: {…},`) — does not parse as JavaScript.

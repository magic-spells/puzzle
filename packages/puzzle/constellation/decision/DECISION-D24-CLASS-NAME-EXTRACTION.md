---
name: "D24 — Compiled component name comes from the export default class declaration"
status: verified
verified_at: '2026-08-24T19:03:10.852Z'
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-COMPILER-DESIGN
  - DOC-SPEC-ANATOMY
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D10-PROTOTYPE-RENDER
code_refs:
  - compiler/internal/codegen/classname.go
  - compiler/internal/codegen/codegen.go
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D24 — The compiled component name comes from the `export default class` declaration

## Decision
[[DOC-SPEC-ANATOMY]] §4 mandates `export default class <Name> extends …` in `<script>`. The compiler reads `<Name>` from the shared `<script>` token stream (`tokenizeJS`, computed once per compile; it also feeds the import-collision and reserved-binding scans) as the first **real** `export` → `default` → `class` sequence — none of the three inside a string, template literal, comment or regex, so a commented-out `export default class Fake` cannot win. It is a read-only lookup for the `Name.prototype.render` assignment ([[DECISION-D10-PROTOTYPE-RENDER]]); `<script>` stays byte-for-byte verbatim.

- A TypeScript `abstract` modifier and generic parameters on the declaration are accepted.
- The `extends` target is unrestricted (a component may extend an intermediate base class), but a class-level `extends` is required.
- An anonymous default class is a build error ("name your component class").
- `<Name>` is any JavaScript identifier, Unicode included, read with the shared `jsident` rules ([[DECISION-D176-EXPRESSION-LANGUAGE]] rule 8). A name the scan cannot read to its end (a `\u` escape, a letter newer than Go's Unicode tables) is a positioned build error, never an assignment against a truncated name.
- A `.pzl` with no `<script>` is legal: codegen synthesizes the runtime import plus an empty `PuzzleView` subclass named from the filename (non-identifier runes become `_`).

## Alternatives rejected
- Filename-derived naming — breaks the canonical app, where `Home.pzl` exports `class TodoHome`.
- Real JS parsing — violates [[DECISION-D03-SCRIPTS-REAL-JS]].
- Substituting `export default` with a compiler-owned binding — rewrites user bytes for no gain.
- A line-anchored regex over raw `<script>` — a commented-out or stringified declaration wins the match and crashes the module on load.

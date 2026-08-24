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
code_refs:
  - compiler/internal/codegen/classname.go
  - compiler/internal/codegen/codegen.go
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
notes:
  - kind: verified
    text: >-
      Class-name extraction re-truthed against classname.go's token scan: abstract modifier,
      unrestricted extends target, filename fallback.
    sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D24 — Compiled component name comes from the export default class declaration

Settled. The compiler extracts the component class name by scanning the `<script>` token stream for the mandated `export default class <Name>` declaration — a read-only lookup, never a rewrite.

## Context
The compiler appends `Name.prototype.render = function () {…}` after the user's `<script>`, so it needs the class name — but the Go side never parses JavaScript ([[DECISION-D03-SCRIPTS-REAL-JS]]).

## Decision
[[DOC-SPEC-ANATOMY]] §4 mandates that `<script>` contains `export default class <Name> extends PuzzleView`; the compiler extracts `<Name>` from the shared `<script>` token stream (`tokenizeJS`, computed once per compile, and also feeding the import-collision and reserved-binding scans) by finding the first REAL `export` → `default` → `class` keyword sequence — "real" meaning none of the three sits inside a string, template literal, comment, or regex literal, so a commented-out `export default class Fake` at column 0 cannot win the match. A TypeScript `abstract` modifier between `default` and `class` is accepted, as are generic parameter lists on the declaration. `<script>` itself stays byte-for-byte verbatim. An anonymous default class (`export default class extends …`) is a build error ("name your component class"), and so is a named default class with no class-level `extends` clause; the base identifier is deliberately unrestricted, because a component may extend an intermediate base class rather than `PuzzleView` directly. A `.pzl` with no `<script>` at all is legal: codegen synthesizes the module — the runtime import plus an empty `PuzzleView` subclass named from the filename — and compiles the rest exactly as if the user had written it. This matches the Phase 1 golden fixture exactly as written (`Home.pzl` → `TodoHome.prototype.render`), so golden file #1 needs no churn.

## Alternatives rejected
- **Filename-derived naming** (the original default plan in COMPILER_DESIGN §b) — breaks the canonical app itself, where `Home.pzl` exports `class TodoHome`.
- **Real JS parsing** — violates [[DECISION-D03-SCRIPTS-REAL-JS]].
- **Substituting `export default` with a compiler-owned binding** (`const __PzlSelf = …; export default __PzlSelf`) — works but rewrites user bytes and muddies the verbatim guarantee for no gain.
- **A line-anchored regex over the raw `<script>` bytes** — cheap, but a commented-out or stringified `export default class` at the start of a line wins the match and emits a `prototype.render` assignment against a name that does not exist at module load.

---
name: "D24 — Compiled component name comes from the export default class declaration"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-COMPILER-DESIGN
---

# D24 — Compiled component name comes from the export default class declaration

Settled. The compiler extracts the component class name by textually matching the mandated `export default class <Name> extends PuzzleView` declaration — a read-only lookup, never a rewrite.

## Context
The compiler appends `Name.prototype.render = function () {…}` after the user's `<scripts>`, so it needs the class name — but the Go side never parses JavaScript ([[DECISION-D03-SCRIPTS-REAL-JS]]).

## Decision
[[DOC-SPEC]] §4 already mandates that `<scripts>` contains `export default class <Name> extends PuzzleView`; the compiler extracts `<Name>` by matching that declaration shape textually (anchored pattern, first match at the start of a line wins) — a read-only lookup, not a rewrite; `<scripts>` stays byte-for-byte verbatim. An anonymous default class (`export default class extends …`) is a build error ("name your component class"). This matches the Phase 1 golden fixture exactly as written (`Home.pzl` → `TodoHome.prototype.render`), so golden file #1 needs no churn.

## Alternatives rejected
- **Filename-derived naming** (the original default plan in COMPILER_DESIGN §b) — breaks the canonical app itself, where `Home.pzl` exports `class TodoHome`.
- **Real JS parsing** — violates [[DECISION-D03-SCRIPTS-REAL-JS]].
- **Substituting `export default` with a compiler-owned binding** (`const __PzlSelf = …; export default __PzlSelf`) — works but rewrites user bytes and muddies the verbatim guarantee for no gain.

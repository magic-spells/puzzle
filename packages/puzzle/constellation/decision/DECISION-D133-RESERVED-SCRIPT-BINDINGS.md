---
name: >-
  D133 — Reserved module-scope script bindings are a positioned compile error, not an esbuild
  duplicate-binding frame
status: verified
connections:
  - DECISION-D29-LOOP-COUNTER
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - COMPONENT-CODEGEN
  - FILE-CODEGEN
  - DOC-COMPILER-DESIGN
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Verified at the merged release/0.4.0 tip (PR #38): checkReservedScriptBindings wiring in
      compile(), the conservative top-level scan, and the declaration-positioned ParseError reviewed
      against scriptcollide.go/codegen.go; reserved_bindings_test.go (11 subtests + position +
      svg-dedup cases) green, zero golden changes from the check itself (go test ./... all 14
      packages ok at the merge commit).
    sha: f2bf7b6ab1c0487ce458b48443b62b447ff55ff6
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D133 — Reserved module-scope script bindings are a positioned compile error

Codegen appends `import { ViewNode, … } from '@magic-spells/puzzle';` after the
verbatim `<script>`, so a script that binds one of the emitted names at module
scope is a duplicate declaration in the generated module. That contract stands
(the names stay reserved — see the rejected alternative), but its failure mode
moves: the compiler now detects the collision itself and fails with a
`parser.ParseError` positioned at the offending declaration's own line and
column in the `.pzl`, instead of esbuild reporting a duplicate binding against
the injected import line — a line that appears in no `.pzl` — at a line number
skewed by the generated preamble.

## Mechanism

`scriptcollide.go`'s existing string/comment/regex-aware tokenizer (the same
LexSkip walk behind the import-shadow warning and classname extraction) gains a
top-level declaration scan: identifiers bound by `const`/`let`/`var`/
`function`/`class` at brace-depth 0, merged with the import-clause locals it
already collected. `compile()` checks that set against **exactly the names this
file will emit** — `ViewNode` always, `SLOT_TAG` when the template has a
composition marker, `PORTAL_TAG` when it has a `<Portal>`, `__s` when display
coercion is compiled (D127), `__svg_N` in SVG-dedup mode —
right after the import line is assembled. Nothing is reserved unconditionally:
`const __s` in a module that never coerces still compiles, and the
function-scope helpers (`__d`, `__f`) never collide because they are shadowed
inside the render body, not redeclared. The error message names what the file
imports as that identifier and why THIS file imports it, so it explains a
reservation the `.pzl` cannot see.

The scan is deliberately conservative — destructuring patterns, later
declarators of a list, and `function`/`class` in expression position are
skipped (a named class expression binds its name inside the expression only),
and TS `declare` statements are ignored as type-only. TS type-only imports are
likewise excluded: `import type …` and inline `{ type X }` / `{ type X as Y }`
specifiers register no value binding — esbuild erases them before the injected
import lands — while the value-space spellings `import type from 'x'`,
`{ type }`, and `{ X as type }` still count. The asymmetry is the
point: a **miss falls through to esbuild's own duplicate-binding error**, while
a false hit would reject legal code. The compiler cannot *parse* the script
(that contract holds — the script's bytes are the user's), but the token scan
detects the common forms without parsing.

Known residual: a scriptless `.pzl` whose filename synthesizes a reserved class
name (`ViewNode.pzl`) still fails at esbuild — the scan reads the user's
script, so the message would be wrong for that case; it needs its own error if
it ever matters.

## Rejected

- **An alias allocator** (pick `__s2` when `__s` is taken) — rejected when this
  was first adjudicated and still rejected: the emitted module's names become
  input-dependent, and the reservation contract is simpler than the machinery
  to avoid it.
- **Reserving the whole `__` prefix by fiat** — would break scripts that
  harmlessly bind `__`-names codegen never emits for that file; the exact
  per-file set costs nothing more.

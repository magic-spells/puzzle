---
name: D133 — Reserved module-scope script bindings are a positioned compile error
status: verified
connections:
  - DECISION-D29-LOOP-COUNTER
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - COMPONENT-CODEGEN
  - FILE-CODEGEN
  - DOC-COMPILER-DESIGN
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D133 — Reserved module-scope script bindings are a positioned compile error

Codegen appends `import { ViewNode, … } from '@magic-spells/puzzle';` after the
verbatim `<script>`, so a script binding one of those names at module scope is a
duplicate declaration. The compiler detects this itself and fails with a
`parser.ParseError` at the offending declaration's line/column in the `.pzl`,
rather than esbuild reporting against an injected line no `.pzl` contains.

## Mechanism

- `scriptcollide.go`'s string/comment/regex-aware tokenizer scans top-level
  (brace-depth 0) `const`/`let`/`var`/`function`/`class` bindings plus import
  locals; `checkReservedScriptBindings` compares them against **exactly the names
  this file emits**: `ViewNode` always, and only when used `SLOT_TAG`,
  `SNIPPET_TAG`, `PORTAL_TAG`, `__s` (display coercion, D127), `__l` (list
  blocks, D170), `__e`/`__r` (loop guards, D173), one `__svg_N` per unique
  `{#svg}` in dedup mode, and one `__L<n>` per lowered `{#for}` site. Nothing is
  reserved unconditionally; render-scope helpers (`__d`, `__f`) are shadowed
  inside the render body and never collide. The message names what the file
  imports as that identifier and why.
- The scan is **conservative**: destructuring patterns, later declarators in a
  list, `function`/`class` in expression position, TS `declare` statements, and
  type-only imports (`import type …`, `{ type X }`) are skipped — while the
  value-space spellings `import type from 'x'`, `{ type }`, `{ X as type }`
  count. A miss falls through to esbuild's own error; a false hit would reject
  legal code. The compiler still never parses script bodies.
- Known residual: a scriptless `ViewNode.pzl` (filename-synthesized class name)
  still fails at esbuild.

## Alternatives

- **An alias allocator** (`__s2` when `__s` is taken) — emitted names become
  input-dependent.
- **Reserve the whole `__` prefix** — rejects harmless scripts for names this
  file never emits.

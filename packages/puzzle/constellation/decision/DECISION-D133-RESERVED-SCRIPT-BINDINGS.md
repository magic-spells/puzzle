---
name: D133 — Reserved module-scope script bindings are a positioned compile error
status: verified
connections:
  - DECISION-D29-LOOP-COUNTER
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D180-COMPONENT-SLOT
  - DECISION-D186-DYNAMIC-URL-SAFETY
  - COMPONENT-CODEGEN
  - FILE-CODEGEN
  - DOC-COMPILER-DESIGN
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - compiler/internal/codegen/scriptcollide.go
  - compiler/internal/codegen/codegen.go
---

# D133 — Reserved module-scope script bindings are a positioned compile error

Codegen appends `import { ViewNode, … } from '@magic-spells/puzzle';` (plus a few
hoisted consts) after the verbatim `<script>`, so a script binding one of those
names at module scope is a duplicate declaration. The compiler detects this
itself and fails with a `parser.ParseError` at the offending declaration's
line/column in the `.pzl`, rather than letting esbuild report against an injected
line no `.pzl` contains.

## Decision

- `scriptcollide.go`'s string/comment/regex-aware tokenizer collects top-level
  (brace-depth 0) `const`/`let`/`var`/`function`/`class` bindings plus import
  locals. `checkReservedScriptBindings` compares them against **exactly the names
  this file emits** (built in `codegen.go` from the import list): `ViewNode`
  always; and only when used `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG`, `__s`
  (display coercion, D127), `__l` (list blocks, D170), `__e`/`__r` (loop guards,
  D173), `__u` (dynamic URL bindings, D186), `__dc` (`<Component>`, D180), one
  `__svg_N` per unique `{#svg}` in dedup mode, and one `__L<n>` list-block meta
  const per lowered `{#for}` site. Only `ViewNode` is reserved in every file;
  render-scope helpers (`__d`, `__f`) are shadowed inside the render body and
  never collide. The message (`reservedBindingEmission`) names what the file
  emits under that identifier and why.
- The scan is **conservative**: destructuring patterns, later declarators in a
  list, `function`/`class` in expression position, TS `declare` statements, and
  type-only imports (`import type …`, `{ type X }`) are skipped — while the
  value-space spellings `import type from 'x'`, `{ type }`, `{ X as type }`
  count. A miss falls through to esbuild's own error; a false hit would reject
  legal code. The compiler still never parses script bodies.
- A new emitted helper must be added to the import list (so it lands in the
  emitted set) **and** get a case in `reservedBindingEmission`.

## Alternatives rejected

- **An alias allocator** (`__s2` when `__s` is taken) — emitted names become
  input-dependent.
- **Reserve the whole `__` prefix** — rejects harmless scripts for names this
  file never emits.

## Gotchas

- A scriptless `ViewNode.pzl` (class name synthesized from the filename) still
  fails at esbuild, not with a positioned error.

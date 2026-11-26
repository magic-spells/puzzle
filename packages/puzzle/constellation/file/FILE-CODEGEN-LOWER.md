---
name: expression lowering
status: verified
path: compiler/internal/codegen/lower.go
language: go
summary: >-
  Lowers every template expression's AST to JavaScript (render target) or TypeScript (puzzle check
  target); resolves names from the tree; reads D170 row facts and D62 handler verdicts off the same
  tree.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D62-HANDLER-CACHING
  - TEST-COMPILER-CODEGEN
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
notes:
  - kind: state
    text: >-
      `ident()`'s `refData` arm calls `noteImport`, which warns once per name, at the identifier's
      own line and column, when a template reads a name imported in `<script>`. `ExprWriter` is the
      one writer interface, shared by the render emitter and `WriteCheckValue`.
---

# lower.go

Lowers every template expression's AST to JavaScript (render target) or
TypeScript (`puzzle check` target). Intent: [[COMPONENT-CODEGEN]] and
[[DECISION-D176-EXPRESSION-LANGUAGE]] (rule 8, the hosts). The file header
carries **the lowering table** — AST node → emitted JavaScript — and the
handler-value forms; read it there rather than restating it here. Before touching
the file:

- **Nothing reads an expression's source string.** Names resolve from the tree:
  an arrow parameter shadows a template binding, which shadows the handler's
  `event`; every other name is `__d.<name>` outside the D180 `<Component>` `is` module scope. A binding a persistent list row
  rewrites (`todo` → `s.item`, the counter → `s.i`) comes from the scope map
  threaded through emission.
- **Every member step, index step and method call is guarded** (`?.`), handler
  arguments included. A library call lowers to
  `(__f["name"] || __f.__missing("name"))(…)` (the D43 guard); a method stays the
  same JavaScript method; `Math.*` and the other allowed globals stay verbatim,
  except `Object.keys`/`values`/`entries` take their first argument as
  `(<arg> ?? {})` (`objectGlobalArgs`) so a missing value yields `[]`; a free
  `event` chain in a handler is emitted as written.
- **One tree, two targets.** The check target (`WriteCheckValue`/`WriteCheckEvent`)
  emits TypeScript with no added guards and no `?? {}` on the `Object` globals
  (TypeScript 5.6+ reports a `??` whose left side can never be nullish), a
  standard library call as the shim's `__puzzle_fn.name(…)`, any other bare call
  (an app function) as `__puzzle_app_fn("name")(…)`, a method call with an
  arrow argument taking its receiver through `__puzzle_check_list(…)`, and an
  `Object.keys`/`values`/`entries` argument through `__puzzle_check_list(…)` (the
  render target's `?? {}` position).
- **Render facts come from the same tree** (`exprFacts`): which parent data roots
  a loop body reads, which members it reads off the row item, and whether it is
  volatile (a `timeago` call) — the inputs to D170 list blocks — plus the D62
  cacheability verdict of a handler (a library call in a handler argument makes
  it non-cacheable).
- Literal date-function arguments are checked at the same call sites by
  [[FILE-CODEGEN-PRESETS]].

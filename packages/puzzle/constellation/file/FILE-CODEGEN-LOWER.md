---
name: expression lowering
status: built
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
---

Source binding for the owning component card. Behavioral intent stays in [[COMPONENT-CODEGEN]] and [[DECISION-D176-EXPRESSION-LANGUAGE]] (rule 8, the hosts); this card anchors that plan to `compiler/internal/codegen/lower.go`.

The file header carries **the lowering table** — AST node → emitted JavaScript — and the handler-value forms; read it there rather than restating it here. What a reader needs before touching the file:

- **Nothing reads an expression's source string.** Names resolve from the tree: an arrow parameter shadows a template binding, which shadows the handler's `event`; every other name is `__d.<name>`. A binding that a persistent list row rewrites (`todo` → `s.item`, the counter → `s.i`) comes from the scope map threaded through emission.
- **Every member step, index step and method call is guarded** (`?.`), handler arguments included; a library call lowers to `(__f["name"] || __f.__missing("name"))(…)` (the D43 guard); a method stays the same JavaScript method; `Math.*` and the other allowed globals stay verbatim, except that `Object.keys`, `values` and `entries` take their first argument as `(<arg> ?? {})` (`objectGlobalArgs`), so a missing value yields `[]`; a free `event` chain in a handler is emitted as written.
- **One tree, two targets.** The check target (`WriteCheckValue`/`WriteCheckEvent`, used by `puzzle check`) emits TypeScript with no added guards and no `?? {}` default on the `Object` globals (TypeScript 5.6+ reports a `??` whose left side can never be nullish), a standard library call as the shim's `__puzzle_fn.name(…)`, any other bare call — an app function — as `__puzzle_app_fn("name")(…)`, and a method call with an arrow argument taking its receiver through `__puzzle_check_list(…)`.
- **Render facts come from the tree** (`exprFacts`): which parent data roots a loop body reads, which members it reads off the row item, and whether it is volatile (a `timeago` call) — the inputs to D170's list blocks — and the D62 cacheability verdict of a handler (a library call in a handler argument makes it non-cacheable).
- There is no pipe lowering, no `.size` helper and no token-scanning resolver; `presets.go` checks literal date-function arguments at the same call sites.

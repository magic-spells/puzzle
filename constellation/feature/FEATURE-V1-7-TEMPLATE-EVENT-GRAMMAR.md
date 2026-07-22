---
name: "v1.7 — Template & event grammar amendments"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D36-UNLESS
  - DECISION-D37-CASE-WHEN
  - DECISION-D38-EVENT-MODIFIERS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-EVENTS
  - DOC-SPEC
---

# v1.7 — Template & event grammar amendments

Three additive grammar/event amendments land together: `{#unless}`, `{#case}`/`{:when}`, and event modifiers `@event:modifier={...}`. Driven by [[DECISION-D36-UNLESS]], [[DECISION-D37-CASE-WHEN]], and [[DECISION-D38-EVENT-MODIFIERS]].

## Intent
SPEC §5/§6 deferred inverted conditionals, multi-branch conditionals, and event modifiers. v1.7 fills all three gaps additively over the frozen grammar — `{#unless done}` reads better than `{#if !(done)}`, multi-branch needed a getter-safe single-evaluation block, and per-node listeners needed `prevent`/`stop`/`once` + key filters.

## Scope
**In:**
- `{#unless expr}` — inverted conditional with optional `{:else}`; a parse-time desugar to a negated `{#if}` (`!(expr)`), codegen unchanged. `{:else if}` inside is a positioned compile error. See [[DECISION-D36-UNLESS]].
- `{#case expr}` / `{:when v1, v2, …}` (+ optional `{:else}`) — Liquid-style naming (not `{#switch}`/`{:case}`), strict `===`, first-match-wins, NO fallthrough; a dedicated `Case` AST node emitting an IIFE that binds the expression to `__c` exactly once (getter-safe); top-level commas are OR; positioned compile errors for malformed clauses. See [[DECISION-D37-CASE-WHEN]].
- Event modifiers `@event:modifier[:modifier…]={ handler }` — `prevent`/`stop`/`once` on any event + key filters (`enter/escape/tab/space/up/down/left/right`) on keyboard events; stack; canonical execution order (key-gate → once-spend → preventDefault → stopPropagation → handler) independent of written order; modifiers encoded in the vnode KEY, handler stays a plain function; runtime `withModifiers` in the ViewManager listener path (D18). See [[DECISION-D38-EVENT-MODIFIERS]].

**Out (rejected):** an `Unless` AST node and `{:else if}` chains under `{#unless}`; `{#switch}`/`{:case}` naming and desugaring case to nested ifs; a compile-time modifier wrapper (can't express once-ever) and a structured `{ handler, modifiers }` vnode value (breaks the function-value contract). The todos example and golden fixtures deliberately stay modifier-free (golden #1 protection).

## Outcome
Shipped in v1.7; documented in [[DOC-SPEC]] §5/§6, [[DOC-TEMPLATE-SYNTAX]], and [[DOC-EVENTS]]. All three are additive amendments — existing `{#if}` templates untouched, modifier-free bindings byte-identical to before; only the [[COMPONENT-VIEW-MANAGER]] listener wiring changed for modifiers. Touched [[COMPONENT-TEMPLATE-PARSER]] and [[COMPONENT-CODEGEN]] (unless/case) and [[COMPONENT-VIEW-MANAGER]] (modifiers).

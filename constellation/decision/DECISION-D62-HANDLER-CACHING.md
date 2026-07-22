---
name: D62 — data-independent @event handlers emit per-instance cached closures
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D38-EVENT-MODIFIERS
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
  - FEATURE-V1-29-COMPOSITION-FIXES
---

# D62 — data-independent `@event` handlers emit per-instance cached closures

## Context

`compileEventValue` (SPEC §5) emits a fresh arrow — `(event) => this.events.h(…)`
— inline in `render()` at every `@event` site, so every render produces a **new
function object**. Two costs:

1. **Component callback props defeat shallowEqual.** `patchComponent` re-runs a
   child's `data()` when props shallow-differ (§4 prop-reactivity). A callback
   prop never compares equal, so any child taking one re-runs `data()` on
   *every* parent re-render — the rule fires on phantom changes. On the
   known-deferred list since the round-1 review ([[COMPONENT-VIEW-MANAGER]]
   note: "the planned fix is compiler-hoisted per-instance handler caching");
   the tarot-puzzle wrapper made it concrete — event wiring cannot be
   props-driven at all (forwarders must be wired once in `mounted()` and read
   `this.props[name]` at fire time), and every wrapper-shaped component pays a
   per-parent-render `data()` tax.
2. **DOM listener churn.** `patchAttrs` sees a changed `'@click'` value on
   every patch → removeEventListener + addEventListener per re-render, per
   listener site. Correct but wasted work.

## Decision

Codegen wraps **data-independent** handler values in a per-instance cache:

```js
((this.__h ??= {})[3] ??= (event) => this.events.h(event))
```

`3` is a per-file site counter (deterministic; `render()` and
`renderSkeleton()` share it, so recompiling an unchanged file is byte-stable).
The cache lives on the component instance (`this.__h`), so the same function
object is passed on every render of that instance. Handler *semantics* are
unchanged — `this.events` lookup still happens at fire time.

**Cacheable sites** (compile-time decision, in `compileEventValue`):

- the bare form `@click={ h }` — always (captures only `this`);
- the call form `@click={ h(args) }` — iff the arguments reference **nothing
  from the render scope beyond `event`**: literals, `event`, `this.…`, and JS
  globals are fine (all are evaluated at fire time *inside* the closure).

Detection is a two-pass resolution, no new lexer:
`resolveExpr(args, fullScope) == resolveExpr(args, {event}) &&
!strings.Contains(out, "__d.")`. The equal-outputs check catches loop/scope
variables (in the reduced scope they'd get `__d.`-prefixed and the outputs
diverge); the substring check catches data references (identical in both
passes). False negatives (a string literal containing `"__d."`) just miss the
cache — harmless.

**Non-cacheable sites emit byte-identical to v1.28**: call forms capturing
render data (`save(draft)` → `__d.draft`) or loop variables
(`remove(card.id)`) stay fresh closures — their captures genuinely change, and
caching them would fire stale values.

## Alternatives

- **Runtime fix: shallowEqual treats functions as equal (or compares source)** —
  rejected: a closure capturing loop data MUST count as a changed prop; any
  function-equality hack reintroduces stale-handler bugs, silently.
- **Module-level hoisting to a const** — rejected: handlers reference `this`;
  an arrow needs instance scope to capture it.
- **Cache all call forms keyed by captured values** — rejected: per-site
  value-keyed caches for closures that are semantically fresh anyway; cost
  without benefit.

## Consequences

- A child whose props are all static/cached no longer re-runs `data()` on every
  parent render — §4's prop-reactivity rule means what it says again. (A child
  receiving a data-capturing callback still re-runs per parent render —
  correct: that prop really is new.)
- Cached DOM listener sites stop rebinding per patch. The `:once` spent flag is
  unaffected (it lives on the element's LISTENERS object keyed by attr name,
  not on the handler function).
- Loop-hosted *bare* handlers share ONE cached closure across iterations
  (correct — they're data-independent by definition).
- `this.__h` joins the emitted `__d`/`__f` as a reserved name (instance field).
- `??=` requires ES2021; builds target ES2022 (dev and prod) — no lowering.
- All goldens update; emitted bytes for non-cacheable sites are unchanged.

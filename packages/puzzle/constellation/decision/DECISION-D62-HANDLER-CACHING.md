---
name: D62 — data-independent @event handlers emit per-instance cached closures
status: verified
verified_at: '2026-08-24T19:03:25.442Z'
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D38-EVENT-MODIFIERS
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
  - FEATURE-V1-29-COMPOSITION-FIXES
code_refs:
  - compiler/internal/codegen/codegen.go
  - compiler/internal/codegen/expr.go
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
notes:
  - kind: verified
    text: >-
      Cacheability detection re-truthed against expr.go: one resolveExprTrackingScope pass,
      referencesLoopScope ANDed with the __d. check.
    sha: c809db6680eb9355961897756f54e97f1164b88f
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

Detection is a single resolution pass, no new lexer: `resolveExprTrackingScope`
resolves the arguments once — with `event` added to the render scope — and
reports, alongside the emitted JS, whether it referenced any identifier from
the render/loop scope. A site is cacheable iff that flag is false **and** the
emitted args contain no `__d.`. The flag catches loop and scope variables; the
substring check catches render-data reads. Keeping the reference check inside
the resolver makes it follow the resolver's own lexical rules — property names
and text inside literals/comments/regexes do not count, identifiers inside
template-literal interpolations do. False negatives (a string literal
containing `"__d."`) just miss the cache — harmless.

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

## Measured: the prediction holds, and the idiom is what defeats the bailout

This card's Context predicted the cost of a non-cacheable callback prop. It has
now been measured end to end, in a 10,000-row list, both arms in one browser
session — [[DOC-STRESS-EXAMPLE]]'s `?handlers=inline|stable` A/B, driven by
[[DECISION-D128-BENCHMARK-METHODOLOGY]]. It settles a question that had been
open as "is the per-row re-render cascade a framework bug?"

**It is not a framework bug.** `patchComponent`'s `shallowEqual` prop bailout is
correct and, given stable props, extremely effective. Structural counts at
n=10,000 (exact, from a development build — properties of the render algorithm,
not of the machine):

| op | arm | child `data()` runs | renders | wasted | prop bailouts | DOM mutations |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `swap-rows` | inline | 10,000 | 10,001 | 10,000 | 0 | 997 |
| `swap-rows` | stable | **0** | **1** | 0 | **10,000** | 997 |
| `select-row` | inline | 10,000 | 10,001 | 10,000 | 0 | 1 |
| `select-row` | stable | **1** | 2 | 1 | 9,999 | 1 |

**The DOM work is identical in both arms** — the stable spelling is not skipping
anything the user can see; it patches precisely the same nodes and stops waking
the rows that had nothing to do. Production script time at 10,000 rows falls by
more than half on every op that mutates an existing list (`select-row` 42.3ms →
14.3ms, `update-every-10th` 46.7ms → 22.2ms, `swap-rows` 47.0ms → 18.5ms), and
the renderer's own `task` accounting agrees. `create` is unchanged in both arms
at both sizes — nothing can bail out on first mount.

What the stable arm changes is only the *spelling*: `@select={ selectById }`
instead of `@select={ selectRow(row) }`, with the row capture moved into the
child (`props.select?.(props.id)`, parent re-queries by id). So the cascade is
caused by the canonical Puzzle list idiom — the shape `examples/todos` uses —
handing the patcher a brand-new function object per row per render, exactly as
this decision's Context said it would. The rejected alternatives above
(function-equality hacks in `shallowEqual`) remain rejected for the same reason;
the remedy is on the authoring side, or in a future numbered decision, not in
weakening prop equality.

## Regression cover

`tests/component-prop-bailout.test.js` holds this finding in place at test
scale. The browser measurement above is not repeatable in CI, and until that
file existed **nothing asserted the bailout fires at all** — a change to
`shallowEqual`, or a newly added prop that is freshly allocated on every parent
render, would have left the suite green while every list-shaped app quietly
reverted to the `inline` column of the table.

It covers both directions against a 20-row list, using
`measureRenders().rendersByView` (keyed by constructor name, so each row gets
its own generated subclass name and the report says WHICH row woke up):

- **stable arm** — one row's `label` changes, one row re-renders, 19 do not, one
  `data()` run, one DOM mutation.
- **inline arm** — the same op with a per-row closure prop; all 20 re-run
  `data()` and re-render for the *same single* DOM mutation. Committed
  deliberately as characterization of a known cost, not as an endorsement, so
  that "fixing" it by deep-comparing props or exempting function-valued props
  fails loudly instead of changing behaviour in silence.
- **DOM equivalence** — both arms produce byte-identical markup and the same
  `domMutations`, which is the claim the table's last column makes.

The comparator's own boundaries are pinned through the real patch path rather
than by exporting `shallowEqual`, so a future `patchComponent` that stops
consulting it fails too.

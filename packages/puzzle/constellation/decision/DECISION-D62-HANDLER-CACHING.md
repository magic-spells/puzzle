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

`compileEventValue` (SPEC §5) emits an arrow — `(event) => this.events.h(…)` —
inline in `render()` at every `@event` site. Emitted naively that is a **new
function object per render**, with two costs:

1. **Component callback props defeat prop equality.** `patchComponent` re-runs a
   child's `data()` when props differ (§4 prop-reactivity). A callback prop that
   is freshly allocated never compares equal, so any child taking one re-runs
   `data()` on *every* parent re-render — the rule fires on phantom changes. On
   the known-deferred list since the round-1 review ([[COMPONENT-VIEW-MANAGER]]
   note: "the planned fix is compiler-hoisted per-instance handler caching");
   the tarot-puzzle wrapper made it concrete — event wiring cannot be
   props-driven at all (forwarders must be wired once in `mounted()` and read
   `this.props[name]` at fire time), and every wrapper-shaped component pays a
   per-parent-render `data()` tax.
2. **DOM listener churn.** `patchAttrs` sees a changed `'@click'` value on
   every patch → removeEventListener + addEventListener per re-render, per
   listener site. Correct but wasted work.

## Decision

Codegen caches the closure on whichever object outlives the render, and the
choice of object is what the compiler decides per site.

**Data-independent sites cache per instance** in `this.__h`:

```js
((this.__h ??= {})[3] ??= (event) => this.events.h(event))
```

`3` is a per-file site counter (deterministic; `render()` and
`renderSkeleton()` share it, so recompiling an unchanged file is byte-stable).
The cache lives on the component instance, so the same function object is
passed on every render of that instance. Handler *semantics* are unchanged —
`this.events` lookup still happens at fire time.

A site is data-independent when it is the bare form `@click={ h }` (captures
only `this`), or the call form `@click={ h(args) }` whose arguments reference
**nothing from the render scope beyond `event`**: literals, `event`, `this.…`,
and JS globals are all fine, because they are evaluated at fire time *inside*
the closure.

**Loop-capturing sites cache on the row scope.** Inside a lowered item-form
`{#for}` ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]) the loop locals rewrite to
the row's live scope object and the closure caches there:

```js
remove: (s.h0 ??= (event) => this.events.deleteTodo(s.item)),
```

`h0` is counted from 0 per loop site. The row scope persists for the row's
whole life and `s.item` is the row's **current** item, so one function object
serves every render of that row and still reads the right record after an
update, a reorder or a same-key replacement. A site qualifies when every
binding its arguments captured belongs to a lowered loop — a range-loop
variable or a `<Snippet>` parameter is re-bound per iteration or per expansion,
so a closure over one must stay fresh.

**Everything else stays a fresh closure.** Arguments that read render data
(`save(draft)` → `__d.draft`) close over `__d`, a per-render snapshot; caching
one would freeze it. Those sites emit byte-identically to v1.28, and the parent
roots they read join the loop site's dirty mask so the row rebuilds when the
data behind them changes.

Detection is a single resolution pass, no new lexer: `resolveExprScan` resolves
the arguments once — with `event` added to the render scope — and reports,
alongside the emitted JS, which bindings and which data roots they referenced.
Keeping the reference check inside the resolver makes it follow the resolver's
own lexical rules — property names and text inside literals/comments/regexes do
not count, identifiers inside template-literal interpolations do. False
negatives (a string literal containing `"__d."`) just miss the cache — harmless.

## Alternatives

- **Runtime fix: prop equality treats functions as equal (or compares source)** —
  rejected: a closure capturing loop data MUST count as a changed prop; any
  function-equality hack reintroduces stale-handler bugs, silently. This is why
  the fix is in what the compiler emits, not in what equality means.
- **Module-level hoisting to a const** — rejected: handlers reference `this`;
  an arrow needs instance scope to capture it.
- **Cache all call forms keyed by captured values** — rejected: per-site
  value-keyed caches for closures that are semantically fresh anyway; cost
  without benefit.
- **Leaving loop captures fresh** (the v1.29 position) — rejected on
  measurement. It was the reason the canonical Puzzle list idiom — the shape
  `examples/todos` uses — handed the patcher a brand-new function object per row
  per render, so every mounted row re-ran `data()` and re-rendered for a single
  changed record. The browser A/B below priced that; the row scope removes the
  cause rather than teaching authors to spell around it.

## Consequences

- A child whose props are all static, cached or memoized does not re-run
  `data()` on a parent render — §4's prop-reactivity rule means what it says.
  A child receiving a genuinely fresh prop still re-runs, correctly.
- **A `{#for}` row's callback prop is identity-stable**, so a list refreshes the
  children whose data actually changed. What invalidates a row's child is its
  record's own render revision (D170), not callback churn. An authored view can
  still allocate a fresh prop per render and pay the old cost — that is a
  spelling, no longer the framework's default output.
- Cached DOM listener sites stop rebinding per patch. The `:once` spent flag is
  unaffected (it lives on the element's LISTENERS object keyed by attr name,
  not on the handler function).
- Loop-hosted *bare* handlers share ONE per-instance cached closure across
  iterations (correct — they're data-independent by definition).
- `this.__h` joins the emitted `__d`/`__f` as a reserved name (instance field);
  the row caches live on the block's row state and reserve nothing.
- `??=` requires ES2021; builds target ES2022 (dev and prod) — no lowering.
- Goldens carry both cache shapes; emitted bytes for fresh-closure sites are
  unchanged.

## Measured: what a fresh closure per row costs

The cost this decision removes was measured end to end, in a 10,000-row list,
both arms in one browser session — [[DOC-STRESS-EXAMPLE]]'s
`?handlers=inline|stable` A/B, driven by
[[DECISION-D128-BENCHMARK-METHODOLOGY]]. It also settles a question that had
been open as "is the per-row re-render cascade a framework bug?"

**It is not a framework bug.** `patchComponent`'s prop bailout is correct and,
given stable props, extremely effective. Structural counts at n=10,000 (exact,
from a development build — properties of the render algorithm, not of the
machine):

| op | arm | child `data()` runs | renders | wasted | prop bailouts | DOM mutations |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `swap-rows` | inline | 10,000 | 10,001 | 10,000 | 0 | 997 |
| `swap-rows` | stable | **0** | **1** | 0 | **10,000** | 997 |
| `select-row` | inline | 10,000 | 10,001 | 10,000 | 0 | 1 |
| `select-row` | stable | **1** | 2 | 1 | 9,999 | 1 |

**The DOM work is identical in both arms** — the stable identity is not skipping
anything the user can see; it patches precisely the same nodes and stops waking
the rows that had nothing to do. Production script time at 10,000 rows falls by
more than half on every op that mutates an existing list (`select-row` 42.3ms →
14.3ms, `update-every-10th` 46.7ms → 22.2ms, `swap-rows` 47.0ms → 18.5ms), and
the renderer's own `task` accounting agrees. `create` is unchanged in both arms
at both sizes — nothing can bail out on first mount.

The two arms differed only in spelling: `@select={ selectById }` (a bare method
reference, per-instance cacheable) against `@select={ selectRow(row) }` (a loop
capture). A compiled `{#for}` now emits the stable identity for both, so the
numbers above are the price of the *pattern*, not of the framework — and the
A/B's inline arm no longer reproduces it from the compiler. Those stress arms
are being re-measured under D170.

## Regression cover

`tests/component-prop-bailout.test.js` holds this in place at test scale. The
browser measurement above is not repeatable in CI, and until that file existed
**nothing asserted the bailout fires at all** — a change to the comparator, or a
newly added prop that is freshly allocated on every parent render, would have
left the suite green while every list-shaped app quietly reverted to the
`inline` column of the table.

It covers both directions against a 20-row list, using
`measureRenders().rendersByView` (keyed by constructor name, so each row gets
its own generated subclass name and the report says WHICH row woke up):

- **the compiled shape** — records in the store, rows through a list block, the
  row's callback cached on the row state. One record's `update()` wakes exactly
  one child: one `data()` run, one re-render, one DOM mutation, and the other 19
  rows return their cached vnode and never reach `patchComponent` at all.
- **a hand-written fresh prop** — the same op with a per-row closure allocated
  in `render()`; all 20 re-run `data()` and re-render for the *same single* DOM
  mutation. Committed deliberately as characterization of a cost an authored
  view can still pay, so that "fixing" it by deep-comparing props or exempting
  function-valued props fails loudly instead of changing behaviour in silence.
- **DOM equivalence** — both arms produce byte-identical markup and the same
  `domMutations`, which is the claim the table's last column makes.

The comparator's own boundaries are pinned through the real patch path rather
than by exporting it: the key-COUNT shape guard, `!==` on values (so a `NaN`
prop never bails out while `+0`/`-0` do), and the record render-revision test
D170 added. A future `patchComponent` that stops consulting it fails too.

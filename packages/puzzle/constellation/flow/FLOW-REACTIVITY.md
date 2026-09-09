---
name: Reactivity flow
status: verified
triggers:
  - { kind: event }
  - { kind: manual }
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-MODEL
  - FILE-STORE
  - FILE-PUZZLE-VIEW
  - FILE-VIEW-MANAGER
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D161-AUTO-FETCHING-FINDS
verified_at: '2026-08-24T21:39:15.808Z'
notes:
  - kind: gotcha
    text: >-
      Record-as-prop defeats prop reactivity: records mutate IN PLACE, so a record passed as a
      component prop is always reference-equal and patchComponent's shallowEqual skip means the
      child's data() never re-runs on record updates (streamed content, flag flips are invisible to
      it). The child renders fresh only when some OTHER prop differs or it is remounted. Idiomatic
      fix (see DOC-CHAT-EXAMPLE): the child re-queries findOne(type, props.record.id) inside data(),
      subscribing itself to the record key — updates then re-render exactly that child. Props carry
      identity; the store carries live data. If a framework-level answer is ever wanted
      (always-refresh children, or record versioning), it needs a D-number — SPEC §4's
      shallow-differ rule is the documented contract.
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Reactivity flow

Puzzle has two intentionally asymmetric update paths:

1. A store notification, prop change, or route-param change reruns
   `data(params, props)`. The successful, settled result replaces the
   component's model layer, then the component renders and patches. A
   notification landing while a D161 settle window is open folds into the
   settling run as one more pass (`_settleDirty`) rather than starting a
   competing refresh.
2. `setData()` mutates the persistent local layer and renders immediately. It
   does not rerun `data()`; call `refresh()` when derived model data must be
   recomputed.

Implicit two-way binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]) feeds
both paths without adding a third: a bound form control's synthesized handler
writes local state through `setData` + `refresh` (path 2 plus the rerun, so
`data()`-derived values track typing) or writes a record through validated
`update()`, which re-enters as an ordinary store notification (path 1). The
controlled-property echo compares against the live DOM, so the keystroke that
caused the write patches nothing back into the input.

Queries made inside `data()` register the evaluating component with
[[COMPONENT-STORE]]. With the adapter capability installed, a tracked miss
also queues a fetch and the evaluation re-runs until it settles — only the
final warm pass's subscriptions commit; every provisional pass's registrations
are unwound first ([[DECISION-D161-AUTO-FETCHING-FINDS]]). Record and
collection keys are batched into one flush, each subscriber is isolated from
failures, and subscriptions are replaced on reevaluation and removed on
destroy.

Async `data()` is last-wins: an older promise cannot commit after a newer
evaluation. A previously-synchronous `data()` returns a promise as soon as a
tracked find misses — only a sync, hit-only first pass stays synchronous, which
is what decides whether a skeleton shows. While a component is suspended,
optional skeleton content follows the first-load and minimum-duration rules
described by [[COMPONENT-PUZZLE-VIEW]].

The DOM path is render → diff → keyed patch in [[COMPONENT-VIEW-MANAGER]].
Conditional placeholders stabilize child arity so toggling a branch does not
remount unrelated trailing siblings.

Durable caveat: model records mutate in place. Passing a record as a prop alone
does not defeat shallow prop equality; a child that needs live record changes
should receive identity and query that record inside its own `data()`.

## Measured: propagation is O(1) in depth and in forest size

A standing worry — that one update walks the whole view forest, or costs one
`data()` per level of nesting — is **refuted**. [[DOC-STRESS-EXAMPLE]]'s
`deep-nest` scenario mounts 64 branches × 24 genuinely nested levels = **1,536
real view instances** and counts node `data()` executions per op:

| op | nodes that ran `data()` |
| --- | ---: |
| update the deepest node of one branch | **1 / 1,536** |
| update the shallowest node of one branch | **1 / 1,536** |
| update the record every node also queries (control) | 1,536 / 1,536 |

One view re-evaluates and re-renders; its child receives shallow-equal props and
takes the component bailout, so propagation stops dead at the node that changed.
A branch-root update is also 1, not 24 — depth costs nothing unless the data
being threaded down actually changes. The third row is the control that makes the
other two worth anything: a scenario with quietly broken subscriptions would
report a very impressive `1` and mean nothing.

Two costs are *not* bounded this way and are recorded on the cards that own them:
async `data()` evaluations serialize store-wide ([[COMPONENT-STORE]]), and a
callback prop that captures loop data defeats the bailout above for every row in
a list ([[DECISION-D62-HANDLER-CACHING]]).

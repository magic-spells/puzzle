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
verified_at: '2026-07-22T00:04:06.638Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
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
    sha: a571b6ffdf32ed9117f929f4f8fb8ea8127edf4d
---

# Reactivity flow

Puzzle has two intentionally asymmetric update paths:

1. A store notification, prop change, or route-param change reruns
   `data(params, props)`. The successful result replaces the component's model
   layer, then the component renders and patches.
2. `setData()` mutates the persistent local layer and renders immediately. It
   does not rerun `data()`; call `refresh()` when derived model data must be
   recomputed.

Queries made inside `data()` register the evaluating component with
[[COMPONENT-STORE]]. Record and collection keys are batched into one flush,
each subscriber is isolated from failures, and subscriptions are replaced on
reevaluation and removed on destroy.

Async `data()` is last-wins: an older promise cannot commit after a newer
evaluation. While a component is suspended, optional skeleton content follows
the first-load and minimum-duration rules described by
[[COMPONENT-PUZZLE-VIEW]].

The DOM path is render → diff → keyed patch in [[COMPONENT-VIEW-MANAGER]].
Conditional placeholders stabilize child arity so toggling a branch does not
remount unrelated trailing siblings.

Durable caveat: model records mutate in place. Passing a record as a prop alone
does not defeat shallow prop equality; a child that needs live record changes
should receive identity and query that record inside its own `data()`.

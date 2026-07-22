---
name: "v1.3 — Nested routes"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DOC-SPEC
---

# v1.3 — Nested routes

A route object gains `children: [...]` with relative child paths, and a parent view renders its matched child at `<Slot/>` — a router-only amendment that generalizes flat v1 routing to view chains. Driven by [[DECISION-D30-NESTED-ROUTES]].

## Intent
v1's router (D19) was strictly flat: one route = one full-path regex → one view + optional top-level layout, and the only nesting was the layout's `<Slot/>` hosting the routed view. There was no way for a routed view to host a child routed view.

## Scope
**In:** `children: [...]` on a route object with relative child paths; parents render the matched child at `<Slot/>`; `path: ''` index child; params merge down and every level's `data(params)` receives the full merged params; chain-prefix reuse (reused ancestors `refresh()` with merged params, awaited pre-commit — the D19 gate generalized); one-animator-per-transition generalized to "topmost swapped instance animates, everything below rides along"; `meta.title` resolves nearest-defined leaf → root; generation-stamped vnode keys; interruption clamping.
**Out (rejected):** flat routes with `parent:` name references, absolute child paths (constructor throw), per-level `layout` (root-only field — `layout` on a child throws), and auto-matching a parent's bare URL with an empty slot. All sub-decisions with their rejected alternatives are in [[DECISION-D30-NESTED-ROUTES]].

## Outcome
Shipped in v1.3; documented in [[DOC-SPEC]] §9, [[DOC-ROUTER]], and [[DOC-VIEW-LIFECYCLE]] §4. A router-only additive amendment — the slot/compose/destroy plumbing was already generic, so no compiler, [[COMPONENT-VIEW-MANAGER]], or PuzzleView change; flat routes (chain length 1) behave exactly as before. Touched [[COMPONENT-ROUTER]].

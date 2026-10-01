---
name: 'D69 — Directional morph roles: data-puzzle-morph-trigger / -target'
status: verified
connections:
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D55-MORPH-TRANSITIONS
  - COMPONENT-MORPH
  - DOC-SPEC
verified_at: '2026-07-17T08:28:24.546Z'
code_refs:
  - client-runtime/morph.js
---

# D69 — Directional morph roles: `data-puzzle-morph-trigger` / `-target`

Three spellings, one id namespace:

| attribute | launches | receives |
|---|---|---|
| `data-puzzle-morph="id"` | yes | yes |
| `data-puzzle-morph-trigger="id"` | yes | never |
| `data-puzzle-morph-target="id"` | never | yes — preferred over plain on id collision |

Plain stays the symmetric surface (dialogs, anything that round-trips). A
trigger→target pair is forward-only: list card = trigger, detail header =
target, so list→detail morphs and detail→list (back-nav or a back-shaped push)
renders plainly.

## Decision

- **Direction is a property of the element, not of history.** Launch-eligible
  scans (leave snapshots, click pins, live-pair sources) = plain + trigger;
  receive-eligible scans (capture landing, live-pair targets, deferred observer)
  = plain + target, target preferred regardless of document order.
- `morphId(el)` reads plain → target → trigger (first wins, no warning if an
  element carries several). All three names derive from `options.attribute`
  (`data-x` → `data-x-trigger`/`data-x-target`); clones strip all three.
- **Several launchers, one id:** the clicked one launches; document order breaks
  ties for non-click navigations. A warn-once duplicate-id guard points at
  `-target` on the intended destination; it stays silent for trigger+target.
- Plain↔plain keeps the full D55 fly-back contract. Router and compiler are
  untouched.

## Alternatives

- **App-level `enableMorph(app, { direction: 'forward' })`** keyed on push vs
  pop — rejected: the router would have to leak direction through the D55 slot,
  and a "← Back"-shaped push is backward yet would still morph.
- **Value-syntax modifier** (`data-puzzle-morph="album-3 target-only"`) —
  rejected: overloads the id and breaks exact-match pairing.
- **Roles on symmetric pairs** — D55's objection stands: a dialog is target on
  open and source on close, so plain stays role-free.

## Consequences

Runtime-only, additive. Tests: the D69 blocks in
`tests/morph-cross-view.test.js`; `examples/music` is the showcase (cards =
triggers, headers = targets, the info dialog plain).

---
name: 'D69 — Directional morph roles: data-puzzle-morph-trigger / -target'
status: verified
connections:
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D55-MORPH-TRANSITIONS
  - COMPONENT-MORPH
  - DOC-SPEC
verified_at: '2026-11-01T19:23:12.785Z'
code_refs:
  - client-runtime/morph.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D69 — Directional morph roles: `data-puzzle-morph-trigger` / `-target`

Three spellings share one id namespace, so a morph can be one-way (list → detail) while dialogs and other round-trips stay symmetric.

| attribute | launches | receives |
|---|---|---|
| `data-puzzle-morph="id"` | yes | yes |
| `data-puzzle-morph-trigger="id"` | yes | never |
| `data-puzzle-morph-target="id"` | never | yes — preferred over plain on id collision |

A trigger→target pair is forward-only: list card = trigger, detail header = target, so list→detail morphs and detail→list (back-nav or a back-shaped push) renders plainly.

## Decision

- **Direction is a property of the element, not of history.** Launch scans (leave snapshots, click pins, live-pair sources) read plain + trigger; receive scans (capture landing, live-pair targets, the deferred observer) read plain + target, target preferred regardless of document order.
- `morphId(el)` reads plain → target → trigger (first wins, no warning). All three names derive from `options.attribute` (`data-x` → `data-x-trigger`/`data-x-target`); clones strip all three.
- **Several launchers, one id:** the clicked one launches; document order breaks ties otherwise. A warn-once duplicate-id guard points at `-target`; it stays silent for trigger+target.
- Plain↔plain keeps the full D55 fly-back contract. Runtime-only: router and compiler are untouched.

## Alternatives rejected

- **`enableMorph(app, { direction: 'forward' })`** keyed on push vs pop — the router would have to leak direction through the D55 slot, and a "← Back"-shaped push is backward yet would still morph.
- **Value-syntax modifier** (`data-puzzle-morph="album-3 target-only"`) — overloads the id and breaks exact-match pairing.
- **Roles on symmetric pairs** — a dialog is target on open and source on close, so plain stays role-free.

## Gotchas

- Tests: the D69 blocks in `tests/morph-cross-view.test.js`. Showcase: `examples/music` (cards = triggers, headers = targets, the info dialog plain).

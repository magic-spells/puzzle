---
name: 'D69 — Directional morph roles: data-puzzle-morph-trigger / -target (v1.36)'
status: verified
connections:
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D55-MORPH-TRANSITIONS
  - COMPONENT-MORPH
  - DOC-SPEC
verified_at: '2026-07-17T08:28:24.546Z'
notes:
  - kind: verified
    text: >-
      Verified at commit fae3338: two-line guard in captureFromLeaving (snapshot skip + click-pin
      condition) traced in the diff; 5 new vitest cases green (suite 725); browser-verified on the
      music demo — runtime-injected marker on the Album header → 0 reverse flights on back-nav,
      unmarked control cycle → forward + reverse both fly, no clone/blob/scroll-lock residue either
      way.
  - kind: verified
    text: >-
      Verified at 21d9ed0 (the final trigger/target API, replacing the earlier fae3338 -target-only
      cut): role-scoped launch/receive selectors + morphId() traced in the diff; 26 morph tests /
      736 suite green; browser QA on the music demo — trigger→target forward flight (click AND pure
      programmatic hash nav), zero reverse flights on back, plain Info-dialog live pair round-trips,
      no residue.
---

# D69 — Directional morph roles: `data-puzzle-morph-trigger` / `data-puzzle-morph-target` (v1.36)

Three spellings, one id namespace. Plain `data-puzzle-morph="id"` stays the
symmetric surface (launches AND receives — dialogs, anything that round-trips,
the D55/D68 default, unchanged). The two directional roles are new:

| attribute | launches | receives |
|---|---|---|
| `data-puzzle-morph="id"` | yes | yes |
| `data-puzzle-morph-trigger="id"` | yes | never |
| `data-puzzle-morph-target="id"` | never | yes — **preferred** over plain on id collision |

Ids match across all three, so a trigger pairs with a plain element or a target
interchangeably. A trigger→target pair is automatically **forward-only**: mark
the list card a trigger and the detail header a target, and list→detail morphs
while detail→list (back-nav AND back-shaped pushes) renders plainly.

## Context

[[DECISION-D68-CROSS-VIEW-MORPH]] captures both directions unconditionally.
Cory asked for forward-only; the first cut shipped a `-target-only` modifier
(same day, unpublished), but two review rounds sharpened it into roles:
(1) the featured-twice scenario — an artist's header art AND a lower featured
card share one id in the same view; the header must be the declared landing
spot and must never launch — needs landing PRIORITY, not just launch opt-out;
(2) role spellings read the flow directly off the markup. D55's "no role
attribute" objection only ever applied to SYMMETRIC pairs (a dialog is target
on open, source on close — roles wrong 50% of the time); plain stays exactly
that, and roles exist only where they're stable and true.

## Decision

- **Direction is a property of the ELEMENT (flight shape), not of history.**
  An app-level `direction: 'forward'` keyed on push-vs-pop was rejected: it
  needs the router to leak navigation direction through the D55 slot, and a
  "← Library"-shaped PUSH is semantically backward yet would still morph.
- **Mechanics** (all in `client-runtime/morph.js`; router/compiler untouched):
  launch-eligible scans (leave snapshots, click-pins, D55 live-pair sources) =
  plain + trigger; receive-eligible scans (capture landing, live-pair targets,
  the deferred observer) = plain + target, target preferred over plain
  regardless of document order. A `morphId(el)` helper reads the id from
  plain → target → trigger; all three derive from `options.attribute`
  (`data-x` → `data-x-trigger`/`data-x-target`); clones strip all three.
- **Multiple triggers, one id** (featured in two lists): the CLICKED one
  launches (the click-candidate pin); document order breaks ties for
  non-click navigations. A warn-once duplicate-id guard teaches the
  resolution rules (`use <attribute>-target="<id>" on the intended
  destination`) — it stays silent for the endorsed trigger+target pattern.
- **Symmetric pairs are untouched**: plain↔plain keeps the full D55 fly-back
  contract; kanban-morph is byte-identical.

## Rejected alternatives

- **App-level `enableMorph(app, { direction })`** — router slot widening +
  wrong for back-shaped pushes (above).
- **`-target-only` modifier on a plain attribute** (the first cut): worked,
  but left the trigger side unmarked (unreadable templates), couldn't express
  landing priority as naturally, and needed a marker-orphan misuse guard that
  the role spellings make structurally impossible (a `-target` carries its own
  id). Replaced same-day, pre-publish — no deprecation surface.
- **Value-syntax modifier** (`data-puzzle-morph="album-3 target-only"`) —
  overloads the id; breaks exact-match pairing.
- **Userland attribute juggling** in `mounted()` — fragile with skeleton
  views (races the deferred observer).

## Consequences

Runtime-only, additive; plain-only apps byte-identical. `examples/music` is
the showcase: cards = triggers, headers = targets (forward-only), the Artist
Info dialog stays plain (symmetric). Verified by the D69 describe blocks in
`tests/morph-cross-view.test.js` (trigger→target flight across attributes,
trigger-never-receives, target-never-launches, featured-twice landing
priority, live-pair preference/exclusions, click-pin behavior, attribute
override, duplicate-id guard) and music-demo browser QA.

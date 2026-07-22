---
name: v1.35 — cross-view (sibling-swap) morphs land in enableMorph
status: verified
connections:
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D55-MORPH-TRANSITIONS
  - COMPONENT-MORPH
  - COMPONENT-ROUTER
  - DOC-SPEC
verified_at: '2026-07-17T07:52:48.042Z'
notes:
  - kind: state
    text: >-
      2026-07-17, v1.36 follow-up ([[DECISION-D69-MORPH-ROLES]]):
      `data-puzzle-morph-target-only` opts an element out of LAUNCHING capture flights (skipped by
      leave snapshots + click-pins) while it still receives them — forward-only list→detail morphs
      on request. No separate FEATURE card (rides this one, like D45 rode v1.13); SPEC §37 amended
      in place.
---

# v1.35 — cross-view (sibling-swap) morphs land in `enableMorph`

`data-puzzle-morph` elements now morph across sibling view swaps automatically
— forward AND back/forward — with no app code beyond `enableMorph(app)`. The
router is untouched; everything lands in `client-runtime/morph.js` via
[[DECISION-D68-CROSS-VIEW-MORPH]] (capture at the leave hook, fly at enter,
MutationObserver for skeleton-deferred targets, optional click-candidate
pinning for the hold-still polish).

## Usage

```html
<!-- AlbumCard.pzl (Library view) -->
<div data-puzzle-morph="album-{ album.id }" class="aspect-square ...">
<!-- Album.pzl header (sibling view) -->
<div data-puzzle-morph="album-{ album.id }" class="w-44 h-44 ...">
```

That's it — same one-line `enableMorph(app)` as [[DECISION-D55-MORPH-TRANSITIONS]].
Coexisting live pairs (route-mounted dialogs) keep the D55 fly-back path and
always win over captures.

## Scope

**In:**
- `client-runtime/morph.js`: leave-time snapshots (`Map<id, {el, rect}>`),
  click-candidate pinned clone (pre-fade hold-still), enter-time clone flights
  (one-shot, never `pair`-tracked), deferred-target observer + 2s TTLs,
  per-navigation capture cleanup, single shared engine.
- `tests/morph-cross-view.test.js` — real `enableMorph` + mocked
  `@magic-spells/morph-engine` over a memory-mode app.
- `examples/music` migration: `art-morph.js` DELETED, `data-art-morph` →
  `data-puzzle-morph`, cardClick capture handlers removed, README morph
  section retruthed (three mechanisms → two).

**Out (deferred):**
- Multiple simultaneous flights per transition; `morphFrom` disambiguation.
- `{#if}`-toggled morphs (still manual via the raw engine).
- Momentum-preserving reversals.

## Rules

D55's element rules apply, plus: the capture-flight target's view wants an
opacity-only `in` animation (the engine measures the target rect once at
flight start). `prefers-reduced-motion` disables everything; deep links
(navigation #0) never morph.

---
name: 'D68 — Cross-view morphs: capture-at-leave promotes sibling-swap flights into enableMorph (v1.35)'
status: verified
connections:
  - DECISION-D55-MORPH-TRANSITIONS
  - DECISION-D28-ANIMATIONS
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - COMPONENT-MORPH
  - COMPONENT-ROUTER
  - FEATURE-V1-35-CROSS-VIEW-MORPH
  - DOC-SPEC
verified_at: '2026-07-17T07:52:47.299Z'
---

# D68 — Cross-view morphs: capture-at-leave promotes sibling-swap flights into `enableMorph` (v1.35)

Elements sharing a `data-puzzle-morph` value now morph across SIBLING view swaps
automatically — an album card's art flies into the album view's header, and back
on pop — with zero app code beyond the existing `enableMorph(app)`. Default-on,
both directions, no new options. Promotes `examples/music/app/art-morph.js`
(the capture-at-click userland prototype) into the framework and deletes it.

## Context

[[DECISION-D55-MORPH-TRANSITIONS]] pairs only elements that COEXIST in the DOM
at some point — nested-route dialogs, where the source card stays mounted.
Sequential transitions ([[DECISION-D28-ANIMATIONS]]) destroy a sibling view
before its replacement mounts, so a Library→Album navigation has no pairing
moment; the music demo bridged it app-side with a `@click` capture helper
(clone the art to `<body>`, MutationObserver for the destination, dedicated
engine), which was forward-only and cost every card an import + handler.

The framework has a strictly better capture point than userland ever had: the
router's existing `leave(el)` hook fires at out-phase start, synchronously,
while the outgoing subtree is still connected and unfaded — before `playOut()`
is awaited, before destroy. The demo hooked `@click` only because apps have no
pre-destroy hook.

## Decision

- **The router is untouched.** D55's "exactly one morph-agnostic slot" holds;
  the entire feature lands in `client-runtime/morph.js`. `setMorphHandler`
  timing, `tests/router-morph.test.js`, and the app config are byte-identical.
- **Capture at leave.** `leave(el)` (after the unchanged D55 fly-back logic)
  snapshots every measurable `[data-puzzle-morph]` element in the leaving
  subtree as `Map<id, {el, rect}>` — one rect pass; detached element refs stay
  cloneable after destroy. This is what makes pops and programmatic navigations
  morph (art-morph could not).
- **Click candidate = visual polish only.** One delegated capture-phase
  document click listener records a ref + timestamp (zero DOM work; guarded
  `typeof document !== 'undefined'` for the D67 node prerender). If fresh
  (<5s) and inside the leaving subtree, `leave()` pins a fixed-position clone
  over it PRE-FADE (attr stripped from the clone so no scan ever matches it;
  `z-index:55; pointer-events:none`; 2s TTL fade) — the art visually holds
  still while the old view animates out, matching art-morph's signature look.
- **Fly at enter.** `enter(el)` scans ALL morph elements in the entering
  subtree (D55 considered only the first): a LIVE counterpart outside the
  subtree wins (existing pair + fly-back path — kanban semantics unchanged);
  else the first entering element whose id matches a capture gets a clone
  flight — the pinned clone if ids match, else a clone built pre-paint from the
  snapshot at its recorded rect. Clone flights reuse art-morph's unwind: always
  drop the clone post-settle; `engine.stop()` only when `show()` settled true (a
  false settle means a newer flight superseded and owns the engine). Clone
  flights never set `pair` — they are one-shot; the reverse trip comes from the
  NEXT leave's fresh capture, never `engine.hide()`.
- **Skeleton-deferred targets.** If captures exist but the entering subtree has
  no morph element yet (`<puzzle-skeleton>` view — the real template lands after
  `data()`), a MutationObserver scoped to the animator element waits (2s TTL)
  for a measurable matching element, then runs the capture path.
- **Cleanup posture.** Captures are per-navigation: discarded at the next
  leave (recapture) and at enter (consumed or dropped). A failed/superseded
  navigation ([[DECISION-D61-ATOMIC-LOCATION-COMMIT]]: nothing commits, enter
  never fires) is cleaned by the pinned clone's TTL + the next leave.
  `prefers-reduced-motion` disables all capture; `options.attribute` flows
  through every selector (`CSS.escape`).

## Rejected alternatives

- **Keep it userland** (the art-morph recipe): every consuming app re-derives
  ~110 subtle lines (clone hygiene, engine-supersession unwind, TTL), each card
  needs an import + handler, and click capture can never do pops.
- **A second router hook / richer slot** (e.g. `willLeave(to, from)`): the
  existing slot already fires while the subtree is measurable; widening the
  router contract for information morph.js can derive itself violates D55's
  one-slot posture.
- **Pin clones for ALL captured elements at leave**: a 50-card grid would leave
  50 fixed clones floating over the out animation. The click candidate names
  the one element worth pinning; everything else flies from an enter-time clone
  (pre-paint, same frame as the new view — no artifact).
- **Capture-at-click required (art-morph parity)**: forward-only, misses
  keyboard/programmatic navigation, and the leave hook makes the click strictly
  optional polish.
- **A separate opt-in flag or subpath**: the user-facing promise is "mark two
  elements, done"; existing apps without cross-view pairs see the new path
  never fire, so default-on is behavior-compatible.

## Constraints / consequences

- The capture-flight target's view should declare an **opacity-only `in`
  animation** (or none): the engine measures the target rect once at flight
  start; a transform entrance slides the real element away from where the blob
  lands (~10px pop at reveal). Same class of rule as D55's style-binding
  caveats — documented, not enforced.
- Still one flight per transition, one shared engine; live pairs keep priority
  over captures for the same id.
- The music example drops from three morph mechanisms to two: `enableMorph`
  (dialog pair + card↔header flights, `data-puzzle-morph`) and the hand-driven
  QueueDialog engine (`data-morph`). `data-art-morph` and `art-morph.js` are
  gone.
- Verified by `tests/morph-cross-view.test.js` (real enableMorph, mocked
  engine, memory-mode router) and the music demo in-browser (forward, pop,
  dialog coexistence, skeleton-deferred landing).

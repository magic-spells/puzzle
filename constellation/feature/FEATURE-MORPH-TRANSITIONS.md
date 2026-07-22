---
name: "v1.23 — shared-element morph route transitions (data-puzzle-morph + enableMorph)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D55-MORPH-TRANSITIONS
  - DECISION-D28-ANIMATIONS
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
  - COMPONENT-PUZZLE-APP
notes:
  - kind: state
    text: >-
      examples/music now demonstrates BOTH morph flavors (2026-07-13): ArtistInfoDialog.pzl is a
      second router-driven reference (child route 'info' under /artist/:id,
      data-puzzle-morph="artist-info-{id}" on a plain <button> + non-modal dialog shell, transposed
      from kanban's TaskDialog), and QueueDialog.pzl is the first in-repo reference for the
      MANUAL-engine pattern this card defers to ("{#if}-toggled morphs — use the engine directly"):
      a layout-mounted TRUE-modal <dialog> driven by a dedicated MorphEngine({attraction:.1,
      friction:.32, zIndex:60}) with the engine demo's showModal()-at-reveal / close()-then-hide()
      handoff, a prop-driven open/close state machine in afterUpdate, and a data-morph (not
      data-puzzle-morph) attribute so the router scanner never pairs it. Gotcha proven in browser
      QA: reveal is async — guard showModal() on current intent (_shown), else a rapid close or a
      hidden-tab-resumed flight promotes a modal AFTER close was requested. Browser-verified
      end-to-end (morph in/out, Escape/outside-click/browser-back, deep link renders plain,
      right-anchored inset positioning).
  - kind: state
    text: >-
      Third pattern added to examples/music (2026-07-13): CAPTURE-AT-CLICK for sibling-view swaps
      (examples/music/app/art-morph.js, ~110 lines, framework-free). Sequential route transitions
      destroy the source view before the target mounts, so enableMorph can never pair sibling views
      — the helper bridges it: on AlbumCard click, clone the artwork into a position:fixed body
      stand-in at the captured rect (survives teardown; visually "holds still" while the old view
      fades), MutationObserver waits for the album view's [data-art-morph] header artwork (appears
      at the skeleton→real swap), then a dedicated MorphEngine springs clone→target; post-settle
      stop() is gated on show()'s settled===true (a false means a newer capture superseded us and
      owns the engine) and is what releases the body scroll lock. Album view's animations.in must be
      opacity-only — a transform entrance slides the target away from the measured rect (~10px pop).
      Forward-only (back-nav has no click to capture — deferred). Uses attribute data-art-morph,
      distinct from data-puzzle-morph (router-scanned) and data-morph (queue). Browser-verified.
  - kind: state
    text: >-
      2026-07-17: the third pattern (capture-at-click, examples/music/app/art-morph.js — see the
      earlier note) is being promoted INTO the framework as v1.35/D68
      ([[DECISION-D68-CROSS-VIEW-MORPH]]): enableMorph itself now captures sibling-swap sources at
      the router's leave hook (both directions, pops included — no click needed) and art-morph.js +
      data-art-morph are deleted from the music example. The D55 live-pair contract this card
      describes is unchanged and keeps priority.
---

# v1.23 — shared-element morph route transitions (`data-puzzle-morph` + `enableMorph`)

Mark two elements with the same `data-puzzle-morph` value and the router morphs
between them when a navigation swaps one in or out — a spring-driven blob grows
from the task card into its route-mounted dialog and flies back on close,
**including the browser back button** (same pipeline). Driven by
[[DECISION-D55-MORPH-TRANSITIONS]]; mechanics from `@magic-spells/morph-engine`
(optional peer dependency).

## Usage

```js
// app.js — the whole opt-in
import { enableMorph } from '@magic-spells/puzzle/morph';
enableMorph(app); // returns the engine for live tuning/events
```

```html
<!-- TaskCard.pzl -->
<div class="kanban-card" data-puzzle-morph="task-{ task.id }">
<!-- TaskDialog.pzl (the task/:taskId child route) -->
<div class="dialog-shell" data-puzzle-morph="task-{ taskId }">
```

Close handlers just `router.push(...)` — no per-view morph code anywhere.

## Scope

**In:**
- Router: `setMorphHandler({ enter, leave })` — one narrow slot; `leave`
  awaited (with `playOut`) before the outgoing unit destroys, `enter` fired
  synchronously post-commit pre-paint with `{ initial }`; handler errors
  logged, never wedge navigation ([[COMPONENT-ROUTER]] `#swap`).
- `client-runtime/morph.js` (`@magic-spells/puzzle/morph`): pairing scan,
  round-trip guards (id changed in place, source gone, whole-chain teardown),
  clean-engine hygiene on every enter, `prefers-reduced-motion` opt-out.
- Packaging: `exports["./morph"]`; morph-engine as optional peer +
  devDependency; in-repo esbuild alias entry for the subpath.
- `tests/router-morph.test.js` — 7 stub-handler tests pinning the slot
  contract (enter initial:true/false, leave-awaited-before-destroy ordering,
  params-only silence, throw survival, PuzzleApp pre-mount stash, null
  unregister); suite 486 green.
- `examples/kanban-morph` — kanban board whose cards morph open into a
  route-mounted task dialog (the pyramid-puzzle dress rehearsal).

**Out (deferred):**
- `{#if}`-toggled (non-route) morphs — use the engine directly.
- Multiple simultaneous morph pairs per transition; `morphFrom` push option
  for duplicate-id disambiguation.
- Momentum-preserving reversals (needs velocity exposure in physics-engine).

## Rules for morph elements

No transform-based positioning or stylesheet `opacity` on the target (engine
drives inline transform/opacity; center with flex or `inset:0; margin:auto`);
no CHANGING dynamic `style={}` binding on either element (the patcher rewrites
the whole style attribute); morph views shouldn't declare `animations.in/out`.

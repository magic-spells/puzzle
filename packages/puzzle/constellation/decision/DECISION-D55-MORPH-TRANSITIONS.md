---
name: >-
  D55 — Shared-element morph route transitions: `data-puzzle-morph` pairing + one router
  morph-handler slot
status: verified
verified_at: '2026-11-01T19:23:24.972Z'
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D69-MORPH-ROLES
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/morph.js
  - client-runtime/router/router.js
  - client-runtime/app.js
---

# D55 — Shared-element morph route transitions

Puzzle owns the pairing **convention**; the spring mechanics live in `@magic-spells/morph-engine`, an optional peer dependency. Two elements carrying the same `data-puzzle-morph` value are one logical surface, and a navigation that swaps one in or out morphs between them. Apps opt in with `enableMorph(app)` from `@magic-spells/puzzle/morph`. Sibling-swap capture flights are [[DECISION-D68-CROSS-VIEW-MORPH]]; the `-trigger`/`-target` roles are [[DECISION-D69-MORPH-ROLES]].

## Decision
- **Identity-based pairing** (the `view-transition-name` model): the attribute names the surface; navigation direction picks the flight.
- **The router has exactly one morph-agnostic slot:** `setMorphHandler({ enter(el, { initial }), leave(el): Promise | null })`. In `#swap`, `leave(oldAnimator.element)` starts with the out phase and a returned promise is awaited (with `playOut()`) before `destroy()`; `enter(animatorElement, { initial: !cur })` fires synchronously post-commit, **pre-paint**, so a pairing hides its elements before the plain mount paints. Handler errors are logged and swallowed. No handler ⇒ the router is unchanged. `PuzzleApp.setMorphHandler()` is safe before or after `mount()`.
- **All pairing logic lives in `client-runtime/morph.js`.** For a coexisting live pair (a nested-route dialog over its source card): scan the mounted animator subtree for the first morph element, find a measurable counterpart outside it, `engine.show(from, to)`. On leave, fly back only when the round trip is intact — target still in the leaving subtree, attribute value unchanged since show (a params-only switch re-points content with no swap), source still connected outside the leaving subtree; otherwise `engine.stop()`. Every enter starts from a clean engine. A live counterpart always wins over a D68 capture flight.
- **Navigation #0 never morphs** (`initial`), and `prefers-reduced-motion` disables morphing entirely.
- **Remount:** `enableMorph`'s `dispose()` has an inverse, `arm()` (idempotent), which `PuzzleApp.mount()` calls when re-applying a stashed handler — so mount → unmount → mount leaves exactly one live click listener. A second `enableMorph` on the same app disposes the first.
- The core bundle carries none of it unless the app imports the subpath.

One morph pair per transition. Morph views should not also declare `animations.in/out` (documented, not enforced). Morph elements must not use transform-based positioning, a stylesheet `opacity` on the target, or a changing dynamic `style={}` binding — the engine drives inline transform/opacity.

## Gotchas
- The compiler's `aliasRuntime` (`compiler/internal/build/options.go`) needs an explicit entry for every subpath export, `/morph` included: the bare alias points at a file, so prefix substitution would produce `index.js/morph`.

## Alternatives rejected
- Per-view glue calls (arm/show/hide/stop) — four touchpoints per dialog, and the back button cannot morph.
- ViewManager-level pairing (covering `{#if}` toggles) — holding removed DOM for a leave is a full transition system; `{#if}` morphs stay manual with the raw engine.
- A promise-valued `animations.out` — a view field cannot see the counterpart, and the enter side still needs the pre-paint scan.
- A `morph: true` app config flag — the core cannot import the engine without bundling it for everyone; the subpath is the tree-shaking boundary.
- `router.push(path, { morphFrom })` to disambiguate duplicate ids — document order plus measurability picks the counterpart.

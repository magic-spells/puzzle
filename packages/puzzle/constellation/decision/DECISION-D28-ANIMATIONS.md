---
name: "D28 — View & component animations: no-wrapper WAAPI, sequential transitions, fill-release"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - DOC-VIEW-LIFECYCLE
  - DOC-SPEC
  - DOC-SPEC-VIEW
  - DECISION-D20-PUZZLE-VIEW-ELEMENT
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D03-SCRIPTS-REAL-JS
  - DOC-USER-GUIDE
code_refs:
  - client-runtime/router/router.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/viewManager.js
---

# D28 — View and component animations: no-wrapper WAAPI, fill-release, one animator

See [[DOC-SPEC-VIEW]] §12 and [[DOC-VIEW-LIFECYCLE]].

## Decision
The `animations` class field declares `in`/`out` specs (`{ from, to, duration, easing?, delay? }`), played as `el.animate([from, to], { …, fill: 'both' })` and completed through `Animation.finished`.

- **No wrapper; the instance root is the target.** A component's single root ([[DECISION-D20-PUZZLE-VIEW-ELEMENT]]) or a view's `<puzzle-view>` animates.
- **Route transitions are sequential by default** — old `out` → destroy → mount new → `in`. Overlap is opt-in ([[DECISION-D56-OVERLAP-TRANSITIONS]]). The URL commit follows [[DECISION-D19-NAVIGATION-COMMIT]].
- **Enters are fire-and-forget; outs are awaited** (the element must stay in the DOM until its out finishes).
- **Fill-release:** on `finished` the enter animation is cleared so the element returns to its natural style. Contract: the `to` keyframe **must equal** the resting style, or it snaps at release.
- **One animator per transition:** a view swapped inside a reused layout animates alone; a layout swap animates the layout as a unit. Nested chains generalize this ([[DECISION-D30-NESTED-ROUTES]]).

## Supporting contracts
- `viewWillShow`/`viewDidShow` bracket `in`, `viewWillHide`/`viewDidHide` bracket `out`. They fire in order **even with no `animations` field** — they are lifecycle, not animation callbacks.
- Malformed specs warn once and skip. `prefers-reduced-motion: reduce` zeroes durations (hooks still fire). No `el.animate` (jsdom) degrades to an instant finish.
- `destroy()` stays synchronous; animated teardown (`destroyAnimated()`) is a separate path.
- **The hide bracket pairs with a completed mount.** Only a view that fired `mounted()` runs the hide hooks and `out`; one removed while its first `data()` was pending takes the instant `destroy()`. `PuzzleView.__isMounted` is the seam: the ViewManager's `unmount()` checks it (plus `__hasHideHooks`, a base-prototype comparison for overridden hide hooks or a declared `out`), and `playOut()` repeats the check because the router's leave paths call it directly. A view with a skeleton completes its mount at the skeleton render.
- WAAPI cannot animate to `height: auto`; collapse effects animate a fixed-height inner element between `px` values (the `TodoItem` recipe in [[DOC-USER-GUIDE]]).

## Gotcha
Cancelling a Puzzle animation **resolves** its `finished` (AbortError is swallowed), so whoever awaits it resumes. `playOut()` cancels a running enter, and the awaiting `playIn()` must check `#leaving` as well as `#destroyed` before firing `viewDidShow()`. Any new "cancel the current animation" path must audit who awaits that handle.

## Alternatives rejected
- A dedicated `<puzzle-component>` wrapper — the wrapper explosion D20 rejected, and it breaks flex/grid layouts.
- Awaiting the enter before the router settles — stalls rapid navigation behind decoration.
- Leaving the fill applied — frozen inline styles fight later reactive styles and `:hover`.
- Animating both layout and view in one transition — double motion, compounding durations.

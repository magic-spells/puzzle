---
name: 'D56 — Overlapping route transitions: opt-in `transitionMode: ''overlap''` with fixed-pin positioning'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D28-ANIMATIONS
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D55-MORPH-TRANSITIONS
  - DECISION-D65-PER-ROUTE-TRANSITION-MODE
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
code_refs:
  - client-runtime/router/router.js
  - client-runtime/app.js
---

# D56 — Overlapping route transitions: opt-in `transitionMode: 'overlap'`

The old view's `out` and the new view's `in` run concurrently (cross-fade, shared-axis slides). Sequential stays the default ([[DECISION-D28-ANIMATIONS]]).

## Decision
- **Opt-in.** `transitionMode: 'overlap'` in the `PuzzleApp` config (default `'sequential'`) sets the app baseline. Per-route and per-view overrides cascade over it and are resolved from the **destination only** ([[DECISION-D65-PER-ROUTE-TRANSITION-MODE]]).
- **Fixed-pin positioning, no wrapper.** At out-start the router measures the leaving animator root's `getBoundingClientRect()` and pins it with inline styles only — `position: fixed` at that rect, `margin: 0`, `pointer-events: none`. The incoming chain takes the layout slot in the same synchronous block, so in-flow content never stacks or jumps; the pinned leaver paints above it, and clicks land on the live view.
- **Reordered `#swap`, convergent destroy.** Overlap pins the leaver, starts `playOut()` without awaiting, then mounts/patches and commits (the D19 commit point is unchanged — data was awaited before the swap). The leaver is destroyed when its out settles. On the reused-layout path the keyed patch's `unmount()` → `destroyAnimated()` drives the same memoized `playOut()`, and `destroy()` is idempotent, so both paths converge. A morph-leave promise ([[DECISION-D55-MORPH-TRANSITIONS]]) is still awaited before removal.
- **Interruption stays instant.** At most one in-flight leaver (`#pendingOut`): a navigation mid-overlap destroys it synchronously and skips its own out, so at most two route elements coexist.
- **Hooks in the overlap window:** `viewWillHide()` at out-start; the new view's `mounted()`/`viewWillShow()` while the old one fades; `viewDidHide()` and `viewDidShow()` in whichever order the animations end.
- Unchanged: initial and params-only navigations, memory mode, reduced motion (zeroed durations), failure recovery (the out starts only after preload succeeds).

## Constraints (documented)
1. `position: fixed` mis-pins when an ancestor of the mount container has `transform`/`filter`/`contain` — keep that chain transform-free.
2. Document height snaps to the new view at commit.
3. The pinned leaver stops scrolling with the page during its fade.
4. Combining with morph is best-effort — the pairing scan may pick the pinned leaver; use one mechanism per app.

## Alternatives rejected
- The View Transitions API — snapshot-based (no live interaction mid-transition) and cannot express the `animations` field's WAAPI semantics.
- Absolute positioning inside an injected wrapper — violates the no-wrapper rule.
- Overlap as the default — changes every shipped app.

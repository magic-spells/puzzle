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
notes:
  - kind: gotcha
    text: >-
      One-animator enforcement had a hole fixed in the pre-release review (fix/prerelease-review):
      #abortEnter only unwound a pending VISIBLE-trigger enter, so a running mount-trigger enter was
      never cancelled when playOut() began — enter and out ran CONCURRENTLY on the same element,
      both fill:'both' (reproduced; destroy() then cancelled only the out handle). playOut() now
      cancels #currentAnimation after #abortEnter(). The trap for future edits: cancelling a Puzzle
      animation RESOLVES its finished promise (animate.js normalizes AbortError away), so the
      awaiting playIn() resumes and would have fired viewDidShow() mid-leave — the guard there must
      check #leaving alongside #destroyed, and the same guard now protects the visible-trigger
      reveal path. Any future "cancel the current animation" change must audit who is awaiting that
      handle's finished.
  - kind: state
    text: >-
      The component-removal path (viewManager unmount) now honors the zero-duration hook rule: a
      child that OVERRIDES viewWillHide/viewDidHide routes through destroyAnimated() even with no
      animations.out (detected via PuzzleView's __hasHideHooks getter — a base-prototype comparison,
      since viewManager can't see the base class). Previously only animations.out took that path, so
      hook-only components skipped both hide hooks on removal. Components declaring neither hooks
      nor animations keep the synchronous instant destroy() — teardown timing changes only for the
      hook-declaring case, whose element now lingers a microtask.
  - kind: state
    text: >-
      Refines the note above it: routing hook-only components through destroyAnimated() is now gated
      on a COMPLETED mount. A child whose async data() was still pending when its parent removed it
      fired the whole hide bracket with no prior mounted()/viewWillShow()/viewDidShow() — 0.6.0 took
      the instant destroy() there, so this was a 0.7.0 regression, caught in the pre-release review.
      Two seams carry the one rule: viewManager's unmount() checks child.__isMounted before choosing
      destroyAnimated(), and playOut() skips the bracket and the out spec when the view never
      reached #mounted (that second one is what covers the router's leave paths, which call playOut
      directly). Pinned by tests/leave-inertness-and-hooks.test.js, describe "the hide bracket fires
      only for a view that completed its mount (D28)". Note the consequence for that file's older
      D136 §3 test: calling playOut() on a still-loading view now logs nothing, where it used to log
      willHide/didHide.
code_refs:
  - client-runtime/router/router.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/viewManager.js
---

# D28 — View & component animations: no-wrapper WAAPI, sequential transitions, fill-release

The reserved `animations` class field graduates from inert to a shipped feature (v1.1): declarative `in`/`out` specs drive the Web Animations API on the instance root, view route transitions run sequentially, and enter animations use a fill-release contract. Settled (v1.1); see [[DOC-SPEC-VIEW]] §12 and [[DOC-VIEW-LIFECYCLE]].

## Context
The `animations` class field was reserved by [[DECISION-D03-SCRIPTS-REAL-JS]] ([[DOC-SPEC]] §4) but inert. D28 makes it a shipped feature: declarative `in`/`out` specs (`{from, to, duration, easing?, delay?}`) drive `el.animate([from, to], { …, fill: 'both' })`, with completion via the `Animation.finished` promise.

## Decision
Five sub-decisions, each with a rejected alternative:

- **No wrapper element; the instance root is the animation handle.** [[DECISION-D20-PUZZLE-VIEW-ELEMENT]]'s single-root rule for components already guarantees one root element — that root **is** the target, matching views/layouts (`<puzzle-view>`). Authors who want wrapper semantics may name their root `<puzzle-component>` themselves. (Rejected: a dedicated `<puzzle-component>` wrapper — see Alternatives rejected.)
- **View transitions are sequential in v1.1, not cross-fade.** Old view `out` → destroy → mount new → `in`, one after another; the URL still commits first ([[DECISION-D19-NAVIGATION-COMMIT]] untouched). Enter is fire-and-forget (below), so sequential still feels responsive. (Rejected: overlapping/cross-fade — see Alternatives rejected.)
- **Fire-and-forget enters.** The `in` animation is **non-blocking**: navigation/mount completes without awaiting `finished`. `out` is awaited because the element must stay in the DOM until it finishes. (Rejected: awaiting the enter so the router "settles" only when the animation ends — see Alternatives rejected.)
- **Enter animations release on finish (fill-release contract).** `fill: 'both'` holds the `from` style before start and the `to` style after end; on `finished` we **clear** the enter animation so the element returns to its natural styled state. The contract: the `to` keyframe **must equal** the natural resting style, or a snap appears at release. (Rejected: leaving fill applied permanently — see Alternatives rejected.)
- **One animator per transition.** A view swapped inside a **reused** layout animates alone; a **layout swap** animates the layout as a unit (its view rides along). (Rejected: animating both layout and view on the same transition — see Alternatives rejected.)

## Alternatives rejected
- **A dedicated `<puzzle-component>` wrapper** (so components would have a stable animation target like views' `<puzzle-view>`): reintroduces exactly the wrapper explosion [[DECISION-D20-PUZZLE-VIEW-ELEMENT]] rejected (a list row of nested components would stack wrapper layers) and breaks flex/grid layouts (the wrapper, not the content, becomes the flex child).
- **Overlapping / cross-fade transitions:** deferred — they need a positioning strategy (absolutely positioning the outgoing view over the incoming one) that risks layout jank and scroll-position bugs; not worth blocking the feature.
- **Awaiting the enter animation** (router settles only when the animation ends): would stall rapid navigation behind decorative motion and complicate the nav-token cancellation model for no user benefit.
- **Leaving the fill applied permanently:** freezes inline animated styles onto the element, which then fights later reactive style updates and CSS `:hover`/state changes.
- **Animating both the layout and its view on the same transition:** visually incoherent (double motion, compounding durations) — the "don't animate twice on first paint" gotcha from the plan.
- **Animating height to `auto`** (see below): silently produces no transition (the browser jumps).

## Consequences


**Supporting contracts:** four no-op lifecycle hooks (`viewWillShow/viewDidShow` around `in`; `viewWillHide/viewDidHide` around `out`) fire in order **even with no `animations` field** — they are lifecycle, not animation callbacks (zero-duration semantics). Malformed specs warn-once and skip (never break rendering). `prefers-reduced-motion: reduce` zeroes all durations (hooks still fire). jsdom/ancient browsers lacking `el.animate` degrade to instant-finish, never breakage. `destroy()` stays synchronous; animated teardown is a separate explicit path so existing callers and error paths are unaffected.

**The brackets pair with the mount.** The hide bracket and the out animation fire only for a view that **completed its mount** — one that reached `#completeMount` and fired `mounted()`. A view whose async `data()` was still pending when its owner removed it was never shown, so there is nothing to hide: it takes the instant, synchronous `destroy()` (which still cancels the pending data run and fires `destroyed()`), and `viewWillHide`/`viewDidHide` never fire. Without the pairing a hook that tears down what `viewDidShow()` built runs against state that was never created — it throws, and the throw is swallowed as a leave failure. `PuzzleView.__isMounted` is the seam: `viewManager`'s `unmount()` reads it to choose between `destroyAnimated()` and `destroy()`, and `playOut()` carries the same rule for the router's leave paths, which reach it without going through the ViewManager. A never-shown view still becomes `#leaving` (inert, unsubscribed) and still cancels a running skeleton enter — only the bracket and the out spec are skipped.

**Fixed-height inner-content pattern (collapse animations).** WAAPI cannot animate to `height: auto`, so height-based enter/leave effects animate between explicit `px` values. The shipped `TodoItem` wraps its row content in a fixed-height inner element and animates that height (plus opacity/scale) — documented in USER_GUIDE ([[DOC-USER-GUIDE]]) as the canonical collapse recipe.

Shipped in v1.1.

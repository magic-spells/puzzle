---
name: 'D93 — Router focus management + route announcement: the focusBehavior option'
status: built
connections:
  - COMPONENT-ROUTER
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D41-SCROLL-ANCHORS-PERSISTENCE
  - DECISION-D82-A11Y-WARNINGS
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D135-REPLACE-FOCUS-PARITY
  - DECISION-D139-FOCUS-RING-SUPPRESSION
  - DOC-SPEC
  - DOC-ROUTER
  - TEST-ROUTER-NAVIGATION
  - FLOW-NAVIGATION
code_refs:
  - client-runtime/router/router.js
  - client-runtime/app.js
---

# D93 — Router focus management + route announcement: `focusBehavior`

After every committed navigation the router moves focus to the incoming leaf
view's root and announces the route in a framework-owned live region.
`focusBehavior` mirrors `scrollBehavior`: omit for the default, `false` to opt
out, a function `(to, from) => element` to choose the target. Spec: SPEC §51.

## Decision

- **Timing:** `#applyFocus` runs last in `#commitState`, strictly after the
  scroll block, in the same post-mount, pre-paint window.
- **`focus({ preventScroll: true })` is mandatory** — plain `focus()` would undo
  D33 restoration and D41 anchor landings.
- **Transient `tabindex="-1"`:** a `<puzzle-view>` root isn't focusable, so the
  attribute is stamped before focusing and removed on `blur` (`{ once: true }`);
  D139 suppresses the focus ring for the same span. An author-set `tabindex` is
  never touched. With no live root on the leaf (a parent without `<Slot/>`) the
  target walks up the chain; none → no focus, still announce.
- **Gate before commit, target after mount:** `#resolveFocus` decides *whether*
  (memory mode is a no-op; navigation #0 — nothing committed yet, `from == null`,
  including a guard redirect that re-enters as a replace — does nothing; a user
  push superseding a slow nav #0 still focuses). The custom function runs after
  mount so it can query the committed DOM; a throw is reported and treated as
  falsy. Push, replace and pop all move focus (browsers don't restore focus on
  client navigation); a params-only *replace* doesn't (D135).
- **Focus before announce** — a polite update issued just before a focus change
  is routinely dropped. A declined focus still announces.
- **One live region**, created in `start()`, removed in `stop()`:
  `aria-live="polite"`, `aria-atomic="true"`, hidden by clip-rect
  (`clip: rect(0, 0, 0, 0)` — the comma form; jsdom's parser drops the space
  form). Never `display:none`/`visibility:hidden`, which silence it.
- **What is announced:** `aria-live` only speaks on change, and title sync
  leaves an unresolved title alone. So the router tracks `#announcedTitle`
  (seeded at `start()` from the shipped title, cleared in `stop()`): the new
  `document.title` is announced only when non-empty and different from the last
  announcement; otherwise the committed leaf route's `name`, or its `path` when
  the name would repeat.

## Consequences

- Default-on for every app. `output: 'static'` pages have no router, so no focus
  management or live region.
- jsdom can't observe `preventScroll`, visual hiding, or speech: tests assert
  the `focus` argument, inline hiding styles, ARIA attributes, and region text.
  Blur-cleanup on a *detached* root isn't asserted (blur doesn't fire reliably).

## Alternatives

- **Resolve the custom function pre-commit** like `scrollBehavior` — the DOM
  doesn't contain the incoming chain yet.
- **Skip focus on pop** — browsers don't restore it for client navigation.
- **Permanent `tabindex="-1"`** — leaves a stray tab stop.
- **Region only, no focus move** — strands the keyboard position.
- **Clear-and-refill the region to re-announce the same title** — duplicate
  speech and races AT debouncing.

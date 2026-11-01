---
name: 'D93 — Router focus management + route announcement: the focusBehavior option'
status: verified
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
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D93 — Router focus management + route announcement: `focusBehavior`

After every committed navigation the router moves focus to the incoming leaf
view's root and announces the route in a framework-owned live region.
`focusBehavior` mirrors `scrollBehavior`: omit for the default, `false` to opt
out, a function `(to, from) => element` to choose the target. Spec: SPEC §51.

## Decision

- **Gate before commit, target after mount.** `#resolveFocus` decides
  *whether*: no for memory mode, `focusBehavior: false`, navigation #0
  (`from == null` — including a guard redirect that re-enters #0 as a replace;
  a user push superseding a slow #0 still focuses), a params-only *replace*
  (D135), and a same-location locale rebuild (D175). Push, replace and pop all
  move focus otherwise (browsers don't restore focus on client navigation).
  `#applyFocus` runs last in `#commitState`, after the scroll landing, in the
  same post-mount, pre-paint window; a custom function runs there so it can
  query the committed DOM. A throw is reported through `onError` and treated as
  falsy, as is a non-focusable return.
- **`focus({ preventScroll: true })` is mandatory** — plain `focus()` would undo
  D33 restoration and D41 anchor landings.
- **Transient `tabindex="-1"`:** a `<puzzle-view>` root isn't focusable, so the
  attribute is stamped before focusing and removed on `blur` (`{ once: true }`);
  D139 suppresses the focus ring for the same span. An author-set `tabindex` is
  never touched. With no live root on the leaf (a parent without `<Slot/>`) the
  target walks up the chain; none → no focus, still announce.
- **Focus before announce** — a polite update issued just before a focus change
  is routinely dropped. A declined focus still announces.
- **One live region**, created in `start()`, removed in `stop()`:
  `aria-live="polite"`, `aria-atomic="true"`, hidden by `clip` +
  `clip-path` — `clip: rect(0, 0, 0, 0)` in the comma form (jsdom drops the
  space form). Never `display:none`/`visibility:hidden`, which silence it.
- **What is announced:** `aria-live` only speaks on change, and a route with no
  `meta.title` leaves the old title standing (D84). So the router tracks
  `#announcedTitle` (seeded at `start()` from the shipped title): the new
  `document.title` is announced only when non-empty and different from the last
  one; otherwise the leaf route's `name`, or its `path` when the name would
  repeat.
- `output: 'static'` pages have no router, so no focus management or region.

## Gotchas

- Navigation #0 announces nothing, so `#announcedTitle` still holds the shipped
  title after it. If #0 resolved a title and the next navigation resolves none,
  that first announcement reads #0's leftover title once.
- jsdom can't observe `preventScroll`, visual hiding or speech: tests assert the
  `focus` argument, inline hiding styles, ARIA attributes and region text.

## Alternatives rejected

- **Resolve the custom function pre-commit** like `scrollBehavior` — the DOM
  doesn't contain the incoming chain yet.
- **Skip focus on pop** — browsers don't restore it for client navigation.
- **Permanent `tabindex="-1"`** — leaves a stray tab stop.
- **Region only, no focus move** — strands the keyboard position.
- **Clear-and-refill the region to re-announce the same title** — duplicate
  speech and races AT debouncing.

---
name: 'D93 — Router focus management + route announcement: the `focusBehavior` option (v1.56)'
status: built
connections:
  - COMPONENT-ROUTER
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D41-SCROLL-ANCHORS-PERSISTENCE
  - DECISION-D82-A11Y-WARNINGS
  - DECISION-D84-HEAD-MANAGEMENT
  - DOC-SPEC
  - DOC-ROUTER
code_refs:
  - client-runtime/router/router.js
  - client-runtime/app.js
---

After every committed navigation the router moves focus to the incoming view's root and announces the new title in a framework-owned live region. `focusBehavior` mirrors `scrollBehavior`'s shape: omit for the default, `false` to opt out, a function to choose the target.

## Context

There was no `focus()`, `activeElement`, or `aria-live` anywhere in `client-runtime/`. The router restored scroll but left focus on the outgoing — now destroyed — element, falling back to `<body>`.

This is the canonical SPA accessibility bug. Keyboard and screen-reader users got no indication the page had changed, and the next Tab restarted from the top of the document. Puzzle already shipped **compile-time** a11y warnings (D82); the runtime half was missing.

## Decision

Focus and announcement land in `#commitState`, in the same synchronous post-mount / pre-paint window that already owns scroll — and **strictly after** the scroll block, so the window position is final before focus can affect it.

- **`focus({ preventScroll: true })` is mandatory, not a nicety.** The default `focus()` scrolls the element into view, which would immediately fight the `window.scrollTo` that just ran and silently break D33 restoration and D41 anchor landings.
- **`tabindex="-1"` is transient.** A `<puzzle-view>` root is not natively focusable, so the attribute is stamped before focusing and removed on the element's `blur` (`{ once: true }`) — the DOM never accumulates stray attributes and the root never becomes a lingering tab stop. **An author-set `tabindex` is left completely alone**: a custom `focusBehavior` may return anything, so an element the author already made focusable is never clobbered and never gets a listener.
- **One live region**, created in `start()` and removed in `stop()`: `aria-live="polite"`, `aria-atomic="true"`, visually hidden by clip-rect. It receives `document.title`, **read rather than re-derived** — `#commitLocation` (URL + title/head, D84) runs immediately before `#commitState`, so the title is already current.
- **The gate is resolved pre-commit; the target is resolved post-mount.** This is the one place the design could not simply mirror D33. `scrollBehavior` returns *coordinates*, so it can be resolved in `#navigate`; `focusBehavior` returns an *element*, and at that point the DOM does not yet contain the incoming chain. The split follows the precedent D41 already set for its `{ anchor }` sentinel: `#resolveFocus` decides *whether* focus applies before commit, `#commitState` resolves *what* to focus after mount.
- **Skips:** memory mode is a full no-op (same reasoning as `#scrollEnabled()` — an embed shares the window with a host page the router has no claim on, and stealing host focus is strictly worse than stealing host scroll); navigation #0 does nothing (the browser owns first paint, including the SSG takeover path). Failed or superseded navigations never reach `#commitState`, so they touch neither.
- **`pop` moves focus, same as `push` and `replace`.** Browsers do not restore focus for client-side navigation, so back/forward needs it exactly as much as a forward push.
- **A declining custom function still announces.** The route *did* change; declining to move focus is not the same as declining accessibility. Focus is applied **before** the announcement, because a polite live-region update issued immediately before a focus change is routinely dropped by assistive tech.
- **A throwing `focusBehavior` is logged and treated as falsy** — the same posture a throwing `scrollBehavior` already gets.

## Consequences

- Screen-reader and keyboard users get a correct navigation experience by default, without app authors knowing this bug exists.
- Default-on is a behavior change for existing apps. It is the correct a11y posture, it mirrors how `scrollBehavior` already defaults to acting, and 0.1.x had been public only days.
- **`output: 'static'` gets nothing from this.** Those pages are mounted by `mountStatic` with no router at all, so there is no live region and no focus management. Out of scope for a router decision; closing it would need the static kernel to grow its own equivalent.
- The live region is one extra always-present DOM node per app, suppressed entirely under `focusBehavior: false`.

## Verification notes

jsdom cannot honestly verify three of these, so the tests assert the closest real thing and say so:

- **`preventScroll` has no observable effect in jsdom** — its `focus()` ignores the options object. The test spies `HTMLElement.prototype.focus` and asserts the *argument*, with a companion test proving `window.scrollTo` runs first.
- **"Visually hidden" is asserted structurally** (inline `position`/`width`/`height`/`overflow`/`clip`/`clip-path`, and the *absence* of `display:none`/`visibility:hidden`) because jsdom does no layout.
- **Announcement itself is unobservable** — the tests assert ARIA attributes, singleton-ness, and that the region receives the committed title.
- No test asserts `tabindex` cleanup on a *detached* root: neither jsdom nor real browsers reliably fire `blur` when a focused element is removed. A detached node keeping the attribute is harmless garbage.

The three load-bearing behaviors were mutation-tested to prove the tests are not vacuous: removing `{ preventScroll: true }` fails 1 test, removing the blur listener fails 2, removing the nav-#0 gate fails 6.

**Implementation note:** the live region uses `clip: rect(0, 0, 0, 0)` — the comma form. The space-separated CSS3 form is silently discarded by stricter parsers including jsdom's `cssstyle`.

## Alternatives rejected

- **Resolving the custom function pre-commit**, mirroring `scrollBehavior` literally — hands it a DOM that does not contain the incoming chain.
- **Skipping focus on `pop`** — the original brief said this, on the theory that the browser handles back/forward. It does not for client-side navigation; the correction is that all three navigation kinds move focus.
- **A permanent `tabindex="-1"`** on view roots — leaves the root as a tab stop forever and accumulates attributes.
- **Hiding the live region with `display:none` or `visibility:hidden`** — both suppress announcement entirely; clip-rect is the pattern that works.
- **Announcing before focusing** — assistive tech routinely drops a polite update issued immediately before a focus change.
- **Announcement without focus movement** (region only) — leaves the keyboard tab position stranded, which is half the bug.

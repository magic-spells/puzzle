---
name: Puzzle Stays (examples/stays) — Airbnb-style example app
kind: reference-app
status: verified
verified_at: '2026-07-22T00:04:06.034Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
connections:
  - DOC-BLOG-EXAMPLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - FILE-EXAMPLES-STAYS-APP-APP
  - FILE-EXAMPLES-STAYS-APP-ROUTES
  - FILE-EXAMPLES-STAYS-APP-MODELS-LISTING
  - FILE-EXAMPLES-STAYS-APP-COMPONENTS-CALENDAR
  - FILE-EXAMPLES-STAYS-APP-LAYOUTS-MAINLAYOUT
  - FILE-EXAMPLES-STAYS-README
notes:
  - kind: verified
    text: >-
      Verified end-to-end at dce8052. Evidence: `puzzle build examples/stays` green in development
      (35.9 KB gzip) and production (20.1 KB gzip) modes; npm test 224/224; live browser walkthrough
      via Playwright against `puzzle dev` — all routes render (/, /search, /listing/:id, /account +
      3 nested children, catch-all 404, mobile 390px), search text filter narrows the grid, calendar
      range selection (booked/past nights disabled, spanning-a-booked-night vetoed) drives the
      BookingWidget breakdown ($189×2 + $65 + $45 = $488 observed), Reserve creates a t-local- trip
      and lands on /account/trips showing it, heart toggled on Home appears in /account/wishlist,
      travel-stamp tilts confirmed via computed transform matrices, window scroll resets to 0 on
      navigation, zero console/page errors.
    sha: dce8052dcfc485613f0140f719174ae2f167bc4c
  - kind: state
    text: >-
      The "window-scroller apps must reset scroll themselves" gotcha in this card's body is RESOLVED
      as of v1.5 (D33): the router now owns window scroll by default, and MainLayout's
      _lastPath/window.scrollTo workaround was deleted in the same change. The example additionally
      gains correct back/forward position restore for free. The gotcha text remains as the
      historical motivation for D33.
    sha: ecbc220863cb26d96ef46ccfa6c1c20c5c5d0fb5
---

# Puzzle Stays (examples/stays)

An Airbnb-style stays marketplace — the biggest exercise of **nested routes
(v1.3, D30)** among the examples, and a light-theme Tailwind v4 app (white
surfaces, `#ff385c` accent) in contrast to music's dark player chrome. Built
2026-07-09 by parallel agents against pinned contracts; full inventory in
`examples/stays/README.md` (kept truthful — trust it over this card for
file-level detail).

## What it demonstrates that other examples don't

- **Nested `/account` branch as primary navigation**: `AccountShell` hosts
  `''`/`trips`/`wishlist` children at `<Slot/>`; tab nav + header active
  states computed from `this.route` route names in `data()` (v1.15, D47 —
  the `window.location.pathname` idiom this originally used was one navigation
  behind: a reused ancestor's data() runs pre-pushState, SPEC §19).
- **Deterministic pseudo-availability**: `listing.isDateBooked(iso)` hashes
  `id + iso` (~20% booked) so the Calendar works on any real date with zero
  seed data to go stale. Calendar/BookingWidget/Listing agree on it.
- **Callback-prop data flow**: Calendar reports `{ checkIn, checkOut }` up via
  its `select` callback prop; BookingWidget fires `reserve`; the Listing view
  owns the state and creates the trip record.
- **Cross-page store reactivity**: ListingCard's heart flips `listing.saved`
  on the record; Wishlist's `findMany('listing', { filter })` subscription
  re-runs anywhere a heart toggles.
- **Local persistence pattern**: hearts + browser-created trips (`t-local-`
  ids) snapshot to localStorage on visibilitychange/beforeunload (mirrors
  music's likes/session pattern).

## Gotchas learned building it

- **Window-scroller apps must reset scroll themselves**: the router leaves
  scroll alone; music never noticed (overflow-hidden shell). MainLayout
  resets `window.scrollTo(0,0)` in `data()` when the path changes — safe only
  because the layout queries no store records, so navigation is the sole
  re-run trigger.
- Compiler constraints hit: a component template needs a single root element,
  and a `{#for}` body root must be an element/component (not a bare `{#if}`).
- Coarse `section === 'account'` nav highlighting lights multiple links;
  per-link path flags are needed when several nav targets share a section.

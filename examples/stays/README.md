# Puzzle Stays Example

An Airbnb-style stays marketplace built with the Puzzle framework — browse a
dozen hand-seeded listings, filter them, pick dates on a real availability
calendar, "reserve" a trip, heart things into a wishlist, and collect passport
stamps on your profile. Where `examples/music/` shows off layout swaps and a
persistent player, this app leans into **nested routes (v1.3, D30)**, callback
props between components, and store reactivity that spans pages (a heart
toggled on the homepage lights up the wishlist tab instantly).

Light theme on purpose: white surfaces, near-black text, and one pink accent
(`#ff385c`) used sparingly — familiar without pretending to be the real thing.

## Run it

```bash
puzzle dev examples/stays        # from the repo root: go run ./compiler/cmd/puzzle dev examples/stays
```

## What each piece demonstrates

### App wiring
- **app/app.js** — `PuzzleApp` config with seven display-only formatters
  (`currency`, `rating`, `plural`, `compact`, `monthDay`, `monthYear`,
  `dateRange`), post-mount seeding via `store.loadAll` for five models, and
  localStorage persistence for wishlist hearts + locally-created trips.
- **app/routes.js** — flat routes plus a **nested `/account` branch**: the
  `AccountShell` view renders its matched child (`''` | `trips` | `wishlist`)
  at `<Slot/>`; children inherit the chain's layout.
- **app/storage.js** — the snapshot save/load pair behind the persistence.

### Models (`app/models/`)
- **listing.js** — the big one: schema with arrays/objects (photos are
  `{from,to,icon}` gradient specs — no image assets anywhere), `location`/
  `cover` getters, and `isDateBooked(iso)`, a deterministic hash over
  `id + date` that gives every listing ~20% booked nights on **any** date the
  demo is run, with no availability data to seed or go stale.
- **trip.js** — `nights` getter; records created in the browser get
  `t-local-` ids so app.js knows to persist them.
- **host.js / review.js / traveler.js** — accent-gradient avatars, and the
  traveler's `stamps` array that drives the passport wall.

### Views
- **Home.pzl** — hero, category chips filtering the grid via local
  `setData` + `refresh` (no store round-trip), guest-favorites rail.
- **Search.pzl** — five stacking filters (query, guests, price bucket, type,
  amenities) computed in `data()` from local state.
- **Listing.pzl** — route param join (`listing` + `host` + `reviews`), local
  `checkIn`/`checkOut` state that survives `data()` re-runs, and the
  reserve flow: create a trip record, `router.push('/account/trips')`.
- **account/AccountShell.pzl** — the nested-route shell: identity strip, tab
  nav computed from the pathname, `<Slot/>` for the child.
- **account/Profile.pzl** — the travel-stamp passport wall.
- **account/Trips.pzl** — upcoming/completed split with map joins.
- **account/Wishlist.pzl** — `findMany('listing', { filter })` subscription:
  hearts toggled anywhere re-run this view's `data()`.

### Components
- **ListingCard.pzl** — the canonical card; the heart button
  `preventDefault`s its parent link and flips `listing.saved` straight on the
  record.
- **Calendar.pzl** — two months from the current date, booked/past nights
  disabled, range selection that refuses to span a booked night, month paging;
  reports `{ checkIn, checkOut }` up through its `select` callback prop.
- **BookingWidget.pzl** — recomputes the nightly × nights + fees breakdown
  from props on every parent re-render; fires `reserve` when armed.
- **PhotoGallery.pzl** — Airbnb's 1-big-4-small mosaic from gradient tiles.
- **TravelStamp.pzl** — double-ring badge, alpha-suffix background wash, and a
  stamped-on pop-in (scale overshoot, per-index delay + resting tilt).
- **ReviewCard.pzl** — staggered fade-in keyed off an `index` prop.

## Framework surface exercised

Nested routes + `<Slot/>` chains, route params, the catch-all, callback props
(`@select`, `@reserve`), per-node DOM events, `{#for}` loop counters (D29),
formatter pipes with arguments, `get animations()` for per-instance staggered
entrances, view in/out transitions, store filters as live subscriptions, and
schema defaults/getters on five models.

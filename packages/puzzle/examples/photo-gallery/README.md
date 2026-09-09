# Photo Gallery

A Puzzle app styled after the **Apple Photos** app (macOS, dark mode): a
persistent left sidebar with a Library section and an Albums section, over a
full-bleed grid — while keeping **shared-element morphs** (v1.23 D55, v1.35 D68)
intact. Click any photo and its thumbnail morphs up into a fullscreen image,
then flies back into its card when you close it — including via the browser back
button, and from either the All Photos grid or an album.

It also demonstrates **both morph shapes** side by side. Opening a photo from
**All Photos** (`/` → `/photo/:id`) is a sibling top-level view swap: the grid
unmounts as the overlay mounts, so the morph is a **cross-view capture flight**
(D68 — the engine snapshots the leaving card and flies a clone into the arriving
image). Opening a photo from an **album** (`/album/:slug` →
`/album/:slug/photo/:id`) is a **nested child route** (D30): the album view stays
mounted and only its `<Slot/>` swaps, so the grid card `<img>` and the fullscreen
`<img>` coexist in the DOM — a **D55 live pair** the engine morphs with a real
show/hide round trip, flying back into the still-mounted card on close/back.
Same `PhotoView`, same `data-puzzle-morph="photo-<id>"` namespace, both shapes.

## What it demonstrates

- **Persistent sidebar chrome + a reactively-highlighted active route.** The
  sidebar lives in `DefaultLayout`, which every route reuses — so it stays
  mounted while only the routed `<Slot/>` swaps (the one-animator rule means the
  sidebar never animates). Its `data()` re-runs on every navigation and reads
  `this.route` (v1.15/D47) to know the current route: `routeName === 'gallery'`
  lights the "All Photos" row, and an `activeSlug` (the `:slug` param, null off
  the album route) highlights the current album via a plain
  `album.slug === activeSlug` comparison in the template. No router-watching
  wiring — just the per-navigation route snapshot read in the layout.
- **Albums derived from data, no model.** There is no album model. Every Lorem
  Picsum photo carries an `author`; an "album" is all photos by one author.
  `app/albums.js` exports `albumSlug(author)` (deterministic kebab-case) and
  `groupAlbums(photos)` → `[{ slug, name, count, cover }]` sorted by count.
  Both the sidebar list and the `/album/:slug` grid compute albums inside
  `data()` from a live `store.findMany('photo')` query, so they stay reactive.
- **Both morph shapes, both directions, from either grid.** The grid card
  `<img>` and the fullscreen `<img>` carry the same plain symmetric
  `data-puzzle-morph="photo-<id>"`, and `enableMorph(app)` in `app.js` is the
  whole opt-in. From **All Photos** the grid unmounts as the overlay mounts
  (sibling swap), so the router pairs them as a **D68 capture flight**. From an
  **album** the overlay mounts as a nested child inside the still-mounted album
  view (`<Slot/>`), so both images coexist and the router pairs them as a **D55
  live pair**. Same id namespace and same `PhotoView` in both — closing returns
  to whichever grid you came from, including via the browser back button.
- **Nested child route for album photos (D30).** `/album/:slug` is a parent
  route with an empty index child (`path: ''`) and a `photo/:id` child; the
  album view renders its matched child at `<Slot/>`. Keeping the album grid
  mounted beneath the fullscreen overlay is precisely what turns the album morph
  into a live pair — the card the fullscreen flew from is still in the DOM to
  fly back to. `PhotoCard` takes an optional `base` prop so its href is
  album-scoped (`/album/<slug>/photo/<id>`) from an album and bare
  (`/photo/<id>`) from All Photos.
- **Morph-safe styling.** The morph `<img>`s are sized only by classes
  (`aspect-square object-cover`) with no transform/opacity or dynamic `style`
  binding; the morphing views use opacity-only `in` animations so the engine's
  once-measured landing rect stays correct (D68 capture-flight rule).
- **`beforeMount` data seeding with graceful failure.** The store is seeded from
  the Lorem Picsum list API (`limit=60`, so several authors have multi-photo
  albums) before navigation #0; a fetch failure is caught and the gallery
  renders an empty state instead of aborting the mount.

## Routes

| Path                       | View         | Notes                                                         |
| -------------------------- | ------------ | ------------------------------------------------------------- |
| `/`                        | `Gallery`    | Library "All Photos" grid                                     |
| `/photo/:id`               | `PhotoView`  | Fullscreen overlay from All Photos → **D68 capture flight**   |
| `/album/:slug`             | `Album`      | Grid filtered to one author (renders its child at `<Slot/>`)  |
| `/album/:slug` (index)     | `AlbumIndex` | Index child (`path: ''`) — renders nothing; the grid is Album |
| `/album/:slug/photo/:id`   | `PhotoView`  | Nested child overlay → **D55 live pair** (grid stays mounted) |
| `*`                        | `NotFound`   | 404                                                           |

`/album/:slug` is a **parent route** whose children are an empty index
(`path: ''`, so the bare album URL matches) and the fullscreen photo
(`path: 'photo/:id'`). `AlbumView` renders its matched child at `<Slot/>`;
`PhotoView` is reused as both a top-level overlay and the nested album overlay
(`params` merge down the chain, so `params.id` — and `params.slug` under an
album — are present in both). `layout` stays a top-level-route field.

All routes share `DefaultLayout` (the sidebar). Below `md` the sidebar is hidden
(`hidden md:flex`) and the grid goes full-width — no hamburger (out of scope).

## Data source

Photos come from [Lorem Picsum](https://picsum.photos): metadata from
`GET /v2/list`, image pixels derived from the id (`/id/<id>/<w>/<h>`, including
the 56px sidebar album covers). Needs network access at boot.

## Run it

```bash
puzzle dev examples/photo-gallery   # serves on port 3030
# or, from this folder: npm run dev
```

Build a production bundle:

```bash
puzzle build examples/photo-gallery
```

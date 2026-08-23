# Chirp Example

A Twitter/X-style microblog built with the Puzzle framework — scroll a feed of
hand-seeded developer-culture chirps, like and rechirp them, follow the cast,
open a thread down to its root, search trending hashtags, and watch a live
unread badge drain as you read your notifications. Where `examples/stays` is a
light marketplace leaning on nested routes and `examples/music` shows off layout
swaps, **Chirp exists to exercise the framework surface no other example
touches**: skeleton loaders, `{#case}` / `{#unless}`, and event modifiers.

Dark theme on purpose: true-black chrome, one chirp-blue accent (`#1d9bf0`), and
a like-pink / rechirp-green pair for the toggle actions. No image assets
anywhere — every avatar and banner is a generated CSS gradient with an emoji.

## Run it

```bash
puzzle dev examples/chirp        # from the repo root: go run ./compiler/cmd/puzzle dev examples/chirp
```

## What this example demonstrates that the others don't

- **`<puzzle-skeleton>` loading templates (v1.8, D39 — SPEC §16)** — the FIRST
  example to use them. `Home.pzl` and `PostDetail.pzl` declare a skeleton
  section that renders (with the `.skeleton-shimmer` utility) while their async
  `data()` awaits `seedStore`, then patches over with the real feed.
- **`{#case}` / `{:when}` multi-branch (v1.7, D37)** — `NotificationRow.pzl`
  switches icon + sentence per notification type; `ChirpCard.pzl` renders body
  segments (text / @mention / #hashtag) through a single `{#case}`.
- **`{#unless}` (v1.7, D36)** — every empty state and the profile's
  follow-vs-edit button.
- **Event modifiers (v1.7, D38)** — `ComposeBox` uses `@submit:prevent` and
  `@keydown:escape`; `Explore`'s search box uses `@keydown:enter`.
- **A live cross-page badge** — the layout subscribes to the unread-notification
  query, so "Mark all read" on the Notifications page drains the sidebar badge
  instantly, with no event plumbing between views.

Plus the established Puzzle goodies: nested profile routes with `<Slot/>`,
`{#for … , i}` staggered card entrances, formatter pipes, and localStorage
persistence of your likes / rechirps / follows / composed chirps.

## Inventory

### App wiring (`app/`)
- **app.js** — `PuzzleApp` config with four display-only formatters (`timeago`,
  `compact`, `plural`, `chirpDate`), post-mount seeding via the memoized
  `seedStore`, and localStorage restore/persist for all local-only state.
- **routes.js** — flat routes plus the nested `/u/:handle` profile branch
  (`ProfileShell` renders `Chirps` / `Replies` / `Likes` at its `<Slot/>`).
- **seed.js** — the memoized `seedStore(store)` that skeleton views await from
  `data()` without re-triggering the load (the D21 gotcha).
- **storage.js** — the snapshot save/load pair behind the persistence.

### Models (`app/models/`)
- **user.js** — accounts (id `me` is you); `at` / `avatarBg` / `bannerBg`
  getters and `toggleFollow()`.
- **post.js** — chirps; `isReply` getter, `toggleLike()` / `toggleRechirp()`,
  and `replyToId` linking the reply tree.
- **notification.js** — activity rows typed `like` / `rechirp` / `follow` /
  `reply` / `mention`.

### Seed data (`app/public/`)
- **users.json** — 10 accounts: you (`@puzzler`) plus nine dev-culture parody
  voices (Ada Lovelace, Grace Hopper, a rubber duck, a CSS wizard, a DBA, a yak
  shaver, a tabs partisan, someone permanently stuck in vim, and a hot-takes
  account).
- **posts.json** — 44 chirps (32 top-level + 12 replies), including a four-deep
  thread, `#hashtags` that feed Explore's trends, and `@mentions` of the cast.
- **notifications.json** — 12 notifications spanning all five types, mostly
  unread so the badge has something to drain.

### Layout (`app/layouts/`)
- **MainLayout.pzl** — the X-style frame: left nav sidebar (active state from
  `pathname`, live unread badge), a 600px bordered center column hosting
  `<Slot/>`, a static "About this demo" right rail, and a mobile bottom tab bar.

### Views (`app/views/`)
- **Home.pzl** — skeleton loader, "For you" / "Following" tabs, the compose box,
  and the top-level feed.
- **Explore.pzl** — hashtag-trend counts, a modifier-driven search box, and
  matching users + chirps.
- **Notifications.pzl** — "Mark all read" plus the notification list.
- **PostDetail.pzl** — skeleton loader, the ancestor chain, the large focused
  chirp, an inline reply composer, and replies.
- **profile/ProfileShell.pzl** + **ProfileChirps / ProfileReplies /
  ProfileLikes.pzl** — the nested-route profile with banner, follow/edit button,
  and tabbed panes.
- **NotFound.pzl** — a playful 404.

### Components (`app/components/`)
- **Avatar.pzl**, **ChirpCard.pzl**, **ComposeBox.pzl**, **NotificationRow.pzl**,
  **FollowButton.pzl**, **WhoToFollow.pzl** — the reusable UI pieces the views
  compose.

## Framework surface exercised

`<puzzle-skeleton>` first-load templates, `{#case}` / `{:when}` multi-branch,
`{#unless}` inverted conditionals, event modifiers (`:prevent`, `:escape`,
`:enter`), nested routes + `<Slot/>` chains, route params and the catch-all,
`{#for}` loop counters (D29), per-instance `get animations()` staggered
entrances, view in/out transitions, store filters as live cross-page
subscriptions, formatter pipes with arguments, and schema defaults / getters /
methods across three models.

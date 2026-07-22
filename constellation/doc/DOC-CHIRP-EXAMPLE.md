---
name: Chirp (examples/chirp) — Twitter-clone example app
kind: reference-app
status: verified
verified_at: '2026-07-22T00:04:05.137Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
connections:
  - DOC-STAYS-EXAMPLE
  - DOC-BLOG-EXAMPLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - COMPONENT-VIEW-MANAGER
  - FILE-EXAMPLES-CHIRP-APP-APP
  - FILE-EXAMPLES-CHIRP-APP-SEED
  - FILE-EXAMPLES-CHIRP-APP-ROUTES
  - FILE-EXAMPLES-CHIRP-APP-MODELS-POST
  - FILE-EXAMPLES-CHIRP-APP-VIEWS-HOME
  - FILE-EXAMPLES-CHIRP-APP-VIEWS-PROFILE-PROFILESHELL
  - FILE-EXAMPLES-CHIRP-APP-COMPONENTS-CHIRPCARD
  - FILE-EXAMPLES-CHIRP-README
notes:
  - kind: verified
    text: >-
      Verified end-to-end at d458c40. Evidence: `puzzle build examples/chirp` green in development
      (47.2 KB gzip) and production (30.1 KB gzip); npm test 272/272 (includes the new router
      regression test); 31-check Playwright walkthrough against `puzzle dev` — Home skeleton shimmer
      under a delayed posts.json then live feed, compose (280 counter, Escape-clears via
      @keydown:escape, @submit:prevent), like/rechirp toggles, card-click → /post/:id with chirpDate
      + ancestor chain + reply flow, PostDetail skeleton, mention links, own-profile {#unless} (Edit
      profile instead of Follow), nested profile tabs (/u/puzzler → /replies → /likes with liked
      chirp), unknown-handle state, Explore trends/search/enter-key/no-results {#unless}/Follow
      toggle, notifications {#case} rows + mark-all-read draining the layout badge live, catch-all
      404, and localStorage persistence of a composed chirp across reload. Zero console/page errors.
    sha: d458c40762129a438ad9678b2981ec8899414a3f
---

# Chirp (examples/chirp)

A local Twitter-style showcase with user, post, and notification models,
threaded replies, profile tabs, notifications, persistence, and seeded latency.

## Framework coverage

- memoized adapter seeding with honest skeleton latency;
- `{#case}`, `{#unless}`, event modifiers, and loop counters;
- nested profile routes rendered through `<Slot/>`;
- cross-page collection subscriptions for unread notification state;
- model getters, custom formatters, and local persistence;
- record updates for likes, reposts, follows, replies, and read flags.

## Durable patterns

`seedStore(store)` memoizes one `Promise.all(loadAll(...))`. Skeleton views may
await it from `data()` without initiating duplicate reads on reevaluation.

A routed shell keeps its root child list stable while loading state changes.
Swap conditional content inside a stable wrapper; changing an unkeyed shell
from `[loading, slot]` to a different sibling sequence can pair the route
outlet with the wrong host node and destroy the nested pane.

Attribute-value conditionals support `{#if}` only. Body-level `{#unless}` and
`{#case}` remain available, but are compile errors inside attributes.

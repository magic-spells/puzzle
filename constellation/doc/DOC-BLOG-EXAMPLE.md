---
name: Puzzle Press (examples/blog) — v1 reference app
kind: reference-app
status: verified
verified_at: '2026-07-22T01:03:40.898Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - COMPONENT-CODEGEN
  - COMPONENT-DEV-SERVER
  - DOC-USER-GUIDE
  - FILE-EXAMPLES-BLOG-APP-APP
  - FILE-EXAMPLES-BLOG-APP-ROUTES
  - FILE-EXAMPLES-BLOG-APP-VIEWS-POSTDETAIL
  - FILE-EXAMPLES-BLOG-APP-COMPONENTS-BUTTON
  - FILE-EXAMPLES-BLOG-PUZZLE-CONFIG
  - FILE-EXAMPLES-BLOG-APP-STYLES-STYLES
  - FILE-PACKAGE
notes:
  - kind: verified
    text: >-
      Verified end-to-end (examples/blog landed). Evidence: `puzzle build examples/blog`
      green in dev + production modes; npm test 164/164 with the pretest smoke guard (D20 negative
      check confirmed: an attr on a component's <puzzle-view> fails the build, exit 1); dev server
      checks — /api/*.json seeds served 200, history fallback serves the shell for /posts/p2 and
      /nope, SSE client injected, live reload events observed on .pzl edit; jsdom walkthrough
      against the real dist bundle 7/7 — home seeds render, meta.title per route, tag filter narrows
      5→2 with active state, /posts/p1 byline (custom formatter) + reading time + pluralized comment
      count, comment create/remove reactive, '*' catch-all NotFound, deep-link cold start shows
      loading then post after seeds resolve.
  - kind: verified
    text: >-
      Re-verified at the v1.16–v1.21 merge (fresh baseline — old one unreachable after squash).
      v1.17 acceptance case landed here: post.js declares author: Puzzle.belongsTo('user') +
      comments: Puzzle.hasMany('comment'), and PostDetail's data() traverses post.author /
      [...post.comments].sort(...) instead of manual findOne/findMany joins — identical rendered
      output, verified by the full suite + relationship tests (480 vitest green).
  - kind: verified
    text: >-
      Re-verified at the correctness-pass HEAD: the only bound-file change was package.json (types
      condition on the ./morph export; verify-pack script unchanged in behavior for this card's
      claims). Blog example itself untouched; build:blog green in the full gate (npm test pretest
      rebuilds it; 510 vitest pass).
  - kind: verified
    text: >-
      v1.32: only package.json changed in this card's binding (new test scripts +
      Playwright/TypeScript devDeps + bin/optionalDependencies for distribution); the blog example
      itself is untouched and still builds via build:blog in pretest. No claim in this card
      affected.
---

# Puzzle Press (examples/blog)

The second reference application complements the deliberately small todos app.
It is smoke-built by root `npm test` and demonstrates a realistic multi-page
data application.

## Coverage

- dynamic post routes, a catch-all, and nested settings routes with an index
  child and reused shell;
- user/post/comment model registration, adapter reads, identity-preserving
  upserts, filtered queries, and local comment mutations. User and post carry
  adapters; comment deliberately has none, demonstrating that adapters are
  opt-in per model;
- reusable components with props, callback events, default
  `<children/>` content, and loop counters;
- a custom `byline` formatter;
- Tailwind v4 through `puzzle.config.js`;
- public JSON seed assets copied into `dist/api/`.

The app seeds users/posts once in the app `beforeMount` hook with
`loadAll()`. Do not call `loadAll` from a subscribed view's `data()`: each
upsert notifies the same collection and would create a fetch/update loop.

Post detail reads the already-seeded store with `findOne`/`findMany`.
`loadOne` is intentionally not used with the local static server because its
SPA fallback returns `index.html` for unknown asset URLs.

Seed dates remain ISO strings after server upsert. Date-related model getters
coerce with `new Date(...)`; display formatters accept the same values.

## Smoke gate

The root `build:blog` script performs a development build and asserts the JS,
HTML, CSS, and JSON seed outputs exist. It exercises the complete Go/esbuild/
Tailwind/public-asset lane before Vitest when running `npm test`.

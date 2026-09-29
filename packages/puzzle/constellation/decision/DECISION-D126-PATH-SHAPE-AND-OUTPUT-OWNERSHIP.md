---
name: >-
  D126 — one owner for route-path shape, and prerender output may not silently overwrite a
  public asset
status: verified
connections:
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D51-ROUTER-BASE-PATH
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC-BUILD
  - DOC-SPEC-ROUTER
  - FILE-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D126 — one owner for route-path shape; prerender output may not overwrite a public asset

## Route-path shape: `client-runtime/router/routePath.js`

The Router and the SSG used to classify path shape independently and drifted.
`routePath.js` (sibling of `routeTree.js`, which shares the tree walk) is the one
owner:

- **`isDynamicSegment(seg)`** — dynamic only if the segment is a complete
  `:name`. A `:` or `*` anywhere else is literal text (the Router regex-escapes
  it), so `/releases/v1:beta` and `/files/*` are static paths and prerender.
  There is no prefix-wildcard route form; only the bare top-level `*` is the
  catch-all.
- **`validateTopLevelPath(path)`** — a top-level path must be `'*'` or start
  with `/`; otherwise the Router throws at construction (such a route was
  unreachable from links and produced unprefixed hrefs).
- **`normalizeRoutePath(path)`** — idempotent percent-encoding canonicalizer run
  at every path boundary (route compilation, `push`/`replace`, `encodeURL`,
  memory initial path, `routerBase`, prerender route snapshot), so `/café` and
  `/caf%C3%A9` are the same path. Encodes `{ } ^` but leaves `|` literal
  (WHATWG); it is not full browser canonicalization (backslash still differs).
  A leaf's single trailing slash is stripped before regex compilation.
- **`findShadowedPaths(entries)`** — tests each fully-static leaf against every
  earlier compiled regex (first-match-wins). Runs from the Router constructor
  in dev only (`__PUZZLE_DEV__`, absent from production bundles) as a warning,
  and always from `prerender()`, which skips a shadowed hybrid page with reason
  `shadowed`. Static output (D81) has no matching, so shadowed pages are still
  written. Results are by entry index, not path, so a duplicate declaration
  never skips the reachable first occurrence; children of a catch-all root
  (which the Router drops) take no index.

`prerenderToDir` builds one memory-mode `Router` up front so a bad route table
fails the build early, and `prerender()` reads its `routeEntries` — the SSG
compiles no matchers of its own.

## Prerender output ownership

`copyPublic`'s map of written paths is threaded into both prerender writers
(`checkPrerenderCollision` in `prerender.go`); a route page that would overwrite
a public asset (typically `public/404.html` + a `path: '*'` route) is a build
error naming both. Keys fold case-insensitively (host-dependent otherwise). The
one exemption is route `/` writing `index.html` — that *is* the shell, read into
memory before the write loop.

## Alternatives

- **Make a non-bare `*` a construction error** — rejected: a breaking change to
  fix a shape nobody writes; it is a literal path and now prerenders as one.

## Consequences

- Declaration order matters (first match wins); the dev warning and the
  prerender skip are the only guards.

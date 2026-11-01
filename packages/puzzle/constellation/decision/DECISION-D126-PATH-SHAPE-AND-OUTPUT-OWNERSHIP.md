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
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/router/routePath.js
  - client-runtime/ssg/index.js
  - compiler/internal/build/prerender.go
---

# D126 — one owner for route-path shape; prerender output may not overwrite a public asset

The Router and the SSG must agree on what a route path means, so one module
classifies and canonicalizes paths for both. And a prerendered page must never
silently replace a file the app shipped in `public/`.

## Decision

**Route-path shape lives in `client-runtime/router/routePath.js`** (beside
`routeTree.js`, which owns the shared tree walk):

- **`isDynamicSegment(seg)`** — a segment is dynamic only if it is a complete
  `:name`. A `:` or `*` anywhere else is literal text (the Router regex-escapes
  it), so `/releases/v1:beta` and `/files/*` are static paths and prerender.
  There is no prefix-wildcard form; only the bare top-level `*` is the catch-all.
- **`validateTopLevelPath(path)`** — a top-level path must be `'*'` or start with
  `/`; otherwise the Router throws at construction.
- **`normalizeRoutePath(path)`** — idempotent percent-encoding canonicalizer run
  at every path boundary (route compilation, `push`/`replace`, `encodeURL`, the
  memory router's initial path, the router base, the prerender route snapshot),
  so `/café` and `/caf%C3%A9` are the same path. It encodes non-ASCII runs and
  the WHATWG path set (space, quotes, angle brackets, backtick, braces, `^`),
  leaves `|` literal, and never encodes `?`/`#`. It is not full browser
  canonicalization (backslash still differs). A leaf's single trailing slash is
  stripped before regex compilation.
- **`findShadowedPaths(entries)`** — tests each fully static leaf against every
  earlier compiled regex (first match wins). The Router constructor runs it in
  dev only, as a warning; `prerender()` always runs it and skips a shadowed
  hybrid page with reason `shadowed`. Static output (D81) has no matching, so
  shadowed pages are still written there. Results are by entry index, not path,
  so a duplicate declaration never skips the reachable first occurrence;
  children of a catch-all root (which the Router drops) take no index.
- The SSG compiles no matchers of its own: `prerenderToDir` builds one
  memory-mode `Router` per build, before reading the shell, so a bad route table
  fails the build first, and `prerender()` reads its `routeEntries`.

**Prerender output ownership:** `copyPublic`'s map of written paths is threaded
into both prerender writers (`checkPrerenderCollision` in `prerender.go`). A
route page that would overwrite a public asset (typically `public/404.html` plus
a `path: '*'` route) is a build error naming both. Keys fold case-insensitively.
The one exemption is route `/` writing `index.html` — that is the shell, read
into memory before the write loop.

## Alternatives rejected

- **Make a non-bare `*` a construction error** — breaks a shape nobody writes to
  no benefit; it is a literal path and prerenders as one.

## Gotchas

- Declaration order matters (first match wins); the dev warning and the
  prerender skip are the only guards.

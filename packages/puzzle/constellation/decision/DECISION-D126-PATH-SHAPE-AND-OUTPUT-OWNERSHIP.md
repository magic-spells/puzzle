---
name: >-
  D126 — one owner for route-path shape, and prerender output may not silently overwrite a
  public asset
status: verified
connections:
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D51-ROUTER-BASE-PATH
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC-BUILD
  - DOC-SPEC-ROUTER
  - FILE-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: state
    text: >-
      Pre-release review hardening (fix/prerelease-review): normalizeRoutePath moved INTO
      routePath.js (exported; router.js imports it) and makeRouteSnapshot now runs path/pathname
      through it, so prerendered route snapshots carry the same canonical form the live Router
      exposes — a snapshot '/café' vs live '/caf%C3%A9' disagreement existed until then. Char class
      extended with { } ^ (browsers percent-encode them in pathnames; '|' deliberately not — WHATWG
      leaves it literal; backslash still disagrees and the doc comment now says the normalizer is
      not full browser canonicalization). Two more alignment fixes: an enumerated leaf under a
      catch-all root ({path:'*', children:[…]} — the Router drops those children entirely) no longer
      consumes a compiledEntryIndex position, which previously INVERTED shadow skips (the reachable
      duplicate skipped, the shadowed one emitted); and makeEntry strips one trailing slash from the
      leaf path before regex compilation, matching #match's incoming normalization (a route declared
      '/docs/' was previously unmatchable by any URL). The ownership half: checkPrerenderCollision
      now folds keys case-insensitively (public/404.HTML vs generated 404.html was silently
      host-dependent), keeping the asset's real spelling in the diagnostic (compiler commit
      1c7b19e).
    sha: ed27cae
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D126 — one owner for route-path shape, and prerender output may not silently overwrite a public asset

Two fail-fast additions and one extraction, from four review findings that turned
out to be symptoms of the same structural gap: **the Router and the SSG each
classified and validated route-path shape independently, with different rules and
no shared owner.** `routeTree.js` had already been extracted to share the tree
*walk* — its own header argues the case — but path *shape* stayed duplicated on
both sides of that boundary.

## The extraction

`client-runtime/router/routePath.js` is a sibling to `routeTree.js` and owns
path-shape truth for both consumers:

- **`isDynamicSegment(seg)`** — a segment is dynamic only if it is a complete
  `:name`. The Router already compiled per-segment and regex-escaped everything
  else; the SSG was using a whole-path substring test (`includes(':') ||
  includes('*')`). That disagreement meant `/releases/v1:beta` and `/pricing*`
  matched in the browser but were skipped as "dynamic" by the prerenderer — a
  404 in `--static`, and a 404 in `--hybrid` unless the host had an SPA rewrite.
- **`validateTopLevelPath(path)`** — must be `'*'` or start with `/`.
- **`normalizeRoutePath(path)`** — the idempotent percent-encoding canonicalizer
  every path-shape boundary runs (route compilation, `push()`/`replace()`,
  `encodeURL()`, the memory mode's initial path, `routerBase`, and the prerender
  route snapshot), so a route declared `/café` and the `/caf%C3%A9` the browser
  reports are the same path on both sides.
- **`findShadowedPaths(entries)`** — for each fully-static leaf, test it against
  every *earlier* compiled regex.

`prerenderToDir` constructs one `new Router(routes, { mode: memoryRouter() })`
up front, purely so a bad route table fails the build before the target selector
and the shell read, and hands that same instance to `prerender()`, which reads
its `routeEntries`. The SSG therefore compiles no matchers of its own — there is
exactly one regex compiler in the system, and it stays in the Router, and
exactly one compiled matcher table per build.

## A non-bare `*` stays legal

Rejected: making `*` a construction error anywhere but the bare top-level
catch-all.

`escapeRegExp` escapes `*` like every other metacharacter, so `{ path:
'/files/*' }` compiles to `/^\/files\/\*$/` and matches the literal URL
`/files/*` — it is not a wildcard, and Puzzle has no match-everything-under-this-prefix
route form. Rejecting it would be a breaking route-config change to fix a route
shape nobody writes deliberately. The SSG now treats it as the static path it is
and prerenders it.

This makes a comment in `ssg/index.js` *false* rather than true — it claimed
"the router construction-checks `'*'` anywhere else, so `fullPath === '*'` is the
only legal `*` shape here." The router rejects `path === '*'` only for
**children**. That false comment is how the two sides drifted, so it was
corrected rather than preserved.

## New: top-level route paths are validated at construction

`{ path: 'about' }` (no leading slash) used to construct silently and then fail
three different ways, none of them loud:

1. With a catch-all declared it did not even warn — `/about` rendered the 404
   view, because the `no route matched` warning only fires when there is no
   catch-all.
2. It was unreachable from links **by construction**: the click interceptor
   pushes `url.pathname + …`, and `URL.pathname` always begins with `/`. Only a
   hand-written `router.push('about')` could reach it — and in path mode that
   calls `history.pushState` with a *relative* URL the browser resolves against
   the current directory, a second independent defect.
3. `router.url('about')` returned it unchanged, so the `link` formatter emitted
   an unprefixed href — broken under `routerBase`.

It now throws at construction, symmetric with the child leading-`/` throw that
already existed. This can break an app that declared such a route, which is
accepted deliberately: every one of those routes was already unreachable, and
silence was the actual bug.

## New: prerendered output may not overwrite a public asset

`app/public/` is copied into staging, then the prerenderer writes route pages
into the same tree with a bare `fs.writeFileSync` — no existence check, no owner
check, in either the hybrid or the static writer. `ValidatePublic` did not cover
it: it is root-level and files-only by design (nested `public/vendor/app.js` is
explicitly allowed), and its reserved set is only `app.js`, `app.js.map`, and
`styles.css`.

The realistic collision is **`public/404.html` plus a `path: '*'` catch-all** —
a root-level name, the single most common hand-authored static-host file, and
absent from the reserved set. Confirmed on a real `puzzle build --hybrid`: the
build exited 0 and `dist/404.html` was the prerendered page, the public file's
contents simply gone.

`copyPublic` already returned a map of the dist-relative paths it wrote and
`build.go` discarded it. It is now captured and threaded into both prerender
paths, and a collision is a build error naming both the route and the public
asset.

**The `/` route is exempt, and must be.** Route `/` writes `index.html`, which
*is* the copied shell — safe because `prerenderToDir` reads the shell into memory
once before the write loop, so a `prerender: false` route `/` rewrites it
verbatim as a byte no-op. An unexempted "throw if the output exists" guard breaks
every hybrid build. The exemption is exactly `routePath === "/" && rel ===
"index.html"`.

## Shadowed routes

Router matching is first-match-wins, and nothing checked across entries — no
shadow, precedence, or overlap warning existed anywhere in the repo. With
`/user/:id` declared before `/user/new`, the SSG emitted a static
`dist/user/new/index.html` while the live app rendered the `:id` view at that
URL, because takeover calls `replaceChildren()` unconditionally.

`findShadowedPaths` now runs from the Router constructor behind the
`__PUZZLE_DEV__` probe (D57 pattern — verified absent from a production bundle,
along with the function itself) and unconditionally from `prerender()`, which
skips the page with reason `shadowed`.

**Hybrid only.** True static output (`--static`, D81) has no router and no
matching — the per-page kernel mounts the page's own view module from the baked
route snapshot — so a shadowed page there is correct and is still written. That
asymmetry is pinned by a test.

Returned entries are identified by **index, not path string**, so a duplicate
static declaration does not cause the first (reachable) occurrence to be skipped.

## Notes

- `tests/router-overlap.test.js` is a false friend: it covers `transitionMode:
  'overlap'`, not pattern overlap. It was not the missing coverage.
- No doc warned about declaration order. First-match-wins is stated as a contract
  in `DOC-ROUTER`, `DOC-USER-GUIDE`, and D30 — never as a hazard.
- `examples/blog` happens to declare `/posts` before `/posts/:id`;
  `examples/mission-control` has `/fleet` with children `['', ':id']` — one added
  `{ path: 'new' }` after `:id` and it would have tripped.

---
name: Router
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - COMPONENT-MORPH
  - COMPONENT-SSG
  - FILE-ROUTER
  - DECISION-D163-LAZY-ROUTE-VIEWS
notes:
  - kind: gotcha
    text: >-
      A reused ancestor's gated data() runs against the DESTINATION params/snapshot but commits only
      inside #commitState (D146). Anything the router adds on a non-committing exit path must
      discard the prepared runs, or their tracked subscriptions strand on a live ancestor.
  - kind: verified
    text: >-
      Re-verified after the 2026-07-24 deep-review round. Corrected two stale claims: the commit no
      longer syncs managed head tags (D111 — #syncHead is syncTitle(resolveHead(chain)) and nothing
      else), and url() now delegates to the exported encodeURL shared with both prerender paths.
      Added the dev-only route-commit emit to the D100 bridge.
    sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: decision
    text: >-
      A view or layout CONSTRUCTOR throw is a pre-commit navigation failure handled exactly like a
      lazy-loader rejection: reported through onError with phase 'navigation', run through the
      shared failed-navigation recovery, URL/history/mounted tree untouched, and the same path
      retryable (before the fix the rejected promise stayed latched to the pending-nav path and
      every later push() to it replayed the rejection). The abandoned instances are DROPPED, never
      destroy()ed — a constructed-only view holds no subscription, timer, or registry entry, so
      destroy() would fire destroyed() for a view whose created() never ran.
  - kind: decision
    text: >-
      The failed-POP URL invariant, made uniform in 0.7.0's pre-release review: after ANY navigation
      failure that leaves the tree on the committed route, the address bar matches the DOM. A push
      never moved the URL (pushState fires at commit, D61), so it needs no repair; a pop is the
      asymmetric case — the browser moved the address bar before #navigate ran. Only the two guard
      paths (blocked guard, no-op guard redirect) restored it before; the three pre-commit catches —
      lazy() marker rejection (D163), view/layout constructor throw, and the data() rejection — left
      the URL on the popped entry over an unchanged tree, so a reload landed on a page the app was
      not showing. All five now run `if (pop && cur && this.#state === cur)
      this.#restoreCommittedUrl(cur.path)`. The `this.#state === cur` test is what keeps it correct
      under a redirect or a newer navigation that already moved the state. #restoreCommittedUrl is a
      replaceState, so the repair adds no history entry; a urlless mode short-circuits inside it.
      Pinned by tests/router-failed-pop-url.test.js (one case per failure kind, each asserting
      location and history.length).
  - kind: gotcha
    text: >-
      #applyFragmentPop mutates #state's path/pathname/query/hash IN PLACE, so `router.current.hash`
      tracks an in-page anchor move live — but the frozen snapshot each mounted view holds as
      `this.route` does NOT. A fragment move is not a navigation (D41): nothing loads, nothing
      refreshes, no snapshot is delivered, so `this.route.hash` keeps whatever the last COMMITTED
      navigation carried. That is the intended design, not a gap — the snapshot commits with the
      tree (D146), and adding an `_adoptRoute` seam to push a fresh snapshot into the committed
      chain would give views a route object that moves without the tree under it. Documented
      instead, in SPEC §19 and DOC-ROUTER's route-snapshot section: a view that must react to an
      anchor jump reads `ctx.router.current.hash` and listens for hashchange/popstate itself.
  - kind: decision
    text: >-
      Guard-redirect continuations join the failed-POP URL invariant. A redirect re-enters #navigate
      for the target while the original pop's address bar is still live, so its own pre-commit
      failures owe the same replaceState repair as the five direct sites. Neither sibling test works
      alone there: the re-entrant #navigate bumps #token by construction, so a `token ===
      this.#token` compare would disable every legitimate repair, and `this.#state === cur` is
      equally satisfied by a NEWER pop still in its load phase. The chain therefore carries a
      mutable ownership box, created by the frame that starts the chain and re-stamped by every
      re-entry of that SAME chain (a nested guard→A→B redirect stays one logical navigation), held
      by identity across the await; the continuation repairs only when the box's token is still the
      router's current token AND the committed state is still `cur`. A chain superseded by a newer
      navigation restores nothing and leaves the winner's URL alone.
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Router

Route compiler and navigation state machine. PATH routing is inline here and
is the zero-config default; hash and memory routing are opt-in mode objects an
app imports from `@magic-spells/puzzle/router-modes` (`router/modes.js`) and
passes as `mode`, so a path-mode bundle carries neither
([[DECISION-D159-ROUTER-MODE-FACTORIES]]). A mode string is a constructor throw
naming the import. Public surface: `start`, `stop`, `push`, `replace` (push's
no-history-entry sibling — same pipeline, `replaceState`/in-place memory-stack
overwrite, current scroll-entry key kept, scroll untouched by default; D83),
`go`, `back`, `forward`, `current`, `url` (path-shaped route → mode-encoded
href, the render-time inverse of the link interceptor; non-`/` strings pass
through — D79), and the narrow `setMorphHandler` integration seam.

`url()` is a thin call into the module-level `encodeURL(path, mode, base)`
(`mode` = the Router's mode instance, or null for path routing),
which the module exports alongside `normalizeBase` precisely so the DOM-free
prerender paths can reuse the *same* encoder without a live Router: the static
router stub and the hybrid prerender ctx both call it ([[COMPONENT-SSG]]). That
sharing is load-bearing rather than tidy — three hand-kept copies of the
encoding had already drifted, emitting unprefixed hrefs from a based hybrid
build.

Nested route definitions flatten to leaf matchers in declaration order.
Children use relative paths; empty children are index routes; layouts are
top-level only; merged params reach every view; nearest leaf metadata wins for
title and transition settings. Top-level `*` is the catch-all. Duplicate params,
absolute child paths, nested catch-alls/layouts, invalid transition modes,
non-function guards, a `view`/`layout` that is neither a `PuzzleView` subclass
nor a `lazy()` marker (D163 — a bare function gets its own message steering to
`lazy()`; this check runs after the older structural ones so their diagnostics
keep precedence), and invalid base/memory config fail at construction. Each
leaf entry compiles its inherited guard chain (`entry.guards`, root→leaf,
catch-all included; D87), and settles its view/layout class list once: an entry
with no `lazy()` marker carries a precomputed class array, so nothing about the
lazy path costs a lazy-free app anything per navigation.

**The canonical internal form of a path is percent-encoded** — the form
`location.pathname` reports, which is the one input the router cannot change.
One normalizer is applied at every boundary: route compilation, `push()`,
`replace()`, `encodeURL()`/`url()`, the memory-mode initial path, and
`routerBase`. It encodes whole non-ASCII runs (whole runs, so surrogate pairs
survive) plus the eight ASCII characters the WHATWG path percent-encode set
escapes and `encodeURIComponent` would otherwise leave alone in a path —
space, `"`, `<`, `>`, `` ` ``, `{`, `}`, and `^`. `?` and `#` are deliberately
NOT encoded: they are structural delimiters the query/fragment split depends on.

Everything else stays byte-identical, including regex metacharacters, malformed
percent text, and existing `%XX` escapes — which is what makes the operation
idempotent (`/caf%C3%A9` never becomes `/caf%25C3%25A9`). Without this a
raw-declared `/café` matched only through `push()`, because `push()` matched its
raw argument string while `#currentPath()` read the browser's encoded pathname:
cold load, in-app `<a>` clicks, and the back button all fell through to the
catch-all, and declaring the route pre-encoded instead broke `push()`. Param
values are unaffected — they were already decoded once at match time and must
not be double-decoded.

Navigation is guard-then-load-then-commit. Guards run in `#navigate` after the
token bump and before any view/layout construction — sequentially root→leaf on
every matched navigation (params/query-only included, `{ to, from, ctx }` with
frozen snapshots, `from` null on nav #0), token-rechecked across awaits.
`false`/throw = stay put through the shared failed-navigation recovery helper;
a string verdict redirects through public `replace()` (denied URL never enters
history; ten guard redirects without a commit trip the cycle cap, reset in
`#commitState`). An empty guard chain adds no await — unguarded navigation
keeps its synchronous path to construction.

Lazy route views resolve next ([[DECISION-D163-LAZY-ROUTE-VIEWS]]), and this
ordering is the contract: only once every guard has ALLOWED the navigation does
any `lazy()` marker in the matched chain start loading, so a blocked or
redirected route never downloads its code. All markers in the chain — every
level's view plus the top-level layout — start together and settle through one
`Promise.all`, before the reuse calculation (so layout reuse compares resolved
classes), before any constructor, and before any `data()`. A loader rejection
is an ordinary pre-commit failure: it reports through `onError` as the existing
`navigation` phase, runs the shared failed-navigation recovery, and leaves URL,
history, and the mounted tree untouched, so `errorView` retry re-enters the
normal same-location rebuild and re-invokes the loader. An entry with no
markers skips this branch entirely and stays byte-for-byte the synchronous path
it was.

The router then computes the shared route-node prefix, preloads fresh views,
prepares reused ancestors
(D146 — run in the gate, committed with the navigation)
with one frozen
`{ path, pathname, query, hash, route, params, chain }` snapshot (parsed once
per navigation by `parseLocation` — frozen null-proto query, repeated keys →
frozen arrays, URLSearchParams decoding; D83), and abandons/destroys fresh
work on failure or supersession. The winning swap commits
location/history/title (`resolveHead` + `syncTitle` from head.js — per-field
leaf→root meta resolution, only a non-null resolved title assigns, memory mode
document-untouched; D84), scroll bookkeeping, mounted tree, and `current` in
one synchronous window. The managed `og:`/`twitter:`/description/canonical tags
are **not** synced here, in any output mode: D111 made them build-time only, so
`#syncHead` does exactly `syncTitle(resolveHead(entry.chain))` and
`headTags.js` never enters a browser bundle.
Dev builds emit the committed route to the D100 DevTools bridge
([[FILE-DEVTOOLS]]) from `#commitState`, beside the existing `warnMissingSlots`
walk — after `#commitLocation`, so the reported `document.title` is already this
route's. Committed-same-path pushes are no-ops; a same-path push while that navigation
is still IN FLIGHT returns the in-flight navigation's own promise, so both
callers settle at commit (D119). The route announcement reads `document.title`
but falls back to the committed route's name (then path) when the title didn't
move — aria-live announces on change only (D119). Trailing `/` is
insignificant for matching. The D39
skeleton gate must start all gated loads before any skeleton-exempt preload opens
its tracking scope, or a store-connected layout's gated sync `data()` queues
behind the skeleton view's fetch and nothing paints.

The route chain becomes nested keyed component vnodes through each `<Slot/>`.
The shared prefix keeps its instances; the topmost divergent view (or a changed
layout) is the sole animator and lower fresh views skip enter. Missing outlets
warn because a preloaded child has no mount target. The whole chain is rebuilt on
each navigation, not only the divergent survivor: patchComponent pushes children
through on every re-render, so a survivor-only swap would be reverted by a later
ancestor re-render (regression-tested).

A contained routed mount/refresh failure marks the chain non-reusable, destroys
the failed view, and replaces only its exact owned position with the app error
view or the invisible recovery marker. Navigation away disposes that
replacement normally. Explicit retry reconstructs the routed views and reruns
all route-chain data by forcing an internal same-location `replace` through the
ordinary navigation pipeline; `chainInvalid` makes `keep = 0`, and the commit
naturally installs healthy instance bookkeeping. The replacement is HELD for the
whole rebuild — the commit disposes it, or the load-failure catch swaps it for
one carrying the new error — so no pre-commit exit (guard verdict, supersession,
a superseding navigation that also stays put) can leave the position empty. The
old ancestor-boundary chain
truncation/invalidation path is gone—replacement never renders above the failed position
([[DECISION-D145-ERROR-BOUNDARIES]]).

Sequential transitions await the old unit's out phase before commit. A failing
leave hook is logged and the swap continues so the incoming preloaded chain is
not leaked. `transitionMode: 'overlap'` pins the leaver at its measured fixed
rect, commits the entrant immediately, and removes the leaver when out settles.
Mode resolution is destination-only: nearest route override, incoming
view/layout class field, then app default. Interruptions synchronously destroy
doomed pending-out subtrees.

The morph slot calls `leave(oldRoot)` at out start and awaits its promise before
destroy; `enter(newRoot, { initial })` runs post-commit/pre-paint. Errors are
logged and never wedge navigation. Params-only updates do not fire morph hooks.

Path/hash modes intercept safe same-origin unmodified links and delegate
pop/go to browser history. Hash routing keeps app paths base-free inside the
fragment. `routerBase` prefixes real URLs in path/hash and is inert in
memory. Memory mode owns an entry stack and has no URL/title/scroll effects.

Scroll defaults to top on push and saved position on pop, with per-entry keys,
sessionStorage persistence (50-entry cap), anchor targets, custom behavior, and
opt-out. Failed/initial navigations do not move scroll.

Hybrid output takeover (`output: 'hybrid'`, D67) recognizes matching
`data-puzzle-ssg` markup at navigation zero, replaces it inside the commit
window, removes the marker, and skips the initial enter animation. After that
the page is the same SPA. A failed takeover mount first offers the exact
position to the app error view; only an absent or failed error view restores
the snapshotted prerendered nodes + marker on the rejection microtask
([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]),
and every container-mount branch — including a layout swap — re-runs the
takeover clear so the restored marker cannot duplicate the page. (True static
output, `output: 'static'`/D81, involves no router — those pages are mounted by
`mountStatic`, stamped `data-puzzle-static`, and never taken over.)

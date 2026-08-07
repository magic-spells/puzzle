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
notes:
  - kind: gotcha
    text: >-
      A reused ancestor's gated data() runs against the DESTINATION params/snapshot but commits
      only inside #commitState (D146). Anything the router adds on a non-committing exit path
      must discard the prepared runs, or their tracked subscriptions strand on a live ancestor.
  - kind: verified
    text: >-
      Re-verified after the 2026-07-24 deep-review round. Corrected two stale claims: the commit no
      longer syncs managed head tags (D111 — #syncHead is syncTitle(resolveHead(chain)) and nothing
      else), and url() now delegates to the exported encodeURL shared with both prerender paths.
      Added the dev-only route-commit emit to the D100 bridge.
    sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
verified_at: '2026-07-25T05:23:58.437Z'
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

# Router

Route compiler and navigation state machine for history, hash, and memory
modes. Public surface: `start`, `stop`, `push`, `replace` (push's
no-history-entry sibling — same pipeline, `replaceState`/in-place memory-stack
overwrite, current scroll-entry key kept, scroll untouched by default; D83),
`go`, `back`, `forward`, `current`, `url` (path-shaped route → mode-encoded
href, the render-time inverse of the link interceptor; non-`/` strings pass
through — D79), and the narrow `setMorphHandler` integration seam.

`url()` is a thin call into the module-level `encodeURL(path, mode, base)`,
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
non-function guards, and invalid base/memory config fail at construction. Each

**The canonical internal form of a path is percent-encoded** — the form
`location.pathname` reports, which is the one input the router cannot change.
One normalizer is applied at every boundary: route compilation, `push()`,
`replace()`, `encodeURL()`/`url()`, the memory-mode initial path, and
`routerBase`. It encodes whole non-ASCII runs (whole runs, so surrogate pairs
survive) plus the four ASCII characters the WHATWG path percent-encode set
escapes and `encodeURIComponent` would otherwise leave alone in a path —
space, `"`, `<`, `>`, and `` ` ``. `?` and `#` are deliberately NOT encoded:
they are structural delimiters the query/fragment split depends on.

Everything else stays byte-identical, including regex metacharacters, malformed
percent text, and existing `%XX` escapes — which is what makes the operation
idempotent (`/caf%C3%A9` never becomes `/caf%25C3%25A9`). Without this a
raw-declared `/café` matched only through `push()`, because `push()` matched its
raw argument string while `#currentPath()` read the browser's encoded pathname:
cold load, in-app `<a>` clicks, and the back button all fell through to the
catch-all, and declaring the route pre-encoded instead broke `push()`. Param
values are unaffected — they were already decoded once at match time and must
not be double-decoded.
leaf entry compiles its inherited guard chain (`entry.guards`, root→leaf,
catch-all included; D87).

Navigation is guard-then-load-then-commit. Guards run in `#navigate` after the
token bump and before any view/layout construction — sequentially root→leaf on
every matched navigation (params/query-only included, `{ to, from, ctx }` with
frozen snapshots, `from` null on nav #0), token-rechecked across awaits.
`false`/throw = stay put through the shared failed-navigation recovery helper;
a string verdict redirects through public `replace()` (denied URL never enters
history; ten guard redirects without a commit trip the cycle cap, reset in
`#commitState`). An empty guard chain adds no await — unguarded navigation
keeps its synchronous path to construction. The router then computes the
shared route-node prefix, preloads fresh views, prepares reused ancestors
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

History/hash modes intercept safe same-origin unmodified links and delegate
pop/go to browser history. Hash routing keeps app paths base-free inside the
fragment. `routerBase` prefixes real URLs in history/hash and is inert in
memory. Memory mode owns an entry stack and has no URL/title/scroll effects.

Scroll defaults to top on push and saved position on pop, with per-entry keys,
sessionStorage persistence (50-entry cap), anchor targets, custom behavior, and
opt-out. Failed/initial navigations do not move scroll.

Hybrid output takeover (`output: 'hybrid'`, D67) recognizes matching
`data-puzzle-ssg` markup at navigation zero, replaces it inside the commit
window, removes the marker, and skips the initial enter animation. After that
the page is the same SPA. A failed takeover mount restores the snapshotted
prerendered nodes + marker on the rejection microtask ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]),
and every container-mount branch — including a layout swap — re-runs the
takeover clear so the restored marker cannot duplicate the page. (True static
output, `output: 'static'`/D81, involves no router — those pages are mounted by
`mountStatic`, stamped `data-puzzle-static`, and never taken over.)

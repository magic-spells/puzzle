---
name: D83 — Router query snapshot + router.replace()
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D42-MEMORY-MODE
  - DECISION-D33-ROUTER-SCROLL
  - FILE-ROUTER
  - FILE-SSG-ASSEMBLE
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D83 — Router query snapshot + `router.replace()`

The route snapshot carries parsed URL state — `pathname`, `query`, `hash` — and
`router.replace(path)` is the no-history-entry sibling of `push()`. Together
they make URL-backed transient UI state (filters, tabs, search, pagination)
first-class. Spec: [[DOC-SPEC-ROUTER]] §44.

## Decision

- **Snapshot fields:** `pathname` (path minus query/hash), `query` (frozen,
  null-prototype; `URLSearchParams` decoding; one value → string, repeated keys
  → frozen array in source order, valueless key → `''`), `hash` (`''` or the raw
  leading-`#` fragment). `path` stays raw (base-free, query+hash included).
  Query never merges into `params`; views read `this.route.query`. Parsed once
  per navigation and stored on the committed state. Prerender and static
  snapshots carry the same fields (empty query/hash, pathname = the page path).
- **`replace(path)`** runs the same match/load/cancellation/atomic-commit
  pipeline as `push()`, including the same-path no-op and the commit-window
  deferral slot. At commit: path/hash mode `history.replaceState` with the same
  encoding, **keeping the current scroll-entry key**; memory mode overwrites
  `stack[index]` in place. A failed or superseded replace commits nothing (D61).
- **Replace leaves scroll alone by default** (transient state like typing a
  filter) unless the target carries an explicit `#anchor`; a custom D33
  `scrollBehavior` still runs and may override.
- **Same-path push settlement:** a `push()` to the path already committed
  resolves immediately. A `push()` to the path *still in flight* (a
  double-click) returns that navigation's own promise (`#pendingNavPromise`,
  set and cleared with `#pendingNavPath`), so the second caller settles exactly
  when the first navigation commits, fails or is superseded. A push to a
  different path mid-flight supersedes. (Guard redirects bypass this guard —
  D87.)
- Query changes on the same route re-run the params-only refresh, so
  `router.replace(router.current.pathname + '?q=' + …)` composes with no new
  machinery.

## Alternatives

- **Restructure the router's internal flags into an action enum** — rejected:
  the D19/D42/D61 state machine is load-bearing; one `replace` boolean is the
  whole delta.
- **Merge query into `params`** — rejected: collides with `:param` names.
- **Ember-style sticky/serialized query state** — rejected: heavyweight and
  implicit.
- **Writable `route.query`** — rejected: inverts the router's one-way flow.

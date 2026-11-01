---
name: D182 — push()/replace() resolve a NavigationResult
status: built
connections:
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D177-LOCALE-URL-PREFIXES
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - TEST-ROUTER-NAVIGATION
---

# D182 — push()/replace() resolve a NavigationResult

## Context

A caller that awaits `router.push()` or `router.replace()` needs to know whether the navigation landed: a commit, a guard block, a redirect, a newer navigation winning, an unmatched path or a failed load. Without a result an agent or test has to poll `router.current` and the DOM. The router knows the outcome at each exit; it only has to say it.

## Decision

`push(path)` and `replace(path)` return `Promise<NavigationResult>` and never reject:

```ts
type NavigationResult =
  | { ok: true; route: RouteSnapshot; catchAll?: true; redirectedFrom?: string }
  | { ok: false; reason: 'blocked' | 'superseded' | 'not-found' | 'error'; error?: unknown };
```

`go()`, `back()` and `forward()` keep their `void | Promise<void>` contract. The static router stub still throws for `push`/`replace`.

### Success

- **`ok: true`**: the navigation committed, the catch-all `*` included. `route` is the navigation's frozen snapshot (the object its guards saw as `to`, equal to `router.current` at commit).
- `catchAll: true` is set exactly when the committed leaf is the `path: '*'` route (D189). It lives on the result, not the snapshot. The module-level `succeed(route)` builds every success result, so it follows the final landing across redirects, reused-chain commits and same-path no-ops.
- **Redirects** resolve the final navigation's result. When it is `ok`, `redirectedFrom` names the path originally requested; across a chain (`/a` → `/b` → `/c`) each outer frame overwrites the field, so it ends as `/a`. A refused or failed redirect carries that failure without `redirectedFrom`.

### Failure: reported to `onError` means `'error'`

- `'blocked'`: a guard returned `false`. Nothing was reported.
- `'superseded'`: a later navigation took the token (during guards, the lazy load, `data()`, the takeover component load or the out animation). One frozen `SUPERSEDED` object.
- `'not-found'`: no route matched and there is no catch-all; the development warning stays.
- `'error'` with `error`: a throwing guard, the ten-redirect cycle cap (its own `Error`), a lazy load, view/layout construction or `data()` failure, or a synchronous throw inside the commit window. Each is reported to `onError` (phase `navigation`). `#runGuards` returns an `{ error }` marker for the first two, and `#navigate` runs the same recovery and pop-URL repair as for `false`. With nothing committed yet (a pop landing during navigation zero) there is no URL to repair.

**"Did not complete", not "nothing committed".** Every reason except a commit-window throw leaves the URL, DOM and `router.current` untouched. A commit-window throw can land after `#commitLocation`, with the URL and DOM on the target, while `#commitState` never ran. The catch releases the in-flight latch (`#pendingNavPath`, `#pendingNavPromise`, the locale target) so a retry navigates again, and sets `chainInvalid` so the next navigation rebuilds every level.

**Strictly never rejects**, with one exception: start()'s navigation zero (the `#navigate` with no verb, plus a guard redirect continuing it; the chain box carries `start`). Its commit-window throw rethrows, so `app.mount()` still rejects and tears down. A push that supersedes navigation zero, or runs after a failed or blocked one, resolves like any other.

### `push()` to the committed path

| Situation | Behaviour |
| --- | --- |
| Nothing in flight, chain intact | No-op, `ok` with the current route (`catchAll: true` on the catch-all) |
| Nothing in flight, chain invalid (a failed view, a commit-window throw) | Rebuild with replace semantics; history unchanged |
| A push or replace in flight (the URL has not moved yet) | Supersede it; rebuild with replace semantics; history unchanged |
| A pop in flight, path or hash mode (the browser already moved onto the popped entry) | An ordinary push (`pushState`), so the popped entry survives |
| A pop in flight, memory mode (the index did not move) | Replace semantics |
| Any row above, called twice in a row | The second call returns the identical promise; `data()` runs once |

Each row has its own test in `tests/router-navigation-result.test.js`.

- `#isCommittedNoop` gates the no-op: the committed path, an intact chain, and both `#pendingNavPath` and `#pendingNavPromise` empty. The path slot matters for a push fired from `created()` of a view being built: it runs before `push()` pairs the promise, while the slot already names the navigation in flight.
- "Replace semantics" is `#navigate` in replace mode, tracked like a push: `push()` passes `track: true`, so `#navigate` records `#pendingNavPath` at its token bump, before it runs synchronously into `preload()`/`created()`, and `push()` pairs `#pendingNavPromise` when it returns. A same-path push from that `created()` therefore joins the rebuild instead of no-opping against the old snapshot or, over an invalidated chain, rebuilding again for each fresh view. Every clear point (commit, recovery, a commit-window throw, `stop()`) releases the record, so a navigation that ended synchronously (a view constructor throwing) leaves nothing latched.
- `#popInFlight` says whether the in-flight navigation is a pop. Every `#navigate` that takes the token sets it, and it is read only while `#pendingNavPromise` is set.
- A guard redirect to the committed path stays a no-op (D87's loop safety): the only navigation in flight is the one being redirected.
- `replace()` to the committed path is a no-op under the same rule; otherwise it joins a push's rebuild of that path when one is in flight, and failing both it is an ordinary replace. A `replace()` to any other path is always an ordinary replace; during a plain `push()` to that same uncommitted path it supersedes the push, so the replace's history semantics hold.

### Joining an in-flight navigation

A push to the path a push already has in flight (a plain push or a rebuild) returns that push's promise (`#joinInFlight`), so all callers share one result object. A replace joins only a rebuild of the committed path; it records no path of its own, so it is only ever joined onto a push.

A call fired synchronously from inside `#navigate` before the promise is paired (a `created()` hook pushing or replacing its own path) reads the slot again one microtask later. If `#pendingNavPath` still names its path it gets the in-flight result; otherwise a navigation fired in between took the token, and it resolves `'superseded'`, never the other navigation's result. Without the replace join, a `replace()` of its own path from `created()` during a rebuild would supersede it and construct a fresh view whose `created()` replaces again, until the stack overflows. A guard redirect never joins (D87): it would wait on the denied navigation's own promise.

### Commit-window deferral

A push or replace from `mounted()`/`viewWillShow` is parked in the single last-wins slot (`#defer`, shared with `go`) together with its promise's resolver. The promise adopts the re-dispatched navigation's result when `#runPendingPush` runs it. An entry displaced by a later deferral, or dropped by `stop()`, resolves `'superseded'`.

## Alternatives rejected

- **Reject on failure**: every fire-and-forget link click would become an unhandled rejection, and `await push()` call sites would need try/catch for an ordinary guard block.
- **A separate `'redirected'` reason or a `redirects` array**: the caller wants where it landed; `redirectedFrom` plus the final snapshot answers that.
- **`'blocked'` for a throwing guard or the redirect cap**: it would hide a reported failure behind the same reason as a deliberate `false`.
- **Keep the same-path no-op while a navigation is in flight**: `push('/')` from `/` during a slow `push('/slow')` would resolve `ok` and then `/slow` would commit.
- **Key the navigation-zero rethrow on "nothing committed yet"**: a push that superseded navigation zero, or ran after a blocked one, would then reject.
- **Resolve a deferred push immediately**: the caller would continue while the old route is committed and the target DOM does not exist.
- **Return `router.current` on success**: a fresh object per read; the frozen `to` snapshot already exists and is what guards and `this.route` see.

## Consequences

`await router.push(p)` tells the caller what happened. Callers that ignore the value see three behaviours worth knowing:

- A synchronous commit-window throw on any navigation other than navigation zero resolves `'error'` and reaches `onError` instead of rejecting.
- A push back to the committed path while a navigation is in flight is a real navigation, not a no-op.
- Clicking the active link after a failed position or a commit-window throw rebuilds the page.

The D145 retry closure still redraws its held face from inside `#navigate`, because the face needs the `onError` info object, which the result does not carry.

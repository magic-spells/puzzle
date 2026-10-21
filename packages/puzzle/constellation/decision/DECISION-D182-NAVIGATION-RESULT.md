---
name: D182 — push()/replace() resolve a NavigationResult
status: built
connections:
  - FEATURE-NAVIGATION-RESULT
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
---

## Context

A caller that awaits `router.push()` or `router.replace()` cannot tell whether the navigation landed. Every exit of the pipeline resolves the same value — a commit, a guard block, a redirect, a newer navigation winning, an unmatched path, a failed load — so an agent or test has to poll `router.current` and the DOM to learn the outcome. The router already knows the outcome at each exit; it only has to say it.

## Decision

`push(path)` and `replace(path)` return `Promise<NavigationResult>` and never reject:

```ts
type NavigationResult =
  | { ok: true; route: RouteSnapshot; redirectedFrom?: string }
  | { ok: false; reason: 'blocked' | 'superseded' | 'not-found' | 'error'; error?: unknown };
```

- **`ok: true`** — the navigation committed, the catch-all `*` included. `route` is the navigation's frozen snapshot (the same object its guards saw as `to`, equal to `router.current` at commit).
- **Same-path no-op, only when nothing is in flight.** A push or replace to the committed path resolves `ok: true` with the current route only when the committed state is the whole story: no navigation in flight (`#pendingNavPromise` empty) and the committed chain not invalidated. With a navigation in flight, a push back to the committed path is an ordinary push that supersedes it, so the last push wins — "already there" would be false the moment the in-flight one committed. A guard redirect to the committed path stays a no-op (D87's loop safety), because the only navigation in flight is the one being redirected. An invalidated chain (a failed position, a commit-window throw) is never "already there", so the push rebuilds.
- **Same-key in flight.** A push to the path already in flight returns that push's promise, so both callers get one result object. A push fired synchronously from inside `#navigate` before the promise is paired (a `created()` hook pushing its own path) reads the slot again one microtask later and gets the same in-flight result.
- **Redirects** resolve the final navigation's result. When it is `ok`, `redirectedFrom` names the path originally requested; across a chain (`/a` → `/b` → `/c`) each outer frame overwrites the field, so it ends as `/a`. A refused or failed redirect carries that failure without `redirectedFrom`.
- **The rule for `ok: false`: reported to `onError` means `'error'`.**
  - `'blocked'` — a guard returned `false`. Nothing was reported.
  - `'superseded'` — a later navigation took the token (during guards, the lazy load, `data()`, the takeover component load, or the out animation).
  - `'not-found'` — no route matched and there is no catch-all; the development warning stays.
  - `'error'` with `error` — a throwing guard, the ten-redirect cycle cap (its own `Error`), a lazy load, view/layout construction or `data()` failure, or a synchronous throw inside the commit window. Each is reported to `onError` (phase `navigation`). `#runGuards` returns an `{ error }` marker for the first two, and `#navigate` runs the same recovery and pop-URL repair as for `false`.
- **"Did not complete", not "nothing committed".** Every reason except a commit-window throw leaves the URL, DOM and `router.current` untouched. A commit-window throw can land after `#commitLocation`, with the URL and DOM on the target, while `#commitState` never ran, so `#state` still names the old route. The catch releases the in-flight latch (`#pendingNavPath`, `#pendingNavPromise`, the locale target) so a retry navigates again, and marks the committed chain invalid so the next navigation rebuilds every level.
- **Strictly never rejects.** The only exception is start()'s navigation zero, the one `#navigate` with no verb, together with a guard redirect continuing it (the chain box carries `start`). Its commit-window throw rethrows, so `app.mount()` still rejects and tears down. A push that supersedes navigation zero, or runs after a failed or blocked navigation zero, resolves like any other.
- **Commit-window deferral.** A push or replace from `mounted()`/`viewWillShow` is parked in the single last-wins slot together with its promise's resolver. The promise adopts the re-dispatched navigation's result when `#runPendingPush` runs it. An entry displaced by a later deferral, or dropped by `stop()`, resolves `'superseded'`.
- `go()`, `back()` and `forward()` keep their `void | Promise<void>` contract.

Bytes: two module-level helpers (`fail(reason, error)` and one frozen `SUPERSEDED`) and two private methods (`#defer`, shared by push, replace and go, and `#isCommittedNoop`, shared by push and replace). Every other change reuses an existing exit.

## Alternatives rejected

- **Reject on failure** — every fire-and-forget link click would become an unhandled rejection, and `await push()` call sites across apps would need try/catch for an ordinary guard block.
- **A separate `'redirected'` reason or a `redirects` array** — the caller wants where it landed; `redirectedFrom` plus the final snapshot answers that without a new shape.
- **`'blocked'` for a throwing guard or the redirect cap** — it would hide a reported failure behind the same reason as a deliberate `false`. The rule is that reported to `onError` means `'error'`.
- **Keep the same-path no-op while a navigation is in flight** — `push('/')` from `/` during a slow `push('/slow')` would resolve `ok` and then `/slow` would commit, so the result would be false.
- **Key the navigation-zero rethrow on "nothing committed yet"** — a push that superseded navigation zero, or ran after a blocked one, would then reject.
- **Resolve a deferred push immediately** — the caller would continue while the old route is committed and the target DOM does not exist, the bug the in-flight same-key rule already fixed for double clicks.
- **Return `router.current` on success** — a fresh object per read; the frozen `to` snapshot already exists and is what guards and `this.route` see.

## Consequences

`await router.push(p)` tells the caller what happened, so agents and tests stop polling. Callers that ignore the value behave as before, with three observable differences:

- A synchronous commit-window throw on any navigation other than navigation zero resolves `'error'` and reaches `onError` instead of rejecting.
- A push back to the committed path while a navigation is in flight is a real navigation, not a no-op.
- Clicking the active link after a failed position or a commit-window throw rebuilds the page.

The D145 retry closure still redraws its held face from inside `#navigate`, because the face needs the `onError` info object, which the result does not carry.

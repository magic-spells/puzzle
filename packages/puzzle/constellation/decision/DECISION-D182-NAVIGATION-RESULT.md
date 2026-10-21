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

- **`ok: true`** — the navigation committed, the catch-all `*` included. `route` is the navigation's frozen snapshot (the same object its guards saw as `to`, equal to `router.current` at commit). A same-path push or replace is a no-op that resolves `ok: true` with the current route. A same-key push while that path is in flight returns the in-flight push's promise, so both callers get one result object.
- **Redirects** resolve the final navigation's result. When it is `ok`, `redirectedFrom` names the path originally requested; across a chain (`/a` → `/b` → `/c`) each outer frame overwrites the field, so it ends as `/a`. A refused or failed redirect carries that failure without `redirectedFrom`.
- **`'blocked'`** — a guard returned `false`. A throwing guard and the ten-redirect cycle cap are already reported through `onError` by `#runGuards`, and block the same way, so they also resolve `'blocked'`.
- **`'superseded'`** — a later navigation took the token (during guards, the lazy load, `data()`, the takeover component load, or the out animation).
- **`'not-found'`** — no route matched and there is no catch-all; the development warning stays.
- **`'error'`** with `error` — a lazy load, view/layout construction or `data()` failure (still reported to `onError`, phase `navigation`), or a synchronous throw inside the commit window, which is now reported there too because no promise rejects. Navigation zero rethrows that commit throw instead, so `app.mount()` still tears down on it.
- **Commit-window deferral.** A push or replace from `mounted()`/`viewWillShow` is parked in the single last-wins slot with its promise's resolver; the promise adopts the re-dispatched navigation's result when `#runPendingPush` runs it. The entry a later deferral displaces, and one `stop()` drops, resolves `'superseded'`.
- `go()`, `back()` and `forward()` keep their `void | Promise<void>` contract. The router constructs no result object for them beyond what `#navigate` already returns.

Bytes: two module-level helpers (`fail(reason, error)` and one frozen `SUPERSEDED`) and one private method (`#defer`, shared by push, replace and go); every other change reuses an existing exit.

## Alternatives rejected

- **Reject on failure** — every fire-and-forget link click would become an unhandled rejection, and `await push()` call sites across apps would need try/catch for an ordinary guard block.
- **A separate `'redirected'` reason or a `redirects` array** — the caller wants where it landed; `redirectedFrom` plus the final snapshot answers that without a new shape.
- **`'error'` for a throwing guard** — it would need `#runGuards` to return a fourth verdict kind; a guard failure already follows D87's "a throw is logged and the app stays put", the same outcome as `false`.
- **Resolve a deferred push immediately** — the caller would continue while the old route is committed and the target DOM does not exist, the bug the in-flight same-key rule already fixed for double clicks.
- **Return `router.current` on success** — a fresh object per read; the frozen `to` snapshot already exists and is what guards and `this.route` see.

## Consequences

`await router.push(p)` tells the caller what happened, so agents and tests stop polling. Existing callers that ignore the value behave as before; the only observable difference is that a synchronous commit-window throw on a later navigation resolves `'error'` and reaches `onError` instead of rejecting. The D145 retry closure still redraws its held face from inside `#navigate`, because the face needs the `onError` info object the result does not carry.

---
name: router.push()/replace() resolve a NavigationResult
status: built
release: RELEASE-V0-9-0
change: feature
branch: feat/navigation-result
connections:
  - DECISION-D182-NAVIGATION-RESULT
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - TEST-ROUTER-NAVIGATION
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D177-LOCALE-URL-PREFIXES
---

# router.push()/replace() resolve a NavigationResult

Part of the 0.9.0 agent-API round. An agent kit drove the router by polling, because `push()` resolved `undefined` on every path. Decision record: [[DECISION-D182-NAVIGATION-RESULT]].

## Design

`#navigate` returns a result at every exit, and `#swap` returns `ok` after its commit or `SUPERSEDED` from its two abandon points. `push()`/`replace()` hand that promise back unchanged, so the in-flight same-key rule shares one result. A slot that is still empty (a push from `created()`) is read again on a microtask; it takes the in-flight promise only while `#pendingNavPath` still names its path, and resolves `SUPERSEDED` otherwise.

`#isCommittedNoop` gates the same-path no-op. It needs the committed path, an intact chain, and nothing in flight — neither `#pendingNavPath` nor `#pendingNavPromise` set; a guard redirect is exempt.

A same-path push that rebuilds with replace semantics passes `track: true`, so `#navigate` records `#pendingNavPath` at its token bump, before it runs into `created()`, and `push()` pairs the promise as for a plain push. A same-path push from that `created()` joins the rebuild instead of no-opping on the old snapshot or recursing over an invalidated chain; the normal clear points release the record, so a navigation that ended synchronously never stays latched.

`#runGuards` returns an `{ error }` marker for a throwing guard and for the redirect cap, so both resolve `'error'`.

The commit-window deferral slot carries the caller's resolver (`#defer`). `#runPendingPush` resolves it with the re-dispatched verb's promise, and an entry that is displaced or dropped by `stop()` resolves `SUPERSEDED`.

`#navigate` catches a synchronous commit-window throw. When it owns the token, the catch releases the in-flight latch and the locale target and marks `#state.chainInvalid`. It then reports the throw and resolves `'error'`. The one exception is start()'s navigation zero (`initial`, carried through a redirect chain by the box's `start`), which rethrows so `app.mount()` keeps its teardown.

## Files

- `client-runtime/router/router.js` — results at each exit, `fail`/`SUPERSEDED`, `#defer`, the commit-throw catch.
- `types/index.d.ts` — `NavigationResult`; `push`/`replace` return `Promise<NavigationResult>`.
- `tests/router-navigation-result.test.js` — one test per outcome, redirect chain, deferral (last-wins, `stop()`), hash and memory mode, D177 locale-prefixed push, the commit throw.
- `tests/router-constructor-throw.test.js`, `tests/router-memory.test.js` — expectations that asserted `undefined`.
- `tests-types/consumer.ts` — narrowing on `ok`.

## Size

hello-world 22595 → 22941 bytes gzip (+346), todos 26755 → 27109 (+354).

## Callers checked

The testing helper `visit()`, the stress example's `RcLayout`/`stress-controller`, the devtools panel views and its `panel-app` test, the hash-mode fragment handler and link interception all await or ignore the value; none read it. The static router stub still throws for `push`/`replace`.

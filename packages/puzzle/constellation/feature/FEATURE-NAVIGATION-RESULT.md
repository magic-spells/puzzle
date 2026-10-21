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

`#navigate` returns a result at every exit and `#swap` returns `ok` after its commit or `SUPERSEDED` from its two abandon points. `push()`/`replace()` hand that promise back unchanged, so the in-flight same-key rule shares one result. The commit-window deferral slot carries the caller's resolver (`#defer`); `#runPendingPush` resolves it with the re-dispatched verb's promise, and a displaced or `stop()`-dropped entry resolves `SUPERSEDED`. A synchronous commit-window throw is caught in `#navigate`, reported, and resolved `'error'`, except on navigation zero, which rethrows so `app.mount()` keeps its teardown.

## Files

- `client-runtime/router/router.js` — results at each exit, `fail`/`SUPERSEDED`, `#defer`, the commit-throw catch.
- `types/index.d.ts` — `NavigationResult`; `push`/`replace` return `Promise<NavigationResult>`.
- `tests/router-navigation-result.test.js` — one test per outcome, redirect chain, deferral (last-wins, `stop()`), hash and memory mode, D177 locale-prefixed push, the commit throw.
- `tests/router-constructor-throw.test.js`, `tests/router-memory.test.js` — expectations that asserted `undefined`.
- `tests-types/consumer.ts` — narrowing on `ok`.

## Size

hello-world 22595 → 22769 bytes gzip (+174), todos 26755 → 26925 (+170).

## Callers checked

The testing helper `visit()`, the stress example's `RcLayout`/`stress-controller`, the devtools panel views and its `panel-app` test, the hash-mode fragment handler and link interception all await or ignore the value; none read it. The static router stub still throws for `push`/`replace`.

---
name: v1.53 — route guards (D87)
status: verified
connections:
  - DECISION-D87-ROUTE-GUARDS
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-ROUTER
  - FILE-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Merged and verified per the card's Verification section: full suite 957 green, go test,
      test:types, stays build. Browser smoke pending.
    sha: 214406a27c9beb7a34a7a1a265f5dd8bf8f28fc0
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-2-0
change: feature
---

# v1.53 — route guards (D87)

`guard: ({ to, from, ctx }) => verdict` on any route node; the matched chain's
guards run root → leaf before views construct or load. Allow / block /
redirect (replace semantics, loop-capped). Ship
[[DECISION-D87-ROUTE-GUARDS]].

## Scope

- In (runtime, `router.js`): `entry.guards` compiled per leaf at construction
  (with non-function validation, catch-all included); the guard phase in
  `#navigate` after the token bump with a per-await supersession recheck; the
  hoisted frozen `to` snapshot (built before any construction); redirects
  re-entering through public `replace()`; the ten-redirect cycle cap, reset on
  commit and at the start of every externally-initiated navigation (a guard
  redirect's own re-entry is flagged as a continuation and keeps the count);
  the shared failed-navigation recovery helper; frozen `from`
  (null on navigation #0).
- In (SSG, `ssg/index.js`): hybrid warning per rendered page whose chain
  declares a guard (quiet under `prerender: false`); one static-build warning
  when any route declares a guard. Warnings only.
- In (types): `GuardFn` + `Route.guard` in the public `.d.ts`, consumer-test
  covered.
- In (example): `examples/stays` — fake `session` model, guarded `/account`
  subtree, `/login` view replaying `?redirect=` via `replace()`.
- Out: enforcement in prerender modes, named guards/registry, built-in
  attempted-path state, per-navigation (call-site) guard overrides.

## Verification

- Vitest guard suites (history + memory): allow/block/redirect semantics,
  no denied-view construction, root→leaf order + short-circuit, child
  composition, async supersession, navigation #0 redirect (`from === null`),
  params-only re-run, thrown guard, same-path no-op redirect, cycle cap
  (leaves nav #0 unmounted without crashing), blocked pop (stack index put),
  construction throws. Prerender suites cover both warnings. Full suite,
  `go test ./...`, and `test:types` green; `examples/stays` builds.

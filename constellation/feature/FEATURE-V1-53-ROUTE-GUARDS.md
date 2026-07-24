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
verified_at: '2026-07-24T01:11:10.487Z'
verified_sha: 214406a27c9beb7a34a7a1a265f5dd8bf8f28fc0
notes:
  - kind: verified
    text: >-
      Merged and verified per the card's Verification section: full suite 957 green, go test,
      test:types, stays build. Browser smoke pending.
    sha: 214406a27c9beb7a34a7a1a265f5dd8bf8f28fc0
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
  hoisted frozen `to` snapshot (now built before any construction); redirects
  re-entering through public `replace()`; the ten-redirect cycle cap reset on
  commit; the shared failed-navigation recovery helper; frozen `from`
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

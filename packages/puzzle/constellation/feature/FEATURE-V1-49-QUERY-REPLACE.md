---
name: v1.49 — Router query snapshot + replace() (D83)
status: verified
connections:
  - DECISION-D83-QUERY-REPLACE
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-ROUTER
  - FILE-ROUTER
  - FILE-SSG-ASSEMBLE
  - FILE-STATIC-MOUNT
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Merged (PR #14) and verified: +25 tests across memory/history/hash/base suites; real-Chrome
      check — replace() per keystroke with zero history growth, back-after-replace lands on the
      rewritten entry, this.route.query live in data().
    sha: 0858d1e52af13ecfe031278ca8e1db496ca3ff2c
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-2-0
change: feature
---

# v1.49 — Router query snapshot + replace() (D83)

The route snapshot gains `pathname` / `query` / `hash` (parsed once per
navigation, frozen, null-proto query, repeated keys → arrays) and the router
gains `replace(path)` — push's no-history-entry sibling riding the same
match/load/cancel/atomic-commit pipeline. Ship [[DECISION-D83-QUERY-REPLACE]].

## Scope

- In (runtime): `client-runtime/router/router.js` — a `parseLocation` helper
  (subsumes the D41 anchor split), extended frozen `to` + committed-state
  parts, `replace()` mirroring `push()` (same-path no-op, commit-window
  deferral now `{ path, replace }`), a `replace` boolean through `#navigate`
  into `#commitLocation` (`replaceState` keeping the current scroll key /
  memory `stack[index]` overwrite), replace leaves scroll alone by default.
  SSG parity: `ssg/assemble.js`'s `makeRouteSnapshot` carries the three new
  fields for both the prerender snapshot and the static kernel's rebuilt one;
  `serializeRouteJSON` stays `{ path, params, chain }` because a static path's
  pathname/query/hash are constants the kernel re-derives.
- In (types): `RouteSnapshot` + `Router.replace` in `types/index.d.ts`.
- Out (per D83): the internal action-enum refactor, sticky/serialized query
  params, query-into-params merging, reactive query writes.

## Acceptance

- Views read `this.route.query` (single/repeated/valueless keys, malformed
  percent input safe); query-only navigations refresh the chain with the new
  snapshot; replace grows no history in any mode and survives
  back/forward correctly; failed/superseded replace commits nothing; scroll
  untouched on replace; SSG/static snapshots carry the same shape; full
  vitest + `test:types` green.

---
name: v1.49 — Router query snapshot + replace() (D83)
status: building
connections:
  - DECISION-D83-QUERY-REPLACE
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-ROUTER
  - FILE-ROUTER
  - FILE-SSG-ASSEMBLE
  - FILE-STATIC-MOUNT
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
  SSG parity: `ssg/assemble.js` snapshot + `serializeRouteJSON` + the static
  kernel snapshot all carry the three new fields.
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

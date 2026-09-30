---
name: D135 — params-only replace() moves no focus, announces nothing
status: verified
connections:
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - COMPONENT-ROUTER
  - DOC-SPEC-ROUTER
  - FILE-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D135 — params-only `replace()` moves no focus, announces nothing

## Context

D83's query-rewrite pattern (`router.replace('/search?q=' + v)` per keystroke)
reuses the committed leaf (`keep === chain.length`). D93 focus management runs
on push, replace and pop, so without a carve-out every keystroke focused the
leaf root and pulled focus out of the search input, and the live region
re-announced a route the user never left. `#resolveScroll` already leaves
replace alone for the same reason.

## Decision

The params-only commit branch in `#commitState` passes
`focus: replace ? null : focus`: no focus move, no announcement. Params-only
**pushes** keep full focus + announcement; full replaces (a different leaf) are
unchanged.

- The fix sits at the commit site because `#resolveFocus` runs before `keep`
  is known.
- A custom `focusBehavior` is skipped on this path too (scroll parity).
- `#announcedTitle` does not advance here; the next real navigation compares
  against the last ANNOUNCED title, so a `document.title` change made by a
  params-only replace does not suppress it.

## Alternatives

- Gate-side fix in `#resolveFocus` — the gate runs before `keep` exists.
- Announce but don't focus — per-keystroke live-region spam; the §51 announcer
  speaks on change only.

## Consequences

A leaf-identical replace is transient URL state, not a route change. Amends
SPEC §51 (D93).

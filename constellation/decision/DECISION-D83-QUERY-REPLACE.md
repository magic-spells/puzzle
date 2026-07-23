---
name: 'D83 — Router query snapshot + `router.replace()` (v1.49)'
status: planned
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-ROUTER
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D42-MEMORY-MODE
  - DECISION-D33-ROUTER-SCROLL
  - FILE-ROUTER
  - FILE-SSG-ASSEMBLE
  - FEATURE-V1-49-QUERY-REPLACE
---

# D83 — Router query snapshot + `router.replace()` (v1.49)

The route snapshot gains parsed URL state — `pathname`, `query`, `hash` — and
the router gains `replace(path)`, the no-history-entry sibling of `push()`.
Together they make URL-backed transient UI state (filters, tabs, search,
pagination) first-class. See [[DOC-SPEC]] §44.

## Context

The router recognizes URLs carrying query strings (`#currentPath` reads
`location.search`; matching strips it) but never parses them: the D47 snapshot
is `{ path, route, params, chain }` with the raw query riding un-parsed inside
`path`. SPEC §19 itself warns users off string-comparing `path` *because* of
query noise. Apps that want `?q=term&sort=date` state have no read surface and
— worse — no way to update the URL without minting a history entry per
keystroke. The static kernel's router stub already listed `replace` among the
"public surface" methods it stubs: the gap was anticipated. Ember and Vue
Router both treat query state as part of routing; Puzzle borrows the readable
part without Ember's controller-backed serialization or sticky params.

## Decision

**Additive snapshot fields + a push-mirroring `replace()`, threaded as one
boolean through the existing navigation options — explicitly NOT a refactor
of the router's internal flags.**

- **Snapshot:** `pathname` (path minus query/hash), `query` (frozen,
  null-prototype; `URLSearchParams` decoding; single value → string, repeated
  keys → frozen array in source order, valueless key → `''`), `hash` (`''` or
  the raw leading-`#` fragment). `path` is unchanged (raw, base-free,
  query+hash included) — full back-compat. Query never merges into `params`;
  `data(params)` signatures are untouched — views read `this.route.query`.
  Parsed ONCE per navigation (one helper shared with the D41 anchor split) and
  stored on the committed state, so `current` never reparses.
- **`replace(path)`** runs the identical match/load/cancellation/atomic-commit
  pipeline as `push()`, including the same-path no-op guard and the
  commit-window deferral slot. At the D61 commit point: history/hash mode
  `history.replaceState` (same base/mode encoding as push), **keeping the
  current scroll-entry key** — the entry is the same entry; memory mode
  overwrites `stack[index]` in place (no truncate, no append, no index move).
  A failed or superseded replace commits nothing, inherited from D61.
- **Replace never touches scroll by default.** The whole point is transient
  state (typing a filter); a scroll-to-top per keystroke would be absurd. A
  custom D33 `scrollBehavior` still runs and may override.
- **No action-enum refactor.** The proposal that prompted this decision wanted
  the internal `{push, pop}` flags restructured into
  `'initial'|'push'|'replace'|'pop'`. The router is the D19/D42/D61 state
  machine — its flag plumbing is load-bearing and heavily reasoned; a
  cosmetic restructure risks subtle regressions for zero behavior. One added
  `replace` boolean is the whole internal delta. **Rejected.**

SSG/static parity: the prerender snapshot ([[FILE-SSG-ASSEMBLE]]) and the
static kernel's rebuilt snapshot carry the same three fields (empty query,
empty hash, pathname = the enumerated path).

## Consequences

- Filters/tabs/search/pagination get shareable URLs and sane Back behavior:
  read `this.route.query`, write `router.replace(router.current.pathname +
  '?q=' + …)` — query changes on the same route already re-run the
  params-only refresh, so reactivity composes with zero new machinery.
- The snapshot shape change is visible to every view (`this.route`) but purely
  additive; frozen/null-proto keeps it tamper-proof and prototype-clean.
- `types/index.d.ts` `RouteSnapshot`/`Router` extend accordingly.

## Alternatives rejected

- Ember-style sticky query serialization / controller state — heavyweight,
  implicit, and the part of Ember queries nobody misses.
- Merging query values into `params` — collides with `:param` names and
  muddies the matching contract; a separate read surface is honest.
- Reactive query-object mutation (`route.query.q = …` writes the URL) —
  magic writes to a frozen snapshot invert the router's one-way data flow.

---
name: D135 — params-only replace() moves no focus, announces nothing
status: verified
connections:
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - COMPONENT-ROUTER
  - DOC-SPEC-ROUTER
  - FILE-ROUTER
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D135 — params-only `replace()` moves no focus, announces nothing

D83's query-rewrite pattern (`router.replace('/search?q=' + v)` per keystroke)
reuses the committed leaf (`keep === chain.length`). D93 focus management would
otherwise focus the leaf root on every keystroke, pulling focus out of the search
input, and the live region would re-announce a route the user never left. A
leaf-identical replace is transient URL state, not a route change — the same
reason `#resolveScroll` leaves replace alone.

## Decision

- The params-only commit branch in `#commitState` passes
  `focus: replace ? null : focus`: no focus move, no announcement, and no custom
  `focusBehavior` call.
- Params-only **pushes** keep full focus and announcement; a replace that changes
  the leaf takes the normal path.
- The carve-out sits at the commit site because `#resolveFocus` runs before
  `keep` is known.
- `#announcedTitle` does not advance here. The next real navigation compares
  against the last *announced* title, so a `document.title` change made by a
  params-only replace does not suppress its announcement.

## Alternatives rejected

- **Gate inside `#resolveFocus`** — it runs before `keep` exists.
- **Announce but don't focus** — per-keystroke live-region spam; the SPEC §51
  announcer speaks on change only.

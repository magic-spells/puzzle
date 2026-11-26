---
name: D135 — params-only replace() moves no focus, announces nothing
status: verified
connections:
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - COMPONENT-ROUTER
  - DOC-SPEC-ROUTER
  - FILE-ROUTER
verified_at: '2026-11-24T18:05:31.213Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# D135 — params-only `replace()` moves no focus, announces nothing

D83's query-rewrite pattern (`router.replace('/search?q=' + v)` per keystroke)
reuses the committed leaf (`keep === chain.length`). D93 focus management would
otherwise focus the leaf root on every keystroke, pulling focus out of the search
input, and the live region would re-announce a route the user never left. A
leaf-identical replace is transient URL state, not a route change — the same
reason `#resolveScroll` leaves replace alone.

## Decision

- The params-only commit branch in `#navigate` hands `#commitState`
  `focus: replace ? null : focus`: no focus move, no announcement, and no custom
  `focusBehavior` call.
- Params-only **pushes** keep the normal focus path and announcement; a replace
  that changes the leaf takes the normal path. Under D93's default target a
  params-only push from a control inside the reused leaf leaves focus on that
  control when it survives the patch.
- The carve-out sits at the commit site because `#resolveFocus` runs before
  `keep` is known.
- `#announcedTitle` does not advance here. The next real navigation compares
  against the last *announced* title, so a `document.title` change made by a
  params-only replace does not suppress its announcement.

## Alternatives rejected

- **Gate inside `#resolveFocus`** — it runs before `keep` exists.
- **Announce but don't focus** — per-keystroke live-region spam; the SPEC §51
  announcer speaks on change only.

---
name: 'D30 — Nested routes: children arrays, chain-prefix reuse, root-only layouts'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
code_refs:
  - client-runtime/router/router.js
---

# D30 — Nested routes: children arrays, chain-prefix reuse, root-only layouts

A routed view hosts a child routed view at its `<Slot/>` outlet. Router-only: slot composition, keyed component vnodes and cascading `destroy()` were already generic. See [[DOC-SPEC-ROUTER]] §9 and [[DOC-ROUTER]].

## Decision

- **Declaration.** A parent route carries `children: [...]`. The Router constructor flattens the table to one entry per leaf (`{ chain, fullPaths, regex, paramNames, layout }`); matching stays depth-first, first match wins.
- **Paths.** Child paths are relative (`'/settings'` + `'profile'` → `/settings/profile`: strip one trailing slash, add `/`, add the child). Constructor throws: a leading `/` on a child, `layout` on a non-root node, `path: '*'` inside `children`, a duplicate `:param` in one chain.
- **Layouts are root-only** — gates and shells at depth 0; children inherit. A layout swap therefore happens only when the chain diverges at depth 0.
- **A parent with children does not match its bare URL.** Opt in with an index child `path: ''`; otherwise the bare URL falls to the catch-all.
- **Params.** The leaf regex yields one merged params object, and every level's `data(params)` receives all of it.
- **Reuse and gating.** `keep` = the shared chain prefix (route-node identity). Fresh levels `preload()`; reused ancestor views re-run `data()` with the full params. All are awaited before the URL commits ([[DECISION-D19-NAVIGATION-COMMIT]]); reused ancestors are transactional — they commit only in the navigation's commit window ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). A reused **layout**'s refresh runs post-commit (it is chrome, not routed content).
- **One animator:** the topmost swapped instance, `views[keep]` (or the layout when `keep === 0`), animates; every fresh instance below it is `skipEnter()`'d ([[DECISION-D28-ANIMATIONS]]).
- **After the out, the full rebuilt vnode chain goes to the topmost host** (layout, or the root view) and the keyed patch cascades to the divergence level.
- **Keys:** a reused level keeps its committed key; a fresh level gets `fullPaths[i] + '\x00' + navToken`, so the keyed patch reuses exactly what the router reused.
- **Interruption:** a navigation arriving while a previous out is animating clamps `keep` to exclude the doomed `#pendingOut` subtree; when `#pendingOut` sits deeper than the winner's own old animator, that animator is destroyed synchronously too.
- **Title:** `meta.title` resolves nearest-defined, leaf → root.
- A non-leaf template with no `<Slot/>` preloads its child but never mounts it; a dev warning fires post-commit.

## Alternatives rejected
- Flat routes referring to a parent by `name` — scatters the hierarchy and needs a name-resolution pass.
- Absolute child paths — renaming a parent segment silently desyncs children.
- Per-level layouts — layout-inside-view sandwiches and a layout swap at every depth.
- Auto-matching the bare parent URL with an empty outlet — an empty hole is almost always a forgotten index pane.
- Swapping only at the survivor with the fresh sub-chain — any later ancestor re-render pushes stale slot content back down and resurrects destroyed instances (reproduced).
- Keying on the runtime path (`/user/42`) — param changes and sibling children sharing a class collide; the bare pattern alone lets a fresh instance adopt a destroyed one after an interruption clamp.

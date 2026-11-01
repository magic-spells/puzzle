---
name: 'D30 — Nested routes: children arrays, chain-prefix reuse, root-only layouts'
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
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
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D30 — Nested routes: children arrays, chain-prefix reuse, root-only layouts

A routed view hosts a child routed view at its `<Slot/>` outlet. This is router work only; slot composition, keyed component vnodes and cascading `destroy()` are generic. See [[DOC-SPEC-ROUTER]] §9 and [[DOC-ROUTER]].

## Decision

- **Declaration.** A parent route carries `children: [...]`. The Router constructor flattens the table to one entry per leaf (`{ chain, fullPaths, regex, paramNames, layout }`); matching is depth-first, first match wins.
- **Paths.** Child paths are relative (`'/settings'` + `'profile'` → `/settings/profile`: strip one trailing slash, add `/`, add the child). The constructor throws on a leading `/` on a child, `layout` on a non-root node, `path: '*'` inside `children`, and a duplicate `:param` in one chain.
- **Layouts are root-only** — gates and shells at depth 0; children inherit. A layout swap happens only when the chain diverges at depth 0.
- **A parent with children does not match its bare URL.** Opt in with an index child `path: ''`; otherwise the bare URL falls to the catch-all.
- **Params.** The leaf regex yields one merged params object, and every level's `data(params)` receives all of it.
- **Reuse and gating.** `keep` = the shared chain prefix (route-node identity). Fresh levels `preload()`; reused ancestor views re-run `data()` with the full params. All are awaited before the URL commits ([[DECISION-D19-NAVIGATION-COMMIT]]), and reused ancestors commit only in the navigation's commit window ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). A reused **layout**'s refresh runs post-commit (it is chrome, not routed content).
- **One animator:** the topmost swapped instance, `views[keep]` (or the layout when `keep === 0`), animates; every fresh instance below it is `skipEnter()`'d ([[DECISION-D28-ANIMATIONS]]).
- **After the out, the full rebuilt vnode chain goes to the topmost host** (layout, or the root view) and the keyed patch cascades to the divergence level.
- **Keys:** a reused level keeps its committed key; a fresh level gets `fullPaths[i] + '\x00' + navToken`, so the keyed patch reuses exactly what the router reused.
- **Interruption:** a navigation arriving while a previous out is animating clamps `keep` to exclude the doomed `#pendingOut` subtree; when `#pendingOut` sits deeper than the winner's own old animator, that animator is destroyed synchronously too.
- **Title:** `meta.title` resolves nearest-defined, leaf → root.
- A non-leaf template with no `<Slot/>` preloads its child but never mounts it; a dev warning fires post-commit.
- **Conditional outlets** (an outlet inside `{#if}`) keep the routed views alive. The machinery ships only when the usage scan sets `__PUZZLE_HAS_CONDITIONAL_SLOT__` ([[DECISION-D89-FEATURE-USAGE-TREESHAKE]]). Every routed vnode pins its router-owned instance. A hidden outlet parks the current chain off-document; a returning outlet adopts its existing root without a second mount. The slot owner pushes the newest child chain into a parked or never-mounted pin at the end of its render pass and releases such pins when destroyed. A forwarding wrapper torn down in the same render pass parks the pin instead of destroying it.

## Gotchas
- A wrapper component with a leave transition finishes its teardown outside the render pass, so it still destroys the routed view it held (parking only works inside the pass).

## Alternatives rejected

- Flat routes referring to a parent by `name` — scatters the hierarchy and needs a name-resolution pass.
- Absolute child paths — renaming a parent segment silently desyncs children.
- Per-level layouts — layout-inside-view sandwiches and a layout swap at every depth.
- Auto-matching the bare parent URL with an empty outlet — an empty hole is almost always a forgotten index pane.
- Swapping only at the survivor with the fresh sub-chain — any later ancestor re-render pushes stale slot content back down and resurrects destroyed instances.
- Keying on the runtime path (`/user/42`) — param changes and sibling children sharing a class collide; the bare pattern alone lets a fresh instance adopt a destroyed one after an interruption clamp.
- Destroying the routed view when a conditional outlet hides and rebuilding it on show — the router still holds the destroyed instances as the live chain, and a view the manager constructs has no route, params or preload. Keeping the instance detached keeps the router the only owner of routed lifetimes.

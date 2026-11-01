---
name: 'D39 — `<puzzle-skeleton>`: declarative first-load template, auto-swapped'
status: verified
verified_at: '2026-11-01T19:23:24.972Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DOC-SPEC
  - DOC-SPEC-VIEW
  - DOC-PUZZLE-FILE
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D67-HYBRID-PRERENDER
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/router/router.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D39 — `<puzzle-skeleton>`: declarative first-load template, auto-swapped

An optional `.pzl` section whose content renders while the component's **first** `data()` is pending, then swaps for the real template. Presence-driven: no config, no API. See [[DOC-SPEC-VIEW]] §16 and [[DOC-PUZZLE-FILE]].

## Decision
- **Grammar.** At most one per file. Its only legal attribute is `min-duration` ([[DECISION-D52-SKELETON-ANTIFLASH]]). The body uses the full template grammar (a range `{#for}` makes placeholder rows), but only `created()`-seeded state is readable. In a **view**, the skeleton's children sit under the same `<puzzle-view>` root and attributes as the real template, so the swap patches children only. In a **component**, the skeleton needs a single plain-element root (a component root is a compile error); matching the template root's tag gives an in-place patch.
- **Codegen** emits `Name.prototype.renderSkeleton`, shaped like `render()`.
- **Runtime.** `PuzzleView.loaded` is false until the first `data()` commit. While not loaded and `renderSkeleton` exists, renders draw the skeleton. A non-preloaded `mount()` with async `data()` renders the skeleton at once, fires `mounted()` against it, and resolves without waiting for data; `beforeUpdate`/`afterUpdate` bracket the swap like any update. `loaded` never resets — a skeleton is a first-load affordance, not a spinner.
- **Router — the one narrowing of [[DECISION-D19-NAVIGATION-COMMIT]].** A **fresh** routed view or layout with `renderSkeleton` does not gate the commit: its `preload()` starts unawaited, the URL and title move immediately, and the real render patches in when `data()` commits. **Reused ancestors always gate.**
- **Failure after commit.** A skeleton view's `data()` rejection lands after the URL moved. It is reported through the `onError` funnel (`[puzzle] skeleton view data() failed:`) and that position is replaced by the app `errorView` (or the recovery placeholder) ([[DECISION-D145-ERROR-BOUNDARIES]]). A rejection that lands before `mount()` built the view is buffered and shown at the end of mount, so the user is never left on the skeleton.
- **The exemption is off where a skeleton would flash over real content:** navigation #0 of a hybrid-prerendered app (container carries `data-puzzle-ssg`, [[DECISION-D67-HYBRID-PRERENDER]]) and a same-location locale rebuild ([[DECISION-D175-TRANSLATIONS]]). There the chain's `preload()` is awaited like any view and the real template replaces the page in one swap.
- The missing-`<Slot/>` dev warning skips a parent that is not `loaded` yet — its routed child mounts when the real template lands.

## Alternatives rejected
- Showing the skeleton on every refresh — flashes placeholders over real content.
- Keeping the D19 gate and using skeletons only for nested components — routed views are where loading states matter most.
- A `loading` slot/prop API — the section keeps loading markup out of the data-dependent template and compiles to plain vdom.
- A component root inside a skeleton — mounts a live child before data resolves and swaps the root instead of patching.

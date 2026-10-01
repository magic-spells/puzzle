---
name: 'D39 — `<puzzle-skeleton>`: declarative first-load template, auto-swapped'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
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
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/router/router.js
---

# D39 — `<puzzle-skeleton>`: declarative first-load template, auto-swapped

An optional `.pzl` section whose content renders while the component's **first** `data()` is pending, then swaps for the real template. Presence-driven: no config, no API. See [[DOC-SPEC-VIEW]] §16 and [[DOC-PUZZLE-FILE]].

## Decision
- **Grammar.** At most one per file. Its only legal attribute is `min-duration` ([[DECISION-D52-SKELETON-ANTIFLASH]]). The body uses the full template grammar (a range `{#for}` makes placeholder rows), but only `created()`-seeded state is readable. In a **view**, the skeleton's children sit under the same `<puzzle-view>` root and attributes as the real template, so the swap patches children only. In a **component**, the skeleton needs a single plain-element root (a component root is a compile error); matching the template root's tag gives an in-place patch.
- **Codegen** emits `Name.prototype.renderSkeleton`, shaped like `render()`.
- **Runtime.** `PuzzleView` tracks `loaded` (false until the first `data()` commit). While not loaded and `renderSkeleton` exists, renders draw the skeleton. A non-preloaded `mount()` with async `data()` renders the skeleton at once, fires `mounted()` against it, and resolves the mount without waiting for data; `beforeUpdate`/`afterUpdate` bracket the swap like any update. `loaded` never resets — a skeleton is a first-load affordance, not a spinner.
- **Router — the one narrowing of [[DECISION-D19-NAVIGATION-COMMIT]].** A **fresh** routed view or layout with `renderSkeleton` does not gate the commit: its `preload()` starts unawaited, the URL and title move immediately, and the real render patches in when `data()` commits. A skeleton view's `data()` rejection therefore lands after the URL moved; it is logged (`[puzzle] skeleton view data() failed:`) and the skeleton stays up — surfacing the error is the view's job. **Reused ancestors always gate.** The missing-outlet warning skips a parent that is not `loaded` yet.

## Alternatives rejected
- Showing the skeleton on every refresh — flashes placeholders over real content.
- Keeping the D19 gate and using skeletons only for nested components — routed views are where loading states matter most.
- A `loading` slot/prop API — the section keeps loading markup out of the data-dependent template and compiles to plain vdom.
- A component root inside a skeleton — mounts a live child before data resolves and swaps the root instead of patching.

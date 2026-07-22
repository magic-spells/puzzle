---
name: "v1.8 — Skeleton loading templates"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D39-SKELETON
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DOC-SPEC
---

# v1.8 — Skeleton loading templates

An optional fourth `.pzl` section, `<puzzle-skeleton>`, renders (as a compiled `renderSkeleton()`) while the first `data()` is pending, then swaps for the real template; routed views declaring one commit navigation immediately. Driven by [[DECISION-D39-SKELETON]].

## Intent
SPEC deferred `<puzzle-skeleton>` auto-swap / skeleton loading management. Components with async `data()` blocked on the full await-everything path — a routed view with slow data showed nothing until it resolved, and there was no declarative loading affordance.

## Scope
**In:** an optional fourth section whose content renders while the component's first `data()` is pending, then swaps when it commits — presence-driven, no config/API. Grammar: at most one per file, no attributes, full template grammar in the body (only `created()`-seeded state readable); view-mode re-parents children under the same `<puzzle-view>` root (children-only patch), component-mode needs a single plain-element root. Codegen: a second prototype-assigned `renderSkeleton` byte-shaped like `render()`, no new runtime imports. Runtime: `PuzzleView` tracks `#loaded` (public `loaded` getter, never resets — a skeleton is a first-load affordance, not a spinner). Router (the one D19 narrowing): a FRESH routed instance declaring `renderSkeleton` does NOT gate the commit — URL + title move immediately, the real render patches in when `data()` commits — while REUSED ancestors always gate (content on screen never regresses).
**Out (rejected):** auto-showing the skeleton on every refresh (flashes over real content), keeping the D19 gate and skeletons only for nested components, a `loading` slot/prop API instead of a section, and allowing a component root inside a skeleton. Sub-decisions in [[DECISION-D39-SKELETON]].

## Outcome
Shipped in v1.8; documented in [[DOC-SPEC]] §16 and [[DOC-PUZZLE-FILE]]. An additive amendment — files without the section compile and behave byte-identically; skeleton-less views keep byte-identical D19 semantics. `view.loaded` reports the first commit. Touched [[COMPONENT-TEMPLATE-PARSER]], [[COMPONENT-CODEGEN]], [[COMPONENT-PUZZLE-VIEW]], and [[COMPONENT-ROUTER]].

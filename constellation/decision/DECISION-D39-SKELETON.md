---
name: "D39 — `<puzzle-skeleton>`: declarative loading template, auto-swapped (v1.8)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DOC-SPEC
---

# D39 — `<puzzle-skeleton>`: declarative loading template, auto-swapped (v1.8)

An optional fourth `.pzl` section `<puzzle-skeleton>` renders while the first `data()` is pending, then swaps for the real template; routed views declaring one commit navigation immediately instead of gating on `data()`. Settled (v1.8); additive. See [[DOC-SPEC]] §16 and [[DOC-PUZZLE-FILE]].

## Context
[[DOC-SPEC]] deferred "`<puzzle-skeleton>` auto-swap, skeleton loading management". D39 ships it: an optional fourth `.pzl` section, `<puzzle-skeleton>…</puzzle-skeleton>`, whose content renders while the component's **first `data()` is pending**, then swaps for the real template when it commits. Presence-driven — no config, no API; delete the section and the old await-everything behavior returns.

## Decision
- **Grammar.** At most one per file; the tag itself takes **no attributes** (compile error). The body uses the FULL template grammar (one parser, one emitter — the range `{#for}` covers repeated placeholder rows), but only `created()`-seeded state is readable during the skeleton render (`data()` hasn't resolved). In **view mode** the skeleton's children are re-parented under the SAME `<puzzle-view>` root and attributes as the real template, so the swap patches children only; in **component mode** the skeleton needs a **single plain-element root** (a component root is a compile error) — keep its tag equal to the template root's for an in-place patch.
- **Codegen.** A second prototype-assigned method, `Name.prototype.renderSkeleton`, byte-shaped like `render()`. No new runtime imports; SLOT_TAG detection covers both trees.
- **Runtime.** `PuzzleView` tracks `#loaded` (false until the first `data()` commit; public `loaded` getter). While `!loaded` and `renderSkeleton` exists, renders draw the skeleton. A non-preloaded `mount()` with async `data()` + skeleton renders the skeleton immediately, fires `mounted()` against it, and **resolves the mount promise without waiting for data** — so a child component's auto-chained `playIn()` animates the skeleton in, and `beforeUpdate`/`afterUpdate` bracket the loaded swap like any update. `loaded` never resets: later refreshes keep current content up (a skeleton is a FIRST-load affordance, not a spinner).
- **Router (the one [[DECISION-D19-NAVIGATION-COMMIT]] narrowing).** A FRESH routed instance (view or layout) declaring `renderSkeleton` **does not gate the commit**: its `preload()` starts but is not awaited; URL + title move immediately; the preloaded mount renders the skeleton and the real render patches in when `data()` commits. That is the point of a skeleton — navigation feels instant, and the URL points at a page that IS there (its declared loading state). The narrowed guarantee: a skeleton view's `data()` rejection lands AFTER the URL moved (logged `[puzzle] skeleton view data() failed:`; the skeleton stays up — surfacing load errors is the view's job). **Reused ancestors always gate** — content on screen never regresses mid-navigation. Skeleton-less views keep byte-identical D19 semantics. `#warnMissingSlots` skips a parent that isn't `loaded` yet (its `<Slot/>` legitimately arrives with the real template).

## Alternatives rejected
- **Auto-showing the skeleton on every refresh** — flashes placeholders over real content on store changes; last-wins refresh already handles updates.
- **Keeping the D19 gate and rendering skeletons only for nested components** — routed views are where loading states matter most; the roadmap's PostDetail case would never show one.
- **A `loading` slot/prop API instead of a section** — the section keeps loading markup out of the data-dependent template, needs no grammar change, and compiles to plain vdom.
- **Allowing a component root inside a skeleton** — would mount a live child before data resolves and swap the root node instead of patching in place.

## Consequences
Non-breaking: additive amendment (v1.8) — files without the section compile and behave byte-identically.

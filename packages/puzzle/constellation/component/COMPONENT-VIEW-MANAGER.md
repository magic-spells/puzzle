---
name: ViewManager and ViewNode
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-CODEGEN
  - COMPONENT-SSG
  - FLOW-REACTIVITY
  - FILE-VIEW-NODE
  - FILE-VIEW-MANAGER
verified_at: '2026-09-25T10:47:50.423Z'
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
---

# ViewManager and ViewNode

`ViewNode` (views/ViewNode.js) is the render-tree value: tag, attrs, children, key,
DOM/component links, plus helpers for text, list keys (`keyOf`), slot markers and
placeholders. `ViewManager` (views/viewManager.js) mounts, diffs, patches and tears
those trees down. Satellite modules: `html.js` (live-HTML ranges), `flip.js`,
`portal.js` ([[FILE-PORTAL]]), `listBlock.js` ([[FILE-LIST-BLOCK]]).

## Reconciliation


- **Keyed** children reconcile with moves. Identity is the (tag, key) pair compared by
  native SameValueZero through tag-partitioned nested Maps (`oldKeyed`), so `1` vs
  `"1"`, `NaN` and class tags never alias. The dev-only duplicate-key detector
  (`seenNewKeys`) is lazily allocated behind `__PUZZLE_DEV__`.
- **Unkeyed** pairing is positional — keep a shell's child list stable across `data()`
  transitions and swap `{#if}` branches inside a stable wrapper. Codegen pads unequal
  branches with `PLACEHOLDER_TAG` vnodes (empty comments). **Exception: identity.** A
  vnode object present in both old and new lists (a D170 cached subtree shifted behind a
  variable-length run) always pairs with itself; `patchIndexedChildren` pre-scans for a
  child with `el` that is not `oldChildren[i]` and delegates to `patchKeyedChildren`,
  which re-pairs with an identity Set.
- **`sameNode`** = same tag, SameValueZero key, same `island` presence, same children
  ownership (string `{#svg}` seed vs array), same `isText`. Anything else is a
  replacement.
- **`isText` is `tag === 'text' && 'value' in attrs`**: an authored SVG `<text>` compiles
  to the same tag and never carries `value`.
- **Leaving nodes** (mid out-animation, in `leavingEls`) stay in the DOM; the move guard
  uses `nextPersistentSibling`, so a fade-out never reorders survivors.
- **Replace arm unmounts before it mounts.** Since D170 a list row or `__c[n]` subtree is
  the SAME object in both trees, so mounting first would let the outgoing unmount destroy
  the new child. The insertion ref (`anchor` + its `nextSibling`) is captured before the
  unmount and resolved after it.
- **Invariant: `newChild.el` is never null at the keyed move guard**, which is why it
  reads `el` unchecked. Every child reaches the guard straight out of `patch()` or
  `mount()`, and both set `el` on every branch. `mount()` creates a node for every
  non-component kind (element, text, `{#if}` placeholder, Portal placeholder, live-HTML
  comment), and `unmount()` never clears `el`, so `patch()` can always hand the old
  node on. A component vnode takes `child.element`. `PuzzleView.mount()` creates that
  node (its anchor comment) synchronously, before its first await or any user hook, and
  a live instance keeps `currentTree.el ?? anchor` until `destroy()`. A destroyed
  instance never reaches `patchComponent`, whether it failed on mount or was destroyed
  out of band: `patch()` routes it to one of two recovery arms. One remounts a fresh
  instance. The other adopts the error view's element, and that link is always cleared
  before the error view is destroyed. `tests/keyed-move-el.test.js` pins this by
  reordering rows that are pending, behind a skeleton, failed, error-viewed, destroyed
  out of band, or next to HTML, Portal, placeholder and slot siblings.
- Controlled `value`/`checked` re-sync from the new value on every patch, including
  browser-drifted values (`syncControl`, the one implementation shared with
  `patchAttrs`/`reassertSelectValue`).

## Identity short-circuit (D170)

When old and new vnode are the **same object**, `patch()` skips the subtree
([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]) — this is what makes cached rows and static
subtrees free. Three things ride with it: a live component's `el` is refreshed from the
instance (a child may replace its root, e.g. a skeleton); a component vnode with no LIVE
instance (destroyed or null) falls through to the recovery path; and controlled values
are re-asserted from the row's `controls` list (O(controls)).

Because vnodes are reusable, `mountComponent` treats a pinned destroyed `vnode.instance`
as absent and constructs fresh, and ordinary `unmount` nulls `vnode.component`/
`instance`. The two error branches keep their links on purpose (D115 records).

## Components

Component vnodes render inline, no wrapper. Same class + key reuses the instance;
changed props rerun `data()`, slot-only changes only rerender. Async mounts use comment
anchors and resolve insertion refs from the live element.

- **Prop bailout** (`propsEqual`, pinned by `tests/component-prop-bailout.test.js`, the
  [[DECISION-D62-HANDLER-CACHING]] guarantee): shallow `!==` with a key-COUNT guard
  (present-but-`undefined` ≠ absent; `NaN` never bails out, unlike `sameNode`). A value
  carrying a numeric `RENDER_REV` (a store record) is also compared against the child's
  snapshot `child.__propRevs` — records mutate in place, so the snapshot must live on the
  child, never on the old props. Related records and getter inputs still need a query in
  the child's own `data()` ([[FLOW-REACTIVITY]]).
- **Mount failure** ([[DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT]]): `mountComponent`
  chains the enter animation with a **two-argument** `then(ok, fail)` — `fail` is the
  recovery (destroy the instance, leave a comment placeholder stashed as
  `__failedPlaceholder` on the instance, null the vnode links); a trailing `.catch` would
  also catch a throwing `viewWillShow` and tear down a healthy child. `playIn()` logs its
  own rejections. Recovery keys off the **instance**, since a same-turn re-render may have
  moved it to a new vnode: `patch()` tests `component == null || component.isDestroyed`
  (the getter) and mounts fresh.
- **Error view** (D145): the failed position hosts a fresh app `errorView`; retry
  destroys it and calls the parent's normal `refresh()`, reaching the same recovery arm.
  Router-preloaded instances follow the same rule.
- **Unmount leave gate** is `child.__isMounted && (animations.out || __hasHideHooks)` —
  keep `__isMounted` first; a never-mounted child (async `data()` pending) takes the
  synchronous `destroy()`.
- **`treeUnknown`**: when a patch throws partway, later diffs against the lying tree are
  forbidden; `renderFresh` releases both aborted trees (instances, refs, `outside`
  listeners, portals), clears only the manager's range and mounts fresh.

## Composition markers

`SLOT_TAG` + shared `expandSlots` (also used by SSG/static): `<Children/>` → default
bucket, `<Slot name>` → named, `<Slot/>` → router outlet; `SNIPPET_TAG` children form a
bucket keyed by `fits`, and an args-bearing marker stamps the Snippet function per render.
Semantics: [[DOC-SPEC-TEMPLATE]] §24/§64.

- **One helper, `fill(out, nodes, marker, parts)`.** The D173 V14 "filled" test (any node
  but `PLACEHOLDER_TAG` or whitespace-only text) runs ONLY when the marker has a fallback.
  A marker without one splices supplied nodes as-is, placeholders included — dropping
  them would shift every later unkeyed sibling (lost focus, rebuilt children). A fallback
  whose node count differs from the content still shifts siblings; the author rule is one
  root element in a fallback (padding rejected, +32 B gzip).
- The compiled fallback is the lazy `attrs.fallback` thunk; its result is stored in the
  marker's `children` so a reused marker keeps the same vnodes.
- Hybrid/static takeover mounts a pre-expanded tree without re-expanding it
  (`slotsExpanded`, behind `__PUZZLE_TAKEOVER__`); `renderFresh` always expands.
- A marker makes its subtree dynamic, so `expandSlots` never clones a cached static
  subtree — only the path down to a marker.
- Any `#`-prefixed metadata tag reaching element creation or the SSG serializer throws
  `metadataTagError` in every build (the long D89 explanation is dev-only) — it means a
  build whose usage scan missed a feature ([[DECISION-D89-FEATURE-USAGE-TREESHAKE]]).

## Host behavior

- SVG namespaces / `foreignObject`; per-node listeners; event modifiers. A spent `once`
  detaches its listener and keeps only the `ONCE_SPENT` marker (`'\x00once'` — write the
  escape, never a literal NUL, or git treats the file as binary).
- `outside` (D86) listens on `document` in the capture phase with one shared options
  object; `releaseSubtree` sweeps outside listeners on every removal shape.
- Islands: children seeded once, never patched; own attrs/listeners still patch. Inline
  SVG uses the island path with string children.
- `@@name` (an `@name` literal inside a D150 raw block) bypasses listeners and is
  attached as a parser-created `Attr` node, behind `__PUZZLE_HAS_RAW_AT__`.
- `setAttr` (mirrored by `ssg/serialize.js`) omits `false`/`null`/`undefined` and plain
  objects (dev warning), and joins arrays with spaces via `displayValue` — D173 V9.
- **Live HTML** (`HTML_TAG = '#html'`, `views/html.js`, D174): the one vnode that owns
  several DOM nodes — `el` is an empty comment FIRST, `vnode.nodes` follow. Mount parses
  sanitized markup through an inert `<template>`; patch keeps `nodes` when value/br are
  unchanged; the replace and keyed-move paths use `htmlTail`/`moveHtml`. Every branch
  sits behind `__PUZZLE_HAS_RAW_HTML__` with the probe INSIDE each condition (hoisting it
  kept the helpers alive, +151 B). SSG emits the markup without the comment.
- **FLIP** (D85, `flip.js`): a `flip` attr on row roots; First-measure before removals
  (prior Puzzle flips cancel after measuring, via a WeakMap, never `getAnimations()`),
  patch, Last-measure, play a no-fill translate. Reduced motion, no WAAPI or unchanged
  order cost nothing. Call sites sit behind `__PUZZLE_HAS_FLIP__`; detection covers
  component props too.
- **Portals**: bookkeeping in `portal.js`; every call carries the
  `__PUZZLE_HAS_PORTAL__` probe; compiled-out Portal vnodes degrade to inert comments.
- D121 devperf instrumentation counts real DOM writes and prop bailouts per render; all
  collector state lives in [[FILE-DEVPERF]].

## Islands and allocation

An island freezes patching (0 mutations below the boundary, [[DECISION-D44-DOM-ISLANDS]])
but its children are still built by `render()`. Only a STATIC seed is cached
(`this.__c[n] ??= [ … ]` at any size). A dynamic seed must be rebuilt: `??=` is per
instance while D44 re-seeds on key-reset or hide/show remount, so caching it would show
the first render's values forever. The `islands` stress scenario
([[DOC-STRESS-EXAMPLE]]) therefore still builds 20,000 child vnodes per shell render;
`benchmarks/scenarios.mjs` records why. Open follow-up (on D170, not built): emit a
dynamic seed as a mount-only thunk.

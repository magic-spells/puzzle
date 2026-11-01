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
  - FILE-LIST-BLOCK
  - FILE-COMPONENT-SLOT
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D180-COMPONENT-SLOT
verified_at: '2026-11-01T19:26:46.557Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# ViewManager and ViewNode

`ViewNode` (`views/ViewNode.js`) is the render-tree value: tag, attrs, children,
key, DOM/component links, plus helpers for text, list keys (`keyOf`), slot markers
and placeholders. `ViewManager` (`views/viewManager.js`) mounts, diffs, patches
and tears those trees down; it is the only code that touches the DOM. Satellites:
`html.js` (live-HTML ranges), `flip.js`, `portal.js` ([[FILE-PORTAL]]),
`componentSlot.js` ([[FILE-COMPONENT-SLOT]]), `listBlock.js` ([[FILE-LIST-BLOCK]]).
`renderRev.js` holds only the `RENDER_REV` Symbol, so `store.js` can write it and
the views can read it without importing each other.

## Reconciliation

- **Keyed** children reconcile with moves. Identity is the (tag, key) pair
  compared by SameValueZero through tag-partitioned nested Maps (`oldKeyed`), so
  `1` vs `"1"`, `NaN` and class tags never alias. The duplicate-key detector
  (`seenNewKeys`) is dev-only.
- **Unkeyed** pairing is positional: keep a shell's child list stable and swap
  `{#if}` branches inside a stable wrapper. Codegen pads unequal branches with
  `PLACEHOLDER_TAG` comments. Exception: a vnode object present in both lists (a
  cached subtree shifted behind a variable-length run) always pairs with itself;
  `patchIndexedChildren` detects that and delegates to `patchKeyedChildren`.
- **`sameNode`** = same tag, SameValueZero key, same `island` presence, same
  children shape (string `{#svg}` seed vs array), same `isText`. Anything else is
  a replacement. `isText` is `tag === 'text' && 'value' in attrs`, because an
  authored SVG `<text>` compiles to the same tag.
- **Leaving nodes** (mid out-animation, in `leavingEls`) stay in the DOM; the move
  guard uses `nextPersistentSibling`, so a fade-out never reorders survivors.
- **The replace arm unmounts before it mounts.** A cached row or `__c[n]` subtree
  is the SAME object in both trees, so mounting first would let the outgoing
  unmount destroy the new child. The insertion ref is the first old-range node
  still in the parent afterward, else the sibling captured after the range.
  Reused vnodes also go through `keepOutgoing`/`outgoingOf`: when the new tree
  overwrites a shared vnode's links first, the old side reads a snapshot.
- **Invariant: `newChild.el` is never null at the keyed move guard.** `mount()`
  creates a node for every non-component kind, `unmount()` never clears `el`, a
  component vnode takes `child.element` (its anchor comment exists before the first
  await), and a destroyed instance is routed to a recovery arm before
  `patchComponent`. `tests/keyed-move-el.test.js` pins this.
- Controlled `value`/`checked` re-sync from the new value on every patch,
  including browser-drifted values (`syncControl`, shared with `patchAttrs` and
  `reassertSelectValue`).

## Identity short-circuit ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]])

When old and new vnode are the same object, `patch()` skips the subtree. That is
what makes cached rows and static subtrees free. Three things ride with it: a
live component's `el` is refreshed from the instance (a child may replace its
root); a component vnode with no live instance falls through to recovery; and
controlled values are re-asserted from the row's `controls` list. An owner whose
`__walk` flag is set walks reused element vnodes for one render instead, so a
failed child under a cached row is reached.

Because vnodes are reusable, `mountComponent` treats a pinned destroyed
`vnode.instance` as absent, and ordinary `unmount` nulls `vnode.component`/
`instance`. The two error branches keep their links on purpose (D115).

List rows come from `listRows` (`listBlock.js`): one row state per key holding
the item, index, record revision, handler scope, cached subtree and nested blocks.
Row-cache rules are [[DOC-SPEC-TEMPLATE]] §28.

## Components

Component vnodes render inline, no wrapper. Same class + key reuses the instance;
changed props rerun `data()`, slot-only changes only rerender.

- **Prop bailout** (`propsEqual`, [[DECISION-D62-HANDLER-CACHING]],
  `tests/component-prop-bailout.test.js`): shallow `!==` with a key-count guard
  (present-but-`undefined` ≠ absent; `NaN` never bails out). A value carrying a
  numeric `RENDER_REV` (a store record) is also compared against the child's
  `__propRevs` snapshot; records mutate in place, so the snapshot lives on the
  child, never on the old props.
- **Mount failure** ([[DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT]]):
  `mountComponent` chains the enter with a two-argument `then(ok, fail)`. `fail`
  destroys the instance, leaves a comment placeholder (`__failedPlaceholder`) and
  nulls the vnode links. A trailing `.catch` would also catch a throwing
  `viewWillShow` and tear down a healthy child. Recovery keys off the instance
  (`component == null || component.isDestroyed`), since a same-turn re-render may
  have moved it to a new vnode.
- **Error view** (D145): the failed position hosts a fresh `errorView`; retry
  destroys it and refreshes the parent, reaching the same recovery arm.
- **Unmount leave gate** is `child.__isMounted && (animations.out || __hasHideHooks)`.
  Keep `__isMounted` first: a never-mounted child takes the synchronous `destroy()`.
- **`treeUnknown`**: when a patch throws partway, later diffs against that tree are
  forbidden; `renderFresh` releases both aborted trees (instances, refs,
  `outside` listeners, portals), clears only the manager's range and mounts fresh.

## Runtime component selection ([[DECISION-D180-COMPONENT-SLOT]])

`dynamicComponent` wraps the selected component vnode in a `COMPONENT_SLOT_TAG`
(`#component`) range between two comments: one sibling position whether empty or
filled. Keyed moves, replacements and error recovery resolve the range's complete
end recursively (`moveComponentSlot`, `lastNode`), including when a component's
own root is such a range. Same constructor → normal `patchChildren` /
`patchComponent`. A changed `attrs.selected` unmounts the old child immediately,
before mounting the new one, even when an out animation would delay ordinary
removal; removing the whole range takes the child's normal hide/leave path.
Named-slot metadata stays on the outer range; `stripSlotAttr` clones the selected
child without it. Gated by `__PUZZLE_HAS_COMPONENT_SLOT__`.

## Composition markers

`SLOT_TAG` + the shared `expandSlots` (also used by SSG/static): `<Children/>` →
default bucket, `<Slot name>` → named, `<Slot/>` → router outlet; `SNIPPET_TAG`
children form a bucket keyed by `fits`. Semantics: [[DOC-SPEC-TEMPLATE]] §24/§64.

- **One helper, `fill(out, nodes, marker, parts)`.** The "filled" test (any node
  but a placeholder or whitespace-only text) runs only when the marker has a
  fallback. Without one, supplied nodes splice as-is, placeholders included;
  dropping them would shift every later unkeyed sibling. The compiled fallback is
  the lazy `attrs.fallback` thunk, stored in the marker's `children` so a reused
  marker keeps its vnodes.
- **Routed pins survive a missing outlet.** Each outermost pass records routed
  pins found in `slotChildren`; unmount, subtree release and owner `clear()` park
  a recorded pin off-document instead of destroying it, and the next mount adopts
  it (no second mount or enter). Every outlet that reaches a pin marks it placed,
  so a wrapper torn down later in the pass can't park it again. Superseded routed
  views are still torn down by the router.
- Takeover mounts a pre-expanded tree without re-expanding it (`slotsExpanded`,
  behind `__PUZZLE_TAKEOVER__`).
- A marker makes its subtree dynamic, so `expandSlots` never clones a cached
  static subtree.
- A `#`-prefixed metadata tag reaching element creation or the SSG serializer
  throws `metadataTagError`. The build already rejects a scanned `.pzl` that needs
  a compiled-out feature, so this throw means vnodes from pre-compiled component
  JavaScript the usage scan never read ([[DECISION-D89-FEATURE-USAGE-TREESHAKE]]).

## Host behavior

- SVG namespaces / `foreignObject`; per-node listeners; event modifiers. A spent
  `once` keeps only the `ONCE_SPENT` marker (`'\x00once'`: write the escape, never
  a literal NUL, or git treats the file as binary).
- `outside` listens on `document` in the capture phase with one shared options
  object; `releaseSubtree` sweeps those listeners on every removal shape.
- `passive` / `capture` ([[DECISION-D187-PASSIVE-CAPTURE]]) become native listener
  options in `setAttr`; `detachListener` removes a capture listener with `true`.
  Gated by `__PUZZLE_HAS_LISTENER_OPTIONS__`.
- Islands: children seeded once, never patched; own attrs/listeners still patch
  ([[DECISION-D44-DOM-ISLANDS]]). Only a static seed is cached; a dynamic seed is
  rebuilt every render, because D44 re-seeds on remount. Inline SVG uses the island
  path with string children.
- `@@name` (an `@name` literal inside a `{#raw}` block) is attached as a
  parser-created `Attr` node, behind `__PUZZLE_HAS_RAW_AT__`.
- `setAttr` (mirrored by `ssg/serialize.js`) omits `false`/`null`/`undefined` and
  plain objects (dev warning) and joins arrays with spaces via `displayValue`. URL
  safety is the compiler's `urlValue` wrapper
  ([[DECISION-D186-DYNAMIC-URL-SAFETY]]), not this layer.
- **Live HTML** (`HTML_TAG = '#html'`, `views/html.js`): the one vnode owning
  several DOM nodes; `el` is an empty comment first, `vnode.nodes` follow. Mount
  parses sanitized markup through an inert `<template>`; patch keeps `nodes` when
  value/br are unchanged; moves reuse `moveComponentSlot` with the `htmlTail` end.
  Every branch carries the `__PUZZLE_HAS_RAW_HTML__` probe inside its own
  condition; hoisting it kept the helpers alive in bundles without `raw()`.
- **FLIP** (`flip.js`): First-measure before removals (prior Puzzle flips cancel
  after measuring, tracked in a WeakMap, never `getAnimations()`), patch,
  Last-measure, play a no-fill translate. Behind `__PUZZLE_HAS_FLIP__`.
- **Portals**: bookkeeping in `portal.js`, every call behind
  `__PUZZLE_HAS_PORTAL__`; compiled-out Portal vnodes degrade to inert comments.
- Dev-only render instrumentation lives in [[FILE-DEVPERF]].

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
notes:
  - kind: gotcha
    text: >-
      Leaving animated nodes remain temporarily in the DOM. Move guards skip
      them when locating the next persistent sibling, so a fade-out cannot
      reorder surviving keyed rows.
  - kind: gotcha
    text: >-
      Edit-time trap: the keyed-map separator must be the `\x00` escape sequence in
      source, not a literal NUL byte — a literal NUL makes the file binary to git.
verified_at: '2026-07-22T00:04:08.069Z'
---

# ViewManager and ViewNode

`ViewNode` is the pure render-tree value: host/component tag, attrs, children,
key, DOM/component links, plus helpers for text, primary-key-aware list keys,
slot markers, and invisible placeholder markers. `ViewManager` mounts, diffs,
patches, and tears those trees down.

The patcher provides real keyed reconciliation with moves and positional
unkeyed pairing; tag mismatches replace in place. Because unkeyed pairing is
positional, keep a shell's child list stable across `data()` transitions and swap
`{#if}` branches inside a stable wrapper. Known limitation: the move-guard
dereferences `newChild.el` without a null check, so a paired component vnode whose
instance was destroyed out-of-band hard-crashes navigation instead of degrading (a
defensive null-skip was considered but deferred). Conditional codegen pads
unequal branches with `PLACEHOLDER_TAG` vnodes, mounted as empty comments, so a
toggle cannot shift and remount unrelated trailing siblings. Controlled form
properties sync from the new value every patch, including browser-drifted
values.

Component vnodes render inline with no wrapper. Same class+key reuses the
instance; shallow-different props rerun `data()`, while slot-only changes only
rerender. Async mounts use comment anchors and resolve insertion references from
the live element to survive parent updates.

Composition uses `SLOT_TAG` and shared `expandSlots`: `<children/>` fills the
default bucket, `<slot name>` fills named buckets with fallback, and `<Slot/>`
is the router outlet by convention. Buckets are null-prototype objects and
forwarding descends through component call-site children while preserving
pinned routed instances.

Host behavior includes SVG namespaces/`foreignObject`, per-node listener
installation and removal, event modifiers with once-spend persistence, ref
callbacks, boolean attrs/properties, and island children seeded once then never
patched. Inline SVG uses the same island path with verbatim string children.
The `outside` modifier (D86) attaches its listener to `document` in the
CAPTURE phase (one shared options object for add/remove so the capture flags
can't mismatch); the containment gate runs before every other modifier step,
and `releaseSubtree` sweeps outside-flagged LISTENERS entries on every removal
shape — the map is the authoritative record, so double-detach is impossible.

Keyed reorders FLIP-animate (D85, `views/flip.js`): a `flip` directive attr
(stripped like `key`/`island`/`ref`) marks row roots; `patchKeyedChildren`
First-measures retained candidates before its removal pass (rects capture
mid-flight transforms; prior Puzzle-owned flips cancel AFTER measuring, via a
WeakMap — never `getAnimations()`), patches unchanged, then Last-measures and
plays a no-fill translate to rest. Reduced motion, missing WAAPI, flip-free
lists, and unchanged order cost no measurements; unkeyed `flip` warns once.

Teardown destroys nested component instances, unsubscribes views, removes
listeners/refs, and tolerates failing leave hooks. All DOM links transfer to the
next vnode tree so repeated patches remain live.

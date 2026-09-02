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
      Leaving animated nodes remain temporarily in the DOM. Move guards skip them when locating the
      next persistent sibling, so a fade-out cannot reorder surviving keyed rows.
  - kind: gotcha
    text: >-
      Edit-time trap: the keyed-map separator must be the `\x00` escape sequence in source, not a
      literal NUL byte — a literal NUL makes the file binary to git.
  - kind: state
    text: >-
      Keyed reconciliation + failed-mount hardening (2026-07-24). (1) Keyed identity is now the
      (tag,key) pair compared by NATIVE SameValueZero via tag-partitioned nested Maps (oldKeyed:
      Map<tag,Map<rawKey,child>>, seenNewKeys: Map<tag,Set<rawKey>>), replacing the `child.tag +
      '\x00' + child.key` string concat. Concatenation collapsed keys differing only by type (`1` vs
      `"1"`, `NaN`, `true` vs `"true"`) and stringified component class tags to their source —
      unmounting a live row, aliasing two logical rows onto one DOM node, and false-positiving
      warnDuplicateKey. (2) sameNode() also uses SameValueZero (`a.key===b.key || (a.key!==a.key &&
      b.key!==b.key)`) so a NaN key self-matches instead of being replaced every render. (3) Failed
      FIRST mount: mountComponent's .catch now destroys the dead instance, leaves a bare comment
      placeholder at the position, and nulls vnode.component/instance; patch() mounts a FRESH
      instance when oldVnode.component==null; unmount drops the leftover placeholder. D145 now
      extends that position ownership with a fresh app-level error view and explicit retry while
      preserving the no-errorView parent-patch recovery. Tests: tests/error-boundaries.test.js and
      tests/keyed-reconciliation.test.js.
    sha: d9591d6
  - kind: verified
    text: >-
      Re-verified at 1400ec6 to cover the D89 paragraph (flip.js bundled only when used, 2 inlined
      probes post-reduction, detection covers component props) appended to this card's body — prior
      stamp (d9591d6) predated that paragraph.
    sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: state
    text: >-
      Refines the metadata-tag sentence in the composition paragraph (2026-08-30): the THROW is
      ungated in every build, as written, but the EXPLANATION is development-only.
      `metadataTagError(tag)` (views/ViewNode.js) builds the long D89 paragraph behind the inline
      `__PUZZLE_DEV__` probe and returns `[puzzle] metadata tag "<tag>" reached the DOM (compiled
      out)` in production, because shipping the prose everywhere cost ~190 B gzip per app. The
      `startsWith('#')` checks in mount() and ssg/serialize.js are unchanged and stay outside every
      gate.
  - kind: gotcha
    text: >-
      unmount()'s leave branch is gated on THREE things, not two: an out animation or a hide hook,
      AND a completed mount (child.__isMounted). The third was added in 0.7.0's pre-release review.
      Reading only the first two routed a child whose async data() was still pending through
      destroyAnimated(), firing the full hide bracket for a view that never fired
      mounted()/viewWillShow()/viewDidShow(). A never-mounted child takes the instant, synchronous
      destroy() — the 0.6.0 timing, and the timing every non-animating removal already had. Keep the
      gate first in the condition: it is the cheap check and it is the one that preserves
      synchronous teardown.
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
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

`patchComponent`'s `shallowEqual` bailout is regression-covered by
`tests/component-prop-bailout.test.js`, which pins both directions of the
[[DECISION-D62-HANDLER-CACHING]] measurement at test scale: with stable props
one changed child re-renders and its siblings do not; with a freshly allocated
callback prop per row every child re-runs `data()` for the same single DOM
mutation. Before those tests nothing asserted the bailout fired, so weakening it
would have been invisible — green suite, slower apps. The comparator's exact
contract is pinned too, through the real patch path rather than a direct import:
the key-COUNT guard is what makes a present-but-`undefined` key differ from an
absent one; values compare by strict `!==`, so a `NaN` prop never bails out
(unlike `sameNode`, which compares keys by SameValueZero on purpose) while `+0`
and `-0` do bail out; and equal key counts with disjoint all-`undefined` key
sets compare equal, because key sets themselves are never compared.

`mountComponent` chains the enter animation onto the mount promise with a
**two-argument** `then(onFulfilled, onRejected)`, not a trailing `.catch()`. The
distinction is load-bearing: the rejection handler is the mount-failure recovery
path (destroy the dead instance, leave a bare comment at the position, null the
vnode's instance links so `patch()` mounts a fresh one — otherwise
`patchComponent` reuses a broken instance forever, `mounted()` never fires and
`setData()` is inert). A single trailing `.catch()` cannot tell that apart from a
rejected `playIn()`, so a user `viewWillShow`/`viewDidShow` that threw tore down
a component that had already mounted, painted, and subscribed. `playIn()` now
carries its own `Promise.resolve(...).catch(log)` — the enter-side mirror of
`destroyAnimated()`'s leave-hook guard, and the same idiom the router's
`#playInLogged` uses.

For D145 failures, the failed instance retains the ordinary parent view while a
fresh app error view occupies the D115 marker. Same-identity patches transfer
the replacement and removal destroys it. Component retry destroys the error
view, exposes the destroyed-instance/placeholder state again, and calls the
parent's normal `refresh()`; the newly rendered vnode reaches `patch()`'s
existing recovery arm and mounts a fresh child with current props and slots.
There is no captured-vnode reconstruction path.

Since [[DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT]], that recovery keys off
the **instance**, not the mount-time vnode: the handler runs in a microtask, so
a same-turn parent re-render can already have transferred the instance to a new
vnode via `patchComponent` — the handler stashes its placeholder on the
instance (`__failedPlaceholder`), and `patch()`'s recovery test is
`component == null || component.isDestroyed` (the getter, never the
always-truthy `destroyed` hook method) with an attached-only insertion-ref
guard. Router-preloaded instances now use the same exact-position replacement
rule. The Router's committed state identifies them at retry time, forces its
normal same-location navigation with `keep = 0`, and retains failed-chain
bookkeeping rather than exempting teardown.

When a patch throws partway, `treeUnknown` forbids all later diffs against its
lying vnode links. The replacement path releases both aborted trees (nested
instances, refs, document `outside` listeners, portals), clears only the
bracketed manager range, plants the stable marker, and mounts fresh. Healthy
paths retain the normal diff.

Composition uses `SLOT_TAG` and shared `expandSlots`: `<Children/>` fills
the default bucket, `<Slot name="x"/>` fills named buckets, and `<Slot/>` is
the router outlet by convention. An unfilled marker expands its fallback
children — supplied content wins completely — and contributes no nodes when it
has none (D141).
`SNIPPET_TAG` children form a third bucket keyed by `fits`; an args-bearing
marker calls the matching Snippet function for fresh vnodes on every stamp.
Development diagnoses shape mismatches, plain fills for args-bearing markers,
and defensive marker vnodes in function output — there is no unused-snippet
warning, because a marker inside a false `{#if}` or an empty `{#for}` is not
visited either and the observation reported both as one. Hybrid and static
takeover preload against an expanded tree and mount that exact tree without
expanding it again, preserving pinned component instances; that `slotsExpanded`
branch of `render()` sits behind the inline `__PUZZLE_TAKEOVER__` probe, and
`renderFresh()` — recovery only, never handed a prepared tree — always expands.
Buckets are null-prototype objects and forwarding descends through component
call-site children while preserving pinned routed instances. Any reserved
`#`-prefixed metadata tag that survives expansion and reaches element creation
(or the SSG serializer) throws the shared `metadataTagError` diagnostic, ungated
in every build: the only way one gets there is a vnode from a build the D89
usage scan could not read (see [[DECISION-D89-FEATURE-USAGE-TREESHAKE]]), and a
DOM `InvalidCharacterError` named none of that.

Host behavior includes SVG namespaces/`foreignObject`, per-node listener
installation and removal, event modifiers with once-spend persistence (the
spend also detaches the listener and drops its map entry; the spent marker
alone survives patches, so `setAttr` refuses to re-attach a spent `once`
binding until an explicit removal resets it — D38 semantics, zero listener
cost after the spend), ref callbacks, boolean attrs/properties, and island
children seeded once then never patched. Inline SVG uses the same island path with verbatim string children.
The `@@name` private vnode key emitted for an `@name` attribute inside a D150
raw block bypasses listener handling and attaches the literal attribute. HTML
parsing accepts `@` names while `setAttribute` rejects them, so first mount
attaches a parser-created `Attr` node; later patches update its value directly
and removal uses the authored name. D89's `__PUZZLE_HAS_RAW_AT__` gate wraps
both `@@` branches and the helper reference, so apps with no raw block drop the
shim; the scan deliberately enables it for every raw block, not only ones whose
body currently contains `@`.
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

`flip.js` is bundled only when used (D89): the `beginFlip` and `playFlip` call
sites — the two that reference the import — sit behind an inlined
`typeof __PUZZLE_HAS_FLIP__ …` probe the compiler folds when no template carries
a `flip` attr, dropping the module. The `'flip' in attrs` detection itself is
intentionally un-probed (it holds no import alive, so gating it would only skip
an `in` check). Detection covers component props too, not just element attrs.

Portal range/outlet bookkeeping lives in `views/portal.js`. ViewManager keeps
only the `PORTAL_TAG` integration branches, and every call imported from that
module carries D89's full inline `__PUZZLE_HAS_PORTAL__` probe. Compiled-out
Portal vnodes degrade to inert local comments with a one-shot dev warning;
outside listeners use ordinary physical containment when the bit is false.

D121 instruments actual DOM write/insert/remove/move sites and component-props
bailouts during `ViewManager.render`. Nested component render scopes attribute
mutations to the innermost render; a zero mutation delta is the durable
wasted-render definition. The collector and all per-view state live in
[[FILE-DEVPERF]], not on ViewManager.

Teardown destroys nested component instances, unsubscribes views, removes
listeners/refs, and tolerates failing leave hooks. All DOM links transfer to the
next vnode tree so repeated patches remain live.

## Measured: `island` saves patching, not allocation

The island branch runs inside `patch()`, which is reached only **after**
`render()` has already built the entire new tree — so an island's children are
constructed on every render and then thrown away
(`newVnode.children = oldVnode.children`). [[DOC-STRESS-EXAMPLE]]'s `islands`
scenario puts a number on both halves over 600 shell renders across 100 islands
of 200 descendants each: **0** DOM mutations below an island boundary (measured
with a real `MutationObserver`, with the shell's own 600 mutations as the
control, so the zero means something), and **20,000 of 20,000 child vnodes
rebuilt per render** — 12,000,000 across the window, counted by read-counting
getters on each descendant rather than inferred from the source. Cost is ~8.7ms
per shell render in a production bundle while holding 20,000 frozen nodes, and
the same assertions hold in the minified bundle, which matters because it takes
a different path through the DCE'd devperf branches.

So the [[DECISION-D44-DOM-ISLANDS]] contract holds exactly, and its price is
allocation: islanding a large subtree to avoid patch cost still pays full
construction every render.

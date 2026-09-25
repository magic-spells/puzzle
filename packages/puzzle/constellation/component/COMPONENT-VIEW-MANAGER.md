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
  - kind: gotcha
    text: >-
      `isText` is `tag === 'text' && 'value' in attrs`, not the bare tag test: an authored SVG
      `<text>` element compiles to the same `'text'` tag (codegen has no reservation) and used to be
      silently mounted, patched and serialized as an empty text node — every element, attr and child
      dropped, with only an "undefined template value" warning. The `value` attr is the
      discriminator because the text-node marker always carries it and SVG `<text>` never does
      (`in`, not `!== undefined`, so interpolating `undefined` stays a text node). `sameNode`
      identity now also includes `isText` and child ownership (`typeof children === 'string'`): a
      `{#svg}` seed and authored `<svg>` markup at the same position are a replacement in both
      directions (string→array used to throw `oldChildren.some is not a function` inside
      patchChildren and mark the tree unknown; array→string overwrote via innerHTML without
      releasing refs/outside listeners), exactly like the `island` flip. Pinned by
      `tests/svg-text-element.test.js` and the seed↔markup case in `tests/inline-svg.test.js`.
  - kind: state
    text: >-
      0.7.0 size cleanups: the duplicate-key detector in `patchKeyedChildren` (`seenNewKeys:
      Map<tag, Set<rawKey>>` + `warnDuplicateKey`) is dev-only — lazily allocated behind the inline
      `__PUZZLE_DEV__` probe, so a production keyed patch allocates neither the Map nor its Sets and
      the helper plus its once-state tree-shake away (before this, `Drop: console` stripped the warn
      call but the bookkeeping ran on every keyed patch with no reader). `ViewNode.keyOf`'s
      `warnNullKey` and animate.js's `warnOnce` / PuzzleView's six `warnOnceForSpec` sites carry the
      same probe. `oldKeyed` is unchanged and still production.
  - kind: gotcha
    text: >-
      2026-09-11 — patch()'s REPLACE arm unmounts before it mounts. Vnodes stopped being single-use
      with D170: a list-block row and a `this.__c[n]` static subtree are the SAME OBJECT in the
      outgoing and the incoming tree, so mounting first overwrote that object's `component`/`el`
      with the new instance and element, and the outgoing unmount then destroyed the NEW child
      (leaking the old one's subscriptions) and swept the NEW element's document-level `outside`
      listeners. The insertion ref is captured before the unmount (`anchor` = the live component
      element or `vnode.el`, plus its `nextSibling`) and resolved after it: a still-connected anchor
      is used, which keeps an element animating out (D58/D85 `destroyAnimated`, in `leavingEls`)
      receiving the replacement BEFORE it exactly as before, and a synchronous removal falls back to
      the captured next sibling when it is still under the same parent. The keyed patcher already
      unmounted first and is untouched. Pinned by tests/patch-replace-ordering.test.js.
  - kind: state
    text: >-
      0.8.0, D173 V14/V9/V6. "Unfilled" in the composition paragraph now means the supplied content
      renders no node other than whitespace-only text: `isFilled(nodes)` in viewManager.js skips
      `PLACEHOLDER_TAG` vnodes (a false call-site `{#if}`'s arity padding) and text vnodes whose
      value has no `\S`, and counts every element or component. It gates all four `expandChildList`
      arms: the plain default/named bucket, the args-less plain arm, the D71 forwarding arm (an
      unfilled position forwards the wrapper marker's own fallback), and each snippet stamp (a stamp
      returning nothing expands the fallback for that stamp). A text vnode's value is tested raw
      because codegen always hands it display text. Filled content is still spliced as-is,
      placeholders and whitespace included, so the D170 identity short-circuit and cached rows are
      untouched; an unfilled bucket's placeholders are dropped in favour of the fallback. SSG/static
      share `expandSlots`, so prerender output matches without a separate path. setAttr (and
      ssg/serialize.js's serializeAttrs, mirrored) now omits an object value (`typeof value ===
      'object' && !Array.isArray(value)`) alongside false/null/undefined, warning in dev through
      `displayValue(value, name)`, and writes a list joined with single spaces via
      `displayValue(value, 0, ' ')`; controlled `value` (setAttr's PROPS arm, syncControlValue,
      reassertSelectValue, and the serializer's value/select/textarea/option paths) prints the same
      way. Pinned by tests/slot-filled.test.js and tests/display-value.test.js.
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

**A vnode is reusable, and `patch()` short-circuits on identity.** When the old
and new vnode are the **same object** there is nothing to compare — same `el`,
same attrs object, same children array, same instance — so the subtree is
skipped whole. That line is what makes a list block's cached rows and the
compiler's cached static subtrees free to reconcile
([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]). Three things ride with it:

- **A live component's `el` is refreshed** from the instance before returning.
  `patchComponent` re-reads it on every parent render because a child can
  replace its root between renders (a component-mode skeleton whose real root
  has a different tag is the common case), and `patchKeyedChildren` uses
  `newChild.el` as both its move guard and its next insertion ref.
- **A component vnode with no LIVE instance falls through** to the ordinary
  path. A destroyed instance (a failed position holding a placeholder or an
  error view, D115/D145) or a null one (`mountComponent`'s takeover-failed arm)
  is not describing the DOM, and its recovery lives further down `patch()`;
  returning early would strand it forever — a retry could never mount a fresh
  child, and a takeover-failed row would stay blank until its record changed.
- **Controlled form values are re-asserted** from a `controls` list the list
  block collects when it builds a row. `syncControl` is the same live-DOM
  comparison `patchAttrs` and `reassertSelectValue` run, factored out so there
  is one implementation and one contract; a cached subtree without controls
  reads `undefined` and does nothing. Cost is O(controls), not O(row).

Because a vnode can be unmounted and mounted again, `mountComponent` treats a
pinned `vnode.instance` that is already **destroyed** as absent and constructs
fresh (adopting the corpse would mount a view whose destroyed latch makes
`mounted()`, `setData()` and every refresh silently inert), and `unmount` nulls
`vnode.component`/`vnode.instance` on the ordinary teardown branch. The two
error branches deliberately keep their links: the instance-less takeover
placeholder has nothing to null, and a destroyed instance on a FAILED position
is the D115 record of what happened there, which `patch()`'s recovery arms read.

Component vnodes render inline with no wrapper. Same class+key reuses the
instance; different props rerun `data()`, while slot-only changes only
rerender. Async mounts use comment anchors and resolve insertion references from
the live element to survive parent updates.

`patchComponent`'s prop bailout is regression-covered by
`tests/component-prop-bailout.test.js`, which pins the
[[DECISION-D62-HANDLER-CACHING]] measurement at test scale: one changed record
wakes exactly one child while its siblings return cached vnodes and never reach
`patchComponent` at all, and a hand-written freshly-allocated callback prop
still makes every child re-run `data()` for the same single DOM mutation.
Before those tests nothing asserted the bailout fired, so weakening it would
have been invisible — green suite, slower apps. The comparator's exact contract
is pinned too, through the real patch path rather than a direct import: the
key-COUNT guard is what makes a present-but-`undefined` key differ from an
absent one; values compare by strict `!==`, so a `NaN` prop never bails out
(unlike `sameNode`, which compares keys by SameValueZero on purpose) while `+0`
and `-0` do bail out; and equal key counts with disjoint all-`undefined` key
sets compare equal, because key sets themselves are never compared.

`propsEqual` adds one test on top of that shallow compare: a value carrying a
numeric `RENDER_REV` (a store record) is also compared against the **snapshot**
the child wrote the last time props were applied (`child.__propRevs`), and an
advanced revision counts as a changed prop. Records mutate in place, so `!==`
can never see them change; the snapshot lives on the child and is never read off
the old prop object, because after a mutation both sides hold the same
already-advanced record. That is what makes `<TodoItem todo={todo}/>` refresh on
its record's own mutations instead of relying on a freshly allocated callback
prop to do it by accident. A related record or a computed getter's inputs still
require the child to query in its own `data()` ([[FLOW-REACTIVITY]]).

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
call-site children while preserving pinned routed instances. A composition
marker makes its subtree dynamic, so `expandSlots` never clones a cached static
subtree — it clones only the path down to a marker. Any reserved
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
lists, and unchanged order cost no measurements; unkeyed `flip` warns once. A
list block's cached rows change none of this: a reorder hands the patcher the
same vnode objects in a new order, so the moves and the flight are what they
always were.

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

## Measured: `island` freezes patching, and now allocation too

The island branch runs inside `patch()`, so an island's children were built by
`render()` before the patcher ever got the chance to ignore them.
[[DOC-STRESS-EXAMPLE]]'s `islands` scenario put a number on both halves over 600
shell renders across 100 islands of 200 descendants each: **0** DOM mutations
below an island boundary (measured with a real `MutationObserver`, with the
shell's own 600 mutations as the control, so the zero means something), and
**20,000 of 20,000 child vnodes rebuilt per render** — 12,000,000 across the
window, counted by read-counting getters on each descendant rather than inferred
from the source. Cost was ~8.7ms per shell render in a production bundle while
holding 20,000 frozen nodes, and the same assertions held in the minified
bundle, which matters because it takes a different path through the DCE'd
devperf branches.

The zero-mutation half is the [[DECISION-D44-DOM-ISLANDS]] contract and is
unchanged. The allocation half is what [[DECISION-D170-INCREMENTAL-VDOM-LISTS]]
closes **only for a static seed**: an island's children array is a compiler
cache site (`this.__c[n] ??= [ … ]`, or `s.c[n] ??= [ … ]` inside a loop row)
at any size — no three-vnode threshold — when every child is static, because a
static seed is identical on every mount. A DYNAMIC seed (an interpolation, a
`{#for}`, anything reading render state) is still rebuilt every render: `??=`
is per view instance, while D44 re-seeds an island from the template on a
key-reset or hide/show remount, so caching one displayed the first render's
values forever (found by the 2026-09-11 Codex review and reverted the same
day). The element itself may stay dynamic — its own attrs and listeners still
patch. A dev counter (`staticSitesBuilt` in [[FILE-DEVPERF]]) reports how many
cache sites a render had to allocate.

**Measured on the D170 branch** (`islands/shell-renders/20000`, 60 shell
renders, production bundle): `islandChildVnodesPerRender` stays **20,000**, the
pre-D170 number, because the stress scenario's island children are a nested
`{#for}` over plain objects — a dynamic seed. `islandViolations` stays 0 and
`shellDidMutate` stays 1. The bench expect in `benchmarks/scenarios.mjs` records
that number with the reason. Getting it to 0 correctly needs the runtime to own
the seed's lifetime — emit a dynamic island seed as a per-render thunk
(`() => [ … ]`) the runtime evaluates at mount only, one closure per render
instead of N vnodes, re-seeded on every remount; recorded as the follow-up on
D170, not built.

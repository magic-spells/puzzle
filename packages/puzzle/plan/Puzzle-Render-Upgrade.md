# Puzzle Render Upgrade — persistent list blocks and an incremental virtual DOM (0.8.0)

**Status:** proposed plan, not implemented. Written 2026-09-10 against
`release/0.7.1` (`1648790`). Decision card: `DECISION-D170-INCREMENTAL-VDOM-LISTS`
(status `planned`). Replaces the direct-DOM rewrite plan, now archived at
`plan/rejected/Puzzle-Direct-DOM-Rendering.md` with the measurements that
retired it.

**Syntax is unchanged.** No `.pzl` file changes. `data()`, `setData()`,
`refresh()`, events, binding, slots, snippets, portals, animations, keys,
skeletons, SSG, hybrid, the router, DevTools and HMR all keep their current
contracts. What changes is what the compiler emits for `{#for}` bodies and
static markup, plus a few hundred additive runtime lines.

---

## 0. Summary

Puzzle's renderer rebuilds the whole `ViewNode` tree for a view on every
update and diffs it. For a list of N rows that is N×(row vnode allocation +
diff) per parent update whether or not any row changed, and for static-heavy
templates it is thousands of allocations that produce zero DOM writes.

This plan keeps the virtual DOM — the measurements in the archived plan show
it is the most compact encoding of a template, since one description serves
both creation and update — and makes it **incremental**:

1. **`{#for}` compiles to a persistent list block.** Each loop site keeps one
   row state per key: the item, index, a stored record revision, a live scope
   object that handlers close over, and the row's last rendered vnode subtree.
   On a parent render the block returns the **cached vnode subtree** for a row
   whose inputs did not change and rebuilds only the rows that did. The
   existing keyed patcher does the rest, unchanged.
2. **`patch()` short-circuits on identity.** If the old and new vnode are the
   same object, the subtree is skipped (with one carve-out for controlled form
   values). This is the line that makes cached rows and cached static markup
   free to reconcile.
3. **Static subtrees are built once** per instance (and once per row inside a
   loop) instead of on every render. This alone removes the 20,000-vnode
   per-render cost the island measurement recorded.
4. **Records get a render revision** (the store notification sequence of the
   last observable mutation, stored under a Symbol), and a component receiving
   a record prop is compared against a **stored snapshot** of that revision,
   so `<TodoItem todo={todo}/>` refreshes when its record changes and not when
   a callback closure happens to be re-created.
5. **Loop handlers are identity-stable** because they close over the row's
   live scope and read the current item at fire time.
6. **One flush, one `data()` run** for a child that both receives a record
   prop and queries that record.

Expected result for the todos list at 1,000 rows on a single record edit:
one row rebuilt (about a dozen vnodes) and diffed, 999 rows returned by
reference and skipped by the patcher, no static markup rebuilt anywhere in
the view. Runtime cost is a few hundred lines added and nothing deleted;
per-template output grows by a small, measured amount (§11).

---

## 1. Goals, non-goals, and the contract that must survive

### Goals

- A `{#for}` over N model rows costs O(N) key reads per parent render and
  rebuilds/diffs only rows whose inputs changed.
- Static markup is allocated once per instance or row, never per render.
- A record prop invalidates its child on the record's own mutations, with
  identity-stable callbacks that no longer force phantom refreshes.
- Bytes stay honest: per-template output within a small measured envelope,
  runtime growth ≤ ~1 KB gzip, hard gates in §11.
- Nothing outside `viewManager.js`, `PuzzleView.js`, `store.js`, `model.js`
  and codegen changes; SSG/static/hybrid, router, takeover, DevTools, HMR,
  portals, FLIP, animations and error recovery are untouched.

### Non-goals

- Replacing the virtual DOM, compiled direct-DOM output, signals, proxies on
  records, event delegation, hydration, list virtualization, LIS
  reconciliation, loop-local keys, branch remount semantics, skeleton changes.
- Property-level reactivity or automatic observation of direct field
  assignment on records (§7).
- Per-site memoization of dynamic subtrees outside loops (a possible 0.8.x
  follow-up, §12).

### Contract preserved

Everything in `DOC-SPEC-VIEW` and `DOC-SPEC-TEMPLATE`. Specifically: keyed
reconciliation semantics including the shared sibling key namespace, mixed
keyed/unkeyed pairing, null-key positional fallback and the duplicate-key
warning (D58); leaving rows and FLIP (D85); `island` (D44); refs (D72);
implicit binding including IME, numeric and `select` re-assert (D147);
modifiers and `once`/`outside` (D38/D86); slots, fallbacks, forwarding and
snippets (D53/D71/D141/D166); portals (D144); skeletons (D39/D52); the
navigation commit ordering (D19/D61/D146); D145 error recovery; takeover; the
DevTools protocol; HMR state restore.

---

## 2. Why this and not the rewrite

The direct-DOM design was measured on five real templates (three todos
fixtures, the two largest music templates), hand-written in its compiled
shape and minified + gzipped against today's output:

| Render tails, gzip | today | naive compiled | with every emitter lever |
|---|---|---|---|
| Sum of five | 5,121 B | 7,148 B (1.40×) | 6,058 B (1.18×) |
| Concatenated (bundle case) | 3,481 B | 5,282 B (1.52×) | 4,353 B (1.25×) |

The floor is the static HTML string itself (closing tags and attribute syntax
compress worse than `,[])`), plus a ~500 B gzip shared block runtime. Break-even
against the ~2.5 KB runtime saving lands around 13 templates; a 16- or
21-template app grows. The vnode form is smaller because one encoding serves
creation and update. Its cost is CPU and allocation per update, and this plan
removes most of that cost without changing the encoding.

---

## 3. Design

### 3.1 The identity short-circuit in `patch()`

```js
export function patch(oldVnode, newVnode, parent, ctx, owner = null) {
	if (oldVnode === newVnode) {
		if (newVnode.controls) reassertControls(newVnode.controls);
		return;
	}
	if (!sameNode(oldVnode, newVnode)) { … }   // unchanged from here
```

Same object means same `el`, same attrs object, same children array, same
component instance: there is nothing to compare. The one thing today's patcher
does on every pass even when nothing changed is re-assert controlled form
properties against the live DOM (`patchAttrs` for `value`/`checked` on
`INPUT`/`TEXTAREA`, `reassertSelectValue` after children). A cached subtree
that contains controlled form values keeps that contract through a small
`controls` list collected when the subtree is built (§3.2, §3.3); a cached
subtree without controls has nothing to re-assert.

Two guards ride with this: `mountComponent` ignores a pinned `vnode.instance`
that is already destroyed (a cached component vnode can be unmounted by a
branch toggle and mounted again later), and `unmount()` nulls
`vnode.instance` and `vnode.component` for the same reason.

### 3.2 List blocks

**Emission.** Today an item-form loop compiles to
`items.map((todo) => new ViewNode(…))` spliced into the parent's children.
It becomes a call into a per-site block that returns the same kind of array:

```js
// module scope: static facts about the site
const __L0 = { key: (todo) => ViewNode.keyOf(todo), roots: 0, ctrl: false, counter: false };

// inside render(), at the loop position (unchanged surroundings)
this.__list(this, 0, __d.filteredTodos, (s) =>
	new ViewNode(TodoItem, {
		key: s.k,
		todo: s.item,
		remove: (s.h0 ??= (event) => this.events.deleteTodo(s.item)),
	}, []),
__L0)
```

The returned array is spliced exactly where the `.map()` result was, so the
keyed patcher, mixed keyed/unkeyed pairing, leaving rows, FLIP and the shared
sibling key namespace all behave as they do today. The block only decides
**which vnode objects** appear in that array: cached or freshly built.

**Row state.** The scope object `s` the factory receives *is* the row state:

```js
{ k, item, i, rev, vnode, controls, gen, h0…hN, c: [], lists: [] }
//  key, current item, index, stored revision, cached subtree, controlled
//  vnodes inside it, visit stamp, cached handlers, static caches, nested blocks
```

Handlers and nested caches live on the row, so a row that is rebuilt keeps
its handlers, its static subtrees and its nested list blocks.

**Algorithm, per render:**

```text
block = owner.lists[id] ??= { rows: Map, gen: 0 }
gen = ++block.gen; d = view.__dirty
for (i, item) of items:
    k = meta.key(item, i)
    if k == null            → build uncached (positional row, today's semantics + warn-once)
    row = block.rows.get(k)
    if row && row.gen === gen → duplicate key this render: warn (dev), build uncached
    if !row                 → row = new RowState(k); rows.set(k, row); dirty = true
    else dirty =
        row.item !== item                                // replaced or plain object (always)
     || (isRecord(item) && item[RENDER_REV] !== row.rev)  // record changed since last build
     || (meta.counter && row.i !== i)                     // body reads the index
     || (d & meta.roots) !== 0                            // a parent field the body reads changed
    row.item = item; row.i = i; row.rev = isRecord(item) ? item[RENDER_REV] : 0; row.gen = gen
    if dirty: row.vnode = factory(row); if meta.ctrl: row.controls = collectControls(row.vnode)
    out[i] = row.vnode
drop every row whose gen !== gen        // its vnode leaves the tree; the patcher unmounts it
return out
```

Dirtiness rules, spelled out:

- **Plain objects and arrays are always dirty.** They can be mutated in place
  and `refresh()`ed; no revision exists. Their rows rebuild every render, as
  today — but their static subtrees and handlers are still cached on the row.
- **Records are dirty when the reference or the stored revision changed.** The
  revision is stored on the row at build time and compared against the
  record's live revision (§3.4). Same object, advanced revision → dirty.
- **Index** dirties a row only when the body reads the counter.
- **Parent roots** the body reads (`selectedId === todo.id`) dirty the row
  when that root changed this render (§3.6).
- **Relations and computed getters.** A row that reads `todo.author.name`
  or a computed getter depends on data the record's own revision does not
  cover. The compiler emits, per site, the item members read at depth one
  (`fields`) and a `deep` flag for any deeper path or call; at first build for
  a given model class the block checks every field against
  `Model.normalizedSchema()` and `Model.relationshipDefs()`. A site that reads
  a relation, a computed getter, or a deep path is marked **conservative**
  and its record rows are treated as always dirty. Formatters are display-pure
  by SPEC contract and do not affect this. This is the same rule the archived
  plan derived; here it is required, because row caching is the list win.
- **Direct field assignment on a record** (`todo.title = 'x'`) advances no
  revision and is not observed by row caching. It is not observed by the
  store today either — nothing re-renders unless something else does — so
  the contract becomes: mutate records through `update()` or a store path.
  Documented in §7, tested, and consistent with `memo()` deps and the shallow
  prop rule.

**Controlled form values in cached rows.** When `meta.ctrl` is set (the body
contains an `<input>`/`<textarea>`/`<select>` with a `value`/`checked`
attribute), `collectControls` walks the freshly built row subtree once
(skipping component and string children) and records the control vnodes; a
clean pass re-asserts them exactly as `patchAttrs`/`reassertSelectValue`
would. Cost O(controls), not O(row).

**Component rows.** `<TodoItem todo={todo}/>` builds a component vnode per
row. A clean row returns the same vnode → `patch()` short-circuits → the
child is not touched. A dirty row (record revision advanced) builds a new
component vnode with the same key → `patchComponent` → the revision-aware
prop comparison (§3.4) sees the advanced revision → the child refreshes. With
stable callbacks this is the *only* path that refreshes it.

**Nested loops.** Inside a row factory the compiler emits `this.__list(s, id,
…)`: the row is the owner, so inner blocks are keyed per outer row and die
with it. Site ids share the per-file counter with `__h`.

**Range loops** (`{#for 1...n}`) keep today's `Array.from` emission; their
rows are cheap and keyed by value. Snippet bodies are stamped fresh per
expansion today and stay that way.

**When a site is not visited** (its enclosing `{#if}` is false) its rows
persist until the site is visited again or the view is destroyed; the patcher
has already unmounted their vnodes. A cached vnode can be mounted again later
(the two guards in §3.1). Memory is bounded by the data the site last showed.

### 3.3 Static subtree caching

A subtree is static when every vnode in it has only static attributes (event
attributes with cacheable handlers, `ref`, `key`, `island`, `flip` included —
they are per-instance stable), static text, and no control flow, marker,
snippet, portal, component, or dynamic child. The compiler emits the largest
such subtrees through a per-owner cache:

```js
// view level                              // inside a loop body
(this.__c[3] ??= new ViewNode('div', …))   (s.c[1] ??= new ViewNode('svg', …))
```

Rules:

- Cache only subtrees worth caching: three or more vnodes, or an `island`
  element's children (the island case is the one the stress example measured).
  A lone static text or leaf element is not worth the wrapper bytes.
- Not inside snippet bodies (stamped per expansion, no owner to cache on).
- Not a subtree containing a controlled form value with a static value
  (rare; excluded rather than tracked).
- Composition markers make a subtree dynamic; `expandSlots` therefore never
  needs to clone a cached vnode (it clones only the path to a marker).
- `island` children: the element itself may be dynamic; its children array is
  cached as a unit, so an island never allocates its seed twice.

A cached vnode carries live `el` links across renders exactly as the tree it
sits in does today. Unmount leaves a stale detached `el`; a later mount
overwrites it. Site numbering is per file and deterministic (shared with
`__h`), so recompiling an unchanged file is byte-stable.

### 3.4 Record render revision and snapshot prop comparison

**Revision.** `model.js` exports `RENDER_REV = Symbol('puzzle-render-rev')`.
`_instantiate` defines it non-enumerable and writable on every record (hidden
class stable); `Store._notify(type, id)` writes the notification sequence to
the record when present. Every mutation path — `createRecord`, `update()` via
`recordChanged`, `removeRecord`, adapter upserts and save reconciliation —
reaches `_notify` (verified against `adapter.js`), so the revision advances
for every observable change. Symbol keys are invisible to payload merges and
schema-name assertions, so no reserved-name change is needed. The existing
`MUTATION_REVISIONS` (D125) is untouched; it counts local edits only.

**Snapshot compare.** `patchComponent` today does
`shallowEqual(old.props, new.props)`. It becomes
`propsEqual(old.props, new.props, child)`: values compare by `!==` as now,
except a value carrying `RENDER_REV`, which is unequal when its live revision
differs from the snapshot the child stored the last time props were applied
(`child.__propRevs[name]`). The snapshot is written at `mount()` and at every
`applyParentUpdate({ props })`. It is never read off the old prop object —
old and new are the same live record after a mutation.

Contract: a record prop invalidates the child on that record's own mutations.
A change to a related record or a computed getter's inputs still requires the
child to query in its own `data()`, which is what `FLOW-REACTIVITY` documents
today (where a record prop never invalidates at all).

### 3.5 Stable loop handlers via the row scope

Today a handler that captures a loop variable is emitted as a fresh closure
per render (`remove: (event) => this.events.deleteTodo(todo)`), and that churn
is what incidentally refreshes `TodoItem`. The compiler now rewrites loop
locals inside such handlers to the scope object and caches the closure on the
row: `(s.h0 ??= (event) => this.events.deleteTodo(s.item))`. Identity-stable,
reads the current item at fire time, correct after reorders and replacements.

Handlers that read render data (`__d.x`) keep today's fresh-closure emission:
`__d` is a per-render snapshot, so caching such a closure would freeze it.
D62's `__h` cache for data-independent handlers is unchanged.

### 3.6 Root dirty mask

The list block's `d & meta.roots` test needs to know which top-level `data()`
keys changed this render. The compiler emits `Class.__roots = ['selectedId',
…]` — only the roots that some loop body reads, only when at least one does —
and PuzzleView keeps the previous values: before each render it computes
`this.__dirty` (bit i set when `roots[i]` changed: primitives by `!==`,
objects always; all bits on the first render). A view with no `__roots` skips
this entirely. The mask is consumed only by list blocks in 0.8.0.

### 3.7 Flush-sequence dedupe

A child that both receives a record prop and queries that record gets, in one
store flush, a refresh from the parent's `applyParentUpdate` and its own
`onStoreChange`. `Store` exposes the sequence of the batch it is delivering; a
refresh started during delivery captures it and stamps `_settleMark` on
commit, so the child's own `onStoreChange(seq)` takes the existing
`seq <= _settleMark` early return. The D161 mechanism, one more case.

### 3.8 What does not change

`expandSlots`, `mount`, keyed/indexed reconciliation, leaving rows, FLIP,
portals, `setAttr`/`removeAttr`, modifiers, refs, bind, islands, error
recovery (`treeUnknown` and friends), `serialize.js`, `preload.js`, the
static kernel, the router's chain assembly, DevTools' `_vnodeTree()`, HMR.

---

## 4. Compiled shape

### 4.1 `Home.pzl` (todos) — the list

Before:

```js
new ViewNode('div', { class: 'max-h-96 overflow-y-auto' },
  __d.filteredTodos.map((todo) =>
    new ViewNode(TodoItem, {
      key: ViewNode.keyOf(todo),
      todo: todo,
      remove: (event) => this.events.deleteTodo(todo),
    }, [])
  )
),
```

After:

```js
const __L0 = { key: (todo) => ViewNode.keyOf(todo), roots: 0, ctrl: false, counter: false, fields: [], deep: false };
…
new ViewNode('div', { class: 'max-h-96 overflow-y-auto' },
  this.__list(this, 0, __d.filteredTodos, (s) =>
    new ViewNode(TodoItem, {
      key: s.k,
      todo: s.item,
      remove: (s.h0 ??= (event) => this.events.deleteTodo(s.item)),
    }, [])
  , __L0)
),
```

The three static stat cards, the filter buttons' static spans and the
empty-state `<div>` become `(this.__c[n] ??= …)` sites.

### 4.2 `TodoItem.pzl` — statics inside a component

```js
…
new ViewNode('div', { class: 'relative' }, [
  new ViewNode('div', { class: `w-5 h-5 … ${__d.todo.completed ? … : ''}…` }, []),
  ...(__d.todo.completed
    ? [ (this.__c[0] ??= new ViewNode('div', { class: 'absolute inset-0 …' }, [
          new ViewNode('svg', { class: 'w-3 h-3 text-ink', fill: 'currentColor', viewBox: '0 0 20 20' }, [
            new ViewNode('path', { 'fill-rule': 'evenodd', d: '…', 'clip-rule': 'evenodd' }, []),
          ]),
        ])) ]
    : []),
]),
…
(this.__c[1] ??= new ViewNode('button', {
  class: 'ml-3 w-7 h-7 …',
  '@click': ((this.__h ??= {})[0] ??= (event) => this.events.remove(event)),
  title: 'Delete todo',
}, [ new ViewNode('text', { value: '×' }) ])),
```

An explicit key (`<li key={ todo.slug }>`) becomes `key: (todo) => todo.slug`
in the site meta; the body root's `key:` attr is `s.k`. A counter
(`{#for todo in todos, i}`) becomes `s.i` and `counter: true`.

### 4.3 Emission conventions (the byte contract)

These are fixed so the hand-written fixtures, the runtime and the emitter
agree; the todos fixtures under `tests/fixtures/todos/` are the reference
bytes (the D14 discipline: the fixture wins, the compiler matches it).

- **Site meta consts** are emitted after the injected import line, one per
  item-form loop site in source order: `const __L<id> = { key: <arrow> … };`.
  `key` is always present: `(todo) => ViewNode.keyOf(todo)` for the synthetic
  key, or `(todo) => <resolved expr>` / `(todo, i) => …` for an explicit
  `key=` (loop locals stay bare inside the arrow). The other fields are
  emitted **only when non-default**, in this order: `counter: true`,
  `ctrl: true`, `roots: <int>`, `fields: ['a', 'b']`, `deep: true`. The
  runtime reads them with defaults (`false`, `0`, `[]`).
- **The list call** replaces the `.map(…)` expression in place, same
  surrounding layout:

  ```js
  this.__list(this, 0, __d.filteredTodos, (s) =>
    new ViewNode(TodoItem, { … }, [])
  , __L0)
  ```

  Inside a loop body the owner argument is `s` (`this.__list(s, 1, …)`).
- **Loop locals** resolve to `s.item` and `s.i`; the row root's first attr is
  `key: s.k`. Nested loops shadow as today (the inner factory parameter is
  also `s`; the inner body's outer-item reads resolve to the outer scope's
  captured name — the emitter binds the outer scope as `s0`, `s1`, … by depth
  when a body reads an enclosing loop's locals; a body that reads only its
  own locals uses `s`).
- **Row handlers** whose arguments reference only loop locals and `event`
  are emitted `(s.h<n> ??= (event) => this.events.x(s.item))`, `<n>` counted
  from 0 per loop site. Handlers reading `__d.` stay fresh closures.
- **Static caches:** `(this.__c[<n>] ??= new ViewNode(…))` at view level and
  `(s.c[<n>] ??= new ViewNode(…))` inside a loop body; `<n>` counted from 0
  per file at view level and from 0 per loop site inside rows. `PuzzleView`
  declares `__c = []`; the block creates `s.c = []`. Threshold: a maximal
  static subtree of three or more vnodes, or an `island` element's children
  array (cached as the array: `(this.__c[n] ??= [ … ])`). Never inside a
  snippet body; never a subtree containing a controlled `value`/`checked`.
- **`__roots` stamp:** `Class.__roots = ['a', 'b'];` on the line after
  `Class.__pzlModule = …;`, only when some loop meta carries `roots`; bit `i`
  of a `roots` mask is index `i` of this array, roots listed in first-read
  order across the file.
- **Counters** `__h` (D62 handler cache), `__L`, view-level `__c` are three
  independent per-file counters; `render()` and `renderSkeleton()` share each.
- **Wrapper layout:** `(this.__c[n] ??= ` / `(s.c[n] ??= ` is a pure prefix on
  the subtree's first line and `)` a suffix on its closing line; inner lines
  keep their indentation. The prefix counts toward `startCol` in the
  `attrsMultiline` width decision.
- **Nested loops:** the factory parameter is `s` at nesting depth 0 and `s1`,
  `s2`, … at depth 1, 2, …; a body reads an enclosing loop's locals through
  that scope's name (`s.item` from inside `s1`'s body). Handler caches and
  static caches attach to the innermost enclosing scope (`s1.h0`, `s1.c[0]`);
  the inner list call's owner is the enclosing scope (`this.__list(s, 1, …)`).
- **`roots` counts every parent-root read in the body, handlers included.** A
  row handler that reads `__d.mode` stays a fresh closure over the render's
  `__d` snapshot, so the row must rebuild when `mode` changes; the compiler
  adds such roots to the site's mask.
- **`volatile: true`** when any expression in the body references `this`
  (`{ this.ctx.router.current.path }`); the block then treats every row as
  dirty on every pass. Loop-body expressions are otherwise assumed pure.
- **Loops inside a `<Snippet>` body keep today's `.map(…)` emission.** A
  snippet is stamped fresh per expansion, so a block keyed by site id would be
  shared between stamps.
- **Range loops** keep today's `Array.from` emission everywhere.
- Reserved on instances: `__list`, `__lists`, `__c`, `__dirty`, `__propRevs`;
  reserved on classes: `__roots`. Module-scope reserved: `__L<n>`.

---

## 5. Compiler changes

All inside the existing emitter; no IR, no second target.

- **`expr.go`:** `resolveExprTrackingScope` already reports scope references;
  extend it to return the set of root names prefixed and the set of scope
  locals read. This feeds `roots` masks, `fields`/`deep`, static-subtree
  detection, and the handler rewrite.
- **`codegen.go` loops (`emitFor`, `forBody`):** item-form loops lower to the
  `__list` call with the site meta const; loop locals in the body resolve to
  `s.item`/`s.i` (via the scope map, which already carries the names); the
  synthetic key or the explicit key expression becomes the meta `key` arrow;
  `counter`, `ctrl`, `fields`, `deep` computed from the body; nested loops
  pass `s` as owner. Range loops unchanged.
- **Handlers (`compileEventHandler`):** in a loop body, a call form whose
  arguments reference only loop locals (and `event`) is emitted as the
  `s.hN ??=` cached form with locals rewritten; arguments referencing `__d.`
  keep the fresh closure. `hN` numbering is per site.
- **Static subtree detection:** a bottom-up pass over processed children marks
  static subtrees; `emitElement` wraps a maximal qualifying subtree in the
  owner cache (`this.__c[n]` at view level, `s.c[n]` in loop bodies, none in
  snippet bodies). Site numbering shares the per-file counter.
- **Roots stamp:** emit `Class.__roots = [...]` after `__pzlModule` when any
  loop body reads parent roots.
- **Reserved names:** `__list`, `__c`, `__roots`, `__lists`, `__dirty`,
  `__propRevs` join `__h`/`__d`/`__f` in `scriptcollide.go`'s reserved-binding
  check and in SPEC §4.
- **Goldens:** every loop and static-heavy golden regenerates; the todos
  fixtures are rewritten **first** by hand and the emitter matched to them.
- `puzzle check`, the WASM playground core, the a11y and formatter scans,
  `binding.go`: unchanged (the emitted expressions are the same; only their
  scope names and wrappers move).

---

## 6. Runtime changes

| File | Change |
|---|---|
| `views/viewManager.js` | `patch()` identity short-circuit + `reassertControls`; `propsEqual` with revision snapshots in `patchComponent`; `mountComponent` ignores a destroyed pinned instance; `unmount` nulls `instance`/`component`. ~60 lines. |
| `views/listBlock.js` (new) | `RowState`, the algorithm in §3.2, `collectControls`, the schema eligibility check, null/duplicate key policy, dev counters. ~150 lines. |
| `views/PuzzleView.js` | `__list(owner, id, items, factory, meta)` delegating to the block; `__c` per-instance cache array; `__lists`; `__dirty` computed from `constructor.__roots` before each render; `__propRevs` written at mount and `applyParentUpdate`; `_settleMark` stamp from the delivering flush. ~60 lines. |
| `datastore/store.js` | `_notify` writes `RENDER_REV`; `_deliveringSeq` during `_deliverNotifications`. ~10 lines. |
| `model.js` | `RENDER_REV` Symbol, defined at `_instantiate`. ~8 lines. |
| `devperf.js` | counters: rows cached / rebuilt / conservative, static cache hits, controls re-asserted. Dev-only. |
| `index.js`, `types/index.d.ts` | nothing public changes. |

Estimated runtime growth: ~1 KB gzip (measured in Phase 0).

---

## 7. Behavior changes and contracts

1. **Record props are revision-compared.** A child receiving a `PuzzleModel`
   prop refreshes when that record mutates through any store path, even
   though the reference is identical. A child that displayed a *related*
   record's field from a record prop and relied on callback churn to refresh
   will now need to query the record in its own `data()` — the documented
   idiom, which keeps working. `component-prop-bailout.test.js` pins D62's
   "fresh callback per row re-runs every child" measurement and is updated
   deliberately: with stable handlers, one changed record refreshes one child.
2. **Row caching contract.** Rows of records are cached on (reference,
   stored revision, index if read, parent roots read). A record mutated by
   direct field assignment is not observed; mutate through `update()` or a
   store path, or the row updates the next time something dirties it. Plain
   objects never cache. Sites reading relations, computed getters or deep
   paths are conservative and never cache their record rows.
3. **Controlled inputs in cached rows** are re-asserted from the control list
   on every pass — the same contract as today, by a different route.
4. **Loop handlers are identity-stable** and read the current item at fire
   time.
5. **Static subtrees and island children allocate once.** No observable
   change beyond allocation and the DevTools profiler's `tree built` span.
6. Nothing else: keys, sibling namespace, branches, skeletons, slots,
   portals, animations, SSG output (byte-identical), takeover, router,
   DevTools protocol, HMR.

---

## 8. Walkthroughs

**A. `todo.update({ completed: true })`, 1,000 todos, todos Home.** `_notify`
stamps the record's revision; flush → Home `onStoreChange` → `data()` →
commit → `__dirty` (Home's loop reads no parent roots, so no `__roots`) →
`render()`: the header, stats and buttons rebuild their few dynamic vnodes
(static subtrees return from `__c`); `__list` walks 1,000 items: 999 rows
clean (same reference, same stored revision) → cached component vnodes; one
row dirty → new component vnode with the same key and the same cached
`remove` handler. Patch: 999 identity short-circuits; one `patchComponent` →
`propsEqual` sees the advanced revision → `TodoItem.refresh({ props })` →
its `data()` → its render (its static check-icon and delete button come from
its own `__c`). If `TodoItem` also queried the record, its own
`onStoreChange(seq)` is skipped by the `_settleMark` stamp.

**B. `setData('currentFilter', 'active')` + `refresh()`.** `data()` re-runs,
`filteredTodos` is a new, shorter array. `__list`: retained rows clean →
cached vnodes; missing rows dropped → the patcher unmounts them through the
existing leave path (out animation, `leavingEls`); nothing rebuilt.

**C. Reorder (sort change).** All rows clean; the block returns the cached
vnodes in the new order; the keyed patcher moves elements and FLIP plays
exactly as today.

**D. Same key, replacement record (delete + recreate).** `row.item !== item`
→ dirty → rebuilt; `patchComponent` sees a different reference → child
refreshes. Handler `s.h0` reads `s.item` → the new record.

**E. Plain-object rows (`items.map(i => ({ id, label }))`).** Every row dirty
every render (as today), but each row's static subtrees and handlers are
reused from the row state, so allocation drops to the dynamic vnodes.

**F. A row body reading `todo.author.name`.** The compiler emits `deep: true`;
the site is conservative: record rows rebuild every render (today's cost,
minus static subtrees). No correctness dependence on the revision.

**G. Branch toggle around a list.** Site not visited → rows persist, vnodes
unmounted. Toggle back → rows found, clean → cached vnodes mounted again;
`mountComponent` sees a destroyed pinned instance and constructs a fresh one.

**H. Takeover (hybrid/static).** `render()` at takeover produces cached
vnodes like any other render; `preload.js` pins nested instances on them;
later renders return the same objects → short-circuit. Unchanged path.

---

## 9. Phases

Fixture-first, small, in `release/0.8.0`. Opus builds the runtime, Codex the
Go changes, Opus reviews every diff, Fable at the two gates marked ★.

### Phase 0 — Fixtures and baseline ★

- Add stress scenarios to `examples/stress` + `benchmarks/scenarios.mjs`:
  `list-update-1` (1,000 record rows, one field edit), `list-update-all`,
  `list-reorder`, `list-filter`; record today's counters (vnodes built, DOM
  mutations, `data()` runs) and timings as the baseline.
- Hand-write the todos fixtures (`Home`, `TodoItem`, `Default`) in the §4
  shape. Measure bytes on the five-template corpus from the archived plan
  (todos ×3 + music `QueueDialog`/`AppLayout`, hand-converted) against §11.
- **Gate:** shape approved; byte numbers within the gate; the emitted names
  (`__list`, `__c`, `__roots`) frozen and recorded on D170.

### Phase 1 — Runtime (Opus)

`RENDER_REV`; `patch()` short-circuit + `reassertControls`; `propsEqual` with
snapshots; the two mount/unmount guards; `listBlock.js`; PuzzleView `__list`,
`__c`, `__dirty`, `__propRevs`, flush stamp; devperf counters. Tests: new
unit suites (§10) and the hand-written fixtures through the todos suite.
Existing suites must pass unchanged except `component-prop-bailout`.

### Phase 2 — Compiler (Codex) ★

`expr.go` root/local collection; loop lowering with scope rewrite and site
meta; cached loop handlers; static subtree detection and caches; `__roots`
stamp; reserved names; goldens regenerated; the todos fixtures reproduced
byte-for-byte. **Gate:** all Go suites green; every example builds and runs
its browser smoke; SSG output for every example byte-identical to 0.7.1.

### Phase 3 — Integration, measurement, docs

`npm run bench` against the Phase 0 baseline; `measure:size --check`; browser
suite additions (focus/IME survive a clean-row pass; controlled input
re-assert in a cached row; reorder with FLIP under caching); cards and SPEC
(§13); CHANGELOG; README banner.

Rough size: ~300 runtime lines added, ~250 Go lines changed, ~12 new tests,
~5 goldens regenerated per construct family, 4–6 PRs.

---

## 10. Tests

New, all in `tests/`:

- `list-block.test.js`: cache hit on clean pass (same vnode object); dirty on
  reference change, on revision change, on index change when `counter`, on
  parent root change; plain-object rows always rebuild but keep `s.c` and
  `s.hN`; null key → uncached + warn-once; duplicate key in one render →
  second occurrence uncached + warn; conservative site (relation / computed
  getter / deep path) never caches record rows; rows dropped when absent;
  site not visited keeps rows; nested list keyed per outer row; component
  row clean → child untouched, dirty → child refreshed exactly once.
- `patch-identity.test.js`: same-object short-circuit performs zero DOM
  work; cached subtree with controlled input re-asserts drifted value; cached
  component vnode remounted after a branch toggle constructs a fresh instance.
- `record-render-rev.test.js`: revision advances on `createRecord`,
  `update()`, `removeRecord`, adapter upsert, save reconciliation; stored
  snapshot compare (same reference + advanced revision → child refresh);
  snapshot rewritten after refresh.
- `flush-dedupe.test.js`: parent-driven refresh + own notification in one
  flush → one `data()` run.
- `static-cache.test.js`: cached subtree built once across N renders;
  island children built once; `expandSlots` never clones a cached node.
- Codegen: `listblock_test.go` (item/explicit-key/counter/nested/conservative
  meta), `static_cache_test.go` (threshold, exclusions), handler rewrite tests,
  reserved-name tests; goldens.
- Updated: `component-prop-bailout.test.js` (stable handlers change the
  measurement it pins), todos fixtures.

---

## 11. Measurement and gates

| Measure | Today | Gate |
|---|---|---|
| hello-world / todos gzip (README banner) | 20.9 / 23.9 KB | hello-world ≤ +0.5 KB; todos ≤ +1.5 KB |
| `examples/stays` (16 templates) `app.js` gzip | 37.7 KB | ≤ +2.0 KB |
| Five-template corpus render tails, concatenated gzip | 3,481 B | ≤ +8% |
| `list-update-1` (1,000 record rows, one edit) | full tree rebuilt | ≤ 1 row's vnodes built; 999 short-circuits; DOM mutations unchanged |
| `list-update-all` | — | N rows built, no duplicates |
| `list-reorder` | — | 0 rows built; moves as today; FLIP plays |
| Static-heavy view update (stress `islands`) | 20,000 vnodes/render | 0 island vnodes/render |
| `deep-nest` | 1 of 1,536 `data()` runs | unchanged |
| Heap after unmount | — | returns to baseline |

Work counters via devperf; timings via the production bench (D128 rules).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Row cache hides a legitimate update (relation, getter, direct assignment) | Conservative-site rule checked against the schema at runtime; plain objects never cache; direct assignment documented as outside the reactive contract; a dev counter reports conservative sites so an author can see why a list is slow |
| Snapshot bookkeeping wrong (comparing live revisions on both sides) | Snapshot lives on the child, written only when props are applied; pinned by `record-render-rev.test.js` |
| Cached vnode remounted with stale links | `mountComponent` destroyed-instance guard; `unmount` nulls links; branch-toggle test |
| Controlled-input drift no longer corrected in cached rows | `controls` list + `reassertControls` on every clean pass; browser test |
| Static cache wrappers cost more bytes than they save | Threshold rule (≥3 vnodes or island); measured on the corpus in Phase 0 |
| `__roots` analysis misses a root a row reads through a template literal or nested call | Roots come from the same lexer that already resolves them to `__d.x`; a body with no resolvable roots reads none; volatile expressions in loop bodies (`this.…`) mark the site conservative |
| Per-site memo for view-level dynamic subtrees is tempting | Explicitly deferred to 0.8.x; measure first |

---

## 13. Cards and SPEC to update when built

- `DECISION-D17-RENDER-FUNCTIONS-VDOM`: amended in place — the virtual DOM
  is compiler-informed (static caching, list blocks); the "Svelte-style
  compiled DOM" alternative gains the 2026-09-10 measurements as the reason
  it stays rejected.
- `DECISION-D62-HANDLER-CACHING`: rewritten — loop-capturing handlers are
  now cached on the row scope; the "fresh closure per row" consequence and
  the D62 measurement are superseded.
- `DECISION-D58-LIST-KEYING`: note that the synthetic key is now the site
  meta's key function; semantics unchanged.
- `FLOW-REACTIVITY`: the record-as-prop gotcha is closed for a record's own
  fields; the re-query idiom stays the answer for relations.
- `DOC-RUNTIME-KERNEL` invariant "Component prop diffing is shallow": amended
  with the revision rule.
- `DOC-SPEC-TEMPLATE` §28 (list keying: row state and caching contract),
  §31 (cached handlers in loops); `DOC-SPEC-ANATOMY` §4 reserved names.
- `COMPONENT-VIEW-MANAGER`, `COMPONENT-CODEGEN`, `COMPONENT-PUZZLE-VIEW`,
  `COMPONENT-STORE`, `COMPONENT-PUZZLE-MODEL`: mechanism paragraphs; the
  island measurement paragraph on the view-manager card is re-measured.
- `DOC-STRESS-EXAMPLE` and the stress README claims about `render()`
  rebuilding the whole tree.
- `DECISION-D170-INCREMENTAL-VDOM-LISTS`: `built`, then `verified`.

---

## 14. Questions for Cory

1. The row caching contract (§7.2): records mutated by direct field
   assignment are not observed by row caching. Accept and document?
2. Range loops keep today's emission (no block). Agree?
3. Per-site memoization of dynamic subtrees outside loops is deferred to
   0.8.x. Agree?
4. Byte gates in §11 (todos ≤ +1.5 KB, stays ≤ +2 KB, corpus ≤ +8%). Agree
   with the envelope?
5. Codex for the Go changes, Opus for the runtime, Opus reviews. Agree?

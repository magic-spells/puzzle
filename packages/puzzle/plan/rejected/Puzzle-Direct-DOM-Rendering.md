> **REJECTED 2026-09-10 — kept for its measurements and correctness findings.**
> This was the direct-DOM rewrite plan (revisions 1–3). Two byte measurements
> on real templates (§11.1, §11.2) showed the compiled output 25–27% larger
> gzipped in a bundle even with every emitter lever, so the direction was
> dropped. The plan of record is `plan/Puzzle-Render-Upgrade.md` (incremental
> virtual DOM with persistent list blocks). Sections still worth reading:
> §2 (review of the GPT handoff), §4.4/§5.1/§5.2 (revision snapshots and
> the relation/getter hazard), §7.2 (takeover side effects), §8.6 (parser
> repair), §11 (numbers), §17 (GPT review incorporations), Appendix A.

# Puzzle Render Upgrade — compiled DOM + persistent lists (0.8.0)

**Status:** proposed plan, not implemented. Written 2026-09-10 against
`release/0.7.1` (`1648790`). Companion decision card: `DECISION-D170`
(status `planned`). Supersedes the GPT-6 Pro handoff in
`0.8.0-plan/Puzzle-0.8.0-Rendering-Implementation-Plan.md` as the working
plan; §2 records what was kept from it and what was dropped, and why.

**Revision 2 (2026-09-10):** amended after a GPT-6 Pro review of revision 1
(`~/Downloads/GPT-Plan-Review.md`); §17 lists every change and the reasoning.

**Revision 3 (2026-09-10, later the same day) — recommendation changed.** Two
byte measurements on real Puzzle templates (§11.1, §11.2) show the compiled
direct-DOM output is 25–27% larger gzipped in a bundle even with every
emitter lever applied, breaking even only around 13 templates. The
recommendation is now to keep the virtual DOM and make it incremental
(persistent list blocks with cached row subtrees, identity short-circuit,
static subtree caching, record revisions, stable handlers) — see §11.2. The
architecture in §3–§10 stands as the measured alternative, not the plan of
record, pending Cory's confirmation.

**Syntax is unchanged.** No `.pzl` file needs to change. Everything below is
compiler output shape plus runtime internals. The editor grammars and the
eslint/prettier plugins are untouched (they vendor the lexer, not codegen).

---

## 0. The verdict in one page

**Yes, this is the right direction — but not the way the GPT plan gets there.**

Puzzle's rendering cost today is structural: every update rebuilds the entire
`ViewNode` tree for the view (the `island` measurement on
`COMPONENT-VIEW-MANAGER` is the clearest number — 20,000 of 20,000 child vnodes
rebuilt per render, then thrown away) and diffs it, and most of that work
produces zero DOM mutations. A list of N rows pays N×(row vnode allocation +
diff) on every parent update whether or not any row changed.

The fix is the one Svelte 3/4 shipped and Svelte 5 / Solid refined: the
compiler emits, per template, a **create** function (clone a static HTML
template, walk to the dynamic nodes once) and an **update** function (guarded
writes to exactly those nodes, comparing the new value to the last one). No
tree, no diff. Lists become **persistent keyed blocks** that keep one row
instance per key and only touch rows whose inputs changed.

Three things make this plan different from the GPT handoff, and each one
removes a large chunk of complexity:

1. **No runtime dependency graph.** No record links, leases, receipts, row
   subscriptions or a second scheduler. Invalidation stays exactly where it is
   today — the view's `data()` re-runs on a store flush, `setData()` schedules
   a render — and the *renderer* becomes precise instead. Root-level dirty bits
   (which top-level `data()` keys changed) plus value-guarded writes give the
   "only touch what changed" behavior without tracking anything at runtime.
   Rows are updated in place during the parent's pass with value-guarded
   writes; a record revision (a **pull** check in that pass, not a **push**
   subscription with its own lifecycle) narrows work further where it is
   provably safe — component props in 0.8.0, whole rows in 0.8.x.
2. **The compiler owns the complexity.** It already resolves every expression's
   identifier roots (`resolveExpr` rewrites them to `__d.x`), so the dependency
   analysis the emitter needs is a by-product of code that exists. The runtime
   rendering layer shrinks to a handful of small helpers, in the size class of
   Solid's (measured ~6 KB gzip for a minimal app — see §11). Whether the
   *emitted* code per template shrinks too is an open, measured question — the
   first measurement says the naive shape does not (§11.1) — so Phase 0 is a
   size spike with hard gates before any compiler work starts.
3. **One IR, two emitters.** A `dom` target for the browser and an `html`
   target for prerendering (string concatenation, DOM-free, like Svelte's
   server output). Hybrid and static output keep their current
   no-hydration "replace on takeover" contract, and the takeover's
   "preload nested components before clearing the page" step is replaced by
   mounting the new tree detached, waiting for it to settle, then swapping —
   no off-DOM walk of any tree.

The GPT plan's invariants (§5 there) are good and are adopted as gates here.
Its architecture (17 new runtime modules, a VDOM-bridge intermediate, a shared
sibling key domain, leases/receipts scheduling, a legacy renderer subpath) is
not adopted. §2 has the item-by-item reasoning.

**Complexity:** high but bounded. The core — emitter + blocks + list — is a few
weeks of agent work with review. The long tail is where the time goes: router
chain composition, SSG takeover, portals, FLIP/leave animations, error
recovery, and porting ~60 runtime test files that hand-build vnode trees. The
plan front-loads a hand-written "compiled output" fixture (the same
fixture-first discipline the original D14 codegen used) so the runtime and the
ABI are proven before the Go emitter is written.

---

## 1. Goals, non-goals, and the contract that must survive

### Goals

- A store change or `setData()` costs: one `data()` re-run (where it does
  today), one pass over the view's dynamic bindings guarded by dirty bits, and
  DOM writes only where a value actually changed. Zero vnode allocation.
- A `{#for}` keeps persistent row instances. A parent update reconciles keys
  (O(N) key reads, no allocation beyond the key map), moves/inserts/removes
  rows, and re-evaluates retained rows' bindings with value-guarded writes, so
  an unchanged row writes nothing. Skipping a row outright by record revision
  is a 0.8.x optimization (§4.4).
- A component row (`<TodoItem todo={todo}/>`) re-runs its `data()` when its
  record changes, even though the prop reference is identical — the
  `FLOW-REACTIVITY` gotcha ("record-as-prop defeats prop reactivity") is closed
  by design, not by the re-query idiom.
- Hybrid and static output keep working with identical HTML and the same
  takeover behavior; the build stays DOM-free.
- The rendering runtime gets smaller, and the emitted template code must not
  eat that saving: per-template gzip within +10% of today's vnode output and
  no growth on a 16-template app are hard gates (§11), decided in Phase 0
  before the compiler is written.

### Non-goals (explicitly out of 0.8.0)

- Signals, runes, proxies on records, property-level reactivity, a reactive
  graph. `data()` returns a plain object; that stays the model.
- Hydration (adopting prerendered nodes). Takeover stays replace-on-commit.
- Event delegation. Listeners stay per-node (D18) — but attached once.
- Query ownership moving into loops, list virtualization, streaming data.
- Any router state-machine change beyond the composition boundary.
- Changing `.pzl` syntax.

### Public contract that must not move

Everything in `DOC-SPEC-VIEW` and `DOC-SPEC-TEMPLATE` except the items listed
in §9 "Behavior changes". In particular: `data()`/`setData()`/`refresh()`
semantics and precedence; the D19/D61/D146 navigation commit ordering; the D145
error view and retry; skeletons (D39/D52); animations and the hook order (D28,
D136); `island`; `{#svg}`; `{#raw}`; refs; implicit binding (D147) including
IME, numeric and `select` re-assert rules; event modifiers incl. `outside`
(D86) and `once` spend (D38); portals (D144); snippets (D166); families
(D167); the whitespace policy (D168); formatters and `displayValue` (D127);
FLIP (D85); the DevTools protocol (D100/D122); HMR state restore (D57).

---

## 2. Review of the GPT-6 Pro plan

The handoff is careful and its risk register is largely right. Its
architecture overshoots. Item by item:

### Adopted

| Item | Where it lands here |
|---|---|
| §5 invariants (parent owns the query; ordered input is authoritative; identity ≠ value; one physical writer; cleanup is exact; no network from render; preparation invisible) | §12 release gates |
| §2.2 table of runtime details a migration must account for | folded into §4–§7 |
| Keys compared by SameValueZero, never stringified; per-tag identity | §4.3 |
| Structure (keys) and content (dirtiness) are separate decisions | §4.3 / §4.4 |
| Stable listeners reading a *live* scope at fire time (§10.4) | §3.4 |
| Revision-aware prop invalidation for record props (§10.2) | §5.2 |
| Router state machine untouched; only the composition boundary changes (§19.1) | §6 |
| No accidental hydration (§19.5) | §7 |
| Measure with equivalent production builds, report work counts separately (§25) | §11 |
| Deterministic duplicate-key handling with a positioned dev warning | §4.3 |
| Skeleton as a separate compiled block with a static predicate (§19.2) | §5.4 |

### Dropped, with reasons

| GPT item | Replacement | Why |
|---|---|---|
| Record links, leases, stamps, render receipts, a render-work scheduler around the store flush (§7, §11, §12) | Value-guarded row updates in the parent's pass, plus a pull-based revision compare where provably safe (§4.4, §5.2) + the existing store flush | The parent's `data()` must re-run anyway (it subscribed to the collection, and its filter may read the changed field). Once it re-runs, the cheapest correct thing is to compare each row's record revision in that pass. Push subscriptions per row add a lifecycle, a race surface (leave/navigation/prepare), and a scheduler — for a benefit that pull already delivers. |
| `ChildDomain`: preserve today's shared sibling key namespace across two loops + keyed static siblings (§8.4) | Keys are loop-local; `key=` on a non-loop element compiles to a keyed block | Nobody documents or uses cross-producer key moves; preserving them forces a coordinated multi-producer reconcile that costs more than every loop in the framework. This is the one semantic change the plan asks Cory to accept (§9). |
| VDOM-row bridge as a first stage (§6.5, M5) and a `vdom` compiler target through the migration | Build the direct renderer fresh; keep the old renderer in the tree only as a **test oracle** until parity, then delete it | A bridge means two renderers patching around each other inside one view; it is throwaway work and its bugs are not the final renderer's bugs. |
| A legacy/compatibility renderer subpath for hand-written `render()` (§20.1) | Remove `ViewNode`, `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG` from the package root; `render()`/`renderSkeleton()` no longer exist | The survey found zero hand-written `render()` or `new ViewNode` in examples, pieces, or docs; the export is documented as compiler ABI, not SPEC surface. Pre-1.0, a minor bump carries it. |
| Compatible-blueprint transitions between conditional branches (§17.1–17.2) | A branch switch destroys the old branch and creates the new one | Cross-branch node reuse today is an accident of index diffing; the arity-padding placeholders exist only to keep that diffing from remounting trailing siblings. Anchor-based blocks make both disappear. Svelte and Solid both remount on branch change. |
| Keep the VNode serializer as the SSG target "first" (§19.3) | An `html` emitter from day one | A VNode serializer keeps `ViewNode` and `expandSlots` alive in the framework forever. The string emitter is the *simpler* of the two targets. |
| "DOM-free structural preparation walk" for takeover (§19.4) | Detached mount → settle → swap (§7.2) | Reuses the real mount path; no second interpretation of templates. |
| `createElement` first, template cloning "later" (§15.1) | Template strings + `cloneNode` first, with an imperative fallback mode | Both reference implementations clone templates; the compiler controls the HTML, so parser normalization is not a source of surprise. Trusted Types gets an escape hatch (§8.6). |
| Map + LIS planner (§8.2, Appendix A) | The existing back-to-front placement with a move guard, generalized to the list block | Neither Svelte 5 nor Solid uses LIS (both use run heuristics). The current algorithm is correct and already handles leaving rows; LIS can be added later behind the same list API if a benchmark asks for it. |
| 16 milestones, 17 new runtime modules, four public review checkpoints | 6 phases (§10), ~8 runtime modules (§13) | Fewer boundaries, fewer seams, less duplicated event/prop/slot code. |
| Whole-application "render receipts" to dedupe parent/child refreshes in one flush (§11.2) | Stamp `_settleMark` with the delivering flush's sequence on any refresh that runs during delivery (§5.3) | The mechanism already exists for D161; this is a two-line generalization. |

### One correction to the handoff's baseline claims

The handoff says "current code generation allocates the capturing callback
again, which makes that prop shallow-different" and treats that as the path
that keeps `TodoItem` fresh. True — and it is why removing callback churn
without revision-aware props would regress the todos example. §5.2 makes the
invalidation explicit, so the callback identity no longer matters.

---

## 3. Architecture

### 3.1 The reactive model: view-level invalidation, root-level dirty bits, binding-level guards

Nothing changes about **when** a view updates:

| Trigger | `data()` re-runs? | Renderer does |
|---|---|---|
| Store flush matching a `data()` query | yes | `update(dirty)` |
| Route params / props change | yes | `update(dirty)` |
| `setData()` | no | `update(dirty)` |
| First render / skeleton swap | — | `create()` then mount |

What changes is what `update` does. The compiler records, per template, the
ordered list of **roots** — the top-level `data()` keys the template reads
(`__d.x` sites). Before each update the view computes a dirty mask over those
roots by comparing the current composed model against the values it rendered
last time:

```text
primitive        dirty when !==
anything else    always dirty   (records, arrays, plain objects, functions)
pass bit         bit 0 of the mask is set on every update pass
```

That is Svelte 4's `safe_not_equal` rule, and in 0.8.0 records get no
exception: a binding such as `post.author.name` or a computed getter reads
beyond the record's own fields, so an unchanged revision cannot prove a model
root clean (§4.4). "Always dirty" is the honest rule — `data()` may mutate an
object in place and call `refresh()` — and it costs only expression
re-evaluation, never a DOM write, because every write is value-guarded.
Revision-narrowed model roots (only when every access is a schema data field)
are a 0.8.x optimization on top of this baseline.

**The invariant that makes this safe:** every binding is correct if it is
re-evaluated on every pass. Dirty masks only remove evaluations that are
provably unnecessary; they are never the reason the DOM is considered correct.
A test mode that forces every bit on must produce identical output (§12).

Each compiled binding carries the mask of roots it reads. An update is:

```js
u(d) {                                   // d = dirty mask over roots
  if (d & 1 && s0 !== (s0 = __s(__d.todo.text))) t1.data = s0;
  if (d & 6 && c0 !== (c0 = `flex-1 ${__d.a ? 'x' : ''}`)) setAttr(span, 'class', c0);
  if (d & 8) setChecked(input, __d.todo.completed);   // controlled: helper compares to the live property
  if (d & 16) list.reconcile(__d.filteredTodos);
  list.u(d);
}
```

Expressions with **no** roots and no scope locals (`this.ctx.router.current.path`,
`Date.now()`) are volatile: they guard on the pass bit, so they re-evaluate on
every update as they do today — including a pass where no root changed, which
an all-ones root mask would wrongly skip (`0 & ~0 === 0`). Roots therefore
occupy bits 1 and up; the sketches in this document number roots from bit 0
for readability.

**First render.** `create()` returns the block detached, with placeholder text
nodes; the caller runs `u(ALL, ALL)` before inserting it, so refs and
`mounted()` observe initialized DOM and no placeholder is ever visible. The
same rule holds for rows and branch blocks: create, initialize, insert.

Roots beyond 31 use a second mask word; the compiler emits `d[1] & …` for those.
Templates with more than 62 roots are rare and simply get more words.

**Why not signals.** A signal graph would need `data()`'s result and every
record field to be reactive primitives — proxies on `PuzzleModel` instances,
against D-cards that deliberately keep records plain classes, and a runtime
graph with ownership/disposal semantics. The root-mask model delivers the same
"only touch what changed" DOM behavior with a compile-time analysis that
already exists and a runtime that is a handful of integer compares.

### 3.2 The compiled shape

Per template the compiler emits module-scope templates and one `__tpl`
descriptor attached to the class (the ABI, §3.7):

```js
import { PuzzleView } from '@magic-spells/puzzle';
export default class TodoItem extends PuzzleView { /* user script, verbatim */ }

import { tpl, first, next, setAttr, setChecked, on, bind, ifBlock, __s } from '@magic-spells/puzzle/render';

// Static HTML. A single space reserves a dynamic text node; <!> reserves a block anchor.
const T0 = tpl('<div class="overflow-hidden"><div class="group h-[65px] …"><label class="flex …">'
  + '<input type="checkbox" class="sr-only"><div class="relative"><div></div><!></div></label>'
  + '<span> </span><span class="ml-4 …"> </span><button class="ml-3 …" title="Delete todo">×</button></div></div>');
const T1 = tpl('<div class="absolute inset-0 …"><svg class="w-3 h-3 text-ink" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="…" clip-rule="evenodd"></path></svg></div>');

TodoItem.__tpl = {
  v: 1,
  roots: ['todo'],
  create(v) {
    const __d = v.__d, __f = v.ctx.formatters.getAll();
    const root = T0();
    const inner = first(root), label = first(inner), input = first(label), rel = next(input),
      box = first(rel), a0 = next(box), span1 = next(label), t1 = first(span1),
      span2 = next(span1), t2 = first(span2), btn = next(span2);
    let c0, c1, s1, s2, b0;
    bind(v, input, 'change', () => __d.todo, 'completed', 'c');   // write target resolved at event time
    on(v, btn, 'click', (event) => v.events.remove(event));
    return {
      n: root,
      u(d) {
        if (d & 1) {
          setChecked(input, __d.todo.completed);
          if (c0 !== (c0 = `w-5 h-5 rounded-md border transition-colors ${__d.todo.completed ? 'bg-accent border-accent' : ''}${!__d.todo.completed ? 'border-white/25 group-hover:border-white/40' : ''}`)) setAttr(box, 'class', c0);
          b0 = ifBlock(b0, a0, !!__d.todo.completed, T1);        // static branch: mount/unmount only
          if (c1 !== (c1 = `flex-1 truncate ${…}`)) setAttr(span1, 'class', c1);
          if (s1 !== (s1 = __s(__d.todo.text, DEV ? 'todo.text' : 0))) t1.data = s1;
          if (s2 !== (s2 = __s((__f["date"] || __f.__missing("date"))(__d.todo.createdAt, 'short'), …))) t2.data = s2;
        }
      },
      x() {}                                                        // dispose; owned resources are journaled on v
    };
  },
};
TodoItem.__pzlModule = 'app/components/TodoItem.pzl';
```

Observations that drive the rest of the design:

- The static HTML is the most compact representation of the static structure;
  the walk (`first`/`next`) is a fixed sequence the compiler knows. Whitespace
  text nodes never appear in our templates (the D168 policy already drops
  inter-element whitespace), so walks are dense and the `html` emitter shares
  the same structure without offset math. This is the Solid choice, not the
  Svelte one, and it is load-bearing for §7.
- Static text is escaped into the template string (`&` → `&amp;`, `<` →
  `&lt;`) so the existing "template text is not entity-decoded" rule holds
  byte-for-byte.
- Dynamic text: one text node per coalesced run (the compiler already
  coalesces). Two runs are never adjacent — a control-flow block between them
  contributes a comment anchor, so the parser cannot merge them.
- Listeners are attached once. A handler that captures loop data closes over
  the row's live scope object (§3.4), so it never needs re-binding. The D62
  `__h` handler cache becomes unnecessary and is removed.
- Controlled form properties keep their live-compare semantics inside the
  helper (`setValue`, `setChecked`, and `reassertSelect` after option
  children update), so drift correction is preserved without re-running the
  row body.

### 3.3 Blocks

A **block** is `{ n | node(), u(d, s), x() }`: its placement (a single node, or
a `node()` getter for a component whose root can change), an update taking the
view dirty mask and the scope dirty mask, and a synchronous idempotent dispose.
Blocks are created by factories the compiler emits; positions are held by
comment anchors (`<!>`) where the block may be empty or multi-node.

| Construct | Block | Notes |
|---|---|---|
| `{#if}`/`{:else if}`/`{:else}`, `{#unless}` | `ifBlock` | One anchor. Branch index compared; change = dispose old, create new before the anchor. Static branches (no bindings) are plain template clones. |
| `{#case}` | `caseBlock` | Same, clause index. Expression evaluated once. |
| `key={x}` on a non-loop element | `keyBlock` | Dispose + recreate when the key changes (SameValueZero). Replaces today's "keyed static sibling" replacement semantics with an explicit block. |
| `{#for}` | `listBlock` | §3.5. |
| `<Component>` | `host` | §3.6. |
| `<Children/>`, `<Slot name>` | `slot` | Mounts the caller's content factory at the marker, or the fallback block. §3.6. |
| `<Snippet>` | content factory with params | §3.6. |
| `<Portal>` | `portalBlock` | Local comment placeholder; children mount into the outlet range (`portal.js` bookkeeping is kept). |
| `island` element | `islandBlock` | Seed children are created and **initialized once** — their bindings run in a one-shot init, so `<div island>{ initialValue }</div>` keeps its D44 semantics — and never receive owner-driven updates afterwards. Attributes and listeners on the element itself still update. |
| `{#svg}` seed, `{#raw}` | static HTML in the template | Byte-identical output; nothing to update. |
| SVG roots | `tplSvg` | Fragment wrapped in `<svg>` at parse and unwrapped, as both reference implementations do; the parser knows the namespace context. |

Placement rules: a block inserts before its anchor (or before its `ref` at
mount). `beforeKey === null` in the list means "before the list's anchor",
never `appendChild` — a list may share its parent with trailing siblings.

### 3.4 Scopes: loop variables, counters, snippet params

A row (or snippet instance) owns a **scope object** `s = { item, i, … }` that
the list block mutates in place on reorder and update. Handlers close over `s`
and read it at fire time, so `@remove={ deleteTodo(todo) }` compiles to
`(event) => v.events.deleteTodo(s.item)` once per row, forever stable.

Scope dirtiness is a second small mask `sd` over the lexical chain of locals
(outer item, outer counter, inner item, …) computed by the list block per row:
item bit set by the same rule as roots (primitive by value; any object —
records included — always, in 0.8.0); counter bit when the index changed. Bindings inside a
row guard on `(d & rootMask) || (sd & scopeMask)`. Nested loops receive the
outer scope's bits shifted in; the compiler assigns bit positions per lexical
depth (a template deeper than 31 locals is a compile error nobody will hit).

### 3.5 Lists: persistent rows, reconciliation, skipping, animations

`listBlock(anchor, v, def)` where `def` carries the site's static facts:
`key(item, i)` (the `ViewNode.keyOf` rule or the author's `key=` expression),
`row(s) → block`, `rootMask` (view roots read inside the row), `fields` (item
members read at depth one) and `deep` (any deeper path or call on the item) —
the last three are emitted for the deferred §4.4 skip and unused by the 0.8.0
runtime.

**Reconcile** (runs when the collection root or a scope input it depends on is
dirty):

1. Read the new array; compute keys in order. Nullish key → this row falls
   back to positional identity (`__i`) with the existing warn-once; duplicate
   key → dev warning naming the `.pzl` site, and the later duplicate is rendered
   positionally so nothing is lost or aliased (deterministic, tested).
2. Pair new keys against `Map<key, row>` (SameValueZero; per-loop map, so
   `1` and `'1'` stay distinct and `NaN` matches itself).
3. FLIP first-measure for retained `flip` rows (before removals reflow).
4. Remove unmatched rows: `row.x()`. A component row with an out animation or
   hide hooks goes through `destroyAnimated()` and its element is registered as
   **leaving**; leaving nodes are skipped by the move guard and never used as
   an insertion reference (exactly today's `leavingEls` rule).
5. Place back-to-front with the next-persistent-sibling guard, inserting new
   rows and moving retained ones — today's algorithm, minus vnodes. (LIS is a
   later option behind the same API; neither Svelte 5 nor Solid uses it.)
6. FLIP last-measure and play.

**Update** (runs on every parent update, after reconcile if any): for each
retained row, compute `sd`, then `row.u(d, sd)`. The guards inside the row
decide the writes; a row whose record did not change re-evaluates a few
property reads and writes nothing. The whole-row skip (§4.4) is **not** part
of 0.8.0 — correctness never depends on a revision, and the cost the skip
removes is a few microseconds per thousand rows.

Three questions stay separate on every pass: structure (which keys, in what
order → insert/remove/move), row input (same item? same index? which outer
inputs changed → the live scope and `sd`), and row content (which bindings to
evaluate → the row updater). Reconcile streams the items once, computing each
key as it goes; the only persistent allocation is the key map and the rows.

Component rows have no bindings of their own; their `u` forwards prop updates
to the host, and the host's revision-aware compare (§5.2) decides whether the
child re-runs `data()`. They are always cheap and never need the skip.

### 3.6 Components, slots, snippets

`host(v, Class | instance, parent, ref, { props, content })`:

- Constructs the child with the owner's `ctx` (or adopts a pinned, preloaded
  instance — the router's case), registers `child.__owner = v` and adds it to
  `v.__children` (for DevTools containment and teardown), and calls
  `child.mount(parent, { props, content, ref, preloaded })`. `mount()` keeps
  its anchor-comment contract for async `data()`.
- `props(next)`: shallow compare with the record rule — a `PuzzleModel` value
  compares by `(ref, _rev)` — then `child.refresh({ props })` on a difference.
  Callback props are stable by construction (§3.4), so the compare is meaningful
  again and D62's "phantom prop change" class of re-run disappears.
- `content` is an object of **content factories** compiled in the caller's
  module: `{ default?: (parent, ref) => block, named?: { x: factory },
  snippets?: { fits: (args) => factory } }`. Each factory closes over the
  caller view and the caller's scope, so `this`, `__d`, loop locals and
  handlers are the caller's — the D71/D166 lexical-ownership rule holds by
  construction, no expansion pass.
- The child mounts a factory at its marker (`<Children/>` → `default`,
  `<Slot name="x"/>` → `named.x`, args-bearing marker → the matching snippet
  called with args) or its fallback block (D141). Mounted content blocks
  register with the host, so the **caller** drives their updates:
  `host.uContent(d, sd)` on every caller update, bracketed by the child's
  `beforeUpdate()`/`afterUpdate()` when the child is mounted and loaded — the
  hook timing a slot-only re-render has today, since a child may measure its
  slotted DOM there. A slot-only change never re-runs the child's `data()` and
  never re-renders the child's own bindings — today's
  `applyParentUpdate({ children })` path is retired.
- Snippet args are scope locals set by the child; when the child's own update
  changes an arg it calls `content.u(0, argsDirty)`. Both directions can push;
  guards are OR'ed, so a snippet instance is correct under either.
- Forwarding (`<Card><Children/></Card>` inside a layout) is a content factory
  that mounts the *outer* factory: the compiler emits
  `default: (p, r) => v.__content.default(p, r)` — lexical forwarding with no
  metadata vnodes and no call-site context machine.
- `<Slot/>` as the **router outlet** is the same mechanism: the router hands the
  layout `content.default = mount the routed chain` (§6).

Skeletons (§5.4) and error recovery (§5.5) are host concerns too.

### 3.7 The ABI

```ts
Class.__tpl = {
  v: 1,                                  // protocol version; mismatch is a dev error and a cache-key input
  roots: string[],                       // top-level data() keys, ordered; mask bit i ↔ roots[i]
  create(view): Block,                   // dom target
  skeleton?(view): Block,                // compiled <puzzle-skeleton>; presence is the static hasSkeleton predicate
  minDuration?: number,                  // was prototype.skeletonMinDuration
  html?(view, content): Promise<string>, // html target only; never in browser bundles
};
Class.__pzlModule = 'app/...';           // unchanged (D81)
```

`PuzzleView` reads `this.constructor.__tpl`. `render()`, `renderSkeleton()`,
`skeletonMinDuration`, `__h`, `__ref`'s vnode wiring and `_vnodeTree()` go
away; `__bind` and `__ref` survive as the helpers the emitted code calls.
`getData()` still returns a copy; the compiled code reads the live composed
object through an internal `__d` getter (framework-owned, underscore
convention).

The old `ViewNode`, `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG` root exports are
removed. The new helper surface lives at `@magic-spells/puzzle/render`
(compiler ABI, documented out-of-SPEC like the old one) — a separate subpath so
esbuild tree-shakes unused helpers per app by construction, which also retires
the `__PUZZLE_HAS_PORTAL__` / `HAS_FLIP` / `HAS_SNIPPETS` / `HAS_RAW_AT` scan
defines (§8.4).

---

## 4. Lists in depth

### 4.1 Why the parent still re-runs `data()`

The parent subscribed to the `todo` collection through `findMany('todo')`. A
field edit on one todo notifies both `todo` and `todo <id>`. The store cannot
know whether the parent's filter reads that field (`data()` is opaque
JavaScript), so membership may have changed; the parent must re-run. That is
inherent to Puzzle's model and it is cheap — `findMany` copies a Map into an
array and the user's filter runs; tens of microseconds for a thousand records.
What this plan eliminates is everything after that: tree construction, diff,
and per-row work for rows that did not change.

### 4.2 Structure versus content

An unchanged key sequence proves membership and order, nothing else. Rows
receive their new `item`/`i` inputs on every parent update whether or not any
structural operation happened; content dirtiness is decided separately by
`sd` and `d & rootMask`.

### 4.3 Identity rules (unchanged from today, now per loop)

- Item-form auto-key: a `PuzzleModel` keys by its declared primary key; other
  values by `.id`; nullish → positional fallback + warn-once (D58).
- Range form keys by the generated value.
- Explicit `key=` on the body root wins and suppresses the synthetic key.
- SameValueZero equality on raw keys; a compound `(tag, key)` is unnecessary
  because a loop body has exactly one root and its tag is fixed.
- Keys are **local to the loop**. `key=` outside a loop is a keyed block.

### 4.4 Row skipping: deferred to 0.8.x, and the rule it will need

Revision 1 of this plan skipped a retained row entirely when its record's
revision, its counter and the view roots it reads were all unchanged. That is
withdrawn from 0.8.0 for two reasons the review made concrete:

- A record is a plain writable object. `todo.title = 'x'; this.refresh()` is
  legal today and re-renders the new title; it bumps no revision, so a
  revision-gated skip would leave that row stale.
- A revision covers the record's own fields only. `todo.author.name` reaches
  another record, and `todo.author` / `todo.fullName` (a D49 relationship
  getter, a computed getter) are depth-one reads that also read other data.

The 0.8.0 baseline re-evaluates every retained row's bindings on every parent
pass and writes only what changed. The skip returns in 0.8.x as a measured
optimization with this eligibility rule: the item is a `PuzzleModel`, the
compiler-emitted `deep` flag is false (no depth-two access or call on the
item), and every name in `def.fields` is in `Model.normalizedSchema()` and not
in `Model.relationshipDefs()`, checked once per (site, model class); formatters
are display-pure by SPEC contract and do not affect eligibility; handlers read
the live scope at fire time and never do. Even then the direct-assignment case
stays a documented limitation of the skip, which is why it must remain an
optimization that can be disabled per site with no change in output.

**Revision snapshots.** Wherever a revision is compared — component props in
0.8.0, rows in 0.8.x — the previous revision is a number stored at the last
commit, never re-read from the old object: the old and new references are the
same live record, so `old[REV] === new[REV]` is always true after a mutation.

### 4.5 Records across create/delete with the same id

A deleted record is detached (`_store = null`, `_deleted = true`). A retained
row whose new item is a different incarnation with the same key sees
`item !== prev` → item bit set → full row update, and the host's prop compare
sees a new reference. A row for a record that is no longer in the parent's
array is simply removed by reconcile. No generation bookkeeping is needed
because rows never hold subscriptions.

### 4.6 FLIP and leave animations

`flip.js` changes signature from vnode pairs to `{ el, spec, key }` entries;
the three phases (measure retained before removals; reconcile; measure and
play) are called from the list block at the same points as today. Component
rows resolve their element through `host.node()` (a comment anchor while
loading is skipped, as now). Leaving rows keep the `leavingEls` set semantics
inside the list block.

---

## 5. Runtime changes outside the renderer

### 5.1 Store: a per-record render revision

Definition: **the store notification sequence of the latest observable
mutation applied to this live record.** `Store._notify(type, id)` already
stamps a monotonically increasing sequence; when the record is present it also
writes that sequence to the record under a module-level Symbol exported by
`model.js` (`RENDER_REV`), defined non-enumerable and writable at
`_instantiate` so the hidden class never changes. A Symbol rather than a
`_rev` string key keeps the reserved-name set (`_store`, `_type`, `_synced`,
`_deleted`) from growing: payload merges iterate own enumerable string keys, so
no `MERGE_SKIP` entry or schema-name assertion is needed. Every mutation path —
`createRecord`, `update()` via `recordChanged`, `removeRecord`, adapter upserts
and save reconciliation — reaches `_notify`, so the revision advances for every
observable change (verified against `adapter.js` `_upsert` and the save paths).
The existing `MUTATION_REVISIONS` map (D125) is untouched; it counts local
edits only and is the wrong signal for rendering, as the handoff noted. The
revision is an optimization signal, never the sole source of correctness.

### 5.2 Component host: revision-aware prop compare

The host keeps, per record-valued prop, a snapshot `{ ref, rev }` taken when
it last handed props to the child. On update it compares the next value's
reference and *live* revision against that snapshot (§4.4, snapshots); any
difference is a prop change and the child refreshes. Stable callbacks make
the compare meaningful; the snapshot makes it correct. `TodoItem` re-runs
`data()` when its todo mutates through any store path and not otherwise.

The contract this sets: a record prop invalidates the child on that record's
own mutations. A change to a *related* record or to inputs of a computed
getter still requires the child to query in its own `data()` — exactly what
`FLOW-REACTIVITY` documents today, where a record prop never invalidates at
all. The new rule is a strict improvement on the documented contract and
identical to it for relations; what it does not preserve is the undocumented
case where a churning callback prop happened to refresh a child on every parent
render. The "re-query in the child" idiom keeps working and stays the answer
for relation-dependent children.

### 5.3 Dedupe a parent-driven child refresh against the child's own notification

When a child both receives a record prop and queries that record in its own
`data()`, one flush produces two refreshes today. Fix: `Store` exposes the
sequence of the batch it is delivering; a refresh that starts during delivery
captures it and stamps `_settleMark` on commit. The child's own
`onStoreChange(seq)` then takes the existing `seq <= _settleMark` early return.
This is the D161 mechanism applied to one more case, not a new one.

### 5.4 PuzzleView

- `#renderNow`: first render → `create()` (or `skeleton()` while not loaded),
  insert at the anchor, journal; later renders → compute `d`, `block.u(d)`.
  `beforeUpdate`/`afterUpdate` bracket the pass exactly as they bracket a patch
  today; a row-level skip is inside the pass and does not change hook counts.
- Skeleton swap: when a skeleton exists and its root tag equals the template
  root's (always true in view/layout mode, where both sit under
  `<puzzle-view>`; true in component mode whenever the author follows the D39
  advice), the compiler emits a **root-preserving** template — `createRoot`,
  `createBody`, `createSkeletonBody` — and the swap disposes the skeleton body,
  creates the real body under the same root element, and updates the root's
  own attributes. Root identity, `this.element`, and an in-flight enter
  animation are undisturbed. Only a component skeleton whose root tag differs
  from the template's replaces the root (§9).
- `element`: `errorView.element ?? failedPlaceholder ?? block.node() ?? anchor`.
- `__children` (Set) and `__owner` replace `_vnodeTree()` for DevTools; devstate
  registration order stays parents-first because `#completeMount` runs in the
  same places.
- `applyParentUpdate` loses its `children` arm.
- `preload()`, `refresh()`, `prepareRefresh()`, D146 fences, D161 settle loop,
  animations, refs, bind write arms: unchanged.

### 5.5 Error recovery becomes simpler

Today's `treeUnknown`/`unknownRange`/`releaseAborted` exist because a
half-applied patch leaves a vnode tree that lies about the DOM. With blocks the
view owns a **journal** of resources it created (child hosts, document-level
`outside` listeners, portal ranges, refs, `bind` handlers) and a root node.
Recovery on any throw in `create` or `u`: dispose the journal, remove the root
(or the partial fragment), plant the failure placeholder, then the D145 error
view mounts there as it does now. Half-updated DOM inside the discarded block is
irrelevant because the block is gone. `renderFresh`, `plantFailurePlaceholder`
and `releaseAborted` collapse into one path.

---

## 6. Router: only the composition boundary changes

The router today builds a chain of keyed component vnodes with pinned
instances and pushes them through `mount({ children })` /
`applyParentUpdate({ children })` on the layout or root view, relying on keyed
diffing to adopt or replace levels — and it rebuilds the *whole* chain on every
navigation so an ancestor's later re-render cannot push stale slot content back
down.

New model: the router owns a `RoutedContent` factory per level. The layout's
outlet content is `default: (parent, ref) => routedHost(level 0)`; each routed
view's outlet content mounts level `i+1`. On a navigation with `keep = k`:

- Levels `< k` are untouched (their `prepareRefresh` commits as today).
- Level `k`'s host is told to **replace** its mounted routed child: the router
  has already played the outgoing animator out (sequential) or pinned it
  (overlap), so the replacement is `oldHost.destroy()` (instant, the animation
  is spent) + mount the new pinned instance before the same anchor. This runs
  inside the synchronous commit window, so D19/D61 atomicity holds.
- The "stale ancestor revert" hazard disappears: content is no longer part of
  an ancestor's render output, so an ancestor update forwards `u(d)` to
  whatever is mounted and cannot reintroduce an old level.
- `keys[i]` and the `'\x00' + token` freshness stamp are no longer needed; the
  pinned instance *is* the identity.
- `hasSkeleton(view)` becomes `!!view.constructor.__tpl?.skeleton` — a static
  predicate, as the router already wants.
- `view.element`, `playIn/playOut`, `skipEnter`, morph handoff, focus target,
  `warnMissingSlots`, `__failedView`: unchanged.

The router's LOAD/GUARDS/TRANSITION/COMMIT machine, tokens, scroll, head,
transitions, overlap pinning, and recovery paths are not touched.

---

## 7. Prerendering and takeover (hybrid and static)

### 7.1 The `html` target

The same IR emits `Class.__tpl.html = async (view, content) => string` for the
prerender bundle only. Static structure is string literals; dynamic text and
attributes go through the existing `escapeText`/`escapeAttr` rules; controlled
form values follow the current HTML-initial-state equivalents (`value=""`,
`selected` on the matching option, `checked`); void elements, RAWTEXT
`<script>`/`<style>` rules (D113), the JSON-script escape, portal omission
(D144) and placeholder omission are all preserved as helper calls. Component
sites `await` the child's `preload()` (or adopt a pinned instance) and then its
`html()`; content factories are async string functions in the caller's scope;
snippets take args. `ssg/serialize.js` and `expandSlots` are deleted; the
escape/RAWTEXT helpers move to `ssg/html.js`.

The build compiles every `.pzl` twice for prerender output modes (browser
target and html target) with the target in the compile-cache key; the html
output never enters a browser bundle (`html` is emitted only for the Node
pass, so nothing needs to be tree-shaken away).

Differential test: for every fixture and example route, `html()` output must
equal the outerHTML of a jsdom mount of the `dom` target after the documented
form-value normalization — the `ssg-equivalence` suite, regenerated.

### 7.2 Takeover without a tree walk

Today `preload.js` renders each nested component off-DOM to discover and
preload its children before clearing the prerendered page, so the swap is one
synchronous mount. New sequence, shared by the router (hybrid, navigation #0)
and `mountStatic`:

1. Assemble the chain as now (routed instances preloaded).
2. Create a `DocumentFragment`; mount the chain into it under a **takeover
   barrier** on the app. Nested components mount through the normal host path
   (async `data()`, anchor comment) and every host registers its mount promise
   with the barrier. The barrier **stages every side effect that would escape
   the fragment**: `#completeMount` queues `mounted()`; `outside` listeners
   queue their `document.addEventListener`; portals mount their ranges into a
   barrier-owned detached outlet instead of the live one. Refs point at
   detached elements until the swap, which is fine. Nothing in the visible
   page changes or becomes interactive during preparation.
3. `await barrier.settled()` — resolves when every registered mount (including
   ones created by mounts that resolved later) has rendered or failed
   (failures keep today's fail-soft placeholder).
4. Commit, in a defined order: `container.replaceChildren(fragment)`; move the
   staged portal ranges into the live outlet; attach the queued document
   listeners; fire the queued `mounted()` hooks in registration order (parents
   first — the order devstate keys HMR state on). `skipEnter()` every
   instance, as today. Each staged resource activates exactly once.
5. Failure of the top-level mount releases every staged resource and restores
   the snapshotted prerendered nodes (existing `#takeoverSSG` contract).

This deletes `preload.js`, `__takeoverTree`, `takeoverPreloaded`/`takeoverFailed`
and the `slotsExpanded` branch. `__PUZZLE_TAKEOVER__` keeps gating the barrier
code so plain SPA builds do not carry it. There is still no hydration: nodes
are replaced, not adopted, and prerendered HTML carries no markers.

`mountStatic` for an unmarked `prerender: false` page mounts directly, as now.

---

## 8. Compiler

### 8.1 Pipeline

```text
sections → parser (unchanged) → a11y warnings (unchanged) → {#svg} resolution (unchanged)
        → lower to IR (analyze.go)
        → dependency analysis: roots, per-expression root masks, scope masks, volatility,
          per-loop `fields`/`deep`, static-subtree detection
        → emit_dom.go  |  emit_html.go
        → module assembly (script verbatim + imports + __tpl + __pzlModule), reserved-name check
```

`ir.go` node kinds: Element (tag, namespace, static/dynamic/mixed attrs,
events with modifiers, bind, ref, key, island, flip, raw inner), TextRun,
If, Case, Key, For (item/range, counter, key expr, body root), Component
(class expr, props, content: default/named/snippets), Slot (name, args,
fallback), Snippet (fits, params, body), Portal. Source spans on every node for
diagnostics.

One **semantic classification pass** on the IR decides, once, what every
attribute and element is — boolean property, controlled property, ordinary
attribute, literal-at attribute, event, framework directive, raw text, void
element, namespace — and both emitters consume that classification rather than
re-deriving it from the AST, so they cannot drift. In development builds every
block and binding carries its source site (`file:line:col`, kind) and runtime
diagnostics name it (`[puzzle] update failed at TodoItem.pzl:18:9`); the
metadata folds away under the production define.

### 8.2 Analysis reuses `expr.go`

`resolveExprTrackingScope` already reports scope references; extend it to
return the set of root names it prefixed and the set of scope locals it read.
Root masks come from that set; scope masks from the lexical chain; a
root-free, local-free expression is volatile. Loop `fields`/`deep` come from
walking member chains rooted at the item. No second scanner, no regexes —
the codegen card's "two scanners must agree" gotcha does not grow a third.

### 8.3 What the DOM emitter must preserve (all currently in `viewManager.js`)

The property/attribute split (`value`, `checked`, `disabled`, `selected`,
`muted` as properties with attribute coherence), `false`/nullish removal,
`true` → empty attribute, `@@name` literal-at attributes (D150), SVG namespace
and `foreignObject`, `select` re-assert after options, the undefined-value dev
warning with the attribute name as label (D127), `ref` timing (set before
children mount and before `mounted()`), `once` spend and `outside` capture
listeners on `document` with portal-aware containment (D86), the committed-scope
fence around every handler (D146), bind coercions and IME guard (D147), island
children frozen after seed, inline-SVG seeds verbatim, portal placeholders,
`flip` never reaching the DOM. Each becomes one helper in `render/dom.js`
with the same tests it has now.

### 8.4 Feature gating

Because the emitted module imports exactly the helpers it uses from
`@magic-spells/puzzle/render`, esbuild drops unused ones by construction.
The D89 scan-based defines `__PUZZLE_HAS_PORTAL__`, `__PUZZLE_HAS_FLIP__`,
`__PUZZLE_HAS_SNIPPETS__`, `__PUZZLE_HAS_RAW_AT__` and their false-negative
warnings for installed pieces are retired. `__PUZZLE_DEV__`,
`__PUZZLE_TAKEOVER__`, `__PUZZLE_HAS_LAZY__`, `__PUZZLE_CAPTURE__` stay.

### 8.5 Tooling that consumes codegen

- `pzlc` gains `--target dom|html`; `puzzle build` selects per pass.
- `plugin/cache.go` and `scanmemo.go` key on target and ABI version.
- `cmd/pzl-wasm` (the playground core, D164) emits the dom target; the
  playground's runtime copy moves to the new render helpers.
- `check/emitter.go` keeps using `ResolveCheckExpr`/`ResolveCheckEvent`; the
  IR does not change what it type-checks.
- Goldens: every construct fixture regenerated for both targets; the
  hand-written todos fixtures are rewritten **first** and the emitter is
  matched to them (the D14 discipline).

### 8.6 Template-cloning risks and the escape hatch

Both reference implementations parse templates through `<template>.innerHTML`
and clone. The hazard is that the HTML parser **repairs** markup: it closes a
`<p>` before a block element, foster-parents stray table content, restructures
`<select>`/`<option>`/`<optgroup>`, refuses nested `<a>`, `<button>` and
`<form>`, treats `<textarea>`/`<script>`/`<style>` as raw text, drops
`<noscript>` content inside a template, and merges adjacent text nodes. A
repaired fragment breaks the compiled walk. Three layers of defense:

- The compiler predicts the repairs it can (the content-model rules above,
  which are finite and well documented) and either reports a positioned error
  or emits that subtree through the imperative `createElement` path; the
  namespace wrapper handles SVG/MathML roots; `<textarea>` and `<option>`
  values are assigned imperatively; inline `<script>` in a template never
  executes when cloned (compile error unless inside `{#raw}`, where it is
  documented as inert today too); adjacent dynamic text runs are separated by
  anchors by construction.
- In development builds `tpl()` verifies, once per template on first clone,
  that the cloned DOM's node signature matches the walk the compiler expected,
  and throws a positioned diagnostic naming the template if it does not — so
  any repair the compiler failed to predict is caught at the first render in
  dev, never as a silent wrong-node write in production.
- A Playwright fixture suite covers tables, `select`/`option`, `textarea`,
  `p` auto-closing, SVG, MathML, `foreignObject`, `script`/`style`,
  `noscript`, and adjacent text, asserting the walk against the real cloned
  DOM in all three engines.

Under a `require-trusted-types-for 'script'` CSP, `innerHTML` throws;
Svelte's answer is a `fragments: 'tree'` mode that builds with `createElement`.
Puzzle gets the same knob (`build: { templates: 'clone' | 'create' }`, default
`clone`), implemented in the emitter, not the runtime — and the imperative path
already exists for repaired subtrees, so the knob is that same emitter mode
applied globally. Ship it in 0.8.0.

---

## 9. Behavior changes (the honest list)

Each is a deliberate simplification. Cory decides on the first three.

1. **Keys are loop-local.** Two sibling loops (or a loop and a keyed static
   sibling) no longer share a key namespace; a keyed node cannot move between
   producers. `key=` on a non-loop element becomes a keyed block with the same
   "replace when the key changes" effect.
2. **Conditional branches remount.** Switching `{#if}`/`{#case}` branches
   destroys the old branch's nodes and creates the new ones; a same-tag element
   across branches is not reused. Toggling a branch never disturbs siblings
   (anchors), which is the guarantee the arity placeholders existed for.
3. **A component skeleton whose root tag differs from the template's replaces
   the root.** Matching roots (and every view/layout) keep root identity
   through the swap, which is what the SPEC's "keep the skeleton root tag
   equal" advice already asks for; only the mismatched case changes.
4. **Slot-only changes update in place.** The caller's update pass updates its
   content blocks inside the child, bracketed by the child's
   `beforeUpdate`/`afterUpdate`; the child's own bindings do not re-render and
   its `data()` does not re-run. `applyParentUpdate({ children })` is gone.
5. **Record props are revision-compared.** A child receiving a `PuzzleModel`
   prop re-runs `data()` when that record changes. The "re-query in the child"
   idiom keeps working and stops being necessary.
6. **All handlers are identity-stable.** D62's cache is generalized and
   `__h` disappears.
7. **SVG `<text>` works.** The `'text'` vnode-tag collision the three chart
   pieces work around no longer exists; their comments become stale (harmless)
   and can switch to real `<text>` later.
8. **Compiler ABI:** `ViewNode`, `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG` leave
   the package root; `render()`/`renderSkeleton()`/`skeletonMinDuration`/`__h`
   are gone; `@magic-spells/puzzle/render` appears. Apps built by an older
   compiler against the new runtime fail at compile time (the build pins the
   compiler), never silently at mount. Types drop `render(): any`.
9. **D17 is rewritten in place** (the rendering-model decision), not
   superseded; D18 (per-node listeners), D20 (inline components, no wrapper),
   D58 (keying), D62 (stable handlers — now by construction), D85, D86, D141,
   D144, D147, D166 keep their contracts and get their mechanism paragraphs
   updated.

Everything else in the SPEC is byte-for-byte or behavior-identical, and the
equivalence suite is what proves it.

---

## 10. Implementation plan

Six phases, each a reviewable PR set into `release/0.8.0` (branched off
`release/0.7.1` once 0.7.1 ships; Cory tags/publishes). The order is
**vertical**: after the spike, the real compiler reproduces the spike before
any further runtime work, and every later feature lands as emitter + runtime
helper + emitted fixture + ported tests together, so no helper is ever built
against imagined output. Builders per the model policy: **Opus** for runtime
and front-end integration, **Codex** for the Go compiler and the html emitter
(logic-heavy, literal), **Opus** reviews every diff, Fable at the four gates
marked ★.

### Phase 0 — Fixture-first spike ★

- Hand-write the compiled output for `TodoItem.pzl`, `Home.pzl`,
  `Default.pzl` (todos) in the §3.2 shape, both targets. These are the byte
  contract for the emitter, as `Home.compiled.js` was for D14.
- Implement the minimum runtime to run them: `render/dom.js` helpers,
  `ifBlock`, `listBlock` (no FLIP yet), `host` with content factories and
  prop snapshots, the `PuzzleView` dirty-mask pass with `create → u(ALL) →
  insert`, behind an `__tpl` check (a class without `__tpl` still takes the
  old path, so the tree stays green).
- Run the todos suite against the hand-written fixtures. Measure: todos gzip
  with the new helpers vs 0.7.1; the stress example's `list-update` counters
  (row work per record change).
- **Size spike (§11.1):** the fixtures are written in the table-driven shape
  with the walk descriptor and constant folding, and the five-template corpus
  plus a hand-converted `stays` route are measured against the §11 gates
  before any Go work starts.
- **Gate:** the todos suite passes on the new path; the measured shape is what
  §0 promises (zero vnode allocation, one row updated per record change); the
  size gates hold on the corpus; the ABI is frozen and written into D170.

### Phase 1 — Minimal real compiler (Codex) ★

- `ir.go`, `analyze.go`, `deps.go`, the semantic classification pass, and
  `emit_dom.go` for exactly the todos subset: elements, text runs, static and
  dynamic attributes, events, implicit binding, `{#if}`, item-form `{#for}`,
  component props and default content. `pzlc --target dom`; cache keys; the
  a11y, reserved-binding, import-collision and formatter-manifest scans
  unchanged.
- **Gate:** the emitter reproduces the Phase 0 fixtures byte-for-byte and the
  todos suite passes on emitted output; all Go suites green.

### Phase 2 — Feature by feature, emitter and runtime together (Codex + Opus)

One PR per construct, each carrying the emitter change, the helper, the
emitted golden, and the ported tests for that construct: `{#case}`, keyed
blocks, range loops and counters, nested loops, refs, named slots and
fallbacks, snippets and forwarding, portals, islands (one-shot init),
`{#svg}`/`{#raw}`, SVG namespaces, FLIP and leave animations, duplicate/null
key policy, skeletons (root-preserving), error journal and recovery, the store
render revision (§5.1) and the flush-seq stamp (§5.3), DevTools containment,
WASM and `puzzle check`. The test suites that hand-built vnodes
(keyed-reconciliation, composition, named-slots, snippets, slot-forwarding,
portal, animations, flip-reorder, leave-inertness, element-refs, binding,
event-modifiers, outside-modifier, dom-islands, inline-svg, error-boundaries,
first-mount-throw, mount-failure-recovery-race, render-null-clears-dom,
component-prop-bailout, memo, morph-*) port with their construct. Test
ergonomics: a vitest helper `compilePzl(source, { mode })` backed by the WASM
compiler core (`__pzlCompile`) so a test can inline a `.pzl` string; `pzlc`
via child process as the fallback. The parser-repair suite (§8.6) lands here.
Gate: every example under `examples/` compiles, builds and runs its browser
smoke.

### Phase 3 — Router, takeover, tooling (Opus)

- `RoutedContent` factories and the level-`k` replace (§6); remove chain
  vnodes and key stamps; static `hasSkeleton`.
- Takeover barrier with staged portals, document listeners and `mounted()`
  hooks (§7.2) in the router and `mountStatic`; delete `preload.js`.
- devtools.js on `__children`; devperf spans renamed (`create`/`update`/`list`
  instead of `tree built`); HMR unchanged but re-verified; morph timing
  re-verified in the browser suite.
- Port the router-* and app-* suites that touch composition.

### Phase 4 — html emitter and prerender (Codex) ★

- `emit_html.go`; `ssg/html.js` helpers; `prerender.go` two-target build;
  `ssg/index.js`/`assemble.js` on `__tpl.html`; delete `serialize.js`.
- Regenerate `ssg-equivalence`, `ssg-serialize`, `static-kernel`,
  `ssg-router-takeover`, `prerender-router-base` suites.
- **Gate:** every `examples/*` hybrid and static build produces HTML
  byte-identical to 0.7.1's output for the same data (a golden diff of
  `dist/`), and takeover leaves the same DOM as a fresh SPA mount.

### Phase 5 — Parity, oracle, measurement ★

- Differential run: the old renderer (still in the tree, unused by builds)
  drives the same fixtures and action scripts as the new one; compare
  semantic DOM, form properties, lifecycle logs, handler arguments, resource
  counts. Approved differences are exactly §9.
- Optimization-off run: force every dirty bit on for the whole suite; the DOM
  must be identical (the §3.1 invariant).
- Browser suite additions: focus/selection/IME survival across reorders,
  branch switches, skeleton swaps; portal in a moving row; FLIP under leave.
- `npm run bench` on the stress example with new scenarios (`list-update-1`,
  `list-update-all`, `deep-nest` unchanged); `measure:size --check`.
- **Gate:** §11 numbers and §12 checklist.

### Phase 6 — Delete and document

- Remove `viewManager.js`, `ViewNode.js`, `preload.js`, `serialize.js`, the
  retired defines, `__h`, arity padding in codegen; rewrite D17 in place; new
  D170 marked `built`; update `COMPONENT-VIEW-MANAGER` (renamed to the render
  runtime card), `COMPONENT-CODEGEN`, `COMPONENT-PUZZLE-VIEW`, `COMPONENT-SSG`,
  `FLOW-REACTIVITY`, `DOC-VIEW-LIFECYCLE` §1/§5, SPEC sections touched by §9,
  `DOC-RELEASE-SURFACE`, the agent skill, the pieces `CLAUDE.md` `<text>` rule,
  types, `tests-types/consumer.ts`, puzzle-prettier's recompile test, the
  stress example's README claims, CHANGELOG. `release:prep` unchanged.

### Rough size of the work

| Area | New/changed | Deleted |
|---|---|---|
| `client-runtime/render/` (dom helpers, blocks, list, host, content, portal glue) | ~1,400 lines | — |
| `PuzzleView.js` | ~400 changed | ~300 |
| `router.js` composition | ~300 changed | ~150 |
| `store.js`, `model.js` | ~40 | — |
| `ssg/`, `static/` | ~250 | ~500 (`serialize`, `preload`) |
| `viewManager.js`, `ViewNode.js` | — | ~1,950 |
| Go: `ir.go`, `analyze.go`, `deps.go`, `emit_dom.go`, `emit_html.go` | ~3,000 | ~700 of `codegen.go` (vnode emission, arity padding) |
| Tests | ~60 files ported, ~15 new | — |

Net runtime source shrinks. The framework's byte size is a §11 measurement,
not an estimate.

---

## 11. Measurement plan

Same harness, same discipline as D128: production builds only, medians, the
stress example driven through `window.__STRESS__`, plus `measure:size`.

| Measure | 0.7.1 baseline | 0.8.0 target |
|---|---|---|
| hello-world / todos gzip (README banner) | 20.9 / 23.9 KB (rebuilt 2026-09-10) | ≤ baseline; hard gate ≤ +1.0 KB each with a written decision if positive |
| Emitted render tail per template, gzip, five-template corpus (§11.1) | 5,121 B over 5 tails; 3,481 B concatenated | ≤ +10% per template and concatenated |
| `examples/stays` (16 templates) `app.js` gzip | 37.7 KB | ≤ baseline |
| Removable renderer today (`viewManager` + `ViewNode` + portal + flip, production defines) | 7.1 KB gzip (6.0 KB without portal/flip) | the new `render/` helpers reported against it; Solid's minimal-app floor is ~6 KB gzip (measured 2026-09-10, `solid-js` 1.9.15), Svelte 5's ~20 KB |
| `list-update-1`: 1,000 record rows, one field edit | full tree rebuild + diff | 0 allocations in the row layer beyond the key map; 1 row updated; ≤ N key reads + N revision compares |
| `list-update-all`: all rows change | — | ≤ N row updates, no duplicates |
| Reorder 1,000 rows (reverse, rotate, shuffle) | — | survivors keep DOM identity; moves ≤ today's algorithm |
| `deep-nest` (FLOW-REACTIVITY table) | 1 of 1,536 `data()` runs | unchanged |
| Mount 5,000 rows | — | ≤ baseline time; heap after unmount returns to baseline |
| Takeover (hybrid, static): time to interactive, DOM equality with a fresh mount | — | equal DOM; time ≤ baseline |

Work counters (dev-only, via devperf): `data()` runs, root-mask computations,
key reads, rows skipped / updated, binding evaluations, DOM writes. The D121
"zero mutation delta = wasted render" definition stays the wasted-render
definition.

### 11.1 Measured 2026-09-10: the naive shape is larger, and what that means

Five real templates (the three todos fixtures plus the two largest music
templates, `QueueDialog.pzl` and `AppLayout.pzl`) were hand-written in the
§3.2 shape exactly as sketched — one guard line per binding, `first`/`next`
walk chains — and minified and gzipped against today's vnode output, user
scripts stripped so only the compiled tail is compared:

| | old min | old gz | new min | new gz | gz new/old |
|---|---|---|---|---|---|
| TodoItem tail | 1,720 | 856 | 1,882 | 1,038 | 1.21 |
| Home tail | 4,534 | 1,335 | 4,791 | 1,929 | 1.44 |
| Default tail | 1,269 | 576 | 1,172 | 618 | 1.07 |
| QueueDialog tail | 3,311 | 1,131 | 4,019 | 1,704 | 1.51 |
| AppLayout tail | 4,290 | 1,223 | 5,095 | 1,859 | 1.52 |
| five tails concatenated (the bundle case) | 14,878 | 3,481 | 16,522 | 5,282 | **1.52** |

Static bytes (Tailwind class strings, ~35–45% of every tail) are
shape-neutral. The loss is in the machinery: the vnode form's
`new e("div",{class:"…"},[` scaffolding repeats hundreds of times and gzips to
almost nothing, while walk chains and guard lines are unique one-offs (the
new machinery is ~570 B *smaller* raw and 1.64× *larger* gzipped), and
closing tags in HTML strings cost more than `,[])`.

The crossover math with these numbers: the removable renderer is ~7 KB gzip
and the new helpers will be ~3–4 KB, so the runtime saving is ~3 KB; at
+0.36 KB gzip per template in a bundle, an app of 8–9 templates breaks even
and `examples/stays` (16) or `music` (21) would grow by 2.5–4.5 KB. That is
Cory's concern exactly, and the naive shape fails it.

Three emitter levers are being measured on the same corpus before the
direction is confirmed:

1. **Table-driven bindings.** `create()` returns `block(root, bindings)` where
   each binding is a short tuple `[node, KIND, mask, () => expr, extra?]` and
   one shared runtime loop does the mask test, the last-value compare and the
   write. Per-binding code becomes small and repetitive, which is what gzips.
   Zero allocation per update is preserved (the table is built once).
2. **A compact walk descriptor.** One `walk(root, path)` call per template
   returning the dynamic nodes, instead of a chain of `first`/`next` locals.
3. **Constant folding.** A root-free, local-free expression whose only calls
   are formatter calls over literals (`link('/albums')`) is evaluated once at
   create time and gets no binding. AppLayout alone carried six such guards.

A fourth, Solid-style lever — omitting quotes and redundant closing tags in
the template string — is measured separately because it relies on parser
recovery, which §8.6 treats with suspicion.

**Decision rule.** If the levers bring the corpus within the +10% gate and
`stays` does not grow, the direction stands with the table-driven shape as
the primary emitted form. If they do not, the trade (bytes versus update
work) goes back to Cory as a decision, not a surprise; the plan does not
ship a larger bundle on the strength of a runtime win.

### 11.2 Measured 2026-09-10, second pass: the levers do not reach the gate

The same five templates re-encoded with all three levers (v2) and with the
Solid-style tag/quote tightening added (v2b). Walk paths were verified against
the naive chains in jsdom; every v2b template re-parses to a byte-identical
tree.

| Render tail, gzip | old | naive | v2 | v2b |
|---|---|---|---|---|
| TodoItem | 856 | 1,038 | 937 | 921 |
| Home | 1,335 | 1,929 | 1,622 | 1,598 |
| Default | 576 | 618 | 604 | 592 |
| QueueDialog | 1,131 | 1,704 | 1,424 | 1,410 |
| AppLayout | 1,223 | 1,859 | 1,555 | 1,537 |
| sum of five | 5,121 | 7,148 (1.40×) | 6,142 (1.20×) | 6,058 (1.18×) |
| **concatenated (bundle case)** | **3,481** | 5,282 (1.52×) | **4,413 (1.27×)** | **4,353 (1.25×)** |

Minified bytes reach parity (+0.8% v2, −1.5% v2b); gzip does not. The
ablation says where the bytes are: the tuple table is worth ~730 B gzip on
the concat (machinery gzip goes from 1.65× to 1.18× of the vnode form — it
compresses almost as well as the constructor scaffolding did), the walk
descriptor ~163 B, and constant folding is gzip-*negative* (+24 B: six
near-identical `link()` tuples compressed better than three unique consts).
The remaining gap is the static HTML: the template strings cost ~560–625 B
more gzipped than the vnode literals across five templates, because closing
tags and attribute syntax are less compressible than `,[])` — and that part
is the floor §0 described, since both forms must carry the structure. The
shared `block()` + `walk()` runtime adds a further 506 B gzip once per app,
on top of the helpers the naive form already needed.

Crossover with these numbers: +187 B gzip per template in a bundle against a
~2.5 KB runtime saving (after the block runtime) — break-even around 13
templates; todos shrinks ~2 KB, `stays` grows ~0.5 KB, `music` ~1.4 KB.
The +10% gate is missed by every variant, and the tuple encoding brought
its own costs (one dirty word per tuple, so a row binding that reads both
root and scope data needs two masks; nested loops need a third; tuple index
is load-bearing state; component rows still need an explicit host call).

**Outcome of the decision rule:** the direct-DOM shape does not pay for
itself in bytes on real Puzzle templates. Its remaining case is CPU and
allocation per update, and most of that is reachable inside the existing
architecture. The recommendation to Cory (2026-09-10) is therefore to
**re-scope D170 to a compiler-informed VDOM**: persistent keyed list blocks
with cached row subtrees, an identity short-circuit in `patch()`, static
subtree caching per instance and row, the record render revision with
snapshot-based prop comparison, stable loop handlers via a live scope, and
the flush-sequence dedupe — with the direct-DOM design retained in this
document as the measured alternative. That re-scope is written up separately
once Cory confirms the direction.

---

## 12. Release gates (go/no-go)

- [ ] Every SPEC contract in §1 holds; only §9 changes are observable.
- [ ] Phase 0 fixtures are reproduced byte-for-byte by the emitter.
- [ ] All examples build (SPA, hybrid, static, splitting, lazy) and pass their
      smokes; `verify:pack`, `test:types`, `test:e2e-pack`, the Playwright
      suite, both sibling suites (devtools, pieces) green.
- [ ] Prerender HTML golden-diffs clean against 0.7.1 for every example route.
- [ ] Differential parity run clean except approved §9 differences.
- [ ] Optimization-off run (all dirty bits forced) produces identical DOM.
- [ ] Revision correctness: same reference + advanced revision invalidates a
      record prop; the previous revision is a stored number; server merges and
      local updates both advance it; a replacement record with the same key
      updates the retained row.
- [ ] Volatile bindings run on a pass with no dirty root; `refresh()` forces
      re-evaluation without a fake data change.
- [ ] Takeover isolation: no portal content, no `document` listener, no hook
      fires before the swap; the old page stays the only interactive tree;
      staged resources activate exactly once; a failed takeover releases them.
- [ ] Template cloning: the parser-repair suite passes in all three engines;
      the dev walk check throws on a repaired fragment; unsafe structures get a
      positioned diagnostic or the imperative path.
- [ ] Initial render: no placeholder text is ever visible; first refs and
      `mounted()` observe initialized, connected DOM.
- [ ] Island seed bindings initialize once and never update afterwards.
- [ ] Slot-only updates fire the child's update hooks; skeleton root identity
      behavior is tested for both the matching and the mismatched case.
- [ ] Leak tests: mount/reorder/remove/navigate loops return listener, portal,
      subscription and `__children` counts to baseline.
- [ ] Browser identity tests: focus, selection, IME, uncontrolled edits
      survive reorder and branch switch as documented.
- [ ] §11 size and work-count gates met, numbers reproduced from the final
      artifacts.
- [ ] No `ViewNode`, `viewManager`, `expandSlots`, `serialize`, `preload`
      reachable in any browser bundle (metafile check).
- [ ] Cards, SPEC, skill, types, CHANGELOG, README banner updated; D17
      rewritten; D170 `built`.

---

## 13. File map (target state)

```text
client-runtime/
  render/
    dom.js         tpl/tplSvg, first/next, setAttr/setProp/setValue/setChecked/reassertSelect,
                   text helpers, on/bind/outside listeners, ref, journal
    blocks.js      ifBlock, caseBlock, keyBlock, static block, anchors
    list.js        listBlock: keys, reconcile, placement, leaving, skip rule, FLIP hooks
    host.js        component host: construct/adopt, props compare (_rev), content registry,
                   __children/__owner, settle registration, error handoff
    content.js     content factories, named/default/snippet mounting, forwarding
    index.js       the '@magic-spells/puzzle/render' surface
  views/
    PuzzleView.js  (create/update integration, dirty masks, skeleton swap, journal)
    portal.js      (outlet ranges, containment — kept)
    flip.js        (entry-based API — kept)
    animate.js, visibility.js (unchanged)
  ssg/
    html.js        escape/RAWTEXT/select helpers for the html target
    assemble.js, index.js (on __tpl.html)
  static/index.js  (takeover barrier + swap)
  router/router.js (RoutedContent factories)
  datastore/store.js (_rev, delivering seq)
compiler/internal/codegen/
  ir.go analyze.go deps.go emit_dom.go emit_html.go   (new)
  codegen.go (orchestration + module assembly)  expr.go (extended)  binding.go a11y.go … (unchanged)
```

Deleted: `views/viewManager.js`, `views/ViewNode.js`, `ssg/serialize.js`,
`ssg/preload.js`, `0.8.0-plan/` (once D170 is written up).

---

## 14. Micro-state walkthroughs

**A. `setData('newTodoText', 'ab')` on Home.** `#scheduleRender` → rAF →
`flushUpdates` → `#renderNow`: dirty = `{newTodoText}` → `u(d)`: the input's
`setValue` compares to the live property (equal, typed by the user) → no
write; the button's `disabled` guard re-evaluates → writes only on a
flip. No other binding runs. `beforeUpdate`/`afterUpdate` fire once.

**B. `todo.update({ completed: true })` with 1,000 todos.** `_notify` stamps
`todo._rev`; flush → Home.`onStoreChange` → `data()` (findMany + two filters)
→ commit → dirty = `{todos, activeTodos, completedTodos, filteredTodos}`
(`hasData`, `currentFilter`, `newTodoText` clean) → `u(d)`: stats texts
re-evaluate (`__s(n)`), write only the two that changed; the list reconciles
`filteredTodos` (1,000 key reads; if the todo left the `active` filter, one
removal with its leave animation); per row: `sd` = 0 for 999 rows (same
record ref, same `_rev`), 1 for the changed row → its host compares props →
`todo` differs by `_rev` → `TodoItem.refresh({ props })` → its `data()` → its
`u(d)` writes the checkbox, class, and text. If `TodoItem` also queried the
record itself, its own `onStoreChange(seq)` is skipped by the `_settleMark`
stamp (§5.3).

**C. Navigation `/todos` → `/todos/7`, nested route, `keep = 1`.** Guards,
load, `prepareRefresh` on the reused level as today. Commit: level 1 host
disposes the old routed view (already played out) and mounts the pinned,
preloaded detail view before the same anchor; ancestor commits apply; URL and
title land in the same synchronous block. No chain vnodes, no key stamps.

**D. Hybrid takeover, navigation #0.** Chain assembled; fragment mounted under
the barrier; nested components' `data()` settle; one `replaceChildren`;
queued `mounted()` hooks fire parents-first; `skipEnter` everywhere; morph
`enter(el, { initial: true })` and focus behave as now.

**E. `create()` throws in a nested component's first mount.** The host's
mount promise rejects → the same `reportError` funnel → the child's journal
is disposed, the anchor stays as the failure placeholder, the D145 error view
mounts there if configured; the parent's block is untouched.

**F. Leave mid-update.** A row's component is removed while animating out:
the list block marks it leaving, moves skip it, a new row with the same key
is a fresh instance (the old one is not in the map), and the old
`destroyAnimated` completion removes only its own node.

---

## 15. Risks and blind spots

| Risk | Mitigation |
|---|---|
| The long tail of `viewManager.js` semantics (13 categories in §8.3) silently regresses in helpers | Each category's existing test file is ported before its helper is written; the oracle run in Phase 5 |
| Router composition rewrite destabilizes D19/D61/D146 ordering | Router state machine untouched; only the outlet replace is new; the router-* suites are the largest in the tree and all port |
| Takeover barrier changes `mounted()` timing for nested components on prerendered pages | Documented: hooks fire after the swap, connected, parents-first — strictly better than firing against a detached fragment; the static-kernel and takeover suites assert order |
| Row skip hides a legitimate update (relation/getter reads) | Eligibility rule (§4.4) is checked at runtime against the model's schema; a dev counter shows skips; the rule can be disabled per site without output change |
| Template cloning under Trusted Types CSP | `templates: 'create'` emitter mode (§8.6), scheduled in 0.8.0 or 0.8.x |
| Generated code per template grows more than the runtime shrinks — **measured: the naive guard-line shape is +40% gzip per template, +52% across a bundle** (§11.1) | Phase 0 is a size spike on the emitter levers (table-driven bindings, walk descriptor, constant folding); §11 hard gates on the corpus and on `stays`; if the levers miss the gate, the trade returns to Cory rather than shipping a larger bundle |
| Test-suite port is the largest single cost and can drag | `compilePzl` helper (WASM) makes inline `.pzl` tests cheap; port one category per PR alongside its helper |
| Two emitters drift (dom vs html) | One IR; the equivalence suite diffs every fixture and example route |
| Playground (D164) and DevTools panel break mid-migration | Both consume the same compiler/runtime and are in CI; the ABI version check turns a mismatch into a message |

---

## 16. Questions for Cory

1. Loop-local keys (§9.1) — accept the semantic change?
2. Conditional branch remount (§9.2) — accept?
3. Skeleton roots: revision 2 preserves root identity whenever the tags match
   and replaces only a mismatched component skeleton root (§5.4). Agree?
4. Row skip: revision 2 defers it to 0.8.x and ships the re-evaluate baseline
   (§4.4). Agree?
5. Old renderer as oracle until Phase 5 (both reviews recommend it). Agree?
6. `templates: 'create'` mode: revision 2 puts it in 0.8.0 because the
   imperative path exists anyway for repaired subtrees (§8.6). Agree?
7. Codex for the Go emitters, Opus for the runtime — agree with the split?

---

## 17. Changes in revision 2 (after the GPT-6 Pro review, 2026-09-10)

Adopted:

| Review item | Change here |
|---|---|
| Revision compares must use a stored snapshot, not the old object's live value | §4.4 "Revision snapshots", §5.2 |
| Use a Symbol for the render revision, not another `_` string field | §5.1 |
| Model roots cannot be proven clean by a revision (relations, getters) | §3.1: records always dirty in 0.8.0; narrowing is 0.8.x |
| Volatile bindings need a true always-run path, not an all-ones mask | §3.1 pass bit |
| Whole-row revision skip is unsafe under direct field assignment; defer | §3.5, §4.4 |
| The takeover barrier must stage portals and `document` listeners, not only hooks | §7.2, §12 |
| Template cloning must be validated against HTML parser repair | §8.6 three layers, §12 |
| First render must initialize bindings before insertion | §3.1 "First render" |
| Island seed content may contain bindings and must initialize once | §3.3 |
| Preserve skeleton root identity when tags match; decide replacement deliberately | §5.4, §9.3 |
| Slot-only updates should keep the child's update-hook timing | §3.6, §9.4 |
| Interleave compiler and runtime work; the compiler reproduces the spike first | §10 |
| Classify element/attribute semantics once in the IR for both emitters | §8.1 |
| Carry source-site metadata in development diagnostics | §8.1 |
| Correctness must never depend on a dirty mask or revision | §3.1 invariant, §12 optimization-off gate |
| Additional release gates (revision, volatile, takeover, cloning, initial render, island, lifecycle) | §12 |

Noted, not changed: streaming the key computation during reconcile is already
the design (§3.5); LIS stays optional (§3.5); the ABI's short member names
(`n`/`u`/`x`) are the emitted form of the reviewer's `node`/`update`/`destroy`
and are cosmetic. The review's recommended-decisions table matches this
revision's §16 recommendations.

## Appendix A — Reference implementations (verified 2026-09-10)

Measured locally by compiling real components with `svelte@5.57.0` and
`solid-js@1.9.15` and reading the runtime sources; sizes via esbuild,
minified, production, gzip.

- **Svelte 5 client:** `$.from_html(html)` template hoisted to module scope,
  parsed once via `<template>.innerHTML`, cloned per instance; nodes located by
  `$.child`/`$.sibling(node, n)`/`$.only_child` with whitespace nodes counted
  in the offsets; updates in `$.template_effect`; `$.if` with a `<!>` anchor;
  `$.each` keeps a `Map<key, item>` plus a linked list and moves the shorter
  run — **not LIS**; events delegated (`$.delegate([...])`). Server output is a
  separate target pushing strings into a renderer with `<!--[-->`/`<!--]-->`
  block markers used by hydration. Minimal app ≈ 20.1 KB gzip.
- **Solid:** `_$template(html)` clone, raw `firstChild`/`nextSibling` chains
  (JSX strips whitespace, so chains are dense), `insert(parent, accessor,
  marker)` effects, `<For>` via `mapArray` (reference identity) and a udomdiff
  reconcile — **not LIS**; delegated events; SSR is a third codegen producing
  string chunk arrays with `<!--$-->`/`<!--/-->` fences and `data-hk`
  hydration keys. Minimal app ≈ 5.9 KB gzip.
- **Documented gotchas adopted here:** SVG/MathML root wrapping; `<textarea>`
  and `<option>` values set imperatively; cloned `<script>` never executes;
  `<noscript>` content dropped by the template parser; Trusted Types needs a
  `createElement` build mode; adjacent text nodes must be separated to
  survive parsing.

Sources: `sveltejs/svelte` `internal/client/dom/{template,operations,
reconciler,hydration}.js`, `dom/blocks/{each,if}.js`, `internal/server/*`;
`ryansolid/dom-expressions` `src/{client,server,reconcile}.js`;
`solidjs/solid` `packages/solid/src/reactive/array.ts`; Svelte compiler docs
(`generate`, `fragments`).

## Appendix B — Helper surface (`@magic-spells/puzzle/render`), sketch

```ts
tpl(html): () => Node            tplSvg(html): () => Node
first(n): Node                   next(n): Node
setAttr(el, name, v)             setProp(el, name, v)      setValue(el, v)   setChecked(el, v)
reassertSelect(el, v)            setLiteralAt(el, name, v)                     // D150
on(view, el, type, fn, mods?)    outside(view, el, type, fn, mods)             // journaled on view
bind(view, el, event, target: () => object|null, key, spec)
ref(view, el, name)              unref(view, el, name)
ifBlock(prev, anchor, index, factories...)        caseBlock(...)      keyBlock(prev, anchor, key, factory)
listBlock(anchor, view, def)     // reconcile(items), u(d), x()
host(view, Class|instance, parent, ref, { props, content })   // props(next), uContent(d, sd), node(), destroy()
slot(view, marker, contentFactory|null, fallbackFactory|null)
portal(view, anchor, factories)
__s = displayValue               keyOf(item)
```

## Appendix C — html target sketch (TodoItem)

```js
TodoItem.__tpl.html = async function (v) {
  const __d = v.__d, __f = v.ctx.formatters.getAll();
  return '<div class="overflow-hidden"><div class="group …"><label class="flex …">'
    + '<input type="checkbox" class="sr-only"' + boolAttr('checked', __d.todo.completed) + '>'
    + '<div class="relative"><div class="' + escAttr(`w-5 …${…}`) + '"></div>'
    + (__d.todo.completed ? '<div class="absolute …"><svg …><path …></path></svg></div>' : '')
    + '</div></label><span class="' + escAttr(`flex-1 …`) + '">' + escText(__s(__d.todo.text)) + '</span>'
    + '<span class="ml-4 …">' + escText(__s((__f["date"] || __f.__missing("date"))(__d.todo.createdAt, 'short'))) + '</span>'
    + '<button class="ml-3 …" title="Delete todo">×</button></div></div>';
};
```

A component site: `+ await hostHtml(v, TodoItem, { todo: s.item, remove: null }, content)`,
which constructs, `preload()`s with `route: null`, and awaits the child's
`html()`. Portals contribute `''`; placeholders do not exist in this target.

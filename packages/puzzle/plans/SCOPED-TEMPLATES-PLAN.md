# Scoped templates (D166) — v0.7.0 execution plan

**Status: APPROVED FOR BUILD, target 0.7.0 (Cory, 2026-08-30).**
Syntax rationale and rejected spellings live in `SCOPED-TEMPLATES-SKETCH.md`;
this file is the binding implementation spec. Amendments to the sketch made
here win: **target is 0.7.0** (not 0.8), the marker name is settled
(`<Template>`, not Snippet, not Piece — Piece collides with the pieces
library), and the cross-file "shapes don't match" check is a **dev-mode
runtime warning**, not a compile error (the compiler is per-file and cannot
see the component's slot declarations from the caller).

**Sequencing: branch `feat/scoped-templates` off `release/0.7.0` AFTER PRs
#87 and #88 merge** — this work touches `internal/plugin/scan.go` and
`internal/build/options.go`, which #87 rewrites (post-#87, the scan-input
predicate is `plugin.IsScanInput` and the dev watch trigger is
`pathsHaveScanInput`; the recon note that `IsScanInput` doesn't exist
describes pre-#87 `release/0.7.0`).

Recon anchors below cite release/0.7.0 file:line as mapped 2026-08-30.

---

## 0. The feature in one line

Slots render a passed-in template; scoped templates render it repeatedly,
with data. Caller declares a parameterized template; the component stamps it.

```html
<!-- caller -->
<UserList users={ users }>
  <Template user>
    <img src={ user.avatar } /> <b>{ user.name }</b>
  </Template>
</UserList>

<!-- named, multiple loops -->
<GroupedList groups={ groups }>
  <Template fits="heading" group>{ group.title }</Template>
  <Template fits="row" user group>…</Template>
</GroupedList>

<!-- component side: existing markers gain data attributes -->
{#for user in users}
  <li key={ user.id }>
    <Children user={ user }>{ user.name }</Children>
  </li>
{/for}
<Slot name="row" user={ user } group={ group }>fallback…</Slot>
```

## 1. The pinned compilation contract (both sides must match EXACTLY)

This is the seam between compiler and runtime. Pin it before any code.

### Caller side

A `<Template>` under a component invocation compiles to a **function-bearing
vnode in the children array** (NOT a prop — see §2 why):

```js
// <Template fits="row" user group> …body… </Template>  emits:
new ViewNode(TEMPLATE_TAG, {
  fits: 'row',                      // '' (empty string) when no fits attr = default
  params: ['user', 'group'],        // declared order; used only by the dev shape-check
  fn: ({ user, group }) => ([       // destructured single object arg — by-name binding
    /* body vnodes, emitted with user/group added to scope */
  ]),
})
```

- `TEMPLATE_TAG = '#template'` — a new exported const in `ViewNode.js` next
  to `SLOT_TAG` (ViewNode.js:42). The `#` guarantees no collision with any
  real HTML tag (a plain `<template>` element must keep working as an
  ordinary element).
- The `fn` closes over the caller's `__d`, `this`, and any enclosing loop
  vars — exactly like eager children do today (uses_component.golden.js:26-30
  shape) — and is **re-created on every caller render** (fresh closures; do
  NOT `__h`-cache it: a cached arrow would pin a stale `__d`).
- Emission is single-object-destructure because binding is by name and the
  two files compile separately: the component cannot know the caller's
  parameter order, the caller cannot know the slot's attribute order.

### Component side

Marker attributes other than `name` compile into an `args` object built in
the component's scope, extending the four existing emission shapes at
codegen.go:606-622:

```js
// <Slot name="row" user={ user } group={ g }>fallback…</Slot>  emits:
new ViewNode(SLOT_TAG, { name: 'row', args: { user: user, group: __d.g } }, [ /* fallback vnodes */ ])
// <Children user={ user }>…</Children>  emits:
new ViewNode(SLOT_TAG, { args: { user: user } }, [ /* fallback vnodes */ ])
```

`args` is rebuilt on every component render (fresh values per stamp — the
marker sits inside the component's `{#for}`, so each iteration emits its own
`args`).

### Runtime join (the whole runtime feature)

In `partitionSlots` (viewManager.js:306-325): children with
`tag === TEMPLATE_TAG` go to a third bucket `parts.templates[fitsOrDefault]`
instead of default/named. In `expandChildList` (viewManager.js:397-420), the
`isSlot` branch becomes:

```
tmpl = parts.templates && parts.templates[name || 'default']
if (tmpl)            → splice ...tmpl.fn(slot.attrs.args || {})   // FRESH vnodes per stamp
else if (bucket len) → splice bucket (existing by-reference path, unchanged)
else                 → fallback children (existing path, unchanged)
```

That single `fn(args)` call is what makes N stamps patch independently —
each call builds fresh vnodes, so the by-reference aliasing constraint
(recon #2: expandChildList pushes buckets by reference, N stamps alias one
`el`) never applies to templates. No cloning machinery, no change detection:
component re-render → expandSlots re-runs → fn re-invoked → normal diff.
Caller re-render → new children array (new fns) → the existing slot-only
`applyParentUpdate` branch (PuzzleView.js:993-1010) re-renders the child.
Both directions ride machinery that already exists.

## 2. Why templates travel in children, not props

Recon: callback props stay shallow-equal across caller renders via the
`this.__h` cache (codegen.go:1248-1253) so a re-render doesn't re-run the
child's `data()`. Template fns CANNOT be identity-cached (fresh `__d`
closure per render), so as props they would defeat the shallow-compare and
re-run `data()` on every caller render. The children channel is already
rebuilt every render and flows through the slot-only update path without
touching `data()`. Users still get the simple story ("templates are things
you hand a component, like markup"), the props-vs-children distinction is
an internal transport detail.

## 3. Compiler work (the bulk — runtime stays thin by design)

### 3a. Parser (`compiler/internal/parser/`)

New AST node (ast.go, near Slot at :52-61):

```go
type Template struct {
    Fits   string     // '' = default
    Params []string   // bare-attr names, declared order
    Body   []Node
    Pos    Position
}
```

In `parseElement`'s marker branch (parser.go:471-508, guarded by `!p.raw`):

- `name == "Template"` → validate attrs: `fits` must be a static, non-empty,
  non-expression value (reuse the `checkStaticSlotAttr` shape, slot.go:276-290
  message style); every other attr must be a **bare** `StaticAttr` with
  `Valueless: true` (ast.go:178-190 — Valueless is the only reliable signal;
  explicit `x=""` is NOT a param, reject it). A valued attr other than
  `fits` → positioned error: `parameters on <Template> are bare — write
  user, not user={ … }`. `@`-events, dynamic/mixed attrs → same error.
  Paired-only (like Portal, parser.go:491-493); self-closing `<Template/>`
  is an error (an empty template is meaningless).
- Param idents: validate with `isBareIdent` (parser.go:1125-1143) and extend
  `loopBindingIdentError`'s reserved list (parser.go:1149-1157) — which must
  also gain `TEMPLATE_TAG` alongside `ViewNode`/`SLOT_TAG`/`PORTAL_TAG`.
  Params may not duplicate each other; `fits` itself is rejected as a param
  name (positioned, steering).
- Lowercase steering (reuse the D134 pattern at parser.go:473-486): lowercase
  `<template>` carrying a `fits` attr → `the template marker is spelled
  <Template fits="…">` error. A `<template>` WITHOUT `fits` stays an
  ordinary HTML element everywhere — no new error, verified by a test.

Placement validation (extend `validateSlots`/`walkSlots`, slot.go:112-197):

- `<Template>` legal ONLY as a direct child of a component invocation
  (same position rule as `slot=` elements, slot.go:250-307, including the
  control-flow rejection at :296-307). Anywhere else → positioned error.
- Per invocation: at most one Template per fits-name, `default` included
  (mirror the per-body uniqueness maps at slot.go:132-145); a Template and a
  `slot="x"` element targeting the same name → error; a default Template
  plus any non-Template default markup in the same invocation → error
  (ambiguous — one or the other).
- A Template body is a NEW body for validation: markers inside it are
  validated as call-site content would be (it may contain component
  invocations with their own Templates), and `nestedFallbackMarker`
  (slot.go:210-248) must NOT fire on Template bodies (recon constraint #6 —
  add the carve-out with a comment saying why).

Marker-attr extensions (slot.go):

- `slotMarkerFromAttrs` (:64-106): in addition to static `name`, accept
  valued attrs (Static/Dynamic/Mixed) as args; `@`-events on markers stay
  rejected. Bare (Valueless) attrs on Slot/Children → error steering that
  bare params belong on `<Template>`, values belong here.
- `childrenMarkerAttrs` (:33-41): same, minus `name` (keep the ref-specific
  message).
- **Uniqueness relaxation (recon #5):** the per-body marker-uniqueness check
  (slot.go:132-145) SKIPS markers that carry args — an args-bearing marker
  inside `{#for}` is the intended N-stamp case; it splices fresh fn results,
  so the DOM-corruption rationale doesn't apply. Markers WITHOUT args keep
  the existing uniqueness rule unchanged. Args-bearing markers remain
  rejected inside `island` subtrees (island.go:109-141 already covers all
  markers — keep).

### 3b. Codegen (`compiler/internal/codegen/`)

- `emitItem` gains a `*parser.Template` arm → emit the TEMPLATE_TAG vnode
  per the §1 contract. The body is emitted with `scopeAdd` for each param
  (the second binding introducer after `emitFor`, codegen.go:934-963;
  scope map at :187, scopeAdd at :1658) so `resolveExpr` leaves param roots
  bare instead of rewriting to `__d.` (expr.go:106-134). Loop vars from the
  caller's enclosing `{#for}` remain in scope (map already threaded);
  params shadow both caller data and loop vars (scopeAdd overwrite — add a
  golden asserting shadowing).
- The Slot/Children arms (codegen.go:606-622) gain args emission: each arg
  value is an ordinary expression compiled in the component's scope
  (`resolveExpr` handles `__d.` rewriting), assembled into
  `args: { name: expr, … }` in the marker's attrs object.
- Conditional import: `hasTemplate` walk (mirror `hasSlot`,
  codegen.go:1558-1595, wired at :269-279) imports TEMPLATE_TAG only when
  used; add TEMPLATE_TAG to `checkReservedScriptBindings`
  (codegen.go:281-296).
- **Typo'd param safety (recon #4):** an identifier in a template body that
  is neither a param, a loop var, nor resolvable otherwise silently becomes
  `__d.foo` today. Acceptable for v1 of the feature (same behavior as all
  template expressions); the dev shape-check (§5) catches the common case
  (param name mismatch vs slot args). Do NOT invent a new binding-error
  mechanism in this round.

### 3c. Goldens

New `testdata/*.pzl` + `.golden.js` (regenerate:
`go test ./compiler/internal/codegen -run TestGoldens -update`):

- `scoped_template_default` — `<Template user>` under a component; asserts
  fn shape, params array, destructure, scope handling.
- `scoped_template_named` — two Templates (`fits="heading"`, `fits="row"`),
  multiple params, plus a coexisting plain `slot="x"` element.
- `scoped_template_shadow` — param shadowing a caller loop var and a data
  field.
- `scoped_marker_args` — component-mode golden (name contains
  `inline_component` per golden_test.go:50-53 or add a mode hint the same
  way): `<Children user={ u }>` and `<Slot name="row" …>` with args +
  fallback bodies, marker inside `{#for}`.

## 4. Runtime work (deliberately minimal)

- `ViewNode.js`: export `TEMPLATE_TAG = '#template'`; an `isTemplate` getter
  beside `isSlot` (:112-114).
- `viewManager.js`: the §1 partition + expand changes. Both live inside the
  existing single pipe shared with SSG (ssg/serialize.js:39,311 and
  preload.js — the same expandSlots import, so prerender gets the feature
  for free; add an SSG test).
- TEMPLATE_TAG vnodes never mount: they are consumed by partitioning. A
  template with a fits-name no marker consumes is simply unused (dev-warn,
  §5). A TEMPLATE_TAG that somehow survives to serialize → `''` like
  SLOT_TAG (ssg/serialize.js:159-161).
- Perf note (recon #9): patch has no identity short-circuit, so component
  re-renders re-invoke fns and re-diff. That is Puzzle's normal render
  model; do NOT add memoization in this round.

## 5. Dev-mode shape warning (the cross-file fit-check)

At the `fn(args)` call site in dev: compare `Object.keys(args)` against the
template's `params` array; on mismatch warn once per (component, slot name)
pair: `template fits "row" declares (person); slot "row" hands over (user) —
the shapes don't match`. Also warn for a Template whose fits-name no marker
consumed, and for plain (non-template) content filling an args-bearing
marker (which falls back — args-bearing markers only accept Templates).
Gate the warning code so production DCE drops it (follow the existing dev
diagnostics pattern; `params` metadata itself is small — ship it
unconditionally rather than complicating the contract).

## 6. Usage gate (`__PUZZLE_HAS_SCOPED_TEMPLATES__`)

Follow the HasRawAt/D150 precedent exactly (recon §4): new `Usage` +
`Features` fields + `Usage.Features()` (scan.go:43-68), a `collectUsage` arm
(scan.go:121-183) that sets the bit on any `parser.Template` node OR any
args-bearing marker, `fileUsage` + merge in scanmemo.go:39-44, and
`bundleDefines` (options.go:118-129). Template usage is `.pzl`-only, so no
script-scan involvement — but the bit still rides the post-#87
`Features()`-equality staleness paths for free. Probes stay INLINE
`typeof __PUZZLE_HAS_SCOPED_TEMPLATES__ === 'undefined' || …` — never
hoisted to a module const (ViewNode.js:92-96, PuzzleView.js:850-853;
build_test.go asserts this). Gate the partition branch + fn-call splice +
dev warning. Add cases to the DCE build test
(`TestBuildUsageDefinesDCE`-family) both directions, and to the warm==cold
scanmemo test (scanmemo_test.go:90-91). Measure gzip cost with
`npm run measure:size` before/after; expected: near-zero for non-users,
small for users.

## 7. Tests

- Parser: every error in §3a (positioned), `<template>`-without-fits stays
  an element, param validation, placement rules, uniqueness relaxation
  (args-bearing marker in `{#for}` compiles; no-args marker duplicate still
  errors). Home: parser_test.go beside the D134/D141 blocks (:1312-1390).
- Vitest `tests/scoped-templates.test.js` (hand-built trees, the
  named-slots.test.js style): default + named templates, args flow, N
  stamps patch independently (mutate one row's record → only that stamp's
  DOM changes; keyed li's), fallback when no template, caller-state change
  re-renders stamps (event handler in a template body fires with caller
  scope), component-state change re-stamps, template + slot= coexistence,
  dev warnings, SSG serialize path.
- `tests/scoped-templates-compiled.test.js` against REAL compiler output via
  the pretest fixture pattern (package.json:73,79 — add fixtures under
  tests/fixtures/scoped-templates/, wired like build:slot-forwarding).
- Example: extend `examples/overlays` (already the composition showcase)
  with a templated list block; examples/blog + grimoire stay pretest gates.

## 8. Docs, cards, release train

- SPEC: new section (next free §; D163 took §62) — grammar, contract,
  scoping, dev warning, gate. Update the slots/markers sections' "markers
  take no data" statements.
- Decision card **D166** (via constellation MCP): the sketch's content —
  framing sentence first, rejected spellings (let:/v-slot, block form,
  data={} bundle, name= routing, Snippet, Piece), the props-vs-children
  transport decision, uniqueness relaxation rationale. Update D141 (fallback
  interaction), D134 (steering list gains Template), D89 (new bit), COMPONENT
  cards for parser/codegen/view-manager, DOC-RELEASE-SURFACE, CHANGELOG
  (0.7.0 Added), plan.md next-free → D167.
- `skills/puzzle/SKILL.md:130-137` ("Two marker tags, three meanings") →
  rewrite for the third marker; check :33 and :241.
- eslint/prettier plugins: **no changes needed** (verified — they port
  section splitter/lexer only; template grammar is opaque to both). Note in
  the PR so nobody sweeps them needlessly.
- Editor grammars (vscode/sublime/zed, separate repos): add `Template` to
  the capitalized-marker highlighting — release-checklist item, not part of
  this branch.
- README size banner: regenerated at release close-out as always.

## 9. Follow-on (after the framework PR merges): pieces

Separate effort in `../puzzle-pieces` (version-locked 0.7.0):

1. `data-table`: cell + header-cell templates (`<Template fits="cell" cell row>`)
   with today's `{ cell.value }` as the fallback — zero breaking change.
2. **NEW `virtual-list` piece** — the feature's flagship customer: windowed
   rendering (scroll math, overscan, fixed row height v1), one
   `<Slot name="row" item index>` stamp point, plain-text fallback. Demo
   page + registry entry.
3. Candidates after: combobox option rows, tree nodes (not this release
   unless trivial).

## 10. Dispatch plan

- **Build (framework): Codex** — compiler + runtime + tests in one task
  (the two halves share the §1 contract; splitting risks seam drift). Brief
  carries this file verbatim. Worktree off post-#87/#88 `release/0.7.0`;
  branch `feat/scoped-templates` pre-created; Codex leaves changes
  uncommitted, orchestrator commits.
- **Review: Opus**, adversarial, with §1 contract conformance + recon
  constraints #1-#10 as the checklist; then full suites + examples +
  measure-size locally.
- **Docs/cards/SKILL + example showcase: Opus** (can overlap review).
- **Pieces round (§9): Opus** (design-sensitive UI work), after merge.

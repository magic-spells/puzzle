---
name: 'D166 — Snippets: a `<Snippet>` declares a parameterized body a component stamps with data (v1.79)'
status: built
connections:
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D71-SLOT-FORWARDING
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D44-DOM-ISLANDS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-SSG
  - TEST-COMPOSITION-MARKERS
  - DOC-SPEC-TEMPLATE
  - DOC-RELEASE-SURFACE
  - RELEASE-V0-7-0
---

Slots render a passed-in template; snippets render it repeatedly, with data.
Today's slots render the caller's markup exactly once with no arguments; a
snippet lifts both restrictions and changes nothing else. Shipped in v1.79 as
the `<Snippet>` marker plus data attributes on the existing markers.

```html
<!-- caller: declare parameters as bare attributes -->
<UserList users={ users }>
  <Snippet user>
    <img src={ user.avatar } /> <b>{ user.name }</b>
  </Snippet>
</UserList>

<!-- caller: route by fits, several snippets per invocation -->
<GroupedList groups={ groups }>
  <Snippet fits="heading" group>{ group.title }</Snippet>
  <Snippet fits="row" user group>…</Snippet>
</GroupedList>

<!-- component: the existing markers hand values out, per stamp -->
{#for user in users}
  <li key={ user.id }>
    <Children user={ user }>{ user.name }</Children>
  </li>
{/for}
<Slot name="row" user={ user } group={ group }>fallback…</Slot>
```

## Why

A component that owns its own loop — a virtual list, a sortable table, a
combobox dropdown, a tree — cannot let the caller decide what one item looks
like. The shipping proof is `puzzle-pieces` `data-table`, which renders every
cell as hardcoded `{ cell.value }`: no app can put a badge, avatar, link, or
button in a cell. The same wall stands in combobox, tree, command, and
multi-select. The benefit lands almost entirely on pieces; app-internal
components rarely need it, because looping on the page over a one-item
component already covers plain lists.

## Grammar

- **`<Snippet>` is caller-side and paired-only.** A self-closing `<Snippet/>`
  is an error — an empty snippet renders nothing and means nothing. It is legal
  **only** as a direct child of a component invocation, the same position rule
  the `slot="x"` attribute already has, including the rejection inside
  control flow.
- **`fits="x"` routes the snippet to `<Slot name="x">`.** It is static and
  non-empty; omitting it fills the default `<Children>` position. *Fits* is
  deliberate — fitting implies shape-matching, which is exactly what the dev
  warning checks, and it earns a distinct word from the shipped `slot="x"`
  attribute (that is static markup *placed into* a position; a snippet is a
  parameterized body that must *fit* one).
- **Every other attribute is bare, and declares a parameter.** `<Snippet
  fits="row" user group>` receives `user` and `group`. A valued attribute other
  than `fits` is a positioned error steering to the bare form, in D134's
  style. Bare attributes pass visibly nothing, which is what a declaration is;
  the precedent is `island` and `flip`. Parameter names are validated as
  identifiers, may not duplicate, and may not be `fits`.
- **Markers gain data attributes.** On `<Slot name="x">` and `<Children>`, any
  valued attribute other than `name` becomes a per-stamp argument; a *bare*
  attribute there is an error steering back to `<Snippet>`. Binding is **by
  name**: the marker's attribute names feed the snippet's declared parameter
  names, so the two files can compile separately and neither needs the other's
  ordering. Declaring a subset of what the marker hands over is legal.
- **Paired marker bodies stay D141 fallbacks**, rendered when nothing fills the
  position — so every existing caller keeps working, and a component can adopt
  a snippet point without breaking anyone.
- **Lowercase `<snippet>` steers** to `<Snippet>` when it carries a `fits`
  attribute; a plain `<template>` element remains ordinary HTML everywhere, and
  gained no meaning here.

## Mechanics


**A snippet compiles to a function that travels in the CHILDREN channel, not
props.** `<Snippet fits="row" user group>` emits
`new ViewNode(SNIPPET_TAG, { fits: 'row', params: ['user','group'], fn: ({ user, group }) => [ …vnodes… ] })`
into the invocation's children array (`SNIPPET_TAG` is `'#snippet'`, which no
real HTML tag can collide with; `fits: ''` is the default position). The
single-destructured-object signature is what makes binding by name work.

The transport choice is the load-bearing one. Callback props stay shallow-equal
across caller renders thanks to the D62 `__h` handler cache, which is what stops
a re-render re-running the child's `data()`. A snippet function *cannot* be
identity-cached — it closes over the caller's `__d` and enclosing loop
variables, so a cached arrow would pin stale data — and as a prop it would
therefore defeat the shallow compare and re-run `data()` on every caller render.
The children channel is already rebuilt every render and flows through the
slot-only parent-update path without touching `data()`. Users still get the
simple story ("a snippet is something you hand a component, like markup"); the
props-vs-children split is an internal transport detail.

**Each stamp calls `fn(args)` and gets fresh vnodes.** Partitioning splits
snippet children into a third bucket beside default and named content; at
expansion, an args-bearing marker whose name has a snippet splices
`fn(args)` instead of the shared children array. That single call is what makes
N stamps independent: the by-reference aliasing that forbids reusing one
children bucket in N positions never applies, so N stamps patch through the
existing keyed reconciliation with no cloning machinery and no change
detection. A component re-render re-runs expansion and re-invokes the function;
a caller re-render produces a new children array and rides the existing
slot-only update. Both directions were already built.

**Prerender shares the pipe.** SSG and the static kernel import the same
expansion, so both prerender modes stamp snippets with no new code. A
`SNIPPET_TAG` vnode that reaches the serializer — or the browser's element
mount — throws the shared metadata-tag diagnostic instead of emitting nothing:
expansion consumes every snippet vnode, so one that survives came from a build
the D89 usage scan could not see through (see that card's
compiled-component-package boundary). A prepared takeover tree expands exactly
once — re-expanding it repeats work that cannot change the output — and only a
view's FIRST mount can carry one, which is why `ViewManager.renderFresh()`
(recovery only) always expands and takes no already-expanded flag.

**Development warns about shapes, and only in development.** At the call site
the declared `params` are compared against `Object.keys(args)` and a mismatch
warns once per (component, position): *snippet fits slot "row" declares
(person); slot "row" hands over (user)*. Two more dev warnings cover an
args-bearing marker that received plain content instead of a snippet (which
falls back), and a snippet function that returned a composition marker. There is
deliberately **no unused-snippet warning**: a marker inside a currently-false
`{#if}` or an empty `{#for}` is not visited either, so "no marker consumed this"
cannot distinguish an authoring mistake from ordinary conditional markup, and
the observation reported both as one.

**Gated behind `__PUZZLE_HAS_SNIPPETS__`** in the D89 pattern — an inline
`typeof … === 'undefined' || …` probe at each site, never hoisted to a module
const, so esbuild folds it away. A snippet-free, marker-arg-free call site takes
exactly the fast path it took before. Non-users pay **0 bytes**; users pay
**48–60 B gzip**.

## Forwarding through wrappers


A snippet handed to a wrapper reaches the component the wrapper wraps by the
same implicit rule D71 already applies to plain content: **a bare
`<Children/>` placed inside a nested component invocation forwards the caller's
snippets alongside the default content.** `DatePicker` renders
`<Calendar …><Children/></Calendar>`, so a caller's `<Snippet fits="day" …>`
arrives at `Calendar`'s `day` marker with `fits`, `params`, and `fn` intact and
never invoked on the way — the nested component's own partitioning consumes it.
The rule is transitive through wrapper chains. An args-bearing marker still
stamps locally and never forwards; a wrapper may both stamp and forward the same
snippet. A snippet nothing in the chain stamps is simply never invoked and never
reaches the DOM — silently, since there is no unused-snippet warning to own.

This is runtime-only (the partition keeps the ordered snippet vnodes as
forwarding metadata and the D71 call-site descent re-inserts them at the
forwarding `<Children/>`); no grammar changed, and every new path sits behind
the same inline `__PUZZLE_HAS_SNIPPETS__` probe — a snippet-free bundle contains
none of it.

## Guardrails (from the adversarial review)


- **A snippet body is a composition LEAF.** No `<Children>`, `<Slot>`,
  `<Portal>`, or `<Snippet>` anywhere inside it, at any depth — including a
  `<Snippet>` attached to a component invocation *within* the body. Every one of
  them is a positioned compile error steering to the fix: stamped output cannot
  declare composition positions, so the marker belongs in the component's own
  template, and nesting is expressed by **extraction** — move the inner
  invocation and its snippet into their own component, whose template holds the
  snippet at top level. That component is then a plain tag inside the snippet
  body. Component invocations themselves are perfectly legal in a snippet body;
  only markers are not. A dev-mode warning catches the case where a snippet
  function returns a marker anyway.
- **`ref=` inside a `<Snippet>` body is a positioned compile error.** A ref
  names one element on one instance, and a snippet body is stamped N times.
- **Same-name marker declarations stay unique**, but the per-body uniqueness
  check skips markers that carry args: one args-bearing `<Slot name="row" …>`
  inside `{#for}` is precisely the N-stamp case, and it splices fresh vnodes
  rather than aliasing one subtree. Markers without args keep the old rule
  unchanged, and args-bearing markers remain rejected inside `island` subtrees.
- **One snippet per `fits` name per invocation**, `default` included; a snippet
  and a `slot="x"` element cannot target the same name, and a default snippet
  cannot coexist with plain default content.
- A snippet body is otherwise a **new caller-owned body** for validation: it
  carries the caller's scope plus the declared parameters, and D141's
  nested-fallback rule does not fire on it.

## Naming

**Snippet** = small + reusable + template, and it is already the word for this
thing in two ecosystems the audience knows: Shopify snippets and Svelte 5
snippets mean exactly this. The feature was built as `<Template>` and renamed
before release.

- **`Template`** — rejected: it names the *category*. Everything inside a `.pzl`
  is a template; a marker called `<Template>` says nothing about what
  distinguishes it.
- **`Piece`** — rejected: it collides with `puzzle-pieces`, the product whose
  components are the feature's first customers.

## Alternatives rejected


- **Svelte-4 `let:user` / Vue `v-slot="{ user }"`.** Function parameters in
  attribute costume, with the declaration far from its use. Svelte itself
  deprecated `let:` in favor of declared snippets.
- **A block form, `{#snippet row(user)}…{/snippet}`.** Mechanically identical
  and function-flavored. Puzzle's `{#…}` blocks are control flow that renders
  *in place*; composition is marker territory, and the marker form fits the
  existing capitalized-marker family.
- **The hybrid `<Snippet row(user)>`.** It breaks the rule that everything
  inside a tag is an attribute.
- **`data={ user, other }` as the parameter bundle.** `={ }` everywhere else in
  Puzzle means "evaluate this and pass it IN" — using it for *received* names
  lies about the direction of flow. That is the exact hack-feel of
  `v-slot="{ user }"`.
- **`name=` as the routing attribute.** It reserves `name`, a thoroughly
  plausible parameter word; `fits` frees it.
- **Allowing a nested component invocation inside a snippet body to carry its
  own `<Snippet>`.** The runtime would cope — a stamped
  `ViewNode(Card, {…}, [ViewNode(SNIPPET_TAG, …)])` is exactly what `Card`
  partitions on mount — and the data-table cell rendering a `<Select>` with its
  own option snippet is a real case. It is refused on authoring grounds: three
  marker levels in one template is where composition stops being readable, and
  where "which body does this parameter come from" stops being obvious at a
  glance. One obvious shape is worth more here than one saved file, for humans
  and for agents alike. The extraction workaround costs a component and is
  arguably the better code: the inner invocation and its snippet move into a
  component whose template declares the marker at top level, and the snippet
  body names it as a plain tag.
- **Compile-time cross-file shape checking.** The compiler is per-file and
  cannot see the component's marker declarations from the caller, so the fit
  check is a dev-mode runtime warning instead.
- **Memoizing stamps.** Patch has no identity short-circuit; component
  re-renders re-invoke and re-diff, which is Puzzle's normal render model. No
  special case was added.
- **Explicit snippet-forwarding syntax.** Rejected for the same reason D71
  rejected it for content: a wrapper already says what it means by placing a
  bare `<Children/>` where the inner component's content goes.

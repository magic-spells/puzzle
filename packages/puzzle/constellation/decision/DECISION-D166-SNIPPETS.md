---
name: 'D166 — Snippets: a `<Snippet>` declares a parameterized body a component stamps with data'
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

Slots render the caller's markup once with no arguments; a snippet renders it repeatedly, with data.

```html
<!-- caller: parameters are bare attributes; fits routes to a named Slot -->
<UserList users={ users }>
  <Snippet user><img src={ user.avatar } /> <b>{ user.name }</b></Snippet>
</UserList>
<GroupedList groups={ groups }>
  <Snippet fits="heading" group>{ group.title }</Snippet>
  <Snippet fits="row" user group>…</Snippet>
</GroupedList>

<!-- component: markers hand values out per stamp; the body is the D141 fallback -->
{#for user in users}
  <li key={ user.id }><Children user={ user }>{ user.name }</Children></li>
{/for}
<Slot name="row" user={ user } group={ group }>fallback…</Slot>
```

## Context

A component that owns its loop — data table, virtual list, combobox, tree, multi-select — can't let the caller decide what one item looks like (e.g. `puzzle-pieces` `data-table` could only render `{ cell.value }`). The benefit lands mostly on pieces; app components usually loop on the page instead.

## Decision

**Grammar**
- `<Snippet>` is caller-side, paired-only (self-closing is an error), and legal only as a direct child of a component invocation (the `slot="x"` position rule, including rejection inside control flow).
- `fits="x"` (static, non-empty) routes to `<Slot name="x">`; omitted, it fills `<Children>`.
- Every other attribute is bare and declares a parameter; names must be identifiers, unique, and not `fits`. A valued attribute is a positioned error steering to the bare form.
- On `<Slot name>` and `<Children>`, any valued attribute other than `name` is a per-stamp argument; a bare one is an error steering to `<Snippet>`. Binding is **by name**, so the two files compile independently; declaring a subset is legal.
- Paired marker bodies stay D141 fallbacks, so adding a snippet point breaks no caller.
- Lowercase `<snippet>` carrying `fits` or a bare attribute steers to `<Snippet>`; `<template>` stays ordinary HTML.

**Guardrails**
- A snippet body is a composition leaf: no `<Children>`, `<Slot>` or `<Snippet>` at any depth, including a `<Snippet>` on a component invocation inside the body — positioned errors steering to extraction (move the inner invocation and its snippet into their own component). Component invocations and `<Portal>` are fine (a marker inside the portal is still rejected).
- `ref=` in a snippet body is an error (stamped N times).
- Marker-name uniqueness skips args-bearing markers (one `<Slot name="row" …>` in `{#for}` is the N-stamp case); args-bearing markers stay rejected inside `island` subtrees.
- One snippet per `fits` name per invocation (default included); a snippet and a `slot="x"` element can't share a name; a default snippet can't coexist with plain default content.
- A snippet body is a new caller-owned body: caller scope plus its parameters; D141's nested-fallback rule doesn't fire on it.

**Mechanics**
- A snippet compiles to `new ViewNode(SNIPPET_TAG, { fits, params, fn: ({ user, group }) => [ …vnodes… ] })` in the invocation's **children** array (`SNIPPET_TAG = '#snippet'`; `fits: ''` is default). The destructured-object signature is what makes by-name binding work.
- Children, not props, because `fn` closes over caller `__d` and loop variables and can't be identity-cached like D62 `__h` handlers; as a prop it would break the shallow compare and re-run the child's `data()` every caller render. The children channel is rebuilt every render and rides the slot-only parent-update path.
- Partitioning puts snippets in a third bucket; an args-bearing marker with a matching snippet splices `fn(args)` — fresh vnodes per stamp, so N stamps patch through keyed reconciliation with no cloning.
- SSG and the static kernel share expansion. A `SNIPPET_TAG` vnode reaching the serializer or element mount throws the metadata-tag diagnostic (it came from a build the D89 scan couldn't see). A prepared takeover tree expands once; `ViewManager.renderFresh()` (recovery only) always expands.
- Dev-only warnings, once per (component, position): declared `params` vs `Object.keys(args)` mismatch; an args-bearing marker that got plain content; a snippet `fn` that returned a marker. No unused-snippet warning (a marker in a false `{#if}` or empty `{#for}` is indistinguishable from a mistake).
- Gated by `__PUZZLE_HAS_SNIPPETS__` (D89): an inline `typeof` probe at each site, never hoisted to a module const. Non-users pay 0 bytes.

**Forwarding.** A bare `<Children/>` inside a nested component invocation forwards the caller's snippets alongside default content (D71's rule), untouched and transitively; the inner component's partitioning consumes them. An args-bearing marker stamps locally and never forwards; a wrapper may do both. Runtime-only, behind the same probe.

## Alternatives

- `<Template>` — names the category (everything in a `.pzl` is template). `Piece` — collides with `puzzle-pieces`.
- `let:user` / `v-slot="{ user }"` — parameters in attribute costume; Svelte itself deprecated `let:`.
- `{#snippet row(user)}…{/snippet}` — `{#…}` blocks are in-place control flow; composition is marker territory.
- `<Snippet row(user)>` — breaks "everything in a tag is an attribute".
- `data={ user, other }` — `={ }` means "pass IN"; using it for received names lies about direction.
- `name=` for routing — reserves a plausible parameter name.
- Allowing a nested `<Snippet>` inside a snippet body — the runtime would cope, but three marker levels stop being readable; extraction is one obvious shape.
- Compile-time cross-file shape checking — the compiler is per-file; the dev warning covers it.
- Memoizing stamps — `fn` closes over caller scope; stamps re-invoke and re-diff like any render.
- Explicit forwarding syntax — a bare `<Children/>` already says it (D71).

## Consequences

Pieces can expose per-item rendering. `puzzle check` walks snippet bodies with typed-`any` parameters (D165).

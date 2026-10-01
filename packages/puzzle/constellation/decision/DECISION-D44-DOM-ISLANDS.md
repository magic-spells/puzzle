---
name: 'D44 — DOM islands: the `island` attribute freezes an element''s children after mount'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-THIRD-PARTY-DOM
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
code_refs:
  - client-runtime/views/viewManager.js
---

# D44 — DOM islands: the `island` attribute

A static `island` attribute on a plain element makes its **children** browser- or library-owned after mount: the template seeds them once and the patcher never reconciles them again. The element's own attributes and listeners keep patching. See [[DOC-SPEC-TEMPLATE]] §17.

```html
<div contenteditable="true" island @input={ syncText(event) }>{ block.text }</div>
```

## When to use it
For code that **restructures or owns** children: `contenteditable` surfaces, carousel loop clones, map/canvas mounts. A library that only **decorates** framework nodes (foreign attributes, inline transforms, injected siblings) should not be islanded — the freeze kills reactive children for nothing, and the patcher already tolerates decoration. Decision rule: [[DOC-THIRD-PARTY-DOM]].

## Runtime semantics (ViewManager)
- **Mount** is unchanged: the template children are the seed (full grammar).
- **Patch:** attributes and listeners patch; children are never reconciled — the old vnode children are carried onto the new vnode so the live `el` links stay in the tree for teardown.
- **Identity:** island-ness is part of node identity with tag and key (`sameNode`). A tag or key change, or a branch flip that disagrees about `island`, replaces the node and **re-seeds** from the template — changing the key is the sanctioned "reset this island" lever.
- The attribute never reaches the DOM (stripped like `key`).
- **Seed caching** ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]): a fully **static** seed is a compiler cache site at any size. A dynamic seed must not be cached — `??=` caches per instance while a re-seed must use current values; winning that case back would need a per-render thunk the runtime evaluates at mount (not built).

## Compile errors (positioned)
1. `island={ expr }` — must be static; toggling would resume patching against restructured DOM.
2. `island` on a component tag — put it on a plain element inside the component.
3. A component tag, `<Children/>` or `<Slot/>` anywhere inside an island — a live instance in browser-owned DOM can be destroyed out from under the framework, and a marker would splice parent-owned vnodes into an unreconciled subtree.
4. `island` on the `<puzzle-view>` root — the navigation/animation boundary.

## Documented behavior
Listeners on seeded children are wired at mount and never swapped: arrow handlers stay correct, but call-expression arguments are frozen at mount-time values. Programmatic changes to island content must update both the DOM (imperatively) and the store — the framework never syncs store → island after mount.

## Alternatives rejected
- A controlled contenteditable binding (`text={…}`) — the browser rewrites that DOM tree during editing (paste, IME, spellcheck); no framework keeps that promise.
- The empty-children convention (seed in `mounted()`) — implicit, and an interpolation inside half-works then breaks with no diagnostic.
- A runtime-only flag with no compile checks — components inside appear to work until the first destructive edit orphans them.
- Emitting the attribute (`data-puzzle-island`) — directives are stripped; style hooks belong to the author's classes.

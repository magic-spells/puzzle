---
name: Wrapping third-party DOM libraries — island vs shared subtree
kind: guide
status: built
connections:
  - DECISION-D44-DOM-ISLANDS
  - COMPONENT-VIEW-MANAGER
---

# Wrapping third-party DOM libraries — island vs shared subtree

How to host a DOM-mutating library (carousel, map, chart, editor) inside a
component. Classify the library by what it does inside the framework-owned
subtree. The shared-subtree mode is a handshake the compiler does not check;
this card is the contract.

## Decorating libraries → no island; share the subtree

A library that only writes attributes or inline styles on framework-owned
elements and injects sibling elements of its own can coexist with the
patcher, and the subtree stays fully reactive:

- `patchAttrs` diffs only the attributes the vnode declares, so foreign
  attribute writes survive every patch ([[COMPONENT-VIEW-MANAGER]]).
- Reconciliation anchors on `vnode.el`, not child positions, so injected
  siblings are tolerated — **provided the framework-owned child list at that
  level is static**. A dynamic list appends new children after injected nodes,
  and keyed-move guards compare against foreign siblings.
- Don't bind a dynamic `style`/`class` on an element the library also styles;
  a change would clobber the library's writes.

Example: the `@magic-spells/tarot-puzzle` carousel renders slides as reactive
slot children, and its MutationObserver treats the patcher's mutations as its
refresh signal.

## Restructuring libraries → `island` ([[DECISION-D44-DOM-ISLANDS]])

A library (or the browser, as with `contenteditable`) that clones, reparents,
rewraps or rewrites nodes corrupts `vnode.el` links. Freeze the container with
`island`: its template children seed once and never patch again; reset with a
key change. Island children cannot be data-reactive, and a composition marker
inside one is a compile error — seed content from the wrapper's own template
or manage it imperatively. Examples: `examples/grimoire`, Swiper/Slick loop
clones.

## Open gap

A restructuring library that also needs reactive content: `<Portal>`
([[DECISION-D144-PORTAL]]) covers the overlay-container case by rendering
reactive vnodes into a framework-created outlet. Projecting into an arbitrary
library-owned container (user-placed named outlets) and an island re-seed
lever remain unbuilt.

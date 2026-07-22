---
name: Wrapping third-party DOM libraries — island vs shared subtree
kind: guide
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D44-DOM-ISLANDS
  - COMPONENT-VIEW-MANAGER
  - DOC-GRIMOIRE-EXAMPLE
---


# Wrapping third-party DOM libraries — island vs shared subtree

The decision rule for hosting a DOM-mutating library (carousel, map, chart,
editor) inside a Puzzle component. Learned building `@magic-spells/tarot-puzzle`
(2026-07-14, sibling repo — see its `docs/PUZZLE-FRICTION.md` for the long form);
verified against the ViewManager patcher source and a live app.

**Classify the library by what it does to DOM inside the framework-owned subtree:**

## Decorating libraries → NO island; share the subtree

A library that only (a) writes attributes/inline styles on framework-owned
elements and (b) injects **sibling** elements of its own can coexist with the
patcher directly — keep the subtree fully reconciled and reactive. Safe because:

- `patchAttrs` diffs only vnode-DECLARED attrs; foreign attribute writes are
  invisible to it and survive every patch ([[COMPONENT-VIEW-MANAGER]]).
- Reconciliation anchors on `vnode.el` refs, not child positions, so injected
  foreign siblings are tolerated — **provided the framework-owned child list at
  that level is static** (a dynamic list mounts new children with append-at-end
  refs that land after injected nodes, and keyed-move guards compare against
  foreign siblings).
- Corollary: don't bind dynamic `style`/`class` on elements the library also
  styles — patchAttrs would clobber the library's writes on change.

Worked example: the tarot carousel (transform-based looping, MutationObserver on
its track). Puzzle renders slides as reactive slot children; tarot's observer
treats the patcher's mutations as its refresh signal. Zero island, full
reactivity.

## Restructuring / owning libraries → island ([[DECISION-D44-DOM-ISLANDS]])

A library (or the browser) that **clones, reparents, rewraps, or rewrites**
nodes inside the subtree corrupts `vnode.el` links — reconciliation is unsafe.
Freeze the container with `island`: template children seed once, never patch
again; reset via key change. This is the `contenteditable` case
([[DOC-GRIMOIRE-EXAMPLE]]) and the Swiper/Slick case (loop-mode slide clones).
Cost: island children can never be data-reactive, and a composition marker
(`<children/>`/`<Slot/>`/`<slot name>`) is a compile
error inside — content must be seeded from the wrapper's own template or managed
fully imperatively.

## The gap (unresolved)

A restructuring library that ALSO needs reactive content has no answer today —
neither mode fits. Candidate primitives: a portal ("render vnodes into that
foreign container") or an island with an explicit re-seed lever short of a key
change. Until then, the shared-subtree mode is a handshake the compiler does not
check — this card IS the contract.

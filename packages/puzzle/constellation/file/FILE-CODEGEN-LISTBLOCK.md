---
name: list block lowering
status: verified
path: compiler/internal/codegen/listblock.go
language: go
summary: 'Item-form {#for} lowering: the __l list call, the __L site meta, row scopes, the __roots stamp.'
connections:
  - COMPONENT-CODEGEN
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
notes:
  - kind: state
    text: >-
      `isExplicitKeyAttr` is the one key-directive predicate; `hasKeyAttr` in codegen.go loops over
      it.
---

# listblock.go

Lowers item-form `{#for}` to a persistent list block call
([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]); the runtime half is
[[FILE-LIST-BLOCK]]. The file header shows the emitted shape.

- `listRows as __l` joins the import line only when the file lowers a site — a
  loop-free module must never pull in `views/listBlock.js`.
- Every dirtiness fact is compile-time and travels in the per-site `__L<n>` meta
  const (key function, counter use, controls, a root bitmask over the class's
  `__roots`, depth-one item members, `deep`, `volatile`); defaults are omitted.
- `__roots` caps at 31 bits (JS bitwise AND is signed 32-bit); a root past the cap
  makes its sites `volatile` instead of landing in the wrong bit.
- Not lowered, on purpose: range loops, and loops inside a `<Snippet>` body
  (stamped fresh per expansion, so one site id would be shared across stamps).

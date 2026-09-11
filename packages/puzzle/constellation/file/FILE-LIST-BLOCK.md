---
name: persistent list blocks
status: built
path: client-runtime/views/listBlock.js
language: javascript
summary: 'Row state per key for one {#for} site: cached row vnodes, dirtiness rules, control collection.'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

Source binding for the owning component cards. Behavioral intent stays in [[DECISION-D170-INCREMENTAL-VDOM-LISTS]] and [[COMPONENT-PUZZLE-VIEW]]; this card anchors that decision to `client-runtime/views/listBlock.js`.

**Reachability is part of the contract.** This module is exported from the
package root as the compiler-support export `listRows`, and a compiled `.pzl`
imports it as `__l` only when it lowers at least one item-form `{#for}`. Nothing
inside `client-runtime/` may import it — least of all
`views/PuzzleView.js`, which every app pulls in. It is ~1 KB gzip on its own, so
one unconditional import would put the whole list runtime into a loop-free
hello-world and blow the D170 hello-world byte gate (+0.5 KB gzip). If a future
change needs the block from inside the runtime, move the shared part out rather
than adding the import.

---
name: ViewNode representation
status: verified
path: client-runtime/views/ViewNode.js
language: javascript
summary: VNode values, slot/placeholder/Component-range constants, and list-key helpers.
connections:
  - COMPONENT-VIEW-MANAGER
verified_at: '2026-11-24T18:13:45.766Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# ViewNode.js

The vnode class compiled `render()` functions build ([[COMPONENT-VIEW-MANAGER]]) — pure data; the ViewManager owns all DOM. A string `tag` is an element (`'text'` with a `value` attr is a text node, without one the SVG `<text>` element), a class `tag` is a component, and reserved tags mark framework metadata: slot markers (`'slot'`), portals (`'portal'`), and the `'#'`-prefixed snippets, placeholders, live HTML and `<Component>` ranges. `instance` pins a pre-built child the manager must adopt (the Router's preloaded routed view). `ViewNode.keyOf` derives list keys.

A `'#'`-prefixed tag that reaches a DOM path throws `metadataTagError` — long message in development, a short one in production.

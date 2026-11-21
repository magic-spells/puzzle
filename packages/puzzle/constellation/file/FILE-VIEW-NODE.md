---
name: ViewNode representation
status: verified
path: client-runtime/views/ViewNode.js
language: javascript
summary: VNode values, slot/placeholder/Component-range constants, and list-key helpers.
connections:
  - COMPONENT-VIEW-MANAGER
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# ViewNode.js

The vnode class compiled `render()` functions build ([[COMPONENT-VIEW-MANAGER]]) — pure data; the ViewManager owns all DOM. A string `tag` is an element (`'text'` with a `value` attr is a text node, without one the SVG `<text>` element), a class `tag` is a component, and reserved tags mark framework metadata: slot markers (`'slot'`), portals (`'portal'`), and the `'#'`-prefixed snippets, placeholders, live HTML and `<Component>` ranges. `instance` pins a pre-built child the manager must adopt (the Router's preloaded routed view). `ViewNode.keyOf` derives list keys.

A `'#'`-prefixed tag that reaches a DOM path throws `metadataTagError` — long message in development, a short one in production.

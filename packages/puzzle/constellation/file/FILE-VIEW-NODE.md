---
name: ViewNode representation
status: verified
path: client-runtime/views/ViewNode.js
language: javascript
summary: VNode values, slot/placeholder/Component-range constants, and list-key helpers.
connections:
  - COMPONENT-VIEW-MANAGER
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# ViewNode.js

The vnode class compiled `render()` functions build ([[COMPONENT-VIEW-MANAGER]]) — pure data; the ViewManager owns all DOM. A string `tag` is an element (`'text'` with a `value` attr is a text node, without one the SVG `<text>` element), a class `tag` is a component, and the `'#'`-prefixed reserved tags mark framework metadata: slot markers, snippets, placeholders, portals, live HTML and `<Component>` ranges. `instance` pins a pre-built child the manager must adopt (the Router's preloaded routed view). `ViewNode.keyOf` derives list keys.

A reserved tag that reaches a DOM path throws `metadataTagError` — long message in development, a short one in production.

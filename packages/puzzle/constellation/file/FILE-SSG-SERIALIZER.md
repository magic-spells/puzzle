---
name: SSG ViewNode serializer
status: verified
path: client-runtime/ssg/serialize.js
language: javascript
summary: ViewNode-to-HTML serialization matching browser semantics, including transparent Component ranges.
connections:
  - COMPONENT-SSG
verified_at: '2026-11-24T18:13:45.766Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# ssg/serialize.js

Pure ViewNode → HTML string, the build-time twin of the ViewManager ([[COMPONENT-SSG]]). It must emit the markup the browser would mount from the same tree, so the router or static takeover finds matching DOM.

It mirrors `setAttr` (directives dropped, controlled form values as their HTML initial state, boolean attributes bare, D173 list joining), renders components inline with no wrapper (D20), each linked to its parent view as the ViewManager links it, so `share()` reaches nested components (D197), expands slots through `viewManager.js`'s own `expandSlots`, emits `{#svg}` seeds verbatim and live-HTML vnodes through the same sanitized `htmlOf()` (D174), treats `<Component>` ranges as transparent, and adds the extra leading newline a `<pre>`/`<textarea>` body needs (D168). `<script>`/`<style>` text is RAWTEXT; content that would end the element early is a build error.

When a ViewManager attribute or node rule changes, change it here too: `tests/ssg-equivalence.test.js` compares the two.

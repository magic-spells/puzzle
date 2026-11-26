---
name: morph integration runtime
status: verified
path: client-runtime/morph.js
language: javascript
summary: Optional shared-element morph pairing, capture flights, and engine lifecycle.
connections:
  - COMPONENT-MORPH
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# morph.js

The `@magic-spells/puzzle/morph` subpath ([[COMPONENT-MORPH]]): `enableMorph(app)`
wires shared-element route transitions over `@magic-spells/morph-engine` (an
**optional** peer dependency) through `app.setMorphHandler`. Nothing in the core
runtime imports it, so an app that never calls `enableMorph` ships neither this
file nor the engine.

Two shapes resolved per transition: coexisting live pairs (both elements in the
DOM at once) always win; otherwise a sibling swap flies a captured clone from the
leaving view into the new one. `data-puzzle-morph`, `-trigger` (launch only) and
`-target` (receive only) share one id namespace.

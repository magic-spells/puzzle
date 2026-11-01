---
name: morph integration runtime
status: verified
path: client-runtime/morph.js
language: javascript
summary: Optional shared-element morph pairing, capture flights, and engine lifecycle.
connections:
  - COMPONENT-MORPH
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
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

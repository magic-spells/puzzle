---
name: slot-forwarding-compiled.test.js
status: verified
path: tests/slot-forwarding-compiled.test.js
language: JavaScript
summary: D71 default-slot forwarding through a real compiled .pzl layout.
connections:
  - DECISION-D71-SLOT-FORWARDING
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# slot-forwarding-compiled.test.js

The compiled-output proof for [[DECISION-D71-SLOT-FORWARDING]]: a real `.pzl` layout that wraps its outlet in a component compiles to a working app — the routed view mounts inside the wrapper's default slot and no literal `<slot>` element reaches the DOM. Its modules (`tests/fixtures/slot-forwarding/*.compiled.js`) are written by `npm run build:slot-forwarding`, which `npm test` runs in `pretest`.

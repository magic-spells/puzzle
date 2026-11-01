---
name: slot-forwarding.test.js
status: verified
path: tests/slot-forwarding.test.js
language: JavaScript
summary: 'D71 default-slot forwarding on hand-written trees: expansion, router, serializer.'
connections:
  - DECISION-D71-SLOT-FORWARDING
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# slot-forwarding.test.js

The [[DECISION-D71-SLOT-FORWARDING]] suite on hand-written ViewNode trees: a bare `<Children/>` written inside a component's call-site children forwards the outer content into that component's default slot, through direct expansion, the router end to end, and the SSG serializer. The compiled-layout proof is `slot-forwarding-compiled.test.js`.

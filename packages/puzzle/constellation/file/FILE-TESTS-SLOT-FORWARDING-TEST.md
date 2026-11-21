---
name: slot-forwarding.test.js
status: verified
path: tests/slot-forwarding.test.js
language: JavaScript
summary: 'D71 default-slot forwarding on hand-written trees: expansion, router, serializer.'
connections:
  - DECISION-D71-SLOT-FORWARDING
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# slot-forwarding.test.js

The [[DECISION-D71-SLOT-FORWARDING]] suite on hand-written ViewNode trees: a bare `<Children/>` written inside a component's call-site children forwards the outer content into that component's default slot, through direct expansion, the router end to end, and the SSG serializer. The compiled-layout proof is `slot-forwarding-compiled.test.js`.

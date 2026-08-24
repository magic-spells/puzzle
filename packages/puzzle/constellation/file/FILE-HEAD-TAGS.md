---
name: managed head-tag machinery
status: verified
path: client-runtime/headTags.js
language: javascript
summary: >-
  Build-time-only managed head tags (og:/twitter:/description/canonical) and their per-tag
  data-puzzle-head identity.
connections:
  - COMPONENT-SSG
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
  - DECISION-D84-HEAD-MANAGEMENT
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the
connected decision cards; this card anchors that plan to
`client-runtime/headTags.js`.

The module exports one thing: the `MANAGED_TAGS` table. Its **only** consumer is
the SSG string injector (`ssg/index.js`), which reads it under Node at prerender
time — hence the binding to [[COMPONENT-SSG]] rather than
[[COMPONENT-ROUTER]], which imported the now-deleted `syncTags` until
[[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]].

Durable constraint: this file must stay DOM-free. It runs under Node, and its
lack of a browser importer is exactly what keeps it out of every bundle — the
deletion in D111 replaced a build define with plain tree-shaking, so re-adding a
browser import would silently ship it again with no gate to notice. `<title>` is
deliberately absent from the table; that is `head.js` `syncTitle`'s job and the
one head concern the runtime still performs.

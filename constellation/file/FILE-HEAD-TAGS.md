---
name: managed head-tag machinery
status: built
path: client-runtime/headTags.js
language: javascript
summary: >-
  Build-time-only managed head tags (og:/twitter:/description/canonical) and their per-tag
  data-puzzle-head identity.
connections:
  - COMPONENT-ROUTER
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
  - DECISION-D84-HEAD-MANAGEMENT
---

Source binding for the owning component card. Behavioral intent stays in the
connected decision cards; this card anchors that plan to
`client-runtime/headTags.js`.

Created to resolve a dangling `FILE-HEAD-TAGS` reference in
[[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]], which listed the handle in its
connections before the card existed. The module itself is live — the SSG string
injector imports `MANAGED_TAGS` at prerender time. Per D111 there is deliberately
no browser-side counterpart; `<title>` is the separate always-on concern handled
by `head.js` `syncTitle`.

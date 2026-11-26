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
  - DECISION-D84-HEAD-MANAGEMENT
  - DOC-SPEC-ROUTER
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# headTags.js

Exports one thing: the `MANAGED_TAGS` table (description, canonical, og:/twitter:
tags and their per-tag `data-puzzle-head` identity). Its **only** importer is the
SSG string injector (`ssg/index.js`), under Node at prerender time — managed head
tags are build-time only ([[DECISION-D84-HEAD-MANAGEMENT]]).

Traps:

- **Keep it DOM-free and browser-import-free.** Having no browser importer is
  exactly what keeps it out of every bundle; there is no build define guarding
  it, so a new browser import would silently ship it with nothing to notice.
- `<title>` is deliberately absent: `head.js` `syncTitle` owns it, the one head
  concern the runtime still performs at commit.

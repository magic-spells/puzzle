---
name: 0.5.0 — escaping the tree
status: built
version: 0.5.0
connections:
  - RELEASE-V0-4-0
  - DECISION-D144-PORTAL
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
---

# 0.5.0 — escaping the tree

Published 2026-08-07. `<Portal>` ([[DECISION-D144-PORTAL]]), error boundaries
with an app-level `onError` ([[DECISION-D145-ERROR-BOUNDARIES]]), reused
ancestors joining the atomic navigation commit, implicit two-way form binding
([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]), and `puzzle preview` plus the
real static pipeline in `puzzle dev`
([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]).

## Upgrade notes

- `prefix:name` attributes (e.g. `bind:value`) are reserved and are compile
  errors; `xml`, `xlink`, `xmlns` are allowed.
- `PORTAL_TAG` is a reserved script binding, like `SLOT_TAG`.
- A path-shaped `value=`/`checked=` on a plain form control now writes back on
  its own; an author `@input`/`@change` suppresses that.

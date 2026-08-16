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

Published 2026-08-07. Named for the two things a view could not previously do:
render outside its own DOM position, and fail without leaving a hole.

`<Portal>` teleports a subtree to a framework-created outlet at the app root
while the subtree stays in its owner's component tree — same props, data flow,
lifecycle, and teardown. That is the fix for overlays losing fights with
ancestor `transform`, `overflow` clipping, and stacking contexts, which until
now had no answer inside the framework at all.

Error boundaries give every framework-contained failure one funnel through an
app-level `onError`, and a way to render something in the failed position
instead of nothing.

Underneath both, the last piece of state sitting outside the atomic navigation
commit joined it. A gated navigation now either lands completely — reused
ancestors' params, snapshot, data, and subscriptions included — or changes
nothing at all, closing a long-standing soft violation of the commit contract.

The other half of the release is the artifact you ship rather than the app you
write. `puzzle preview` serves a built `dist/` the way a production host will,
per output mode, with a real 404 for static output. And `puzzle dev` finally
runs the real static pipeline for `output: 'static'` projects instead of
serving them as SPAs, so what you develop against is what you deploy.

## Upgrade notes

Additive overall. Three things can touch an existing app:

- **`prefix:name` attributes are reserved.** `bind:value` and any other
  namespaced attribute is now a positioned compile error, holding that space
  for the grammar. `xml`, `xlink`, and `xmlns` are allowlisted.
- **`PORTAL_TAG` is a reserved script binding**, alongside `SLOT_TAG`. A
  module-scope binding or loop variable by that name is a compile error.
- **Implicit two-way binding is new behavior on unchanged markup.** A
  path-shaped `value=`/`checked=` on a plain form control now writes back on
  its own. An author `@input`/`@change` suppresses it, so hand-written mirror
  handlers keep working exactly as before — delete them at your convenience,
  not as a precondition.

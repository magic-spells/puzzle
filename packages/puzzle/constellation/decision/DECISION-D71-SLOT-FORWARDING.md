---
name: D71 — Default-child forwarding through a component invocation
status: verified
connections:
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - FILE-VIEW-MANAGER
  - FILE-TESTS-SLOT-FORWARDING-TEST
  - FILE-TESTS-SLOT-FORWARDING-COMPILED-TEST
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D71 — Default-child forwarding through a component invocation

## Context

A routed layout may wrap its outlet in reusable chrome:

```html
<puzzle-view class="layout">
  <Header/>
  <Card>
    <Children/>
  </Card>
</puzzle-view>
```

Without forwarding, the marker in Card's call-site children stays a literal
element and the routed page never reaches Card.

## Decision

The expansion walk (`expandSlots` in `viewManager.js`) descends into a component
vnode's call-site children. A default marker (`<Children/>`, or `<Slot/>` in a
layout — the same marker node) authored there consumes the enclosing template's
default bucket before the inner component renders; the substituted vnodes become
ordinary default children for the inner component. Mounted vnode identity and
instance pointers survive expansion, so patching and teardown stay correct.
A lowercase marker spelling in that position is a compile error.

Named markers inside a component invocation are compile errors (through nested
elements, control flow and deeper invocations): the router fills only the
default bucket, and named forwarding would need new source/renaming semantics.
Per-body slot-name uniqueness counts inside the invocation — a default marker
inside and outside would splice the same bucket twice.

## Consequences

Works in the browser and the SSG serializer (shared `expandSlots`). Covered by
`tests/slot-forwarding.test.js` and `slot-forwarding-compiled.test.js`.
Named-slot forwarding remains deliberately unshipped.

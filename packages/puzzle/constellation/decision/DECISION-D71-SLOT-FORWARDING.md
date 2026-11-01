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
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D71 — Default-child forwarding through a component invocation

A routed layout may wrap its outlet in reusable chrome, and the routed page must reach the inner component:

```html
<puzzle-view class="layout">
  <Header/>
  <Card>
    <Children/>
  </Card>
</puzzle-view>
```

## Decision

- The expansion walk (`expandSlots` in `viewManager.js`) descends into a component vnode's call-site children. A default marker there (`<Children/>`, or `<Slot/>` in a layout — the same marker node) consumes the enclosing template's default bucket before the inner component renders; the substituted vnodes become ordinary default children of the inner component.
- Mounted vnode identity and instance pointers survive expansion, so patching and teardown stay correct.
- Named markers inside a component invocation are compile errors (through nested elements, control flow and deeper invocations): the router fills only the default bucket.
- Per-body slot-name uniqueness counts inside the invocation — a default marker inside and outside would splice the same bucket twice.
- Works in the browser and the SSG serializer (shared `expandSlots`).

## Alternatives rejected

- **Named-slot forwarding** — needs new source/renaming semantics; deliberately not shipped.

## Gotchas

- Tests: `tests/slot-forwarding.test.js`, `tests/slot-forwarding-compiled.test.js`.

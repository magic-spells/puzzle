---
name: 'D71 — Default-slot forwarding through a component invocation (v1.38)'
status: verified
connections:
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - FILE-VIEW-MANAGER
  - FILE-COMPILER-INTERNAL-PARSER-SLOT
  - FILE-TESTS-SLOT-FORWARDING-TEST
  - FILE-TESTS-SLOT-FORWARDING-COMPILED-TEST
verified_at: '2026-07-22T00:04:06.730Z'
notes:
  - kind: verified
    text: >-
      Verified at 9c199aa: expandNode/expandChildList descent + clone link preservation traced in
      viewManager.js; walkSlots inCallSite named-marker rejection traced in slot.go;
      tests/slot-forwarding.test.js + slot-forwarding-compiled.test.js green in the 746-test suite;
      all D69 citations re-pointed to D71 (grep-clean outside morph code); SPEC §24 forwarding
      paragraph and DOC-DECISIONS index line landed in the same commit.
  - kind: verified
    text: >-
      Re-verified at 10613c3: expandNode/expandChildList/expandSlots/partitionSlots untouched since
      the 9c199aa stamp; slot.go's only change is the additive D72 ref-on-slot rejection firing
      before the D71 named-marker rule. Forwarding semantics intact.
  - kind: state
    text: >-
      Respelled by D74 (v1.41): the forwarding form is now `<Card><children/></Card>` (or `<Slot/>`
      in a layout — same marker node); bare lowercase `<slot/>` in that position is a positioned
      compile error like everywhere else. Forwarding semantics, the named-marker rejection, and the
      expansion walk are unchanged. See DECISION-D74-CHILDREN-MARKER.
---

# D71 — Default-child forwarding through a component invocation

## Context

A routed layout may wrap its outlet in reusable chrome:

```html
<puzzle-view class="layout">
  <Header/>
  <Card>
    <children/>
  </Card>
</puzzle-view>
```

Without forwarding, the marker in Card's call-site children remained a literal
element and the routed page never reached Card. D74 later respelled the original
bare lowercase marker as `<children/>`; the mechanism is unchanged.

## Decision

The expansion walk descends into a component vnode's call-site children. A
default marker authored there consumes the enclosing template's default bucket
before the inner component renders. The substituted vnodes then become ordinary
default children for the inner component.

Mounted vnode identity and instance pointers survive expansion so patching and
teardown remain correct.

Named markers inside a component invocation are compile errors. The router
fills only the default bucket, and named forwarding would require new source
and renaming semantics. The rejection applies through nested elements, control
flow, and deeper component invocations alike; per-body slot-name uniqueness
keeps counting inside the invocation, since a default marker inside AND outside
would splice the same bucket twice.

## Consequences

Wrapper layouts such as `<Card><children/></Card>` work in the browser and the
SSG serializer. Parser, runtime, compiled-fixture, and forwarding tests cover
the rule. Named-slot forwarding remains deliberately unshipped.

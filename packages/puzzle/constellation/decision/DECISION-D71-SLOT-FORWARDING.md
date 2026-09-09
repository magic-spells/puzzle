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
verified_at: '2026-08-24T21:39:23.520Z'
notes:
  - kind: verified
    text: >-
      Verified: expandNode/expandChildList descent + clone link preservation traced in
      viewManager.js; walkSlots inCallSite named-marker rejection traced in slot.go;
      tests/slot-forwarding.test.js + slot-forwarding-compiled.test.js green in the 746-test suite;
      all D69 citations re-pointed to D71 (grep-clean outside morph code); SPEC §24 forwarding
      paragraph and DOC-DECISIONS index line landed in the same commit.
  - kind: verified
    text: >-
      Re-verified: expandNode/expandChildList/expandSlots/partitionSlots untouched since the prior
      stamp; slot.go's only change is the additive D72 ref-on-slot rejection firing before the D71
      named-marker rule. Forwarding semantics intact.
  - kind: state
    text: >-
      The forwarding form is `<Card><Children/></Card>` (or `<Slot/>` in a layout — same marker
      node); a lowercase spelling in that position is a positioned compile error. Forwarding
      semantics, the named-marker rejection, and the expansion walk are unchanged.
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
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


Wrapper layouts such as `<Card><Children/></Card>` work in the browser and the
SSG serializer. Parser, runtime, compiled-fixture, and forwarding tests cover
the rule. Named-slot forwarding remains deliberately unshipped.

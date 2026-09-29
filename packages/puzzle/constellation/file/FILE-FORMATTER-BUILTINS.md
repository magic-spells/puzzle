---
name: function library built-ins
status: verified
path: client-runtime/formatters/builtins.js
language: javascript
summary: >-
  Side-effect-free implementations of the standard library functions plus timeago (the module keeps
  its formatters name); t and link are added by the i18n service and the registry.
connections:
  - COMPONENT-FORMATTERS
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `client-runtime/formatters/builtins.js`.

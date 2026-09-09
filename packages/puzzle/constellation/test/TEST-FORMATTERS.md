---
name: Formatter registry and display coercion
kind: unit
status: verified
framework: vitest
connections:
  - COMPONENT-FORMATTERS
  - FILE-FORMATTER-REGISTRY
  - FILE-FORMATTER-BUILTINS
  - FILE-FORMATTER-ALL
  - DECISION-D25-BARE-FORMATTER-CALLS
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - DECISION-D114-CALENDAR-DATE-FORMATTERS
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - FEATURE-V1-12-FORMATTER-GUARD
  - DOC-TESTING
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

# Formatter registry and display coercion

Proves the display layer: registry behavior, the missing-name guard, the
built-in set, and the single coercion function that decides how any value
becomes text.

The Intl-backed built-ins are covered with their caches, which is where the
subtle bugs live — a cache keyed carelessly leaks locale or array-locale state
between calls. Calendar-date formatters run a second time under a foreign
process time zone, because a date formatter that only passes in UTC is a
formatter that fails for half the planet.

`displayValue` is proven as the sole owner of value-to-text coercion, so
rendering, the serializer, and formatters cannot drift into three different
answers for the same input.

Covers 3 files under `tests/`.

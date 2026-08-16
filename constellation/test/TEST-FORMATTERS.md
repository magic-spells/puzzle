---
name: Formatter registry and display coercion
kind: unit
status: built
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

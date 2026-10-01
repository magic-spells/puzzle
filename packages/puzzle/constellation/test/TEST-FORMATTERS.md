---
name: Function library registry and display coercion
kind: unit
status: verified
framework: vitest
connections:
  - COMPONENT-FORMATTERS
  - FILE-FORMATTER-REGISTRY
  - FILE-FORMATTER-BUILTINS
  - FILE-FORMATTER-ALL
  - FILE-DATES
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - DECISION-D114-CALENDAR-DATE-FORMATTERS
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DOC-TESTING
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Function library registry and display coercion

Proves the display layer: the function library's registry (`FormatterRegistry`
in `client-runtime/formatters.js`), the missing-name guard, the built-ins, and
the one coercion function that decides how any value becomes text. Suites:
`tests/formatters.test.js`, `formatters-hardening`, `formatters-timezone`,
`display-value`, `handler-library-collision`. Run with
`npx vitest run tests/formatters tests/display-value tests/handler-library-collision`.

- **The shared table.** `formatters.test.js` runs the conformance rows in
  `packages/puzzle-lang/conformance/functions.json` — the same file Sites runs
  from its Go tests ([[DECISION-D174-STANDARD-FORMATTERS]]). Beside it: the
  standard set and the PuzzleKit-only names against `STANDARD_FORMATTERS`,
  registration validation and app overrides (with the shadowing warning), the
  D43 guard, and that a call to a removed name passes the value through with a
  development error naming its JavaScript replacement.
- `handler-library-collision` pins the mount-time development warning when a
  view handler shares a library function's name
  ([[DECISION-D176-EXPRESSION-LANGUAGE]] rule 4).
- The Intl-backed built-ins are covered with their caches — a carelessly keyed
  cache leaks locale or array-locale state between calls. The calendar-date
  functions run a second time under a foreign process time zone.
- `displayValue` is the sole owner of value-to-text coercion, so rendering, the
  serializer and the functions cannot give three answers for one input.

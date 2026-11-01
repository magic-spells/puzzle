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
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Function library registry and display coercion

The display layer: the function library's registry (`FormatterRegistry` in
`client-runtime/formatters.js`), the missing-name guard, the built-ins, the `raw`
sanitizer, and the one coercion function that decides how any value becomes text. Run
with
`npx vitest run tests/formatters tests/display-value tests/handler-library-collision tests/sanitize`.

- **The shared table**: `formatters.test.js` runs the conformance rows in
  `packages/puzzle-lang/conformance/functions.json`, the same file Sites runs from its Go
  tests (D174). Beside it: the standard set and the PuzzleKit-only names against
  `STANDARD_FORMATTERS`, registration validation and app overrides (with the shadowing
  warning), the D43 guard, a removed name passing the value through with a development
  error naming its JavaScript replacement, and the Intl-backed built-ins with their
  caches (a carelessly keyed cache leaks locale state between calls).
- `formatters-timezone`: the calendar-date functions under a foreign process time zone
  (D114).
- `formatters-hardening`: unreadable input. `round` gives NaN; the number and date
  functions print nothing for NaN, ±Infinity, an Invalid Date or an object;
  `date(in_timezone(v))` on a bad date prints nothing; a string prints as written.
- `handler-library-collision`: the mount-time development warning when a view handler
  shares a library function's name (D176).
- `sanitize`: the allowlist sanitizer behind `raw` (DOMPurify-compatible defaults for
  `class`, `id` and `target`) and `newline_to_br` escaping, shared by the browser and
  prerender.
- `display-value`: `displayValue` is the sole owner of value-to-text coercion, so
  rendering, the serializer and the functions cannot give three answers for one input.

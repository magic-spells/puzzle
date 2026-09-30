---
name: >-
  D43 — Library calls compile with the `__missing` guard: an unknown function passes the value
  through
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D176-EXPRESSION-LANGUAGE
code_refs:
  - client-runtime/formatters.js
---

# D43 — Library calls compile with the `__missing` guard

See [[DOC-SPEC-TEMPLATE]] §6.

## Decision
- **Emission.** A template call to a library function, `name(a, b)`, compiles to `(__f["name"] || __f.__missing("name"))(a, b)` ([[DECISION-D176-EXPRESSION-LANGUAGE]]; `lower.go`). Bracket access with a JSON-quoted name matches the registry's arbitrary string keys — dot access would turn a hyphenated name into subtraction.
- **`__missing` is a factory** on the registry: given the name, it returns a pass-through function `(v) => v`, so a display-only mistake renders the raw value instead of taking down the render loop. `registry.get(name)` follows the same rule.
- **The warning is development-only** (behind `__PUZZLE_DEV__`, so production drops it and its edit-distance helper): one `console.error` per unknown name, `[puzzle] unknown function "captialize" — value passed through unchanged (did you mean "capitalize"?)`, suggesting a registered name at edit distance ≤ 2. A name removed from the library gets its replacement instead, and `t` without translations gets the i18n setup hint ([[DECISION-D175-TRANSLATIONS]]).
- The tree-shaking scan still keeps every used built-in ([[DECISION-D31-FORMATTER-TREESHAKE]]), so the guard stays a typo guard, not a bundling crutch.

## Alternatives rejected
- A compile-time unknown-function error — impossible: app functions register at runtime in the app config, which the compiler never parses.
- A nameless `(__f.name || __f.__missing)` — calls the fallback as the function, so the message cannot name the typo.
- Throwing — turns a cosmetic typo into a blank page.

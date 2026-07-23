---
name: Formatter registry
status: verified
verified_at: '2026-07-17T23:33:30.500Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - FILE-FORMATTER-REGISTRY
  - FILE-FORMATTER-BUILTINS
  - FILE-FORMATTER-ALL
---

# Formatter registry

Liquid-style, display-only transformations used by compiled template chains. The registry seeds built-ins, applies user registrations last (user overrides win), exposes the raw function map to render functions, and supports arbitrary string keys through bracket access.

An unknown formatter calls `__missing(name)`: warn once per registry, include a did-you-mean suggestion at edit distance at most two, and return a pass-through function. A typo therefore renders the original value instead of crashing the view.

Built-ins are pure named exports. A JSON name manifest is embedded by the Go build scanner, which serves a virtual module importing only formatters observed in project templates. The scan deliberately errs toward inclusion; `escape`, `raw`, and `noescape` remain safety defaults. Raw/test imports use the full built-in map.

One built-in is not a pure export: `link` (D79) needs the live router, so PuzzleApp registers it at mount after constructing the router — only if absent, so a user `link` from config wins. It delegates to `router.url()` (nullish → `''`, non-strings coerced, non-`/` strings pass through). The tree-shake scanner ignores the name (not on the allowlist), the same handling as any custom formatter.

All built-ins fail soft on nullish or invalid display input. Numeric precision normalizes to an integer in the `toFixed` range; date/locale/time-zone failures fall back to a string; sort copies before comparing and treats numeric arrays numerically. `raw`/`noescape` only skip formatter escaping—they do not inject HTML into text vnodes.

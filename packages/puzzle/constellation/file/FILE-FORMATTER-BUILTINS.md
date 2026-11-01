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
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# builtins.js

The built-in functions of the template library ([[COMPONENT-FORMATTERS]]), as
named exports compiled code reaches through the registry's `__f` map.

- **Side-effect-free, always.** The compiler's virtual manifest imports only the
  names a build uses straight from here; one top-level side effect defeats that
  tree-shaking. [[FILE-FORMATTER-ALL]] re-exports everything for non-compiler
  consumers.
- The standard set is shared with Sites (D174/D176); its identical-output part is
  pinned by `packages/puzzle-lang/conformance/functions.json`. `timeago` is
  PuzzleKit-only; `link` is built by the registry and `t` by the i18n service, not
  here.
- What a JavaScript method, `Math` global, operator or `??` already does is not a
  function here (`round` stays: nothing in JS rounds half away from zero to a
  number in one call).
- Dates are classified only through `dates.js` ([[FILE-DATES]]); unreadable input
  prints as written (strings) or nothing — never `NaN`, `Invalid Date` or
  `[object Object]`.

---
name: Formatter registry
status: verified
verified_at: '2026-07-24T05:49:12.276Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - FILE-FORMATTER-REGISTRY
  - FILE-FORMATTER-BUILTINS
  - FILE-FORMATTER-ALL
notes:
  - kind: state
    text: >-
      Dev-only did-you-mean machinery is now tree-shaken from prod (2026-07-24). The D43 __missing
      typo-guard computed its Levenshtein suggestion OUTSIDE the (dropConsole-stripped)
      console.error, so ~0.5 KB of dead code shipped in production. editDistance + the nearest-match
      search (now a module-level `nearestFormatter` function, no longer a class method) plus the
      whole warn block are wrapped in `if (typeof __PUZZLE_DEV__ === 'undefined' ||
      __PUZZLE_DEV__)`; production folds __PUZZLE_DEV__ to false, DCEs the branch, and tree-shakes
      both functions out. Verified: the "did you mean"/"unknown formatter" strings and the DP loop
      are ABSENT from a prod examples/todos app.js. Dev/test behavior (warn-once with suggestion)
      unchanged. Does NOT touch D31 manifest tree-shaking or the D43 pass-through contract.
    sha: d9591d6
verified_sha: d9591d6e01cb9c358acfa4d641174d08e1f05b23
---

# Formatter registry

Liquid-style, display-only transformations used by compiled template chains. The registry seeds built-ins, applies user registrations last (user overrides win), exposes the raw function map to render functions, and supports arbitrary string keys through bracket access.

An unknown formatter calls `__missing(name)`: warn once per registry, include a did-you-mean suggestion at edit distance at most two, and return a pass-through function. A typo therefore renders the original value instead of crashing the view.

Built-ins are pure named exports. A JSON name manifest is embedded by the Go build scanner, which serves a virtual module importing only formatters observed in project templates. The scan deliberately errs toward inclusion; `escape`, `raw`, and `noescape` remain safety defaults. Raw/test imports use the full built-in map.

One built-in is not a pure export: `link` (D79) needs the live router, so PuzzleApp registers it at mount after constructing the router — only if absent, so a user `link` from config wins. It delegates to `router.url()` (nullish → `''`, non-strings coerced, non-`/` strings pass through). The tree-shake scanner ignores the name (not on the allowlist), the same handling as any custom formatter.

All built-ins fail soft on nullish or invalid display input. Numeric precision normalizes to an integer in the `toFixed` range; date/locale/time-zone failures fall back to a string; sort copies before comparing and treats numeric arrays numerically. `raw`/`noescape` only skip formatter escaping—they do not inject HTML into text vnodes.

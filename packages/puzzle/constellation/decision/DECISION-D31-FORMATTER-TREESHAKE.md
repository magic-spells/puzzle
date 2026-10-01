---
name: 'D31 — Library tree-shaking: a manifest-seeded function registry pruned by a compile-time scan'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-FORMATTERS
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-PUZZLE-APP
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
---

# D31 — Library tree-shaking: a manifest-seeded registry pruned by a compile-time scan

A bundle ships only the built-in library functions its templates call. See [[COMPONENT-FORMATTERS]] and [[COMPONENT-ESBUILD-PLUGIN]].

## Decision
- **Built-ins are pure named exports** in `client-runtime/formatters/builtins.js` (shared logic in non-exported helpers). `formatters/builtins.json` is the canonical name list, embedded by the Go compiler as its allowlist and kept honest by a vitest drift test. `formatters/builtins-all.js` default-exports the full map.
- **The registry seeds from a manifest.** `FormatterRegistry` registers from the `@magic-spells/puzzle/formatters/manifest` import; [[COMPONENT-PUZZLE-APP]] then registers the app's `formatters` over it, so config overrides still work. Render code is unchanged — `getAll()` plus guarded calls ([[DECISION-D43-FORMATTER-MISSING-GUARD]]).
- **The compiler prunes.** `plugin.ScanUsage` parses every `.pzl` in the project for library calls before the bundle (in `build`, `watch` and every dev rebuild), and the plugin resolves the manifest specifier to a virtual module importing only the used names from `builtins.js`. Unbundled use (tests, raw imports) resolves the specifier to `builtins-all.js` through package `exports` and a vitest alias. The same scan feeds the feature DCE bits ([[DECISION-D89-FEATURE-USAGE-TREESHAKE]]).
- **Always kept:** `escape` — the manifest adds it and the registry seeds it itself.
- **Never in the manifest:** `raw` and `newline_to_br`. Codegen lowers them to the live-HTML node ([[DECISION-D174-STANDARD-FORMATTERS]]), so the scan records them only as the `HasRawHTML`/`HasRawSanitize` usage bits; seeding `raw` would pull the sanitizer into every bundle.
- The scan errs toward over-inclusion. A missed name would not crash (the D43 guard passes the value through), but the guard is a typo guard, not a bundling crutch.

## Alternatives rejected
- Per-file static imports + direct calls — simpler, but drops config override of built-ins and couples codegen to the built-in list.
- Shipping every built-in — the size cost this removes.

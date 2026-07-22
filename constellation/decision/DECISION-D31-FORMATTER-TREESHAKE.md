---
name: "D31 — Compile-time formatter tree-shaking: manifest-seeded registry (Approach B)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-FORMATTERS
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-PUZZLE-APP
  - DECISION-D28-ANIMATIONS
---

# D31 — Compile-time formatter tree-shaking: manifest-seeded registry (Approach B)

The shipped built-in formatter set becomes the union of what an app's templates actually pipe to — via pure named exports, a manifest-seeded registry, and a compiler pre-scan — with zero documented-behavior change. Settled; see [[COMPONENT-FORMATTERS]] and [[COMPONENT-ESBUILD-PLUGIN]].

## Context
The ~40 built-in formatters ([[DECISION-D07-NAMING]]) were all registered unconditionally in the `FormatterRegistry` constructor, so every build shipped the full set (~1–2 KB gzip) regardless of use — a bundler can't tree-shake what a constructor references. D31 makes the shipped set the union of what an app's templates actually pipe to, additively and with **zero documented-behavior change**.

## Decision
- **Built-ins become pure named exports.** `client-runtime/formatters/builtins.js` holds each formatter as a side-effect-free `export function`; internal deps resolve via real imports (`time`/`datetime` call the imported `date`). `formatters/builtins-all.js` default-exports the full map (the raw/non-build fallback) and `formatters/builtins.json` is the canonical name list, embedded by the Go compiler as its allowlist and kept honest by a vitest drift test.
- **The registry seeds from a manifest.** `new FormatterRegistry(seedMap = manifest)` registers from the `@magic-spells/puzzle/formatters/manifest` import; [[COMPONENT-PUZZLE-APP]] then registers config formatters over it (override preserved). Render codegen is UNCHANGED — still `getAll()` + bare `__f.name(...)` ([[DECISION-D22-NO-ESCAPE-BY-DEFAULT]]/[[DECISION-D25-BARE-FORMATTER-CALLS]]).
- **The compiler prunes at build time.** A parse-only pre-scan ([[COMPONENT-ESBUILD-PLUGIN]] `scan.go`) walks `app/**/*.pzl` for used built-in names; the plugin resolves the manifest specifier to a virtual module importing ONLY those from `builtins.js`, so esbuild drops the rest. The scan runs BEFORE the bundle in both `build` and `watch` (complete union, no onLoad race); `dev` rescans per rebuild. Raw imports / tests resolve the specifier to `builtins-all.js` via package `exports` + a vitest alias.

**Chose B (manifest-seeded registry) over C (per-file static imports + direct calls).**

## Alternatives rejected
- **Approach C (per-file static imports + direct calls).** Simpler infrastructure — esbuild unions/tree-shakes across the module graph for free, no manifest, no scan — but it would drop runtime override of built-ins by config and couple codegen to the built-in name list, a SPEC-level behavior change in a repo with a frozen contract. B keeps every documented semantic.
- **Shipping all formatters** (the status quo): the size cost this fixes.

## Consequences
**Safety.** Because compiled calls are bare `__f.name(...)` with no `__missing` guard ([[DECISION-D25-BARE-FORMATTER-CALLS]]), a scan miss would crash (`undefined(...)`), so the scan walks every node / attr / part type codegen can emit a formatter from (text `Interpolation`, `MixedAttr` `InterpPart`, `InlineIfPart`) and `escape`/`raw`/`noescape` are always kept. Verified end-to-end: `examples/blog` drops unused built-ins from `dist/app.js` (~958 B gzip / 4.3 KB raw saved) with used ones present; 224 vitest + all Go tests green.

Non-breaking: an app that pipes to every formatter still ships every formatter; additive over the frozen SPEC like [[DECISION-D28-ANIMATIONS]]/D29/D30.

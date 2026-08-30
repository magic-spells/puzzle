---
name: D164 — Playground compilation is parser+codegen-only WASM behind a worker protocol
status: built
connections:
  - DECISION-D46-INLINE-SVG
  - DECISION-D54-TYPESCRIPT-SCRIPTS
---

# D164 — Playground compilation is parser+codegen-only WASM behind a worker protocol

## Context

A browser playground needs the framework's real positioned parser diagnostics and render output, but embedding esbuild triples the measured WASM payload. The compiler also normally reaches the filesystem for `{#svg}` assets.

## Decision

Build a js/wasm-only command whose dependency graph ends at [[COMPONENT-TEMPLATE-PARSER]] and [[COMPONENT-CODEGEN]]. It registers `__pzlCompile(source, { filename?, ts? })` and `__pzlVersion()`; compilation returns data instead of throwing. Filename drives the existing view/layout/component path convention. The entry documents the phase-2 worker envelope as `{ id, source, options }` request to `{ id, result }` response.

The WASM path never reads assets: any `{#svg}` site becomes a positioned “not available in the playground” error before codegen can reach `os.ReadFile`. TypeScript transformation remains outside this Go module because D54's transformer is esbuild; the `ts` option is retained in the protocol for the wrapper that will own that separate step.

## Alternatives

- **Embed esbuild in Go WASM** — rejected: it defeats the measured size budget.
- **Create a second parser/code generator in JavaScript** — rejected: grammar and diagnostics would drift.
- **Silently ignore filesystem constructs** — rejected: generated output would lie about what will build in a real project.

## Consequences

The module is a synchronous single-source transform suitable for serialization behind a web worker, not the full Puzzle bundle pipeline. Assets and TypeScript transformation need explicit wrapper-level capabilities in later phases.

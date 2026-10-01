---
name: D164 — Playground compilation is parser+codegen-only WASM behind a worker protocol
status: built
connections:
  - DECISION-D46-INLINE-SVG
  - DECISION-D54-TYPESCRIPT-SCRIPTS
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-PZL-WASM
  - DECISION-D59-SCOPED-STYLES
  - RELEASE-V0-7-0
---

## Context

A browser playground needs the real positioned parser diagnostics and render output, but embedding esbuild triples the WASM payload, and the compiler normally reads `{#svg}` assets from disk. The input comes from strangers, and a Go WASM instance is single-use: one fatal error ends the session, not the request.

## Decision

`compiler/cmd/pzl-wasm` is a js/wasm-only command whose dependency graph ends at [[COMPONENT-TEMPLATE-PARSER]] and [[COMPONENT-CODEGEN]]. It registers `__pzlCompile(source, { filename?, ts? })` and `__pzlVersion()`; compilation returns data, never throws.

- `filename` drives view/layout/component emission through `codegen.ModeForPath` (the playground's path selector). Option reads are lenient: non-string `filename` → default, non-boolean `ts` → false.
- Response `{ js, css, warnings, errors }`; the worker wraps it as `{ id, result }` against `{ id, source, options }`. `css` exists because there is no build pipeline — scoping is applied in Go by the same `codegen.ScopedCSS` the esbuild plugin calls, so playground and build can't drift (D59).
- Any `{#svg}` becomes a positioned "not available in the playground" error before codegen reaches `os.ReadFile`.
- TypeScript (`ts: true` or `lang="ts"`) returns a positioned "not available" diagnostic: D54's transformer is esbuild. The `ts` bit stays in the protocol for a wrapper-level transformer.

**Failure containment in three layers:**
1. `compile` runs under a deferred `recover()`, so a Go panic becomes an error diagnostic.
2. Options are snapshotted via a JS call (`Object.assign`), not raw `Get`: a throwing JS getter unwinds WASM frames as a JS exception `recover()` never sees, but the bridge turns a thrown *call* into a Go panic.
3. Input caps for what `recover()` can't catch (out of memory, stack exhaustion): source ≤ 512 KB (`maxSourceBytes`), template nesting ≤ 200 (`maxNestingDepth`), both positioned diagnostics. Nesting is a token scan (`parser.OverNestingDepth` in puzzle-lang `parser/depth.go`), not an AST walk — the recursive-descent parser would exhaust the stack first.

The guards are a floor, not a proof: the protocol requires the wrapper to treat any throw out of `__pzlCompile` as a dead worker and respawn it.

## Gotchas

- The depth scan counts token pairs. `{#svg}` is a void block (no `{/svg}`), so it is treated as self-contained; **any future void directive must be added to the scan**. Each `{:else if}` desugars to one more nested `If`, so the scan adds a level per clause and the single `{/if}` pops the whole chain.
- `maxSourceBytes` can only be checked after `args[0].String()`: `js.Value.Get("length")` on a string primitive panics, which `recover()` turns into "playground compiler error" on every call. Run `node scripts/smoke-wasm.mjs` after touching this entry.

## Alternatives

- Embed esbuild in Go WASM — blows the size budget.
- A second parser/codegen in JavaScript — grammar and diagnostics drift.
- Silently ignore filesystem constructs — output would lie about what builds.
- Return raw styles plus a `scopeId` for the wrapper to wrap — a second `@scope` implementation.
- Fix codegen's O(N²) indentation instead of capping — risks every real build to defend a playground.
- A low source cap instead of a depth scan — tuned to one engine's stack; the scan is exact.

## Consequences

A synchronous single-source transform behind a worker, not the bundle pipeline. Assets and TypeScript need wrapper-level capabilities. The caps are visible product limits and must say so plainly.

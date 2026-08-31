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
notes:
  - kind: gotcha
    text: >-
      The nesting-depth scan counts token pairs, so a VOID block breaks it: `{#svg 'icon.svg'}`
      opens a TokBlockOpen with no `{/svg}` to pop it, and 201 flat sibling icons tripped "template
      nesting exceeds 200" with zero real nesting. `scanNesting` now treats a `svg` block header as
      self-contained. Any future void directive must be added there too — the guard has no other way
      to know a block never closes.
  - kind: gotcha
    text: >-
      `{:else if}` is the second way the token scan under-counts: the parser desugars each clause
      right-to-left into a nested `If`, so N clauses are N codegen levels while the stream shows one
      block. `scanNesting` keeps a per-open-block clause count so `{:else if}` adds a level and the
      single `{/if}` pops the whole synthetic chain — a flat row of `{#if}…{:else if}…{/if}` must
      still measure as one level.
  - kind: gotcha
    text: >-
      `maxSourceBytes` can only be checked AFTER `args[0].String()`. A pre-copy check on
      `args[0].Get("length")` looks like the obvious optimization and is a hard bug:
      `syscall/js.Value.Get` requires `isObject()`, so on a string primitive it panics `call of
      Value.Get on string` — swallowed by compile's `recover()`, turning every single call into
      "playground compiler error". `node scripts/smoke-wasm.mjs` catches it on the first compile;
      run it after touching this entry.
---

# D164 — Playground compilation is parser+codegen-only WASM behind a worker protocol

## Context

A browser playground needs the framework's real positioned parser diagnostics and render output, but embedding esbuild triples the measured WASM payload. The compiler also normally reaches the filesystem for `{#svg}` assets. And unlike every other consumer of the compiler, this one is fed by strangers: a Go WASM instance is single-use, so one fatal error ends the session, not the request.

## Decision

Build a js/wasm-only command whose dependency graph ends at [[COMPONENT-TEMPLATE-PARSER]] and [[COMPONENT-CODEGEN]]. It registers `__pzlCompile(source, { filename?, ts? })` and `__pzlVersion()`; compilation returns data instead of throwing. Filename drives the existing view/layout/component path convention through `codegen.ModeForPath`, so the playground's path selector is what decides view versus component emission. Option reads are lenient — a non-string `filename` falls back to the default, a non-boolean `ts` is false.

The response is `{ js, css, warnings, errors }`, wrapped by the worker as `{ id, result }` against an `{ id, source, options }` request. `css` is there because the playground has no build pipeline: without it a `<style scoped>` component would get its `data-<scopeId>` stamp in the markup and never receive the matching rule. Scoping is applied in Go, by the same `codegen.ScopedCSS` the esbuild plugin ([[COMPONENT-ESBUILD-PLUGIN]]) calls, so the playground and a real build cannot drift ([[DECISION-D59-SCOPED-STYLES]]).

The WASM path never reads assets: any `{#svg}` site becomes a positioned "not available in the playground" error before codegen can reach `os.ReadFile`. TypeScript transformation remains outside this Go module because D54's transformer is esbuild; the `ts` option is retained in the protocol for the wrapper that will own that separate step.

Failure is contained in three layers, because the instance cannot be allowed to die:

1. `compile` runs under a deferred `recover()`, so any Go panic becomes an error diagnostic and the instance answers the next request.
2. Attacker-controlled option reads go through `Object.assign` rather than a raw `Get`. A JS getter that throws is NOT a Go panic — it unwinds the WASM frames as a JavaScript exception that `recover()` never sees — but the js/wasm bridge converts a thrown *call* into a Go panic, so routing the one read that touches foreign getters through a call brings it back inside layer 1.
3. Two input caps refuse what neither layer can catch: `fatal error: out of memory` and stack exhaustion. Source is capped at 512 KB, and template nesting at 200 levels, both answered as ordinary positioned diagnostics. The nesting count is a token scan (`parser.OverNestingDepth`), not an AST walk — the recursive-descent parser exhausts the stack on a pathological source before any tree exists to walk.

The guards are a floor, not a proof. The pinned protocol therefore also requires the wrapper to treat any *throw* out of `__pzlCompile` as a dead worker ("Go program has already exited") and respawn it.

## Alternatives rejected

- **Embed esbuild in Go WASM** — it defeats the measured size budget.
- **Create a second parser/code generator in JavaScript** — grammar and diagnostics would drift.
- **Silently ignore filesystem constructs** — generated output would lie about what will build in a real project.
- **Return raw style text plus a `scopeId` and let the wrapper wrap it** — a second implementation of the `@scope` wrapper, in another language, for two lines of string concatenation; the id already comes from Go, so the rule should too.
- **Fix codegen's O(N²) indentation growth instead of capping input** — the quadratic emission is fine for files people actually write, and rewriting the emitter to defend a playground would put every real build at risk for no gain.
- **Cap input size low enough that deep nesting cannot reach the stack limit** — a source budget tuned to one engine's stack; the depth scan is exact and costs nothing.

## Consequences

The module is a synchronous single-source transform suitable for serialization behind a web worker, not the full Puzzle bundle pipeline. Assets and TypeScript transformation need explicit wrapper-level capabilities in later phases. The caps are visible product limits: a playground refuses a 600 KB paste or a 250-level template, and the message has to say so plainly.

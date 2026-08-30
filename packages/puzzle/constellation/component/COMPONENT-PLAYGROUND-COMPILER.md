---
name: Playground WASM compiler
status: built
connections:
  - FEATURE-PLAYGROUND-WASM-COMPILER
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - FILE-PZL-WASM
  - TEST-PZL-WASM
---

# Playground WASM compiler

A js/wasm-only bridge over the real section splitter, template parser, and render-function code generator. It registers two synchronous globals and then keeps the Go runtime alive:

- `__pzlCompile(source, options)` returns `{ js, css, warnings, errors }`; every diagnostic is `{ message, line, col }`, and errors are returned rather than thrown.
- `options.filename` defaults to `app/views/Playground.pzl` and drives `ModeForPath`; `options.ts` is pinned for the worker protocol but reports the Phase 1 no-transform diagnostic. Both are read leniently: a non-string filename or non-boolean `ts` falls back to the default rather than failing.
- `__pzlVersion()` returns the framework compiler version.

`css` carries the file's `<style>` body, `@scope`-wrapped through `codegen.ScopedCSS` when the block is `scoped` — the same call the esbuild plugin makes, so the rule and the `data-<scopeId>` stamp in the emitted JS always agree. Empty when the file has no `<style>`. Without it the playground, which has no build pipeline, would render scoped markup with no matching rule.

The command passes `AssetReadsUnavailable` into codegen, so `{#svg}` fails at the path literal before `filepath`/`SVGCache` can reach `os.ReadFile`. The only build artifact in this phase is local and ignored: `artifacts/wasm/{pzl.wasm,wasm_exec.js}`.

## Staying alive

A Go WASM instance is single-use: after the program exits, every later call throws `Go program has already exited`. So the compile path is built to answer, never to die.

`compile` runs under a deferred `recover()`, which covers the whole body including the options read. That read is deliberately made through `Object.assign` rather than `js.Value.Get`: a hostile getter's exception is a JavaScript throw, not a Go panic, and it would unwind past `recover()` — but the js/wasm bridge turns a throwing *call* into a Go panic, which recover does see.

`recover()` cannot catch a Go fatal error, so the two faults that produce one are refused up front: source over 512 KB, and template nesting over 200 levels. Both come back as ordinary positioned diagnostics. The depth check is `parser.OverNestingDepth`, a token scan with a counter — the recursive-descent parser blows the stack on a pathological source long before an AST exists to walk. Codegen's indentation growth is O(N²) in nesting depth; that is fine for files people write and is not being restructured for this consumer.

The build script proves the command's dependency graph contains no esbuild package, uses the matching Go toolchain's runtime shim, enforces a 6 MiB raw ceiling, and reports raw/gzip bytes. CI builds the command under `GOOS=js GOARCH=wasm`, since the `js && wasm` tag hides it from `go build ./...`. The Node smoke owns the executable API contract until the Phase 2 worker exists.

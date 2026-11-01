---
name: Playground WASM compiler
status: verified
connections:
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - FILE-PZL-WASM
  - TEST-PZL-WASM
verified_at: '2026-11-01T19:26:04.240Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Playground WASM compiler

`compiler/cmd/pzl-wasm`: a js/wasm-only bridge over the real section splitter, template
parser and render-function code generator ([[DECISION-D164-PLAYGROUND-WASM-BOUNDARY]]). It
registers two synchronous globals and keeps the Go runtime alive:

- `__pzlCompile(source, options)` returns `{ js, css, warnings, errors }`; every diagnostic
  is `{ message, line, col }`, and errors are returned, never thrown.
- `options.filename` defaults to `app/views/Playground.pzl` and drives `ModeForPath`.
  `options.ts` (or a `<script lang="ts">`) returns a "TypeScript transpilation is not
  available" diagnostic: esbuild's Transform API would triple the payload, so a future
  worker wrapper owns that transform. Both options are read leniently — a wrong type falls
  back to the default.
- `__pzlVersion()` returns the framework compiler version.

`css` carries the file's `<style>` body, `@scope`-wrapped through `codegen.ScopedCSS` when
`scoped` — the same call the esbuild plugin makes, so the rule and the `data-<scopeId>`
stamp always agree. The playground has no build pipeline, so without it scoped markup
would render with no matching rule.

Codegen gets `AssetReadsUnavailable`, so `{#svg}` fails at the path literal before
`filepath`/`SVGCache` can reach `os.ReadFile`. Build output is local and ignored:
`artifacts/wasm/{pzl.wasm,wasm_exec.js}`.

## Staying alive

A Go WASM instance is single-use: after the program exits, every later call throws `Go
program has already exited`. So the compile path answers, never dies.

- `compile` runs under a deferred `recover()` covering the whole body, including the
  options read. That read goes through `Object.assign` rather than `js.Value.Get`: a hostile
  getter's exception is a JavaScript throw that would unwind past `recover()`, but the
  bridge turns a throwing *call* into a Go panic, which recover sees.
- `recover()` cannot catch a Go fatal error, so the two faults that produce one are refused
  up front as positioned diagnostics: source over 512 KB, and template nesting over
  `parser.DefaultMaxDepth` (200). The depth check is `parser.OverNestingDepth`, a token
  scan with a counter — the recursive-descent parser would blow the stack long before an
  AST exists. Codegen's indentation growth is O(N²) in depth; fine for real files and not
  being restructured for this consumer.

`scripts/build-wasm.mjs` proves the dependency graph contains no esbuild package, uses the
matching Go toolchain's `wasm_exec.js`, enforces a 6 MiB raw ceiling, and reports raw/gzip
bytes. CI builds the command under `GOOS=js GOARCH=wasm` (the `js && wasm` tag hides it
from `go build ./...`). `scripts/smoke-wasm.mjs` owns the executable API contract until a
playground worker exists.

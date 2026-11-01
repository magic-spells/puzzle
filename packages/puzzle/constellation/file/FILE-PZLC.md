---
name: single-file compiler CLI
status: verified
path: compiler/cmd/pzlc/main.go
language: go
summary: Internal explicit-mode pzl compiler used by tests and tooling.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# pzlc

Internal one-shot `.pzl` compiler (`pzlc --mode view|layout|component <in> <out>`):
the same split → parse → codegen pipeline as the esbuild plugin, used by npm
scripts to emit compiled modules for the vitest suite. Not shipped in the npm
package. `view` and `layout` both emit a `<puzzle-view>` root; errors print as
`file:line:col: message` and exit 1.

---
name: single-file compiler CLI
status: verified
path: compiler/cmd/pzlc/main.go
language: go
summary: Internal explicit-mode pzl compiler used by tests and tooling.
connections:
  - COMPONENT-COMPILER-CLI
  - FILE-STANDALONE-COMPILE
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# pzlc

Internal one-shot `.pzl` compiler (`pzlc --mode view|layout|component <in> <out>`):
the same split → parse → codegen pipeline as the esbuild plugin, used by npm
scripts to emit compiled modules for the vitest suite. Not shipped in the npm
package. `view` and `layout` both emit a `<puzzle-view>` root; errors print as
`file:line:col: message` and exit 1. The pipeline itself lives in
`compiler/internal/standalone` ([[FILE-STANDALONE-COMPILE]]), shared with the
hidden `puzzle compile` command that app tests reach through the Vitest plugin.

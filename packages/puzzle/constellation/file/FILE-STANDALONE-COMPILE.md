---
name: standalone .pzl compile
status: verified
path: compiler/internal/standalone/standalone.go
language: go
summary: >-
  One .pzl file to one self-contained ES module, shared by pzlc and `puzzle compile`.
connections:
  - DECISION-D194-VITEST-PLUGIN
  - FILE-PZLC
  - FILE-VITEST-PLUGIN
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# standalone.go

`Compile(filename, src, mode, assetsDir)` runs split → parse → codegen without a bundler: `{#svg}` inlines instead of deduplicating into virtual modules, no module stamp is written, and a `lang="ts"` script is type-stripped with esbuild's transform API. `codegen.AlignScript` pads the module before the strip so the script keeps its `.pzl` lines, and the strip adds an inline source map back to the `.pzl`, so an error thrown in script code names its `.pzl` line. `AssetsDirFor(path)` finds the nearest ancestor `app/` and returns its `assets/`. Two callers: `pzlc` (explicit `--mode`, writes the framework's compiled test fixtures) and the hidden `puzzle compile` (`compiler/cmd/puzzle/compilecmd.go`, mode from the D20 directory rule, prints to stdout for the Vitest plugin, [[DECISION-D194-VITEST-PLUGIN]]). Positioned split/parse/codegen errors pass through unchanged. Go tests: `compilecmd_test.go`.

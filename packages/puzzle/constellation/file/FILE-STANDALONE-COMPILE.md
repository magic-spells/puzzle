---
name: standalone .pzl compile
status: built
path: compiler/internal/standalone/standalone.go
language: go
summary: >-
  One .pzl file to one self-contained ES module, shared by pzlc and `puzzle compile`.
connections:
  - DECISION-D193-VITEST-PLUGIN
  - FILE-PZLC
  - FILE-VITEST-PLUGIN
  - COMPONENT-COMPILER-CLI
---

# standalone.go

`Compile(filename, src, mode, assetsDir)` runs split → parse → codegen without a bundler: `{#svg}` inlines instead of deduplicating into virtual modules, no module stamp is written, and a `lang="ts"` script is type-stripped with esbuild's transform API. `AssetsDirFor(path)` finds the nearest ancestor `app/` and returns its `assets/`. Two callers: `pzlc` (explicit `--mode`, writes the framework's compiled test fixtures) and the hidden `puzzle compile` (`compiler/cmd/puzzle/compilecmd.go`, mode from the D20 directory rule, prints to stdout for the Vitest plugin, [[DECISION-D193-VITEST-PLUGIN]]). Positioned split/parse/codegen errors pass through unchanged. Go tests: `compilecmd_test.go`.

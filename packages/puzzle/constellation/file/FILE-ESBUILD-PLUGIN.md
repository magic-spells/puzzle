---
name: pzl esbuild plugin
status: verified
path: compiler/internal/plugin/plugin.go
language: go
summary: In-memory pzl onLoad transform, CSS collection, and diagnostics.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: state
    text: >-
      `ScanUsage` + `SetUsage` are the only usage entry points; `SetUsage` builds the function set
      itself, with `escape` always present.
---

# plugin.go

The esbuild `onLoad` plugin for `*.pzl` ([[COMPONENT-ESBUILD-PLUGIN]]), all in
memory per file: split sections → `codegen.Compile` → JS. Parse/codegen errors
become positioned esbuild messages, and a failed file emits nothing.
Every positioned `.pzl` plugin message uses `sourceLocation` for its code frame.

- `<style>` blocks go into a mutex-guarded map (esbuild runs `onLoad`
  concurrently) and are joined sorted by path, so `CSS()` output is deterministic.
- `relName` falls back to the absolute path for a `.pzl` outside the app root
  (symlinks, monorepos); callers must accept absolute paths
  ([[FILE-BUILD-PRERENDER-PAGES]]).
- A production SPA build compiles without the `Class.__pzlModule` stamp
  (`SetStripStamps`): only development diagnostics and the prerender passes read
  it. Every pass that shares one `CompileCache` must use the same setting.

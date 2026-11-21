---
name: pzl esbuild plugin
status: verified
path: compiler/internal/plugin/plugin.go
language: go
summary: In-memory pzl onLoad transform, CSS collection, and diagnostics.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
notes:
  - kind: state
    text: >-
      2026-11-08 trims: `ScanFormatters` and `(*Plugin).SetFormatters` are gone; `ScanUsage` +
      `SetUsage` are the only entry points (SetUsage builds the formatter set inline, `escape`
      always present). Plugin tests use a local `scanFormatters` helper over `ScanUsage`.
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

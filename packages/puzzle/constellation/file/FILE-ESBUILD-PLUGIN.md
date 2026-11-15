---
name: pzl esbuild plugin
status: verified
path: compiler/internal/plugin/plugin.go
language: go
summary: In-memory pzl onLoad transform, CSS collection, and diagnostics.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
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
become positioned esbuild messages, and a failed file emits nothing. The shared
message converter supplies the original source line, with zero-based byte columns
and point locations (no invented token span). It uses the caller's source bytes;
errors naming an SVG asset use that asset's cached bytes, never the importing
`.pzl` line. Build and dev share this path; `check` reports its own diagnostics.

- `<style>` blocks go into a mutex-guarded map (esbuild runs `onLoad`
  concurrently) and are joined sorted by path, so `CSS()` output is deterministic.
- `relName` falls back to the absolute path for a `.pzl` outside the app root
  (symlinks, monorepos); callers must accept absolute paths
  ([[FILE-BUILD-PRERENDER-PAGES]]).

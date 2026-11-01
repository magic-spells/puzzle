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
---

# plugin.go

The esbuild `onLoad` plugin for `*.pzl` ([[COMPONENT-ESBUILD-PLUGIN]]), all in
memory per file: split sections → `codegen.Compile` → JS. Parse/codegen errors
become positioned esbuild messages, and a failed file emits nothing.

- `<style>` blocks go into a mutex-guarded map (esbuild runs `onLoad`
  concurrently) and are joined sorted by path, so `CSS()` output is deterministic.
- `relName` falls back to the absolute path for a `.pzl` outside the app root
  (symlinks, monorepos); callers must accept absolute paths
  ([[FILE-BUILD-PRERENDER-PAGES]]).

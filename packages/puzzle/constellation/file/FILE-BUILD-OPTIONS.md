---
name: shared esbuild options
status: verified
path: compiler/internal/build/options.go
language: go
summary: Browser/prerender resolution aliases, targets, defines, and shared options.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# options.go

The esbuild options every pass shares: browser/prerender resolution aliases,
targets, defines, and the runtime source resolution (`configureRuntime`).
Behavioral intent stays on [[COMPONENT-ESBUILD-PLUGIN]].

Traps:

- **Splitting rides `bundleFlags`, never the shared options**
  ([[DECISION-D160-SPA-CODE-SPLITTING]]): set, the pass gains `Splitting` +
  `ChunkNames: "chunks/[name]-[hash]"`. esbuild rejects `Splitting` alongside the
  prerender pass's `Outfile`, so it cannot be global.
- **`HashEntry` is also a per-pass flag.** It sets `EntryNames: "[name]-[hash]"`
  only for a production SPA/hybrid entry; its CSS bundle follows esbuild's same
  naming rule. It must not leak onto the Node pass's `Outfile` or the static
  mode's discarded SPA output.
- **`AbsWorkingDir` stays unanchored on the SPA pass**, unlike the per-page pass:
  its metafile input keys are resolved against the process cwd by
  `metafileAllInputs`, which drives dev CSS pruning; anchoring would silently
  break that whenever the app root is not the cwd.
- **`configureRuntime` falls through silently** when no runtime source resolves.
  The user-facing guard is `build.PreflightRuntime` (`preflight.go`), which
  consults the same three sources in the same order — change the precedence in
  one and you must change it in the other.

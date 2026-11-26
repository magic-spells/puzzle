---
name: shared esbuild options
status: verified
path: compiler/internal/build/options.go
language: go
summary: Browser/prerender resolution aliases, targets, defines, and shared options.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: gotcha
    text: >-
      `bundleDefines` always defines the bare `import.meta.env` (`{}` without `env`), plus
      `import.meta.env.KEY` per key ([[DECISION-D190-CONFIG-ENV]]). esbuild turns any object-valued
      define into an injected `<define:...>` module imported by every parsed file: unused it emits
      nothing, but it shifts the minifier's names in every bundle. A primitive define (the
      `__PUZZLE_HAS_*__` flags) changes no bytes. Count that before adding another object define.
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
- **`configureRuntime` falls through silently** when no runtime source resolves,
  and it never compares versions: it runs on every esbuild pass and every dev
  rebuild and has no error path. The user-facing guard is `build.PreflightRuntime`
  (`preflight.go`), whose `PairRuntime` consults the same three sources in the
  same order and stops on a missing runtime or on an installed one across a
  breaking release from the CLI ([[DECISION-D202-CLI-RUNTIME-VERSION-PAIR]]) —
  change the precedence in one and you must change it in the other.

---
name: compiler build orchestrator
status: verified
path: compiler/internal/build/build.go
language: go
summary: Staged browser builds, assets, styles, validation, and atomic dist swap.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
  - DECISION-D153-PUZZLE-SCRATCH-DIR
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: state
    text: >-
      `cfg.Env` ([[DECISION-D190-CONFIG-ENV]]) rides `passContext.env` into both prerender passes
      and static pages, and `bundleFlags.Env` into the SPA pass, the same way `i18n` is threaded;
      every pass reaches `bundleDefines`.
---

# build.go

One-shot builds: stages browser output, assets, styles and public files into a
staging dir under `<root>/.puzzle/tmp` ([[DECISION-D153-PUZZLE-SCRATCH-DIR]]) and
swaps it into `dist/` only when every step succeeds, so a failed build keeps the
last good output ([[FLOW-BUILD]]).

- **Splitting is resolved before `ValidatePublic`**
  (`cfg.Splitting() && mode != "static"`, [[DECISION-D160-SPA-CODE-SPLITTING]]):
  static mode deletes this pass's `app.js` before the swap, so splitting it would
  strand chunks nothing imports. `ValidatePublic` reserves the root-level `chunks/`
  name only while splitting is on — an app that never opts in keeps its
  `public/chunks/`, which is why `chunks` is not in `reservedOutputNames`.
- **Hashing** ([[DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD]]):
  `hash := !opts.Development && cfg.HashNames()`; static mode's discarded SPA entry stays fixed.
  When `cfg.Build.HashNames` is nil (default-on, not explicit), the
  [[FILE-BUILD-SHELL]] pre-check runs before bundling and clears `hashEntry` /
  `hashStyles` for a file the public HTML cannot follow, with one warning each. An
  explicit `true` skips the check: the stylesheet is hashed even when unlinked and
  a missing entry reference fails the build.
- After public assets are copied, the shell rewrite (and, with splitting, its
  static-import preloads) runs before either prerender mode reads the shell.

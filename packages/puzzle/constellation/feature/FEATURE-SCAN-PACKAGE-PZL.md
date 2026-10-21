---
name: Usage scan reads .pzl files from installed packages
status: built
release: RELEASE-V0-9-0
change: feature
branch: feat/scan-package-pzl
connections:
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D85-FLIP-ATTRIBUTE
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-VIEW-MANAGER
  - FILE-BUILD-OPTIONS
  - FLOW-BUILD
  - FLOW-DEV-REBUILD
  - DOC-SPEC-BUILD
  - DOC-RELEASE-SURFACE
---

# Usage scan reads .pzl files from installed packages

A component package that ships `.pzl` source (an agent kit's message list, a
widget library) is compiled by the app's build like any first-party
template. The usage scan pruned `node_modules`, so the package's features
were defined false and stripped: a package component calling `raw()` threw
"#html reached the DOM" in production only, and its library functions fell
through to the missing-name guard. Apps worked around it with a shim
component in their own tree that used each feature once.

The design record is [[DECISION-D89-FEATURE-USAGE-TREESHAKE]], rewritten in
place (no new decision number).

## What ships


- **Package walk** (`compiler/internal/plugin/scanpkg.go`). After the project
  walk, `UsageScanner.Scan` visits the `node_modules` under the scan root and
  each ancestor. A package counts when its `package.json` lists
  `@magic-spells/puzzle` in `peerDependencies` or `dependencies`; Puzzle
  itself and apps (the scan root or an ancestor, or a directory with a
  `puzzle.config.js`) never count. Scoped and unscoped packages, the nested
  `node_modules` of every package, and the `node_modules` holding a linked or
  counted package's real directory (store layouts) are covered. Only `.pzl`
  files are read inside a package, through the same `scanFileUsage` and memo,
  with their `lazy()` match dropped; `example/`, `examples/`, `test/`, `tests/`
  and `__tests__/` at the package root are skipped. Every directory is visited
  by real path, so linked packages are read once, and only link entries pay
  for resolving one. Uncounted packages cost one `package.json` read and
  their files are never read; classifications are memoized by manifest stamp.
- **Per-file check** (`compiler/internal/plugin/usagecheck.go`). `Usage`
  gains `PZLFiles` (the `.pzl` files the scan read). The `.pzl` OnLoad
  records the usage of any compiled `.pzl` outside that set, and an esbuild
  OnEnd callback fails the pass when one needs a compiled-out gate or a
  library function the manifest lacks. The advice reads the owning package's
  manifest: declare Puzzle, or (when it already does) why the walk skipped
  the file. It runs on every pass, one-shot and incremental, and filters
  records by the pass's metafile graph so a dropped import clears the error.
  In dev it surfaces as the ordinary rebuild error.
- **Runtime text.** `metadataTagError` (`views/ViewNode.js`) and the dev-only
  flip/Portal compiled-out warnings (`views/viewManager.js`) state the real
  rule: `.pzl` source only, from the app and from declaring packages;
  pre-compiled component JavaScript is unsupported. All are dev-only strings,
  so production bytes are unchanged.

## Out of scope

- Pre-compiled component packages (compiled JavaScript emitting Puzzle
  vnodes) stay unsupported.
- The dev watcher stays on the project: installing a package, or editing a
  package's manifest, needs a `puzzle dev` restart. The check's error says so.
- A package's Tailwind classes: the app's `@source` scan is a separate
  concern.

## Tests


- `plugin/scanpkg_test.go`: declaring packages (scoped/peer, unscoped/deps,
  nested) contribute bits and functions, including from `dist/`; undeclared,
  malformed, manifest-less packages, Puzzle itself, package scripts, the
  `lazy()` match of package templates, package dot-dirs and root-level
  example/test folders do not; a Puzzle package under a plain parent is found
  (npm nested and store layout); workspace apps and an ancestor workspace root
  linked into `node_modules` are skipped; ancestor `node_modules`; linked and
  store-layout packages read once by real path; a long-lived scanner tracks
  manifest edits; the check errors on an undeclared package (file, features,
  peerDependencies hint, restart note), passes when features are already on
  or no `Usage` was set, follows the module graph across incremental
  rebuilds, and picks its advice from the owning manifest (a linked undeclared
  checkout vs a declaring package's skipped folder).
  `BenchmarkPackageWalkFlat` tracks the warm rescan of 3,000 flat packages.
- `build/package_pzl_test.go`: a production static build importing
  `@x/kit/Message.pzl` (which uses `raw()`) from a declaring package
  prerenders the sanitized markup and ships the sanitizer; the same app with
  an undeclared package fails before `dist/` exists; `WatchBuilder` reports it
  through the rebuild error.
- `TestStaticBuildScansUsageOnce` holds: the package walk is part of the one
  scan.

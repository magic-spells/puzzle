---
name: D199 — the 0.10 upgrade pass, `puzzle check --fix`
status: verified
connections:
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D174-FUNCTION-LIBRARY
  - DECISION-D191-SET-STATE-GET-STATE
  - DECISION-D197-SHARE
  - DECISION-D20-PUZZLE-VIEW-ELEMENT
  - DECISION-D32-CLI-TOOLING
  - COMPONENT-COMPILER-CLI
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC-BUILD
code_refs:
  - compiler/internal/codemod/codemod.go
  - compiler/internal/codemod/codemod_test.go
  - compiler/internal/codemod/testdata/
  - compiler/cmd/puzzle/checkcmd.go
  - compiler/internal/codegen/outletwarn.go
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# D199 — the 0.10 upgrade pass, `puzzle check --fix`

0.10 renames four things an app writes, and each old spelling fails loudly
with a message naming the new one. `puzzle check` finds every site before it
type-checks; `puzzle check --fix` rewrites them. The pass is part of `check`
rather than a separate command because `check` is what an upgrading author
(and CI) already runs, and code written for 0.9 would otherwise surface as
type errors that never say what changed. D176 shipped no codemod for its
pipe-to-function change because Puzzle had no outside users then; 0.10 is the
first release published for outside feedback, so its renames get one.

| 0.9 | 0.10 | Old spelling fails as |
|---|---|---|
| `this.setData(` | `this.setState(` ([[DECISION-D191-SET-STATE-GET-STATE]]) | a TypeError: no such method |
| `data(params, props)` | `data({ params, props })` ([[DECISION-D197-SHARE]]) | wrong values at runtime |
| bare `<Slot/>` | `<Outlet/>` in a layout or view, `<Children/>` in a component ([[DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS]]) | a positioned compile error |
| `formatters:` config key, `app/formatters.js` | `functions:`, `app/functions.js` ([[DECISION-D174-FUNCTION-LIBRARY]]) | a throw at startup |

## Rules

- **Dry run by default.** `puzzle check` lists each site as
  `file:line:col  old → new` and exits non-zero before the type check, so CI
  on an un-upgraded app fails with the command that fixes it. `--fix`
  rewrites the files, then type-checks; with no TypeScript installed it says
  it skipped the type check and exits zero, since the fix did its job.
- **A CLI across a breaking release from the project's install stops first.**
  `check` and `check --fix` call `build.PairRuntime` before the pass
  ([[DECISION-D202-CLI-RUNTIME-VERSION-PAIR]]), so code is never rewritten for
  the wrong release.
- **Idempotent.** Every rewrite produces a spelling no rule matches, so a
  second run reports nothing. The fixture tests run the pass twice.
- **Which tag replaces a bare `<Slot/>` is decided by file kind** (D20):
  `app/layouts/**` and `app/views/**` get `<Outlet/>`, everything else
  `<Children/>`. A bare `<Slot>` that hands values to a caller's `<Snippet>`
  (`<Slot item={ item }/>`) always becomes `<Children>`, since `<Outlet>`
  takes no attributes. The paired form keeps its fallback body and its
  closing tag is renamed with it. The parser finds the sites, so markers in
  comments, `{#raw}` and strings are left alone.
- **`data()` and `share()` declarations** with one or two positional
  parameters become one destructured object: the first is `params`, the
  second `props`. A declaration is a method directly in a class body (any
  class in a `.pzl` script, so a local base class counts); a call named
  `data` or `share`, or an object's method of that name, is not one. A name
  that matches stays shorthand, another becomes
  `params: _params`, defaults stay (`props = {}`), and a `lang="ts"`
  declaration's parameter types move onto an inline object type. Rest
  parameters, more than two parameters and a parameter list holding a
  comment are listed, not rewritten.
- **`setData(` is rewritten only on `this.` and `super.`**, and never in a
  file that defines its own `setData`. `dataTransfer.setData` and
  `clipboardData.setData` are DOM methods and are skipped silently; any other
  receiver is listed for the author to judge.
- **The config key is renamed only where the pass can see the config**: the
  object literal passed to `new PuzzleApp(…)`, `createTestApp(…)` and
  `mountView(…, options)`. Shorthand `formatters` becomes
  `functions: formatters` so no binding changes. A config passed by name is
  listed. `app/formatters.{js,ts}` moves to `app/functions.{js,ts}` (never
  over an existing file) and imports of it follow.
- **It reads `app/` and `tests/`** (`.pzl`, `.js`, `.mjs`, `.ts`), skipping
  `node_modules`, dotted files and folders, the public folder (the build
  copies it to `dist` as it is) and `.d.ts` files. That list is
  `codemod.SourceFiles`, and the type check takes its `.pzl` files under
  `app/` from the same list. An error the pass hits, such as a file it cannot
  read, write or rename, stops `puzzle check` with that error.

## Alternatives rejected

- **A separate codemod command** — `puzzle upgrade` already means installing a
  newer Puzzle, and a second command an author must know about is one they
  skip. Folding the pass into `check` means the upgrade surfaces the
  first time they check, and CI catches an app that skipped it.
- **Rewrite by default, `--dry-run` to preview** — a tool named `check` that
  edits files when run bare would surprise; the dry run is the safe default
  and the listing is what CI needs.
- **Text substitution** — a regex cannot tell a router outlet in a template
  from one in a comment, a string or `{#raw}`, or a positional `data(` from a
  call to some other `data`. The pass uses the parser for templates and the
  compiler's script tokenizer for scripts.
- **Deprecation warnings for one release instead of errors** — Puzzle is
  pre-1.0 and each old spelling has a mechanical fix; a warning that still
  compiles lets the old spelling spread through copied and generated code.

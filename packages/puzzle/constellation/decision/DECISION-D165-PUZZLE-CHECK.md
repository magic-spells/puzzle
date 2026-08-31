---
name: 'D165 — `puzzle check`: virtual files + the app''s own tsc, never a TypeScript API (v1.78)'
status: built
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D54-TYPESCRIPT-SCRIPTS
  - DECISION-D32-CLI-TOOLING
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - DOC-SPEC-BUILD
  - DOC-RELEASE-SURFACE
  - RELEASE-V0-7-0
---


`puzzle check` type-checks an app's `.pzl` files — script bodies *and* template
expressions — by emitting virtual TypeScript beside the app and running the
app's own `tsc` over it, then remapping every diagnostic back to the authored
`.pzl` line and column. Shipped in v1.78; `compiler/internal/check` plus
`compiler/cmd/puzzle/checkcmd.go`.

```
$ puzzle check
app/views/Profile.pzl:14:22: Property 'nmae' does not exist on type 'User'.
```

Until now nothing checked a `.pzl`. `lang="ts"` is transpile-only (D54), the
build never type-checks, and the scaffolded `tsc --noEmit` sees standalone
`.ts`/`.js` files but not a single byte inside a `.pzl`. That is the largest
remaining gap between Puzzle and the frameworks it is measured against, and it
is felt hardest where Puzzle is otherwise strongest: a template expression is
ordinary JavaScript against ordinary class fields, so `{ user.nmae }` is
mechanically checkable and simply was not checked.

## The hard constraint that shapes everything

**Nothing may be built on TypeScript 6-era compiler APIs.** No embedded
language service, no Volar, no `typescript` import — the owner's explicit rule,
and the reason this feature exists at all rather than waiting. TypeScript 7 is
a Go rewrite whose stable tooling API is not shipped; anything written against
today's JS compiler APIs would be rework the moment it lands. What *is* stable
across the transition is the CLI: `tsc --noEmit`, its `Version x.y.z` banner,
and its `file(line,col): error TSxxxx: message` diagnostic line. The whole
design is "everything we need, addressed only through the CLI protocol", and it
is verified live against tsc **4.9.5, 5.7.3, and 7.0.2**.

## The design

**Emit virtual files, do not transform in memory.** Each `.pzl` under `app/`
becomes one or two files under `.puzzle/check/src/` (D153's scratch dir),
mirroring the app tree. `Generate` clears and rebuilds the whole workspace each
run, so a deleted `.pzl` cannot leave a ghost.

**The script is copied verbatim; the template becomes a wrapper function.** A
`lang="ts"` component emits one `.pzl.ts` file: the script bytes exactly as
authored, then a generated `void function (this: InstanceType<typeof Class> &
Record<string, any>): void { … }` that is never executed and exists only to
give every template expression a typed home. `{#if}`/`{#case}` become real
`if`/`switch`, `{#for}` becomes a call to a declared `__puzzle_check_each`
whose item type is destructured out of the collection with a conditional type
(a plain `readonly T[]` parameter would infer `unknown` from an untyped
collection and turn every loop-variable read into a false positive), formatter
pipes become `__puzzle_check_formatter(name, value, …args)` calls, and an
`@event` binding is assigned to an
`((event: any) => any) | null`-typed const so the handler-shape rules are
checked too. The root `<puzzle-view>` tag's own attributes are real bindings and
are checked like any other element's; `<puzzle-skeleton>` is walked in the same
pass.

**A JavaScript component emits a two-file pair.** `<name>.pzl.script.js` is an
unchecked mirror of the script body (`checkJs: false`), and `<name>.pzl.ts` is
the checked template wrapper that imports it. Ordinary JavaScript is not
silently promoted into `checkJs`, so the command is useful on a JS app without
drowning it in inference noise. The `.script` infix is load-bearing: without it
TypeScript's extension substitution resolves the wrapper's import of
`./X.pzl.js` back to the sibling `X.pzl.ts` — the wrapper importing itself.

**Positions come from a byte-exact segment table, not a source map.** Every
range copied out of the `.pzl` is recorded as a `Segment` pairing generated and
source line/column/offset; generated scaffolding and inserted `__d.` prefixes
carry no segment and therefore can never be mistaken for authored code. The
expression writer walks the codegen-resolved string against the authored one and
maps only the bytes they share — `ResolveCheckExpr` is insertion-only by
contract, and an unexpected byte is left unmapped rather than given a
manufactured position. Tables are written as `.segments.json` sidecars beside
each virtual file; the runner reloads them and rewrites matching diagnostic
lines, passing anything it cannot map through untouched.

**The tsconfig is generated, version-aware, and defensive.** The app's own
`tsconfig.json` is `extends`-ed when present so the app's `strict`, `lib`, and
`paths` settings are the ones enforced — but every option that would turn
`extends` into garbage is overridden, each for an observed failure, not a
precaution: `rootDir` (an app `rootDir: "app"` makes every emitted file TS6059
and nothing is checked), `composite: false` (a composite project may not
disable emit), `skipLibCheck` (the shim pulls in framework `.d.ts` files, whose
errors carry no `.pzl` position and nothing the user can act on), and
`noUnusedLocals`/`noUnusedParameters` (the wrapper's synthetic bindings are not
authored code). `include` spells out extensions rather than `src/**/*`, because
an app with `resolveJsonModule` would otherwise pull every segment sidecar into
the program; `exclude` is forced empty, because an inherited exclude of
`.puzzle` would exclude the entire generated workspace and tsc would fail with
"No inputs were found".

The version split is the TypeScript 7 accommodation: the runner probes
`tsc --version` **once** per run and reads the major. For 7 and up, `baseUrl`
and `moduleResolution` are cleared to JSON `null` (both were removed, and
`paths` is replaced because targets inherited from a `baseUrl` config may be
non-relative, which is illegal once `baseUrl` is gone). Below 7, the proven
`moduleResolution: "node"` + `baseUrl` pair is kept, because `module: ESNext`
defaults to classic resolution on the oldest supported compiler and package
imports would not resolve.

**One bad file does not abort the run.** A `.pzl` that fails to parse or compile
is collected as an already-positioned diagnostic and skipped; the rest of the
app still checks, because nothing links the virtual files to each other. Its
diagnostic is printed alongside the type errors — it is a real failure of the
run and the reason that file is absent from everything tsc just checked.

**tsc is resolved, never installed.** `node_modules/.bin/tsc` (`tsc.cmd` under
`cmd.exe` on Windows) or the message
`puzzle check needs TypeScript: npm install -D typescript`. Puzzle does not
install a compiler for you (D3's posture applied to tooling). "You are not in a
Puzzle project" is checked *before* "TypeScript is missing", so a wrong working
directory is never reported as a missing dependency.

## Scope of what is actually typed

Template expressions are checked against the component class's **declared
fields** — `this` in the wrapper is `InstanceType<typeof Class> &
Record<string, any>`, and `__d` is that same value. So a typo in a declared
field or a misused method signature is caught; a read of a `data()`-derived key
falls through the index signature and is not.

**Inferring `data()` shapes cross-file is explicitly out of scope.** The owner
rejected build-time dynamic structure inference outright: it means guessing at
what a method returns across files and reporting errors the author cannot see
the basis for. Template expressions over `data()` values stay untyped in v1.
A cheap follow-up exists if the demand shows up — point the wrapper's `this`
type at `data()`'s own declared return type instead of the bare index signature
— but it is not shipped and is not promised. The `--js` flag (checking JS script
bodies) is declared and deliberately errors as not implemented, reserving the
spelling.

## Alternatives rejected

- **Volar-style language tooling** (a virtual-file language service, an LSP,
  editor-level checking). It is the right long-term shape and it is *deferred*,
  not refused: every existing implementation is built on the TypeScript 6 JS
  compiler API, which is the one thing this work may not depend on. Revisit when
  the official TS 7 tooling API lands; the segment tables emitted here are
  already the data structure such a service would need.
- **A type checker inside the Go compiler.** Reimplementing TypeScript's
  inference is a multi-year project that would be wrong in ways users cannot
  predict, and it would diverge from the compiler the app's editor uses. The
  app's own tsc is the only checker whose verdict matches what the author sees
  in their editor.
- **Type-checking during `puzzle build`.** Rejected: the build stays fast and
  transpile-only (D54). Checking is a separate, opt-in command that a
  pre-commit hook or CI job runs.
- **An in-memory transform handed to tsc over stdin.** tsc has no such mode, and
  writing real files means the generated workspace is inspectable when a mapping
  looks wrong — the `.puzzle/check/` tree is the debugging surface.
- **Source maps instead of segment tables.** A source map is lossy at the
  column level and describes emitted *output*; the segment table records
  byte-identical ranges only, which is what makes an unmappable diagnostic
  detectable rather than silently misplaced.
- **Promoting JS components into `checkJs`.** It turns every untyped app into a
  wall of inference noise on the first run. The unchecked mirror keeps the
  template win available to JS apps at zero cost.

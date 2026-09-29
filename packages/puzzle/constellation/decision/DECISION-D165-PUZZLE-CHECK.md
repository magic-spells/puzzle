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
  - DECISION-D166-SNIPPETS
  - DOC-SPEC-BUILD
  - DOC-RELEASE-SURFACE
  - RELEASE-V0-7-0
notes:
  - kind: gotcha
    text: >-
      Every emitted expression statement must be parenthesized: `void` binds tighter than every
      binary operator, so a bare `void a + 1` type-checks `undefined + 1` — it reported "Object is
      possibly 'undefined'" on a correct `{ a + 1 }` under a strict app tsconfig while checking
      nothing about the expression the author wrote. `emitVoid` always parenthesized;
      `emitInterpolation` did not, and every interpolation carrying an operator was that false
      positive until it was fixed pre-0.7.0.
  - kind: gotcha
    text: >-
      The shim's `libraryFunctionSignatures` table is a hand copy of types/index.d.ts
      `LibraryFunctions` with its aliases (TranslationVars, DatePreset, LocaleArgument) spelled out,
      and it drifted once: `t` took `Record<string, unknown>` vars (rejecting an interface or
      class-instance value, and null) and date/time/datetime took one locale string and any preset
      string. TestLibrarySignaturesMatchPublicTypes (check/expr_test.go) now parses LibraryFunctions
      and fails on any difference in parameter names, types or return type; the one allowed
      difference is a shim parameter widened to `unknown` (t's key). Change both files together.
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
is verified live against tsc **4.9.5, 5.2.2, 5.7.3, 5.9.3, 6.0.3, and
7.0.2**.

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
collection and turn every loop-variable read into a false positive). Every
template expression is written by codegen's own lowerer, from the tree the
parser built — its check target ([[DECISION-D176-EXPRESSION-LANGUAGE]] rule
8) — so a standard library call becomes `__puzzle_fn.name(…)` and any other
bare call, an app function, `__puzzle_app_fn("name")(…)` (typed as described
under *Scope* below). An `@event` binding is assigned to an
`((event: any) => any) | null`-typed const so the handler-shape rules are
checked too; inside it the free `event` is the DOM event, and a template that
also reads `event` as data is codegen's rule 7 error, which this command
reports like any compile error. The root `<puzzle-view>` tag's own attributes
are real bindings and are checked like any other element's;
`<puzzle-skeleton>` is walked in the same pass.

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
expression writer is the lowerer's `WriteCheckValue`/`WriteCheckEvent`: its
`CheckWriter` writes every authored token of a template expression — a name, a
property, a literal — mapped at that token's AST position, so nothing is
matched by comparing strings and no byte gets a manufactured position. The
runner rewrites matching diagnostic lines from the run's own in-memory tables
and the bytes it emitted, passing anything it cannot map through untouched —
never a re-read, so a save while tsc is running cannot shift a reported
position. Tables are also written as `.segments.json` sidecars beside each
virtual file, for inspection.

**The tsconfig is generated, version-aware, and defensive.** The app's own
`tsconfig.json` is `extends`-ed when present so the app's `strict`, `lib`, and
`paths` settings are the ones enforced (`paths` merged, as below) — but every
option that would turn `extends` into garbage is overridden, each for an
observed failure, not a precaution: `rootDir` (an app `rootDir: "app"` makes
every emitted file TS6059 and nothing is checked), `composite: false` (a
composite project may not disable emit), `skipLibCheck` (the shim pulls in
framework `.d.ts` files, whose errors carry no `.pzl` position and nothing the
user can act on), and `noUnusedLocals`/`noUnusedParameters` (the wrapper's
synthetic bindings are not authored code). `include` spells out extensions
rather than `src/**/*`, because an app with `resolveJsonModule` would otherwise
pull every segment sidecar into the program; `exclude` is forced empty,
because an inherited exclude of `.puzzle` would exclude the entire generated
workspace and tsc would fail with "No inputs were found".

The version split is the TypeScript 6/7 accommodation: the runner probes
`tsc --version` **once** per run and reads the major. For 6 and up, `baseUrl`
and `moduleResolution` are cleared to JSON `null` (TypeScript 7 removed both;
TypeScript 6 deprecates both, an error unless the app sets
`ignoreDeprecations`), so a `paths` target resolves from the generated
config's directory. Below 6, the proven `moduleResolution: "node"` + `baseUrl`
pair is kept, because `module: ESNext` defaults to classic resolution on the
oldest supported compiler and package imports would not resolve — and
`module` is pinned to `ESNext` beside it, because an app's `node16`/`nodenext`
module rejects node resolution (TS5109). Pinning it drops the default-import
interop those module modes imply, so `allowSyntheticDefaultImports` is set
with it: otherwise a default import of an `export =` package that the app's
own tsc accepts is TS1259. The check emits nothing, and esbuild interops those
imports anyway.

`paths` is always written, never inherited: an inherited target is relative to
the app's `baseUrl` or tsconfig rather than to the generated config, and may be
non-relative, which is illegal once `baseUrl` is gone. The runner reads the app
tsconfig's own `compilerOptions.paths` (tolerating tsconfig's comments and
trailing commas), rewrites each relative target to resolve from
`.puzzle/check/` — through the app's `baseUrl` when it set one — and merges the
entries beside the `@/*` → `app/*` alias, which is written last and wins a
clash: the build aliases `@` to `app/` in esbuild, whose alias beats tsconfig
`paths`, so the check resolves it the same way. The
app's `extends` chain is not followed: `paths` or a `baseUrl` the app inherits
from another config do not reach the check, and a config the runner cannot
parse contributes nothing but the `@` alias.

With **no** app tsconfig the generated config supplies `target: ES2020` and
`module: ESNext` and turns `strict` and `noImplicitAny` off — TypeScript 6 and
7 default `strict` on, which held a plain-JavaScript app to checks it never
opted into (`'__d.stats' is possibly 'undefined'` across examples/stress).

**One bad file does not abort the run.** A `.pzl` that fails to parse or compile
is collected as an already-positioned diagnostic and skipped; the rest of the
app still checks, because nothing links the virtual files to each other. Its
diagnostic is printed alongside the type errors — it is a real failure of the
run and the reason that file is absent from everything tsc just checked.

**tsc is resolved, never installed, and always run under `node`.** The runner
resolves the app's own `node_modules/typescript/bin/tsc` — the plain JavaScript
entry every `.bin` shim points at, under npm, pnpm, and yarn layouts alike — and
executes `node <that path> …` with `node` taken from `PATH`. Missing TypeScript
is the message `puzzle check needs TypeScript: npm install -D typescript`; a
missing `node` is its counterpart, `puzzle check needs Node.js on PATH: it runs
the app's TypeScript compiler`. Puzzle does not install a compiler for you (D3's
posture applied to tooling). "You are not in a Puzzle project" is checked
*before* "TypeScript is missing", so a wrong working directory is never reported
as a missing dependency.

The `.bin` shims are deliberately not used, and that is a **bug fix, not a
preference**: the Windows shim is a `tsc.cmd` batch file, so it had to run as
`cmd.exe /d /s /c <path> args…`, and `/s` strips the first and last quote on the
line — the quotes Go put around a path containing a space. Any Windows project
under `C:\Users\Cory Schulz\…` therefore ran `C:\Users\Cory` instead of the
compiler and failed at the version probe with "read TypeScript version: exit
status 1". Running the JS entry under `node` is one code path on every OS, and
`node` is already a hard prerequisite — the app's TypeScript is npm-installed.

## Scope of what is actually typed


Template expressions are checked against the component class's **declared
fields** — `this` in the wrapper is `InstanceType<typeof Class> &
Record<string, any>`, and `__d` is that same value. So a typo in a declared
field or a misused method signature is caught; a read of a `data()`-derived key
falls through the index signature and is not. One consequence under an app's
`noPropertyAccessFromIndexSignature`: a dotted read of a `data()`-only field
(`__d.total`) is itself a diagnostic, because it resolves through that index
signature — a known gap, not fixed.

**A JavaScript component's handlers take any arguments, and must be
declared.** Its handler parameters are whatever TypeScript infers from untyped
JS — `play: () => {}` takes nothing — so the documented
`@click={ play(event) }`, legal JavaScript, would be an arity error at every
such site. For a JS component the wrapper's `this` is
`__PuzzleCheckJSView<InstanceType<typeof Class>> & Record<string, any>`: the
shim type replaces `events` with a mapped type over its keys that types each
handler `(...args: any[]) => any`. That drops the handler's arity and
parameter types, and it closes the set of handler **names**: TypeScript reads
a JS object literal as open, so without the mapped type a misspelled handler
was never reported, and with it `plya(event)` is
`Property 'plya' does not exist`. The consequence is that a JS component's
template handlers must be declared in its `events` field — a handler attached
at runtime (`this.events.play = …` in the constructor or `created()`) is
reported. The argument expressions are still checked where they are written.
DOM events and component callback props both lower to `this.events.name(…)`,
so both are covered. A `lang="ts"` component is never wrapped: its handlers
are declared, and a call that does not match one is reported.

**Library calls are typed by name, never through an index signature.** A
standard function emits `__puzzle_fn.name(…)` and is checked against its real
signature (`libraryFunctionSignatures`). Any other bare call — an app function
from the `formatters` config — emits `__puzzle_app_fn("name")(…)`, declared
`(name: string) => (...args: any[]) => any`, so it is untyped but never
"possibly undefined": `__PuzzleFunctions` has no index signature, and an app
call type-checks under `noUncheckedIndexedAccess`. The emitter keeps the
author's spelling where the render target adds safety — no `?.` guards and no
`?? {}` default on `Object.keys`/`values`/`entries` (TypeScript 5.6+ reports a
`??` whose left side can never be nullish) — and it runs the same codegen, so a
compile error such as a template that reads `event` as data and also uses it
in a handler (D176 rule 7) is reported here too.

**Every expression the compiler emits is walked**, which includes the D166
composition surface: a marker's arguments (`<Slot name="x" total={ … }>`,
`<Children item={ … }>`) go through the same attribute-expression path as an
element's bindings, and a `<Snippet item index>` body is walked inside a
`__puzzle_check_snippet((item, index) => { … })` call so its parameters are
declared bindings that shadow caller data exactly as codegen scopes them, while
every other name in the body still resolves against the caller's view instance.
Snippet parameters are typed `any`: their values come from the marker arguments
in the *component's* template, a different `.pzl` this command checks
independently, so there is nothing in the caller's file to infer from — unlike a
loop variable, whose type `__puzzle_check_each` destructures out of the
collection expression standing right there. The shim declares no composition
marker names: the emitter never writes a marker's TAG into the virtual file,
only its argument expressions, so a `Children`/`Slot`/`Portal`/`Snippet`
declaration there would name nothing.

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
- **Checking a JS handler's inferred arity, and asking authors to write the
  bare form instead.** `@click={ play }` compiles to the same code as
  `@click={ play(event) }`, but the call form is the documented idiom and legal
  JavaScript; flagging it is the inference noise the unchecked mirror exists to
  avoid (examples/music alone reported 39 such sites). Typing a JS component's
  `events` as plain `any` would also have removed the arity errors, but it
  checks nothing about handler names; the mapped type over `events`' keys
  reports a misspelled handler, which neither `any` nor the open object-literal
  type the JS mirror infers ever did.
- **Inferring a snippet parameter's type from the marker that fills it.** It is
  the same cross-file guess `data()` inference was rejected for, one file
  further out: the marker lives in the component's `.pzl`, which the walk
  reaches only by resolving the caller's component import and re-deriving that
  file's marker arguments. `any` reports nothing rather than reporting the wrong
  thing, and the parameters are still *declared*, so a body that misspells one
  is a `Cannot find name` at the right column.

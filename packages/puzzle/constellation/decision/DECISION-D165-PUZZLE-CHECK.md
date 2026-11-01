---
name: 'D165 — `puzzle check`: virtual files + the app''s own tsc, never a TypeScript API'
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
---

# D165 — `puzzle check`: virtual files + the app's own tsc

`puzzle check [dir]` type-checks an app's `.pzl` files — script bodies and template expressions — by emitting virtual TypeScript under `.puzzle/check/`, running the app's own `tsc --noEmit`, and remapping every diagnostic to the authored `.pzl` line and column. Code: `compiler/internal/check`, `compiler/cmd/puzzle/checkcmd.go`.

```
$ puzzle check
app/views/Profile.pzl:14:22: Property 'nmae' does not exist on type 'User'.
```

## Context

`lang="ts"` is transpile-only (D54) and the build never type-checks, yet a template expression is a closed JavaScript-shaped expression against class fields (D176), so `{ user.nmae }` is mechanically checkable. **Hard constraint (Cory's rule): nothing is built on TypeScript compiler APIs** — no language service, no Volar, no `typescript` import. TS 7 is a Go rewrite with no stable tooling API; what stays stable is the CLI: `tsc --noEmit`, the `Version x.y.z` banner, and the `file(line,col): error TSxxxx:` line.

## Decision

**Virtual files.** Each `.pzl` under `app/` becomes files under `.puzzle/check/src/` (D153 scratch dir), mirroring the tree; the workspace is rebuilt every run so a deleted file leaves no ghost.
- `lang="ts"`: one `.pzl.ts` — the script verbatim, then a never-executed `void function (this: InstanceType<typeof Class> & { [key: string]: any }): void { const __d = this; … }` that gives every template expression a typed home.
- JavaScript: a pair — `<name>.pzl.script.js` (unchecked mirror, `checkJs: false`) and the checked `<name>.pzl.ts` wrapper that imports it. The `.script` infix is load-bearing: without it TS extension substitution resolves `./X.pzl.js` to the wrapper itself.

**Template lowering** uses codegen's own lowerer (`WriteCheckValue` / `WriteCheckEvent`) over the parser's tree:
- `{#if}`/`{#case}` → `if`/`switch`; `{#for}` → `__puzzle_check_each`, whose item type is destructured from the collection with a conditional type (a `readonly T[]` parameter would infer `unknown` from untyped collections).
- A standard-library call → `__puzzle_fn.name(…)`, typed by `libraryFunctionSignatures`; any other bare call (an app function from the `formatters` config) → `__puzzle_app_fn("name")(…)`, typed `(...args: any[]) => any` — a call, not an index signature, so it survives `noUncheckedIndexedAccess`.
- A method call with an arrow argument takes its receiver through `__puzzle_check_list(…)`, so untyped receivers give `any` params. Methods map 1:1 onto `lib.d.ts`; the shim references the lib files the D176 method table needs whatever the app's `target` (`languageLibs` in `emitter.go`).
- `@event` bindings are assigned to a `((event: any) => any) | null` const; inside, free `event` is the DOM event.
- Every emitted expression statement is parenthesized — `void a + 1` would check `undefined + 1`.
- The author's spelling is kept: no added `?.` guards and no `?? {}` on `Object.keys/values/entries` (TS 5.6+ reports a `??` that can never be nullish).
- Root `<puzzle-view>` attributes and `<puzzle-skeleton>` are walked too. D166 marker arguments go through the attribute path; a `<Snippet item index>` body is walked inside `__puzzle_check_snippet((item, index) => { … })` so its parameters shadow caller data as codegen scopes them. Snippet parameters are `any` (their values come from another file).

**`libraryFunctionSignatures` (`check/emitter.go`) is a hand copy of `types/index.d.ts` `LibraryFunctions`** with aliases spelled out. `TestLibrarySignaturesMatchPublicTypes` fails on any difference except a shim parameter widened to `unknown` (t's key); `TestLibrarySignaturesMatchCodegen` keeps its names equal to `codegen.LibraryFunctionNames`. Change all three together.

**Positions come from a byte-exact segment table**, not a source map. Every range copied from the `.pzl` is a `Segment` (generated ↔ source line/column/offset); scaffolding and `__d.` prefixes have no segment, so they are never mistaken for authored code. The runner rewrites diagnostics from the run's in-memory tables (never a re-read — a save mid-run can't shift positions) and passes unmappable lines through. Tables are also written as `.segments.json` sidecars.

**Generated tsconfig** `extends` the app's `tsconfig.json` when present (so its `strict`, `lib` apply), overriding what breaks under `extends`: `rootDir` (TS6059), `composite: false`, `skipLibCheck` (framework `.d.ts` errors have no `.pzl` position), `noUnusedLocals`/`noUnusedParameters` (synthetic bindings). `include` spells out extensions (so `resolveJsonModule` doesn't pull in sidecars); `exclude` is forced empty (an inherited `.puzzle` exclude means "No inputs were found").
- `tsc --version` is probed once per run. TS ≥ 6: `baseUrl` and `moduleResolution` are set to JSON `null` (removed in 7, deprecated in 6). Older compilers get `moduleResolution: "node"` + `baseUrl`, `module: ESNext` and `allowSyntheticDefaultImports`; only TS 6/7 matter going forward.
- `paths` is always written, never inherited: the app's own `compilerOptions.paths` (comments and trailing commas tolerated) is rebased to `.puzzle/check/` through the app's `baseUrl` and merged with `@/*` → `app/*`, written last so it wins (esbuild's alias beats tsconfig paths). The app's `extends` chain is not followed.
- No app tsconfig: `target: ES2020`, `module: ESNext`, `strict` and `noImplicitAny` off (TS 6/7 default strict on).

**One bad file doesn't abort.** A `.pzl` that fails to parse or compile becomes a positioned diagnostic printed with the type errors and is skipped; the virtual files don't link to each other.

**tsc is resolved, never installed, always run under `node`:** `node <app>/node_modules/typescript/bin/tsc …` (works under npm, pnpm, yarn). Errors: `puzzle check needs TypeScript: npm install -D typescript`, `puzzle check needs Node.js on PATH: …`; "not in a Puzzle project" is checked first. The `.bin` shims are avoided on purpose: Windows `tsc.cmd` must run via `cmd.exe /s`, which strips the quotes around a path with a space.

**Scope of typing.**
- Expressions check against the class's declared fields; `data()`-derived keys fall through the inline `{ [key: string]: any }` and are unchecked (known gap: under `noPropertyAccessFromIndexSignature` a dotted `data()`-only read is itself a diagnostic). The fallback is an inline index signature, not `Record`, so an authored class named `Record` cannot capture it.
- A JS component's `this` is `__PuzzleCheckJSView<InstanceType<typeof Class>> & { [key: string]: any }`, which types each declared `events` handler `(...args: any[]) => any`: arity is not checked (`@click={ play(event) }` against `play: () => {}` passes), but names are — `plya(event)`, or a handler attached at runtime instead of declared in `events`, is reported. `lang="ts"` components check against their declared handlers.
- `PuzzleView.events` is optional in `types/index.d.ts` (the base class has none), so a template handler on a view that declares no `events` reports "possibly 'undefined'" — a real runtime TypeError.
- `--js` (also checking JS script bodies) is a hidden flag that errors as not implemented.

## Alternatives rejected

- Volar-style language service / LSP — the right long-term shape, deferred until the TS 7 tooling API ships; the segment tables are the data it would need.
- A type checker in the Go compiler — years of work, and it would disagree with the editor's tsc.
- Type-checking in `puzzle build` — the build stays fast and transpile-only; `check` is opt-in for CI or pre-commit.
- Source maps instead of segments — lossy at column level; segments make an unmappable diagnostic detectable.
- Promoting JS components into `checkJs` — a wall of inference noise on untyped apps.
- Checking JS handler arity — flags the documented `play(event)` idiom everywhere.
- Inferring `data()` or snippet-parameter types cross-file — guesses the author can't see the basis for. A possible follow-up: type the wrapper's `this` from `data()`'s declared return type.

## Consequences

JS and TS apps both get template checking with no dependency beyond their own TypeScript. JS components must declare template handlers in `events`.

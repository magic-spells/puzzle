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
  - RELEASE-V0-7-0
---

`puzzle check` type-checks an app's `.pzl` files — script bodies and template expressions — by emitting virtual TypeScript under `.puzzle/check/`, running the app's own `tsc --noEmit`, and remapping every diagnostic to the authored `.pzl` line and column. Code: `compiler/internal/check` and `compiler/cmd/puzzle/checkcmd.go`.

```
$ puzzle check
app/views/Profile.pzl:14:22: Property 'nmae' does not exist on type 'User'.
```

## Context

`lang="ts"` is transpile-only (D54) and the build never type-checks, yet a template expression is ordinary JavaScript against class fields, so `{ user.nmae }` is mechanically checkable. **Hard constraint (owner's rule): nothing may be built on TypeScript 6-era compiler APIs** — no language service, no Volar, no `typescript` import. TS 7 is a Go rewrite without a stable tooling API; what is stable across the transition is the CLI (`tsc --noEmit`, the `Version x.y.z` banner, the `file(line,col): error TSxxxx:` line). Verified live against tsc 4.9, 5.2, 5.7, 5.9, 6.0 and 7.0.

## Decision

**Virtual files.** Each `.pzl` under `app/` becomes files under `.puzzle/check/src/` (D153 scratch dir), mirroring the tree; `Generate` rebuilds the workspace each run so deleted files leave no ghost.
- `lang="ts"`: one `.pzl.ts` — the script verbatim, then a never-executed `void function (this: InstanceType<typeof Class> & Record<string, any>): void { const __d = this; … }` giving every template expression a typed home.
- JavaScript: a pair — `<name>.pzl.script.js` (unchecked mirror, `checkJs: false`) and the checked `<name>.pzl.ts` wrapper that imports it. The `.script` infix is load-bearing: without it TS extension substitution resolves `./X.pzl.js` to the wrapper itself.

**Template lowering** uses codegen's own lowerer (`WriteCheckValue`/`WriteCheckEvent`, D176 rule 8), from the parser's tree:
- `{#if}`/`{#case}` → `if`/`switch`; `{#for}` → `__puzzle_check_each`, whose item type is destructured from the collection with a conditional type (a `readonly T[]` parameter infers `unknown` from untyped collections).
- A standard-library call → `__puzzle_fn.name(…)`, checked against `libraryFunctionSignatures`; any other bare call (an app function from the `formatters` config) → `__puzzle_app_fn("name")(…)`, typed `(name: string) => (...args: any[]) => any` — untyped but never "possibly undefined" (no index signature, so it survives `noUncheckedIndexedAccess`).
- `@event` bindings are assigned to a `((event: any) => any) | null` const; inside, free `event` is the DOM event. D176 rule 7 errors are reported like any compile error.
- Every emitted expression statement is parenthesized — `void a + 1` would type-check `undefined + 1`.
- The author's spelling is kept: no `?.` guards and no `?? {}` on `Object.keys/values/entries` (TS 5.6+ reports a `??` that can never be nullish).
- Root `<puzzle-view>` attributes and `<puzzle-skeleton>` are walked too. D166 marker arguments (`<Slot name="x" total={ … }>`, `<Children item={ … }>`) go through the attribute path; a `<Snippet item index>` body is walked inside `__puzzle_check_snippet((item, index) => { … })` so its parameters shadow caller data as codegen scopes them. Snippet parameters are `any` (their values come from another `.pzl`). The shim declares no marker names — marker tags are never written.

**`libraryFunctionSignatures` is a hand copy of `types/index.d.ts` `LibraryFunctions`** with aliases spelled out. `TestLibrarySignaturesMatchPublicTypes` (`check/expr_test.go`) fails on any difference except a shim parameter widened to `unknown` (t's key). Change both together.

**Positions come from a byte-exact segment table**, not a source map. Every range copied from the `.pzl` is a `Segment` (generated ↔ source line/column/offset); scaffolding and `__d.` prefixes have no segment, so they can never be mistaken for authored code. `CheckWriter` maps each authored token at its AST position. The runner rewrites diagnostics from the run's in-memory tables (never a re-read — a save mid-run can't shift positions) and passes unmappable lines through. Tables are also written as `.segments.json` sidecars.

**Generated tsconfig** `extends` the app's `tsconfig.json` when present (so its `strict`, `lib` apply), overriding what breaks under `extends`: `rootDir` (TS6059), `composite: false`, `skipLibCheck` (framework `.d.ts` errors have no `.pzl` position), `noUnusedLocals`/`noUnusedParameters` (synthetic bindings). `include` spells out extensions (so `resolveJsonModule` doesn't pull sidecars in); `exclude` is forced empty (an inherited `.puzzle` exclude means "No inputs were found").
- Version split: `tsc --version` is probed once per run. For ≥ 6, `baseUrl` and `moduleResolution` are set to JSON `null` (removed in 7, deprecated in 6). Below 6: `moduleResolution: "node"` + `baseUrl`, `module: ESNext` (node16/nodenext rejects node resolution, TS5109), and `allowSyntheticDefaultImports` (else TS1259 on `export =` defaults).
- `paths` is always written, never inherited: the app's own `compilerOptions.paths` (comments and trailing commas tolerated) is rebased to `.puzzle/check/` through the app's `baseUrl`, and merged with `@/*` → `app/*`, written last so it wins (esbuild's alias beats tsconfig paths). The app's `extends` chain is not followed.
- No app tsconfig: `target: ES2020`, `module: ESNext`, `strict` and `noImplicitAny` off (TS 6/7 default strict on).

**One bad file doesn't abort.** A `.pzl` that fails to parse/compile becomes a positioned diagnostic printed with the type errors, and is skipped; the virtual files don't link to each other.

**tsc is resolved, never installed, always run under `node`:** `node <app>/node_modules/typescript/bin/tsc …` (works under npm, pnpm, yarn). Messages: `puzzle check needs TypeScript: npm install -D typescript` and `puzzle check needs Node.js on PATH: …`. "Not in a Puzzle project" is checked first. The `.bin` shims are avoided on purpose: the Windows `tsc.cmd` must run via `cmd.exe /s`, which strips the quotes around a path with a space.

**Scope of typing.** Expressions check against the class's declared fields; `data()`-derived keys fall through `Record<string, any>` and are unchecked (under `noPropertyAccessFromIndexSignature` a dotted `data()`-only read is itself a diagnostic — known gap). For a JS component, `this` is `__PuzzleCheckJSView<InstanceType<typeof Class>> & Record<string, any>`, which types each `events` handler `(...args: any[]) => any`: arity is not checked (so `@click={ play(event) }` against `play: () => {}` passes), but handler names are — `plya(event)` is reported, and a handler attached at runtime rather than declared in `events` is reported. `lang="ts"` components are checked against their declared handlers. `--js` (checking JS script bodies) is reserved and errors as not implemented.

## Alternatives

- Volar-style language service / LSP — the right long-term shape, deferred until the TS 7 tooling API ships; the segment tables are the data it would need.
- A type checker in the Go compiler — years of work, and it would disagree with the editor's tsc.
- Type-checking in `puzzle build` — the build stays fast and transpile-only; `check` is opt-in for CI or pre-commit.
- Source maps instead of segments — lossy at column level; segments make an unmappable diagnostic detectable.
- Promoting JS components into `checkJs` — a wall of inference noise on untyped apps.
- Checking JS handler arity — flags the documented `play(event)` idiom everywhere.
- Inferring `data()` or snippet-parameter types cross-file — guesses the author can't see the basis for. A possible follow-up: type the wrapper's `this` from `data()`'s declared return type.

## Consequences

JS and TS apps both get template checking with no new dependency beyond their own TypeScript. JS components must declare template handlers in `events`.

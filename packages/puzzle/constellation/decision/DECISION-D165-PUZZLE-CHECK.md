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
notes:
  - kind: state
    text: >-
      2026-11-08 (feat/0.10-types-devtools, review F10 B2): the `[key: string]: any` index
      signatures on the `Store` and `Router` interfaces in types/index.d.ts are gone, so
      `this.ctx.store.findall()` / `this.ctx.router?.pushh()` in a lang="ts" view are now errors
      ("Did you mean 'push'?") and fixture-only `seed()` type-checks only where
      `@magic-spells/puzzle/fixtures` is imported (D98). `puzzle check` is clean on all 22 examples;
      test:types and test:runtime-types pass. Also removed the unreferenced `StoreOptions` and
      `PuzzleValue` exports (noted in the 0.10.0 CHANGELOG under Breaking).
---

# D165 — `puzzle check`: virtual files + the app's own tsc

`puzzle check [dir]` type-checks an app's `.pzl` files — script bodies and template expressions — by emitting virtual TypeScript under `.puzzle/check/`, running the app's own `tsc --noEmit`, and remapping every diagnostic to the authored `.pzl` line and column. Code: `compiler/internal/check`, `compiler/cmd/puzzle/checkcmd.go`.

```
$ puzzle check
app/components/TodoItem.pzl:11:16: Property 'remov' does not exist on type '{ toggle: (event: Event) => void; remove: (event: Event) => void; }'. Did you mean 'remove'?
```

## Context

`lang="ts"` is transpile-only (D54) and the build never type-checks, yet a template expression is a closed JavaScript-shaped expression (D176), so it can be re-emitted as TypeScript and checked. **Hard constraint (Cory's rule): nothing is built on TypeScript compiler APIs** — no language service, no Volar, no `typescript` import. TS 7 is a Go rewrite with no stable tooling API; what stays stable is the CLI: `tsc --noEmit`, the `Version x.y.z` banner, and the `file(line,col): error TSxxxx:` line. **TypeScript 7 is the floor** (Cory: "we're on TS7 and up, we don't need to support old TS at all").

## Decision

**Virtual files.** Each `.pzl` under `app/` becomes files under `.puzzle/check/src/` (D153 scratch dir), mirroring the tree; the workspace is rebuilt every run so a deleted file leaves no ghost.
- `lang="ts"`: one `.pzl.ts` — the script verbatim, then a never-executed `void function (this: InstanceType<typeof Class>): void { const __d: any = this; … }`: `this` types handler names against the view's `events`; template data reads `__d`, which is `any`.
- JavaScript: a pair — `<name>.pzl.script.js` (unchecked mirror, `checkJs: false`) and the checked `<name>.pzl.ts` wrapper that imports it. The `.script` infix is load-bearing: without it TS extension substitution resolves `./X.pzl.js` to the wrapper itself.

**Template lowering** uses codegen's own lowerer (`WriteCheckValue` / `WriteCheckEvent`) over the parser's tree:
- `{#if}`/`{#case}` → `if`/`switch`; `{#for}` → `__puzzle_check_each`, whose item type is destructured from the collection with a conditional type (a `readonly T[]` parameter would infer `unknown` from untyped collections).
- A standard-library call → `__puzzle_fn.name(…)`, typed by `libraryFunctionSignatures`; any other bare call (an app function from the `functions` config) → `__puzzle_app_fn("name")(…)`, typed `(...args: any[]) => any` — a call, not an index signature, so it survives `noUncheckedIndexedAccess`.
- A method call with an arrow argument takes its receiver through `__puzzle_check_list(…)`, so untyped receivers give `any` params. An `Object.keys`/`values`/`entries` argument goes through it too: TypeScript infers `values`' and `entries`' element type from an `any` argument as `unknown`, so a walk over untyped data would report "is of type 'unknown'" on a correct template; a typed argument passes through unchanged. Methods map 1:1 onto `lib.d.ts`; the shim references the lib files the D176 method table needs (ES2016–ES2023 string, array and object libs) whatever the app's `target` (`languageLibs` in `emitter.go`).
- `@event` bindings are assigned to a `((event: any) => any) | null` const; inside, free `event` is the DOM event.
- Every emitted expression statement is parenthesized — `void a + 1` would check `undefined + 1`.
- The author's spelling is kept: no added `?.` guards and no `?? {}` on `Object.keys/values/entries` (tsc reports a `??` that can never be nullish).
- Root `<puzzle-view>` attributes and `<puzzle-skeleton>` are walked too. D166 marker arguments go through the attribute path; a `<Snippet item index>` body is walked inside `__puzzle_check_snippet((item, index) => { … })` so its parameters shadow caller data as codegen scopes them. Snippet parameters are `any` (their values come from another file).

**`libraryFunctionSignatures` (`check/emitter.go`) is a hand copy of `types/index.d.ts` `LibraryFunctions`** with aliases spelled out. `TestLibrarySignaturesMatchPublicTypes` fails on any difference except a shim parameter widened to `unknown` (t's key); `TestLibrarySignaturesMatchCodegen` keeps its names equal to `codegen.LibraryFunctionNames`. Change all three together.

**Positions come from a byte-exact segment table**, not a source map. Every range copied from the `.pzl` is a `Segment` (generated ↔ source line/column/offset); scaffolding and `__d.` prefixes have no segment, so they are never mistaken for authored code. The runner rewrites diagnostics from the run's in-memory tables (never a re-read — a save mid-run can't shift positions) and passes unmappable lines through. Tables are also written as `.segments.json` sidecars.

**Generated tsconfig** `extends` the app's `tsconfig.json` when present (so its `strict`, `lib`, `module` apply), overriding what breaks under `extends`: `rootDir` (TS6059), `composite: false`, `skipLibCheck` (framework `.d.ts` errors have no `.pzl` position), `noUnusedLocals`/`noUnusedParameters` (synthetic bindings). `include` spells out extensions (so `resolveJsonModule` doesn't pull in sidecars); `exclude` is forced empty (an inherited `.puzzle` exclude means "No inputs were found").
- `baseUrl` and `moduleResolution` are set to JSON `null`, clearing whatever the app sets: TypeScript 7 removed both `baseUrl` and node10 resolution.
- `paths` is always written, never inherited: the app's own `compilerOptions.paths` (comments and trailing commas tolerated) is rebased to `.puzzle/check/` through the app's `baseUrl` and merged with `@/*` → `../../app/*`, written last so it wins (esbuild's alias beats tsconfig paths). The app's `extends` chain is not followed.
- No app tsconfig: `target: ES2020`, `module: ESNext`, `strict` and `noImplicitAny` off (TS 7 defaults strict on).

**One bad file doesn't abort.** A `.pzl` that fails to parse or compile becomes a positioned diagnostic printed with the type errors and is skipped; the virtual files don't link to each other.

**tsc is resolved, never installed, always run under `node`:** `node <dir>/node_modules/typescript/bin/tsc …`, where `<dir>` is the app or its nearest ancestor holding that file — a lexical walk up from the absolute app path (`fsutil.FindUp`; a symlinked project directory is not resolved first), so an npm or Yarn 1 workspace root's hoisted install is found; pnpm links it into the app's own `node_modules`. `tsc --version` is read once per run, before anything is generated; a major below 7 stops the run with `puzzle check needs TypeScript 7 or later, found 5.9.3: npm install -D typescript@latest`. Other errors: `puzzle check needs TypeScript: npm install -D typescript`, `puzzle check needs Node.js on PATH: …`; "not in a Puzzle project" is checked first. The `.bin` shims are avoided on purpose: Windows `tsc.cmd` must run via `cmd.exe /s`, which strips the quotes around a path with a space.

**Scope of typing.**
- Template data is untyped: the wrapper's `__d` is `any`, because a template reads `getData()` — what `data()` returns plus local state (`setState()`) — not the class's fields. A misspelled or mistyped data read (`{ user.nmae }`) is not reported, and neither is a `<Component is>` selector's data or module read, which reads like data; a typed sub-expression inside a selector (`cards[round(kind).missing]`) is still checked. `Object.values`/`entries` over data give `any` values. `this` stays typed, so handler names are checked against `events`.
- A JS component's `this` is `__PuzzleCheckJSView<InstanceType<typeof Class>>`, which types each declared `events` handler `(...args: any[]) => any`: arity is not checked (`@click={ play(event) }` against `play: () => {}` passes), but names are — `plya(event)`, or a handler attached at runtime instead of declared in `events`, is reported. `lang="ts"` components check against their declared handlers.
- `PuzzleView.events` is optional in `types/index.d.ts` (the base class has none), so a template handler on a view that declares no `events` reports "possibly 'undefined'" — a real runtime TypeError.

## Alternatives rejected

- Volar-style language service / LSP — the right long-term shape, deferred until the TS 7 tooling API ships; the segment tables are the data it would need.
- A type checker in the Go compiler — years of work, and it would disagree with the editor's tsc.
- Type-checking in `puzzle build` — the build stays fast and transpile-only; `check` is opt-in for CI or pre-commit.
- Source maps instead of segments — lossy at column level; segments make an unmappable diagnostic detectable.
- Promoting JS components into `checkJs` — a wall of inference noise on untyped apps.
- Checking JS handler arity — flags the documented `play(event)` idiom everywhere.
- Inferring `data()` or snippet-parameter types cross-file — guesses the author can't see the basis for.
- Typing template data against the class's declared fields — the template reads `getData()`, not the instance, so it reports false errors (a TS `private` field mirrored in `data()`, a nullable field normalised there, a data key named `events`), breaks the documented `cards[embed.type]` under strict, and makes dotted data reads TS4111 under `noPropertyAccessFromIndexSignature`. Typing `__d` from `data()`'s return type misses local state, which `getData()` also carries. An explicit `Object.values<any>(…)` for the Object globals drops lib's non-generic overload, which makes `Object.values(<number>)` a new error and untypes a literal's values.
- Supporting compilers before TypeScript 7 — a second tsconfig shape (`baseUrl` + `node` resolution, pinned `module`, `allowSyntheticDefaultImports`) and version-gated lib references, kept alive for compilers nobody runs. TS 7, the native Go compiler, is the only one Puzzle targets, and an older one is refused with a clear error rather than half-supported.

## Consequences

JS and TS apps both get template checking with no dependency beyond their own TypeScript 7. JS components must declare template handlers in `events`.

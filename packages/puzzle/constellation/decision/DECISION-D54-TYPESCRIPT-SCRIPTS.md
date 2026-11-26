---
name: >-
  D54 — TypeScript: `<script lang="ts">` transpile-only, an `app/app.ts` entry, typed scaffolds and
  stubs
status: verified
verified_at: '2026-11-26T05:26:02.017Z'
connections:
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D09-GO-ESBUILD-COMPILER
  - DECISION-D32-CLI-TOOLING
  - DECISION-D165-PUZZLE-CHECK
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
  - DOC-COMPILER-DESIGN
  - DECISION-D197-SHARE
code_refs:
  - compiler/cmd/puzzle/initcmd.go
  - compiler/cmd/pzlc/main.go
  - compiler/internal/plugin/plugin.go
  - compiler/internal/scaffold/scaffold.go
  - starters/default-ts
  - starters/static-ts
  - compiler/internal/build/entry.go
  - compiler/internal/generate/generate.go
  - compiler/internal/generate/templates.go
verified_sha: 2f5f6d0cebefc1d6b3c8f4cde3f4b4795d3e78c3
---

# D54 — TypeScript: `<script lang="ts">`, transpile-only

A `.pzl` opts its script into TypeScript with `<script lang="ts">`; esbuild strips the types. The Go compiler still never parses the script ([[DECISION-D03-SCRIPTS-REAL-JS]]). A TypeScript app also gets an `app/app.ts` entry, a typed scaffold and typed `generate` stubs. See [[DOC-SPEC-ANATOMY]] §25.

## Decision

- **`lang` attribute.** `lang="ts"` → TypeScript; absent or `lang="js"` → JavaScript. Any other or empty value, a dynamic `lang={…}`, or a second attribute is a positioned compile error (did-you-mean for `"typescript"`). The section splitter reads it into `Sections.ScriptsLang`. `.pzl` stays the only extension.
- **Transpile-only.** No type-checking in the build; the editor and `puzzle check` ([[DECISION-D165-PUZZLE-CHECK]]) own correctness.
- **One loader for the whole module.** The generated module is the user's script verbatim plus an injected runtime import and the appended `Name.prototype.render` — plain JS, which is valid TS — so the plugin sets `Loader: LoaderTS` for `lang="ts"`. Standalone `pzlc` strips types with esbuild's Transform API so its output stays runnable JS. Codegen bytes are identical either way.
- **Typings.** `types/index.d.ts` types the package exports (wired via `exports.types`); the shipped `puzzle-env.d.ts` declares `'*.pzl'` as `typeof PuzzleView<any>` for editors — an untyped view, so the instance of an import has `any` props (bare `typeof PuzzleView` is the generic constructor, whose `InstanceType` is `PuzzleView<unknown>`). Under `puzzle check` a `.pzl` import resolves to the component's own virtual file and carries the real class.
- **Typed props: `PuzzleView<Props = any>`.** The type parameter types `this.props`, the `props` of `data()`'s input (`DataInput<Props>`, [[DECISION-D197-SHARE]]; an override declaring another shape is an error) and `afterUpdate`'s `prev.props` (`PrevViewState<Props>`); `/testing` reads it off the view for `mountView`'s `props` option and `setProps()`. A plain `extends PuzzleView` is `PuzzleView<any>`, so untyped views compile unchanged. The TypeScript scaffolds, the TypeScript `puzzle generate` stubs that take props, and `examples/typed-todos` name the interface (`extends PuzzleView<TodoItemProps>`) and never cast `this.props`. Types only: the runtime class has no type parameter — its JSDoc types props `any`, and the drift check allows a declaration narrower than the runtime. A typed view is not assignable to the generic `typeof PuzzleView`; `PuzzleViewConstructor` is the type that takes any view constructor.
- **`import.meta.env`.** `puzzle-env.d.ts` also declares `ImportMetaEnv` and `ImportMeta.env`, so editors and `puzzle check` accept reads of config `env` values; an app augments `ImportMetaEnv` with its exact keys ([[DECISION-D190-CONFIG-ENV]]).
- **Entry: `app/app.ts` or `app/app.js`.** Both present is a hard error naming both; neither is "entry point not found". One helper, `build.ResolveEntry` (`compiler/internal/build/entry.go`), holds the rule for every consumer (build, dev watchers, both prerender passes, the `--fixtures` wrapper, `puzzle doctor`) — never re-derive it. A dev session's esbuild context is frozen over its starting entry, so a rebuild that resolves differently fails with "restart puzzle dev". Output stays `dist/app.js`. `puzzle.config.js` stays JavaScript (node reads it before bundling).
- **`puzzle init --typescript`** (or answering the prompt) lays an overlay `starters/<name>-ts/` over the base template. An overlay file replaces the base file at the same path, and an overlay `x.ts` drops the base `x.js` it ports. The overlay holds only what differs — every component as `<script lang="ts">` with typed data, props, events and hooks; `app/app.ts`; `routes.ts` and tests as `.ts`; the README; and a `package.json` that is the base plus `typescript` (`^7`) and a `"check": "puzzle check"` script. Init then writes a strict, noEmit `tsconfig.json` (with the `@` alias and the `puzzle-env.d.ts` include). Scaffold tests hold the TS variant to its JS twin (same markup, same package.json plus exactly those two additions) and type-check it with `puzzle check` under TypeScript 7; `release:prep` asserts the overlay framework ranges.
- **`puzzle generate` writes TypeScript in a TypeScript app** — one with a root `tsconfig.json` (`generate.IsTypeScriptApp`; a JavaScript scaffold gets `jsconfig.json`). Stubs use `<script lang="ts">` with named interfaces for props and the `data()` model and typed handlers (no `any`), keeping the JavaScript stub's markup and style; `model` writes `app/models/<name>.ts` with a fields interface and a `<Name>Record` type; a family barrel is `index.ts`. Both variants are pinned by goldens in `internal/generate/testdata/{js,ts}`.
- `examples/typed-todos` (entry `app/app.ts`) builds in the `pretest` example gate.

## Alternatives rejected

- A `.pzt` extension — multiplies surface everywhere a glob names `.pzl` (templates, Tailwind `@source`, editor grammars); an alias implying `lang="ts"` can layer on later.
- Type-checking in the build — slow, and drags the Go toolchain toward a TS type system.
- A per-project flag instead of a per-file attribute — JS and TS files must coexist during migration.
- `init --typescript` adding only a `tsconfig.json` — the answer changes nothing a user can see.
- Full duplicate `-ts` template trees — every style or config change would land twice; deriving the TS variant by transforming JS cannot author types.
- A JS `app/app.js` shim re-exporting `main.ts` — every TS app carries a JS file whose only job is satisfying the build.
- Picking one entry when both exist — two entries mean a half-finished migration.
- Detecting a TS app by `app/app.ts` or any `.ts` file — `tsconfig.json` is what makes an app type-check.
- Typing props by casting (`this.props as Props`) or a per-class `declare readonly props: Props` — a line per read or per class, and neither ties `data()`'s `props` parameter to the same interface.
- A `@template` on the runtime class to mirror `PuzzleView<Props>` — the runtime holds props as an untyped bag (`{}` defaults, `Record<string, any>` mount/preload options), so the parameter would need casts through mount, preload and refresh and check nothing.

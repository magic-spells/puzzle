---
name: >-
  D54 — TypeScript: `<script lang="ts">` transpile-only, an `app/app.ts` entry, typed scaffolds and
  stubs
status: built
verified_at: '2026-08-24T18:51:07.507Z'
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
code_refs:
  - compiler/cmd/puzzle/initcmd.go
  - compiler/cmd/pzlc/main.go
  - compiler/internal/plugin/plugin.go
  - compiler/internal/scaffold/scaffold.go
  - compiler/internal/scaffold/templates/default-ts
  - compiler/internal/scaffold/templates/todos-ts
  - compiler/internal/build/entry.go
  - compiler/internal/generate/generate.go
  - compiler/internal/generate/templates.go
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# D54 — TypeScript: `<script lang="ts">`, transpile-only

A `.pzl` opts its script into TypeScript with `<script lang="ts">`; esbuild strips the types. The Go compiler still never parses the script ([[DECISION-D03-SCRIPTS-REAL-JS]]). See [[DOC-SPEC-ANATOMY]] §25.

## Decision
- **`lang` attribute.** `lang="ts"` → TypeScript; absent or `lang="js"` → JavaScript. Any other or empty value, a dynamic `lang={…}`, or a second attribute is a positioned compile error (did-you-mean for `"typescript"`). The section splitter reads it into `Sections.ScriptsLang`. `.pzl` stays the only extension.
- **Transpile-only.** No type-checking in the build; the editor and `puzzle check` ([[DECISION-D165-PUZZLE-CHECK]]) own correctness.
- **One loader for the whole module.** The generated module is the user's script verbatim plus an injected runtime import and the appended `Name.prototype.render` — plain JS, which is valid TS — so the plugin sets `Loader: LoaderTS` for `lang="ts"`. Standalone `pzlc` strips types with esbuild's Transform API so its output stays runnable JS. Codegen bytes are identical either way.
- **Typings.** `types/index.d.ts` types the package exports (wired via `exports.types`); the shipped `puzzle-env.d.ts` declares `'*.pzl'` as `typeof PuzzleView` for editors. Under `puzzle check` a `.pzl` import resolves to the component's own virtual file and carries the real class.
- **Entry: `app/app.ts` or `app/app.js`.** Both present is a hard error naming both; neither is "entry point not found". One helper, `build.ResolveEntry` (`compiler/internal/build/entry.go`), holds the rule for every consumer: the one-shot build, both dev watchers, both prerender passes (including the static capture tier), the `--fixtures` wrapper and `puzzle doctor`. A dev session's esbuild context is frozen over its starting entry, so a rebuild that resolves differently fails with "restart puzzle dev". Output stays `dist/app.js`. `puzzle.config.js` stays JavaScript (node reads it before bundling).
- **`puzzle init --typescript`** (or answering the prompt) scaffolds a typed app: each template has an overlay `templates/<name>-ts/` laid over the base tree. An overlay file replaces the base file at the same path, and an overlay `x.ts` drops the base `x.js` it ports. The overlay holds only what differs — every component as `<script lang="ts">` with typed data, props, events and hooks; `app/app.ts`; `routes.ts` and models as `.ts`; the README; and a `package.json` adding `typescript` `^7` and `"check": "puzzle check"`. Init then writes a strict, noEmit `tsconfig.json` (with the `@` alias and the `puzzle-env.d.ts` include). Scaffold tests build and check both variants under TypeScript 6 and 7, pin the JavaScript output to the base template byte for byte, require each ported `.pzl` to keep its JavaScript twin's markup, and require each TypeScript `package.json` to equal its base plus exactly those two additions. `release:prep` asserts the overlay framework ranges too.
- **`puzzle generate` writes TypeScript in a TypeScript app** — one with a root `tsconfig.json` (`generate.IsTypeScriptApp`; a JavaScript scaffold gets `jsconfig.json`). Stubs use `<script lang="ts">` with named interfaces for props and the `data()` model and typed handlers (no `any`), keeping the JavaScript stub's markup and style byte for byte; `model` writes `app/models/<name>.ts` with a fields interface and a `<Name>Record` type; a family barrel is `index.ts`. JavaScript stubs are pinned by `internal/generate/testdata/js` goldens.

`examples/typed-todos` (entry `app/app.ts`) runs in the `pretest` example-build gate, which asserts the bundle has no TS syntax.

## Alternatives rejected
- A `.pzt` extension — multiplies surface everywhere a glob names `.pzl` (filters, templates, Tailwind `@source`, editor grammars); an alias implying `lang="ts"` can layer on later.
- Type-checking in the build — slow, and drags the Go toolchain toward a TS type system.
- A per-project flag instead of a per-file attribute — JS and TS files must coexist during migration.
- `init --typescript` adding only a `tsconfig.json` — the answer changed nothing a user could see.
- Full duplicate `-ts` template trees — every style or config change would land twice; deriving the TS variant by transforming JS cannot author types.
- A JS `app/app.js` shim re-exporting `main.ts` — every TS app carries a JS file whose only job is satisfying the build.
- Picking one entry when both exist — two entries mean a half-finished migration.
- Detecting a TS app by `app/app.ts` or any `.ts` file — `tsconfig.json` is what makes an app type-check.

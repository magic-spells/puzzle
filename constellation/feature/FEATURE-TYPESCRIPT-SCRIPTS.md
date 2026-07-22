---
name: "v1.22 — TypeScript scripts"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D54-TYPESCRIPT-SCRIPTS
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D32-CLI-TOOLING
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-COMPILER-DESIGN
---

# v1.22 — TypeScript scripts

First-class TypeScript in a `.pzl`, delivering the "(later) TypeScript works with
zero special tooling" promise of [[DECISION-D03-SCRIPTS-REAL-JS]]. Driven by
[[DECISION-D54-TYPESCRIPT-SCRIPTS]]; contract in [[DOC-SPEC]] §25.

## Intent

A component author writes `<scripts lang="ts">` and uses TypeScript — interfaces,
type annotations, `getData<T>()` — with the build stripping types transpile-only
(like Vite). No type-checking in the build; `.pzl` stays the only extension.

## Scope

**In (shipped):**
- **Parser** ([[COMPONENT-TEMPLATE-PARSER]], `sections.go`): the section splitter
  reads the `lang` attribute on `<scripts>` into `Sections.ScriptsLang`
  ("" | "ts"). Absent / `lang="js"` → "" (JS). Unknown value, empty value,
  dynamic `lang={…}`, or a second attribute → positioned compile error with a
  did-you-mean. Body stays opaque.
- **Plugin** ([[COMPONENT-ESBUILD-PLUGIN]], `plugin.go`): `lang="ts"` sets
  `Loader: api.LoaderTS` on the generated module so esbuild strips types across
  the mixed module (user TS + generated JS render tail). Absent → `LoaderJS`,
  byte-identical.
- **Standalone CLI** ([[COMPONENT-COMPILER-CLI]], `pzlc`): no bundler, so it runs
  esbuild's Transform API (`LoaderTS`, `FormatESModule`) to strip types; output
  stays runnable ESM JS.
- **Package typings:** hand-written `types/index.d.ts` (all four exports + config
  surface + store/router/formatters + `Route`/`ctx`), wired via package.json
  `exports.types`; `puzzle-env.d.ts` shim (`declare module '*.pzl'`). Both added
  to `files`.
- **CLI:** `puzzle init --typescript` (D32 surface) writes a strict/noEmit
  `tsconfig.json` (via `scaffold.WriteTypeScriptConfig`); refuses to clobber an
  existing one. Default stays JS.
- **Editor:** the Sublime grammar embeds `source.ts` for `<scripts lang="ts">`
  (the `lang="ts"` rule precedes the plain-JS rule).
- **Example:** `examples/typed-todos` — typed model (`todo.ts` + `TodoRecord`),
  typed routes, and `lang="ts"` `.pzl` files (typed `data()`/props/events).

**Out (deferred in D54):** the `.pzt` extension alias; type-checking in the
build; `tsc` invocation by `puzzle build`.

## Outcome

Shipped in v1.22. Parser (`ScriptsLang` + `parseScriptsLang`), plugin (loader
switch), pzlc (Transform pass), scaffold (`WriteTypeScriptConfig` + `--typescript`
flag), typings, Sublime grammar, and the `typed-todos` example. Codegen and the
runtime kernel are untouched — every JS `.pzl` compiles byte-for-byte as before
(all pre-existing goldens unchanged). New Go subtests in `sections_test.go`
(lang accepted + 6 error cases), `plugin_test.go` (TS transpiles + strips + bad
`lang` errors), and `initcmd_test.go` (tsconfig written, refuses clobber). The
`pretest` gate adds `build:typed-todos`, which asserts the bundle carries no TS
syntax. Full suite green: 480 vitest + all Go packages.

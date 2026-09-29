---
name: "D54 — TypeScript scripts: <script lang=\"ts\"> transpile-only via esbuild (v1.22)"
status: built
verified_at: '2026-08-24T18:51:07.507Z'
connections:
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D09-GO-ESBUILD-COMPILER
  - DECISION-D32-CLI-TOOLING
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - COMPONENT-CODEGEN
  - FEATURE-TYPESCRIPT-SCRIPTS
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
notes:
  - kind: verified
    text: Claims re-verified against the current Go compiler code; no drift found.
    sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# D54 — TypeScript scripts: `<script lang="ts">`, transpile-only (v1.22)

Cashes in the promise [[DECISION-D03-SCRIPTS-REAL-JS]] made — "Editors, ESLint,
Prettier, and (later) TypeScript work with zero special tooling." A `.pzl`
opts a component's logic into TypeScript with `<script lang="ts">`; esbuild
strips the types during the build. See [[DOC-SPEC-ANATOMY]] §25.

## Context
`<script>` is an opaque string the Go compiler never parses (D3); esbuild owns
the JS module graph (D9). TypeScript users had no first-class path — a `.pzl`
body had to be plain JS. The build already runs through esbuild, which transpiles
TS natively, so the enabling work is almost entirely **plumbing a flag**, not new
compilation.

## Decision

- **Mechanism: a `lang` attribute on `<script>`.** `lang="ts"` → TypeScript;
  absent or `lang="js"` → JavaScript (byte-identical to pre-v1.22). Any other
  value, an empty value, a dynamic `lang={…}`, or a second attribute is a
  positioned compile error (with a did-you-mean for near-misses like
  `"typescript"`). The parser (section splitter) reads the attribute exactly the
  way it reads `<puzzle-skeleton min-duration>` (D52); the body stays opaque —
  **the Go compiler still never parses TS.**
- **`.pzl` stays the only extension.** A `.pzt` alias was **considered and
  deferred** (see rejected alternatives).
- **Transpile-only, like Vite.** esbuild strips types; there is **no
  type-checking in the build**. Type safety is the editor's and `puzzle check`'s
  concern ([[DECISION-D165-PUZZLE-CHECK]]: the app's own tsc over `.pzl` scripts,
  template expressions and `.ts` modules). This keeps builds fast and the Go
  side ignorant of TS.
- **Loader threading.** The generated module is the user's `<script>` verbatim
  plus an injected runtime import and the appended
  `Name.prototype.render = function () {…}` (D10). Those generated parts are
  plain JS, which is valid TS, so **one loader covers the whole mixed module**:
  the esbuild plugin sets `Loader: LoaderTS` when `lang="ts"`; the standalone
  `pzlc` (no bundler) runs esbuild's Transform API to strip types so its output
  stays runnable ESM JS. Codegen is unchanged — it emits the same bytes; only the
  loader differs.
- **Package typings + shim.** Hand-written `types/index.d.ts` types the four
  exports (PuzzleApp config, PuzzleView, PuzzleModel + `Puzzle` builders, store/
  router/formatters), wired via package.json `exports.types`. A shipped
  `puzzle-env.d.ts` (`declare module '*.pzl'` → `typeof PuzzleView`) lets
  `import X from './X.pzl'` resolve in an editor; under `puzzle check` the
  import resolves to the component's own virtual file instead, so it carries the
  real class.
- **The build entry is `app/app.ts` or `app/app.js`.** The entry is
  `app/app.ts` when it exists, otherwise `app/app.js`; an app with **both** is a
  hard error naming both files — the build never guesses. One helper
  (`build.ResolveEntry`, `compiler/internal/build/entry.go`) holds the rule, and
  every consumer calls it: the one-shot build, the SPA and static dev watchers,
  both prerender passes (hybrid and static, including the static capture tier's
  page-entry import), the `--fixtures` wrapper, and `puzzle doctor`. Neither file
  is the long-standing "entry point not found" error. A dev session's esbuild
  context is frozen over the entry it started with, so each rebuild re-resolves
  and fails with "restart puzzle dev" once the answer changes (a second entry
  appears, or the entry is renamed). The output stays `dist/app.js`.
  `puzzle.config.js` stays JavaScript — node reads it before any bundling, and
  nothing in the app imports it.
- **`puzzle init --typescript` scaffolds a TypeScript app** (the D32 surface; the
  interactive `Use TypeScript? [y/N]` prompt is the same switch). The default
  stays JavaScript. Each template has a TypeScript variant, written as the
  template's tree with an overlay, `templates/<name>-ts/`, laid over it: an
  overlay file replaces the base file at the same path, and an overlay `x.ts`
  drops the base `x.js` it ports — which is how the overlay's `app/app.ts`
  removes the base `app/app.js`. The overlay carries only what a TypeScript
  app writes differently — every component as `<script lang="ts">` with typed
  `data()` return, props, events and lifecycle hooks; the `app/app.ts` entry
  (the app configured and mounted there directly), `routes.ts` and the todos
  models as `.ts` (a `Route[]`, a model plus its record type); the README; and
  a `package.json` adding `typescript` `^7` and a `"check": "puzzle check"`
  script — so styles, `public/` and `puzzle.config.js` stay single-sourced.
  Init then writes a strict/noEmit `tsconfig.json` (the `@` alias `paths`, the
  `puzzle-env.d.ts` include) that both the editor and `puzzle check` read. Both
  variants pass `puzzle check` clean under TypeScript 6 and 7; the scaffold
  tests build and check them, pin the JavaScript output to `templates/<name>/`
  byte for byte, require each ported `.pzl` to keep its JavaScript twin's
  markup, and require each TypeScript `package.json` to equal its base plus
  exactly the two additions.
- **`puzzle generate` writes TypeScript in a TypeScript app.** A TypeScript app
  is one with a `tsconfig.json` at the project root — the marker init writes (a
  JavaScript scaffold gets `jsconfig.json`); that is the one rule
  (`generate.IsTypeScriptApp`). There, component, view and layout stubs are
  `<script lang="ts">` with typed props and a typed `data()` model as named
  interfaces and typed event handlers (no `any`), in the scaffold's idiom and
  with the JavaScript stub's markup and style byte for byte; `model` writes
  `app/models/<name>.ts` with a fields interface and a `<Name>Record` type; a
  family's barrel is `index.ts` (the same bytes — they are valid TypeScript);
  and the registration hint names `app/models/index.ts` with an extensionless
  import. A JavaScript app's stubs are byte-identical to before, pinned by
  `internal/generate/testdata/js` goldens.

## Alternatives rejected

- **A `.pzt` file extension (implying `lang="ts"`).** Deferred, not refused. An
  extension alias multiplies surface everywhere a glob names `.pzl`: parser file
  filters, `generate`/`init` templates, Tailwind `@source` lines, editor
  grammars/file associations, and import specifiers. `<script lang="ts">` adds
  TypeScript with **zero new file-type surface**, matching how Vue/Svelte SFCs do
  it. An alias that simply implies `lang="ts"` can be layered on later without
  breaking anything.
- **Type-checking in the build.** Rejected — slow, and it drags the Go
  toolchain toward owning a TS type system it has no business owning. The
  separate `puzzle check` (D165) and the editor own correctness; the build owns
  speed.
- **A per-project config flag instead of a per-file attribute.** A file-local
  attribute lets JS and TS `.pzl` files coexist in one app during migration and
  keeps the signal next to the code esbuild loads.
- **`init --typescript` dropping only a `tsconfig.json` into the JavaScript
  starter.** Answering yes to "TypeScript?" then produced an app with no
  TypeScript in it — plain `<script>` bodies, `.js` modules, no `typescript`
  dependency and nothing that ran a check — so the choice did nothing a user
  could see. The scaffold is where a new app's conventions are set, so it writes
  the typed app.
- **Full duplicate template trees** (`default-ts/` as a complete app). Doubles
  the stylesheets, `public/` and config that do not differ, and every visual
  change would have to land twice. The overlay duplicates only the scripts,
  which cannot be shared.
- **Deriving the TypeScript variant by transforming the JavaScript files.** A
  rewrite can flip `<script>` to `<script lang="ts">` but cannot author types;
  the typed code has to be written, so it lives as files.
- **Keeping `app/app.js` as the only entry, with a one-line
  `export { default } from './main'` shim in TypeScript apps.** It worked, but
  every TypeScript app then carried a JavaScript file whose only job was to
  satisfy the build, and the real setup lived in a `main.ts` no convention
  named. Resolving `app/app.ts` is one helper the consumers already share.
- **Picking one entry when both exist** (TypeScript first, say). Two entries
  almost always mean a half-finished migration; silently building one of them
  ships whichever the rule favors while the developer edits the other.
- **Detecting a TypeScript app for `generate` by an `app/app.ts` entry, or by
  any `.ts` file.** `tsconfig.json` is what makes an app type-check — the
  editor and `puzzle check` both read it — and init writes it for exactly the
  TypeScript variant, so it is the marker a user can see and control.

## Consequences

Parser + plugin + CLI amendment; **codegen and the runtime kernel are
untouched** (render bytes identical; JS `.pzl` files compile byte-for-byte as
before). New surface: `Sections.ScriptsLang`, the plugin's loader switch, the
`pzlc` Transform pass, `types/index.d.ts` + `puzzle-env.d.ts`, `init
--typescript` and the `templates/<name>-ts/` overlays (whose `package.json`
framework ranges `release:prep` asserts beside the base templates'), the
`app/app.ts` entry (`build.ResolveEntry`), TypeScript `generate` stubs, the
Sublime grammar's `source.ts` embed, and `examples/typed-todos` (whose entry is
`app/app.ts`). Ships in the `pretest` example-build gate (asserts the bundle has
no TS syntax).

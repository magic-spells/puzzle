---
name: "D54 — TypeScript scripts: <script lang=\"ts\"> transpile-only via esbuild (v1.22)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
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
  - DOC-COMPILER-DESIGN
---

# D54 — TypeScript scripts: `<script lang="ts">`, transpile-only (v1.22)

Cashes in the promise [[DECISION-D03-SCRIPTS-REAL-JS]] made — "Editors, ESLint,
Prettier, and (later) TypeScript work with zero special tooling." A `.pzl`
opts a component's logic into TypeScript with `<script lang="ts">`; esbuild
strips the types during the build. See [[DOC-SPEC]] §25.

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
  type-checking in the build**. Type safety is an editor/`tsc --noEmit` concern.
  This keeps builds fast and the Go side ignorant of TS.
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
  `import X from './X.pzl'` resolve. `puzzle init --typescript` (D32 surface) adds
  a strict/noEmit `tsconfig.json`; the default stays JS.

## Alternatives rejected
- **A `.pzt` file extension (implying `lang="ts"`).** Deferred, not refused. An
  extension alias multiplies surface everywhere a glob names `.pzl`: parser file
  filters, `generate`/`init` templates, Tailwind `@source` lines, editor
  grammars/file associations, and import specifiers. `<script lang="ts">` adds
  TypeScript with **zero new file-type surface**, matching how Vue/Svelte SFCs do
  it. An alias that simply implies `lang="ts"` can be layered on later without
  breaking anything.
- **Type-checking in the build.** Rejected for v1.22 — slow, and it drags the Go
  toolchain toward owning a TS type system it has no business owning. `tsc
  --noEmit` / the editor own correctness; the build owns speed. (A future
  `puzzle doctor` tsc-presence note is fine; enforcement is not.)
- **A per-project config flag instead of a per-file attribute.** A file-local
  attribute lets JS and TS `.pzl` files coexist in one app during migration and
  keeps the signal next to the code esbuild loads.

## Consequences
Parser + plugin + CLI amendment; **codegen and the runtime kernel are
untouched** (render bytes identical; JS `.pzl` files compile byte-for-byte as
before). New surface: `Sections.ScriptsLang`, the plugin's loader switch, the
`pzlc` Transform pass, `types/index.d.ts` + `puzzle-env.d.ts`, `init
--typescript`, the Sublime grammar's `source.ts` embed, and `examples/typed-todos`.
Ships in the `pretest` example-build gate (asserts the bundle has no TS syntax).

---
name: Production shell and page asset rewriting
status: verified
path: compiler/internal/build/shell.go
language: go
summary: Metafile output names, static-import closures and production HTML modulepreloads.
connections:
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
  - FILE-BUILD
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-BUILD-OPTIONS
  - DOC-SPEC-BUILD
  - TEST-BUILD-AND-DEV-PIPELINE
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# shell.go

Production HTML rewriting for the shell (`public/index.html`), every other copied
public `.html`, and generated static pages: maps compiler names (`app.js`,
`app.css`, `styles.css`) to the emitted hashed names and inserts static-import
`modulepreload` links. Development skips all of it. Intent:
[[DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD]].

- **The pre-check runs before bundling** (`shellHashSupport` → `shellHashPlan`),
  only when `build.hashNames` is unset (default-on): esbuild's `EntryNames` is fixed
  per pass, so whether the entry can be hashed must be known up front. It walks the
  public dir itself (staging is not filled yet) and reports whether `index.html`
  loads `app.js` from a `<script src>` / references `styles.css`, and which other
  public pages name `app.js`/`app.css`/`styles.css` by their fixed names. Build
  keeps the fixed name for anything a page cannot follow and prints
  `hashFallbackWarning` once per file. It reuses the rewrite's tag scan
  (`rewriteShellHTMLRefs` with nil renames) so the two can never disagree.
- **`strict` = an explicit `hashNames: true`.** Only then does a compiler-name
  reference with no emitted output, or a missing shell/entry reference, fail the
  build. Unset hashing leaves such references as written.
- `rewriteShell` computes renames, runs `rewritePublicPages` over the other public
  pages (compiler-output references only, no preloads, file untouched when nothing
  changes), then rewrites the shell. Local references keep deployment prefixes,
  queries and fragments; remote URLs and copied public files that share a compiler
  name are left alone.
- **Metafile paths resolve against the emitting pass's working directory**: the
  SPA pass leaves `AbsWorkingDir` unset (cwd), the page pass anchors at staging;
  both against the symlink-resolved staging tree. The preload closure is
  breadth-first over static imports only — dynamic and external edges never enter.
- Preloads inherit the shell entry's prefix and verbatim `crossorigin` (or a static
  page's module base) and go on their own lines before `</head>`. A missing
  `</head>` is an error only when there is something to insert; a generated page
  with anything other than one module tag fails before the swap.
